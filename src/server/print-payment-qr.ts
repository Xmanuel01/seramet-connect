// The scan-to-pay QR printed on a bill: a real M-Pesa dynamic QR from
// Safaricom (Daraja), issued through the same payment-intent flow as the POS
// "Pay by QR" button, so a customer who scans and pays is reconciled against
// this bill by the existing M-Pesa confirmation handling.
//
// Printing never depends on it: with no QR payment method configured, an
// amount the QR cannot carry, or any provider error, the bill prints the till
// and amount without a QR, and says so.

import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { authorizeSerametMutation, type SerametEnv, type ServerActor } from "@/lib/seramet-auth";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { qrModulesFromBase64Png } from "@/printing/qr-image";

export type PrintPaymentQrInput = {
  billId: string;
  branchId: string;
  /** Amount still due on the bill, in major units. */
  amountDue: number;
  currency: string;
};

export type PrintPaymentQrResult =
  { ok: true; modules: string[]; paymentMethodId: string } | { ok: false; reason: string };

export async function printablePaymentQr(
  env: SerametEnv,
  repository: TransactionRepository,
  actor: ServerActor,
  input: PrintPaymentQrInput,
): Promise<PrintPaymentQrResult> {
  // M-Pesa QR amounts are whole shillings; Daraja would round anything else.
  const cents = Math.round(input.amountDue * 100);
  if (input.currency !== "KES") return { ok: false, reason: "M-Pesa QR is for KES bills" };
  if (cents <= 0) return { ok: false, reason: "Nothing is due" };
  if (cents % 100 !== 0) return { ok: false, reason: "M-Pesa QR amounts are whole shillings" };
  const method = getConfigurationRepository()
    .listPaymentMethods(actor.tenantId, true)
    .find(
      (candidate) =>
        candidate.providerConnectionId && candidate.metadata["providerOperation"] === "QR_PAYMENT",
    );
  if (!method) return { ok: false, reason: "No M-Pesa QR payment method is configured" };
  try {
    authorizeSerametMutation(actor, "createPaymentIntent", actor.tenantId, input.branchId);
    const result = await createIntegrationRuntime(env, {
      transactions: repository,
    }).initiatePayment({
      tenantId: actor.tenantId,
      branchId: input.branchId,
      invoiceId: input.billId,
      paymentMethodId: method.id,
      amountMinor: cents,
      currency: input.currency,
      actor: actor.name,
      // One intent per bill and amount: reprints reuse it and get its QR again.
      idempotencyKey: `PRINT-QR:${input.billId}:${cents}`,
      operation: "QR_PAYMENT",
      reissueQrOnReplay: true,
    });
    const provider = result.provider as
      { ok: true; value?: { QRCode?: string } } | { ok: false; message?: string } | undefined;
    if (!provider?.ok) return { ok: false, reason: provider?.message ?? "M-Pesa QR not issued" };
    const image = provider.value?.QRCode;
    if (!image) return { ok: false, reason: "M-Pesa returned no QR image" };
    return { ok: true, modules: await qrModulesFromBase64Png(image), paymentMethodId: method.id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "M-Pesa QR unavailable" };
  }
}
