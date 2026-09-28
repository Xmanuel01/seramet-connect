import { describe, expect, it } from "vitest";
import {
  STAGING_PRINTERLESS_START_UTC,
  STAGING_PRINTERLESS_END_UTC,
  stagingPrinterlessTestingEnabled,
} from "@/lib/staging-printerless-testing";

describe("temporary printerless testing guard", () => {
  const start = Date.parse(STAGING_PRINTERLESS_START_UTC);
  const end = Date.parse(STAGING_PRINTERLESS_END_UTC);
  const host = "seramet-staging.emmanuelhanningtone59.workers.dev";

  it("is bounded to precisely 48 hours and expires without redeployment", () => {
    expect(end - start).toBe(48 * 60 * 60 * 1000);
    expect(stagingPrinterlessTestingEnabled(host, start - 1)).toBe(false);
    expect(stagingPrinterlessTestingEnabled(host, start)).toBe(true);
    expect(stagingPrinterlessTestingEnabled(host, end - 1)).toBe(true);
    expect(stagingPrinterlessTestingEnabled(host, end)).toBe(false);
  });

  it("never affects production or similar-looking malicious hosts", () => {
    const middle = start + 60 * 60 * 1000;
    for (const other of [
      "seramet.emmanuelhanningtone59.workers.dev",
      "seramet-connect.emmanuelhanningtone59.workers.dev",
      "seramet-staging.emmanuelhanningtone59.workers.dev.evil.invalid",
      "localhost",
      "",
    ]) {
      expect(stagingPrinterlessTestingEnabled(other, middle)).toBe(false);
    }
    expect(stagingPrinterlessTestingEnabled(host, Number.NaN)).toBe(false);
  });
});
