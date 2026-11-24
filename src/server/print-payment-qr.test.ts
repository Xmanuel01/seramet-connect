import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import type { ServerActor } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { printablePaymentQr } from "@/server/print-payment-qr";
import { qrModulesFromBase64Png } from "@/printing/qr-image";

const actor = {
  id: "u",
  name: "Cashier",
  tenantId: "t",
  branchId: "b",
  permissions: [],
} as unknown as ServerActor;
const repository = {} as TransactionRepository;

describe("scan-to-pay QR on printed bills", () => {
  it("is only requested for whole-shilling KES amounts that are due", async () => {
    const qr = (amountDue: number, currency = "KES") =>
      printablePaymentQr({}, repository, actor, {
        billId: "bill",
        branchId: "b",
        amountDue,
        currency,
      });
    expect(await qr(2850.5)).toEqual({
      ok: false,
      reason: "M-Pesa QR amounts are whole shillings",
    });
    expect(await qr(0)).toEqual({ ok: false, reason: "Nothing is due" });
    expect(await qr(2850, "USD")).toEqual({ ok: false, reason: "M-Pesa QR is for KES bills" });
  });

  it("reads Safaricom's QR image back to the exact module grid, at Daraja's 300px size", async () => {
    const payload = "00020101021229300012TILL4235484AMOUNT2850";
    const image = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      width: 300,
      margin: 4,
    });
    const expected = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules;
    const rows = await qrModulesFromBase64Png(image.split(",")[1]!);
    expect(rows).toHaveLength(expected.size);
    rows.forEach((row, r) =>
      [...row].forEach((bit, c) => expect(bit === "1").toBe(expected.get(r, c) === 1)),
    );
  });

  it("refuses an image that is not a clean QR rather than printing a damaged code", async () => {
    const image = await QRCode.toDataURL("TILL 4235484", { width: 300, margin: 4 });
    const bytes = Uint8Array.from(atob(image.split(",")[1]!), (c) => c.charCodeAt(0));
    // Not a PNG at all.
    await expect(qrModulesFromBase64Png(btoa("not an image"))).rejects.toThrow(/PNG/);
    // A truncated PNG.
    await expect(
      qrModulesFromBase64Png(btoa(String.fromCharCode(...bytes.subarray(0, 60)))),
    ).rejects.toThrow();
  });
});
