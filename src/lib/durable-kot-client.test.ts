import { describe, expect, it, vi } from "vitest";
import {
  claimKitchenPrintObligation,
  finishKitchenPrintObligation,
  type KitchenPrintObligation,
} from "@/lib/kitchen-print-outbox";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import { dispatchDurableKitchenObligation } from "./durable-kot-client";

const obligation: KitchenPrintObligation = {
  id: "KPO-test",
  tenantId: "tenant-a",
  branchId: "branch-west",
  branch: "Westlands",
  orderId: "ORD-1",
  station: "MAIN KITCHEN",
  kind: "ORIGINAL",
  status: "PENDING",
  lines: [
    {
      id: "line-1",
      name: "Pilau",
      category: "Meals",
      quantity: 1,
      unitPrice: 900,
      productionStation: "MAIN KITCHEN",
      sentAt: "2026-09-29T01:00:00.000Z",
    },
  ],
  snapshot: {
    channel: "Walk-in",
    cashier: "Cashier",
    customer: "Walk-in",
    createdAt: "2026-09-29T01:00:00.000Z",
    subtotal: 900,
    tax: 0,
    total: 900,
  },
  createdAt: "2026-09-29T01:00:00.000Z",
  updatedAt: "2026-09-29T01:00:00.000Z",
};

describe("crash-safe KOT dispatch orchestration", () => {
  const createHarness = () => {
    let state = {
      ...createEmptyTransactionState(obligation.tenantId),
      kitchenPrintObligations: [{ ...obligation }],
    };
    const mutate = vi.fn(async (action: string, payload: unknown) => {
      const fields = payload as Record<string, string>;
      if (action === "claimKitchenPrintObligation") {
        state = {
          ...state,
          kitchenPrintObligations: claimKitchenPrintObligation(
            state.kitchenPrintObligations,
            fields.obligationId!,
            fields.claimId!,
            { id: "cashier-1" },
            "2026-09-29T01:00:10.000Z",
          ),
        };
      } else if (action === "finishKitchenPrintObligation") {
        state = {
          ...state,
          kitchenPrintObligations: finishKitchenPrintObligation(
            state.kitchenPrintObligations,
            fields.obligationId!,
            fields.claimId!,
            { id: "cashier-1" },
            fields.status as "SPOOLED" | "DIGITAL_QUEUED" | "UNCERTAIN",
            (payload as { bridgeJobIds: string[] }).bridgeJobIds,
            "2026-09-29T01:00:20.000Z",
            fields.reason,
          ),
        };
      } else {
        throw new Error("Unknown command");
      }
      return { state, revision: mutate.mock.calls.length };
    });
    return { mutate, current: () => state };
  };


  it("leaves the authoritative obligation pending when known printer preflight fails", async () => {
    const harness = createHarness();
    const preflight = vi.fn(async () => {
      throw new Error("Printer bridge offline");
    });
    const deliver = vi.fn();
    await expect(
      dispatchDurableKitchenObligation({
        obligation,
        terminalId: "WEST-POS-1",
        mutate: harness.mutate,
        preflight,
        deliver,
      }),
    ).rejects.toThrow(/offline/i);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(harness.mutate).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(harness.current().kitchenPrintObligations[0]?.status).toBe("PENDING");
  });

  it("claims authoritatively before submitting to the bridge and records only OS-spool acceptance", async () => {
    const harness = createHarness();
    const deliver = vi.fn(async () => {
      expect(harness.current().kitchenPrintObligations[0]?.status).toBe("CLAIMED");
      return {
        jobs: [{ id: "bridge-job-1" } as never],
        outcomes: ["SPOOLED" as const],
        skipped: [],
      };
    });
    await dispatchDurableKitchenObligation({
      obligation,
      terminalId: "WEST-POS-1",
      mutate: harness.mutate,
      deliver,
    });
    expect(harness.mutate.mock.calls.map((call) => call[0])).toEqual([
      "claimKitchenPrintObligation",
      "finishKitchenPrintObligation",
    ]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(harness.current().kitchenPrintObligations[0]?.status).toBe("SPOOLED");
  });

  it("after an uncertain outcome, a refresh cannot silently print the same original again", async () => {
    const harness = createHarness();
    const uncertainBridge = vi.fn(async () => {
      throw new Error("Response lost after possible printer acceptance");
    });
    await expect(
      dispatchDurableKitchenObligation({
        obligation,
        terminalId: "WEST-POS-1",
        mutate: harness.mutate,
        deliver: uncertainBridge,
      }),
    ).rejects.toThrow(/uncertain/i);
    expect(harness.current().kitchenPrintObligations[0]?.status).toBe("UNCERTAIN");
    await expect(
      dispatchDurableKitchenObligation({
        obligation,
        terminalId: "WEST-POS-1",
        mutate: harness.mutate,
        deliver: uncertainBridge,
      }),
    ).rejects.toThrow(/claimed|attempted/i);
    expect(uncertainBridge).toHaveBeenCalledTimes(1);
  });
});
