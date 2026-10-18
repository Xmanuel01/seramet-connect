import { Link } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { InventoryActionLink } from "./inventory-action-link";
import { requireInventoryResponse } from "./inventory-response";
import { multiplyDivide, quantityCostMinor } from "./quantity";
import {
  requireValidStoredCleanEvidence,
  scannerPipelineConfigured,
} from "@/server/malware-scanner";

describe("inventory control regressions", () => {
  it.each(["/receiving", "/purchase-orders", "/requisitions", "/supplier-performance"] as const)(
    "renders %s as an actionable router link, not a disabled nested button",
    (to) => {
      const element = InventoryActionLink({ to, children: "Open" });
      expect(element.type).toBe(Link);
      expect(element.props).toMatchObject({ to, children: "Open" });
      expect(element.props).not.toHaveProperty("disabled");
    },
  );
  it("values zero cost without relaxing conversion or integer validation", () => {
    expect(quantityCostMinor(1_000_000, 0)).toBe(0);
    expect(quantityCostMinor(-1_000_000, 0)).toBe(0);
    expect(quantityCostMinor(0, 100)).toBe(0);
    expect(quantityCostMinor(-1_500_000, 101)).toBe(-152);
    expect(() => quantityCostMinor(1, -1)).toThrow();
    expect(() => quantityCostMinor(0.5, 0)).toThrow();
    expect(() => multiplyDivide(1, 0, 1)).toThrow("Conversion factors must be positive");
  });
  it("identifies the failed dependency and preserves authorization diagnostics", async () => {
    await expect(
      requireInventoryResponse(
        Response.json(
          { message: "Permission required: inventory.cost_control.view" },
          { status: 403 },
        ),
        "Inventory cost control",
      ),
    ).rejects.toThrow(
      "Inventory cost control query failed (403): Permission required: inventory.cost_control.view",
    );
    await expect(
      requireInventoryResponse(
        new Response("upstream failed", { status: 500 }),
        "Procurement overview",
      ),
    ).rejects.toThrow("Procurement overview query failed (500)");
    const success = Response.json({ items: ["authoritative"] });
    await requireInventoryResponse(success, "Items");
    expect(await success.json()).toEqual({ items: ["authoritative"] });
  });
  it("keeps file imports fail-closed without configured scanning and authenticated CLEAN evidence", () => {
    expect(scannerPipelineConfigured({})).toBe(false);
    expect(scannerPipelineConfigured({ scanQueue: {}, workQueue: {}, objectStorage: {} })).toBe(
      false,
    );
    expect(() =>
      requireValidStoredCleanEvidence({
        evidence: { verdict: "CLEAN" },
        sha256: "test",
        subject: { jobId: "job", objectKey: "key", objectVersion: "version" },
      }),
    ).toThrow("File security scanner did not return valid CLEAN evidence");
  });
});
