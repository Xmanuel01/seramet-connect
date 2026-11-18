import { describe, expect, it } from "vitest";
import {
  bridgeStageLabel,
  connectionLabel,
  documentTypeLabels,
  kitchenTicketStatusLabels,
  printerRoleLabels,
} from "@/lib/printer-labels";

describe("printer labels", () => {
  it("names every print bridge stage in plain words", () => {
    expect(bridgeStageLabel("BYTES_SUBMITTED")).toBe("Sent to printer");
    expect(bridgeStageLabel("SPOOL_ACCEPTED")).toBe("Sent to printer");
    expect(bridgeStageLabel("NOT_SENT")).toBe("Didn't reach the printer");
    expect(bridgeStageLabel("UNCERTAIN")).toBe("May not have printed");
  });

  it("falls back to a readable form for a stage it doesn't know", () => {
    expect(bridgeStageLabel("SOME_NEW_STAGE")).toBe("some new stage");
  });

  it("never shows a raw code for roles, documents or kitchen ticket statuses", () => {
    for (const label of [
      ...Object.values(printerRoleLabels),
      ...Object.values(documentTypeLabels),
      ...Object.values(kitchenTicketStatusLabels),
    ])
      expect(label).not.toMatch(/^[A-Z_]+$/);
  });

  it("describes how a printer connects", () => {
    expect(connectionLabel("TCP")).toBe("Network");
    expect(connectionLabel("WINDOWS")).toBe("USB or Windows");
  });
});
