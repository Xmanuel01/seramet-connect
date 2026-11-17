import { useState } from "react";
import { Btn } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/currency";
import type { BillingRecord } from "@/lib/transaction-engine";
import type { AppOrderBalance } from "@/payments/app-order-balance";
import { parseMajorAmount } from "@/payments/money";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

/**
 * Clears the pay-on-delivery part of a delivery-app invoice with whatever was actually paid.
 * The part the app owes is left alone; it clears when the app's payout is matched.
 */
export function AppOrderCollect({
  invoice,
  invoiceName,
  balance,
  tenantId,
  canCollect,
  mutate,
  onDone,
}: {
  invoice: BillingRecord;
  invoiceName: string;
  balance: AppOrderBalance;
  tenantId: string;
  canCollect: boolean;
  mutate: (action: "recordDirectCompanyCollection", payload: unknown) => Promise<unknown>;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [methodId, setMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!balance.obligationId || balance.toCollect <= 0) return null;
  const methods = getConfigurationRepository()
    .listPaymentMethods(tenantId, false)
    .filter(
      (method) =>
        method.enabled &&
        ["CASH", "DIGITAL_WALLET", "CARD", "BANK_TRANSFER"].includes(method.category),
    );
  const method = methods.find((candidate) => candidate.id === methodId);
  const cash = method?.category === "CASH";

  const start = () => {
    setMethodId(methods[0]?.id ?? "");
    setAmount(String(balance.toCollect));
    setReference("");
    setError("");
    setOpen(true);
  };

  const confirm = async () => {
    const value = Number(amount);
    if (!method) return setError("Choose how the money was paid.");
    if (!Number.isFinite(value) || value <= 0) return setError("Enter the amount received.");
    if (value > balance.toCollect)
      return setError(`Only ${formatMoney(balance.toCollect)} is left to collect.`);
    if (!cash && !reference.trim()) return setError("Enter the transaction reference.");
    setSaving(true);
    setError("");
    try {
      await mutate("recordDirectCompanyCollection", {
        input: {
          obligationId: balance.obligationId,
          amountMinor: parseMajorAmount(value, balance.currency),
          paymentMethodId: method.id,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      setOpen(false);
      onDone(`${formatMoney(value)} received for ${invoiceName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The payment was not recorded. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Btn onClick={start} disabled={!canCollect}>
        Collect
      </Btn>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-w-[480px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Collect payment</DialogTitle>
            <DialogDescription>
              {invoiceName} - {invoice.customer}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-[13px]">
            <div className="grid gap-1 rounded-lg border border-border bg-secondary/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">To collect now</span>
                <span className="num text-[20px] font-extrabold">
                  {formatMoney(balance.toCollect)}
                </span>
              </div>
              {balance.appOwes > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Paid in the app, arrives with its payout</span>
                  <span className="num font-semibold">{formatMoney(balance.appOwes)}</span>
                </div>
              )}
            </div>
            <div>
              <div className="mb-1.5 font-semibold">How it was paid</div>
              <div className="flex flex-wrap gap-2">
                {methods.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setMethodId(candidate.id)}
                    className={`rounded-md border px-3 py-2 font-semibold ${methodId === candidate.id ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-secondary"}`}
                  >
                    {candidate.displayName}
                  </button>
                ))}
                {methods.length === 0 && (
                  <span className="text-muted-foreground">
                    No payment method is switched on yet.
                  </span>
                )}
              </div>
            </div>
            <label className="grid gap-1 font-semibold">
              Amount received
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-10 rounded-md border border-border bg-card px-3 font-normal"
              />
            </label>
            {!cash && (
              <label className="grid gap-1 font-semibold">
                Transaction reference
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value.toUpperCase())}
                  className="h-10 rounded-md border border-border bg-card px-3 font-normal"
                />
              </label>
            )}
            {error && (
              <p role="alert" className="font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={() => void confirm()} disabled={saving}>
                {saving ? "Saving..." : "Record payment"}
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
