import { describe, expect, it } from "vitest";
import { parseDeliveryAppPayout } from "@/payments/delivery-app-payout-files";

const context = { connectionId: "manual:channel-glovo", currency: "KES" };

describe("reading a delivery app's payout report", () => {
  it("reads an Uber Eats payment details file by header name", async () => {
    const csv = [
      "Store Name,Order ID,Order Date,Sales (incl. tax),Marketplace Fee,Promotions on items,Cash Collected,Total payout,Payout Date,Payout reference ID",
      "Westlands,U-1,2026-11-10,950.00,-95.00,-50.00,-600.00,205.00,2026-11-14,PAY-77",
      'Westlands,U-2,2026-11-11,"1,200.00",-120.00,,,1080.00,2026-11-14,PAY-77',
      ",,,,,,,,,",
    ].join("\n");
    const preview = await parseDeliveryAppPayout(csv, context);
    expect(preview.layoutName).toBe("Uber Eats payment details");
    expect(preview.canPost).toBe(true);
    expect(preview.issues).toEqual([]);
    const [batch] = preview.recognized;
    expect(batch).toMatchObject({
      providerSettlementId: "PAY-77",
      grossAmountMinor: 215_000,
      netAmountMinor: 128_500,
    });
    expect(
      batch!.lines
        .filter((line) => line.externalOrderId === "U-1")
        .map((line) => [line.type, line.amountMinor]),
    ).toEqual([
      ["GROSS_SALE", 95_000],
      ["COMMISSION", 9_500],
      ["PROMOTION", 5_000],
      ["MERCHANT_COLLECTION", 60_000],
    ]);
  });

  it("warns when the file's payout differs from its lines", async () => {
    const csv = [
      "Order ID,Sales (incl. tax),Marketplace Fee,Total payout,Payout reference ID",
      "U-3,1000.00,-100.00,850.00,PAY-78",
    ].join("\n");
    const preview = await parseDeliveryAppPayout(csv, context);
    expect(preview.canPost).toBe(true);
    expect(preview.issues[0]!.message).toMatch(/file says 850, Seramet's lines add up to 900/);
  });

  it("does not post a payment that adds to the payout as a deduction", async () => {
    const csv = ["Order ID,Sales (incl. tax),Other payments", "U-4,500.00,40.00"].join("\n");
    const preview = await parseDeliveryAppPayout(csv, context);
    expect(preview.recognized[0]!.netAmountMinor).toBe(50_000);
    expect(preview.issues[0]).toMatchObject({ severity: "WARNING" });
  });

  it("skips a repeated order and says so", async () => {
    const csv = ["Order ID,Sales (incl. tax)", "U-5,100.00", "U-5,100.00"].join("\n");
    const preview = await parseDeliveryAppPayout(csv, context);
    expect(preview.duplicates).toEqual([3]);
    expect(preview.recognized[0]!.grossAmountMinor).toBe(10_000);
  });

  it("reads Glovo's column names", async () => {
    const csv = [
      "Glovo code,Order date,Products price,Glovo commission,Partner payout,Invoice number",
      "G-48213,2026-11-12,950.00,-142.50,807.50,GL-INV-9",
    ].join("\n");
    const preview = await parseDeliveryAppPayout(csv, context);
    expect(preview.layoutName).toBe("Glovo payout");
    expect(preview.recognized[0]).toMatchObject({
      providerSettlementId: "GL-INV-9",
      netAmountMinor: 80_750,
    });
  });

  it("refuses a file it does not recognise and lists its columns", async () => {
    const preview = await parseDeliveryAppPayout("Date,Amount\n2026-11-12,100", context);
    expect(preview.canPost).toBe(false);
    expect(preview.headers).toEqual(["date", "amount"]);
    expect(preview.issues[0]!.message).toMatch(/order ID column and a sales column/);
  });
});
