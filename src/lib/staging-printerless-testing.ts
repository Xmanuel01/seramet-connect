/**
 * One-off staging-only POS test accommodation.
 *
 * Does NOT mark a kitchen print as delivered, disable order validation,
 * skip backend KOT creation, or affect production hosts. This expires
 * automatically at 19:00 EAT, 30 September 2026, without a redeploy.
 */
export const STAGING_PRINTERLESS_START_UTC = "2026-09-28T16:00:00.000Z";
export const STAGING_PRINTERLESS_END_UTC = "2026-09-30T16:00:00.000Z";
const STAGING_HOST = "seramet-staging.emmanuelhanningtone59.workers.dev";

export function stagingPrinterlessTestingEnabled(
  hostname: string,
  nowMs: number = Date.now(),
): boolean {
  return (
    hostname === STAGING_HOST &&
    Number.isFinite(nowMs) &&
    nowMs >= Date.parse(STAGING_PRINTERLESS_START_UTC) &&
    nowMs < Date.parse(STAGING_PRINTERLESS_END_UTC)
  );
}

export function isStagingPrinterlessTestingEnabled(): boolean {
  return typeof window !== "undefined" && stagingPrinterlessTestingEnabled(window.location.hostname);
}
