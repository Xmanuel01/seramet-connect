import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPosDrafts, posDraftKey, readPosDraft, writePosDraft } from "./pos-draft";
afterEach(() => vi.unstubAllGlobals());
describe("safe cashier draft recovery", () => {
  it("isolates tenant/branch/cashier/device, allowlists values and clears on logout", () => {
    const data: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
      removeItem: (key: string) => {
        delete data[key];
      },
    });
    const key = posDraftKey("tenant", "branch", "cashier", "device");
    const draft = {
      lines: { meal: 2 },
      itemNotes: { meal: "No onion" },
      kitchenNote: "Separate sauce",
      activeOrderId: "order",
      selectedTableNo: "12",
      orderSource: "dine",
      customerId: "customer-id",
      savedAt: Date.now(),
      pin: "never-store",
      accessToken: "never-store",
    };
    writePosDraft(key, draft);
    expect(readPosDraft(key)).toMatchObject({ lines: { meal: 2 }, kitchenNote: "Separate sauce" });
    expect(data[key]).not.toContain("never-store");
    expect(readPosDraft(posDraftKey("tenant", "other", "cashier", "device"))).toBeNull();
    expect(readPosDraft(posDraftKey("tenant", "branch", "other", "device"))).toBeNull();
    expect(readPosDraft(posDraftKey("tenant", "branch", "cashier", "other"))).toBeNull();
    // Use a Storage-shaped fixture for key enumeration.
    vi.stubGlobal(
      "sessionStorage",
      Object.assign(data, {
        removeItem: (name: string) => {
          delete data[name];
        },
      }),
    );
    clearPosDrafts();
    expect(data[key]).toBeUndefined();
  });
  it("storage denial cannot crash a mounted POS", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(readPosDraft("fixture")).toBeNull();
    expect(() => clearPosDrafts()).not.toThrow();
  });
});
