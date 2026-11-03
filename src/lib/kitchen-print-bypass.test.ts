import { describe, expect, it } from "vitest";
import {
  activeKitchenPrintBypass,
  endKitchenPrintBypass,
  startKitchenPrintBypass,
} from "./kitchen-print-bypass";

const at = new Date("2026-11-03T10:00:00.000Z");

describe("kitchen printer bypass window", () => {
  it("lasts exactly 36 hours from when it is turned on", () => {
    const metadata = startKitchenPrintBypass(
      { kitchenMode: "PRINTER" },
      { startedBy: "Owner", reason: "Kitchen printer is being replaced", at },
    );
    expect(metadata["kitchenMode"]).toBe("PRINTER");
    expect(activeKitchenPrintBypass(metadata, "2026-11-03T10:00:00.000Z")).toMatchObject({
      until: "2026-11-04T22:00:00.000Z",
      startedBy: "Owner",
      reason: "Kitchen printer is being replaced",
    });
    expect(activeKitchenPrintBypass(metadata, "2026-11-04T21:59:59.999Z")).not.toBeNull();
    expect(activeKitchenPrintBypass(metadata, "2026-11-04T22:00:00.000Z")).toBeNull();
  });

  it("is off when never set, malformed, or ended", () => {
    expect(activeKitchenPrintBypass(undefined, at)).toBeNull();
    expect(activeKitchenPrintBypass({ kitchenPrintBypassUntil: "soon" }, at)).toBeNull();
    expect(activeKitchenPrintBypass({ kitchenPrintBypassUntil: 42 }, at)).toBeNull();
    const started = startKitchenPrintBypass(
      {},
      { startedBy: "Owner", reason: "Printer fault", at },
    );
    const ended = endKitchenPrintBypass(started);
    expect(activeKitchenPrintBypass(ended, at)).toBeNull();
    expect(Object.keys(ended)).toEqual([]);
  });
});
