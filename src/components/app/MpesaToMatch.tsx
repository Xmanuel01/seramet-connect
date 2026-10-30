import { CheckCircle2, Smartphone } from "lucide-react";
import { useState } from "react";
import { Btn, Status } from "@/components/app/ui";
import type { TransactionState } from "@/lib/transaction-engine";
import { formatMinor } from "@/payments/money";
import { unmatchedDirectPayments } from "@/payments/mpesa-matching";

/**
 * M-Pesa payments that reached the till without a Seramet prompt and are not yet on a bill.
 * Each shows open bills of exactly the same balance from around the time it was paid; a person
 * confirms which one it belongs to.
 */
export function MpesaToMatch({
  state,
  tenantId,
  branchId,
  canMatch,
  onApply,
}: {
  state: TransactionState;
  tenantId: string;
  branchId: string;
  canMatch: boolean;
  onApply: (transactionId: string, invoiceId: string) => void;
}) {
  const payments = unmatchedDirectPayments(state, tenantId, branchId);
  if (!payments.length)
    return (
      <div className="flex items-center gap-2 p-6 text-[13px] text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
        Every M-Pesa payment for this branch is on a bill.
      </div>
    );
  return (
    <div className="space-y-3 p-4">
      <p className="text-[12px] text-muted-foreground">
        Customers paid these straight to your till or Paybill. When a cashier types the M-Pesa code
        at the POS it is applied automatically; otherwise choose the bill it belongs to.
      </p>
      {payments.map((payment) => (
        <div key={payment.transactionId} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">
                  {formatMinor(payment.unallocatedMinor, payment.currency)}
                  {payment.unallocatedMinor !== payment.amountMinor && (
                    <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                      left of {formatMinor(payment.amountMinor, payment.currency)}
                    </span>
                  )}
                </div>
                <div className="break-words text-[12px] text-muted-foreground">
                  {[
                    payment.receipt,
                    payment.payerName,
                    new Date(payment.occurredAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                    payment.accountReference ? `Account ${payment.accountReference}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
            <Status>
              {payment.suggestions.length === 1
                ? "1 likely bill"
                : payment.suggestions.length
                  ? `${payment.suggestions.length} possible bills`
                  : "No bill of this amount"}
            </Status>
          </div>
          {payment.suggestions.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {payment.suggestions.slice(0, 4).map((bill) => (
                <li
                  key={bill.invoiceId}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{bill.invoiceId}</span>
                    {bill.table ? ` · Table ${bill.table}` : ""}
                    <span className="text-muted-foreground">
                      {" "}
                      · billed{" "}
                      {bill.minutesApart >= 0
                        ? `${bill.minutesApart} min before payment`
                        : `${-bill.minutesApart} min after payment`}
                    </span>
                  </span>
                  <Btn
                    disabled={!canMatch}
                    onClick={() => onApply(payment.transactionId, bill.invoiceId)}
                  >
                    Apply to this bill
                  </Btn>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

const waitingStatuses = ["PENDING", "AWAITING_CUSTOMER", "PROCESSING"];

/**
 * Prompts sent to customers' phones that have no answer yet, and ones that failed recently with
 * the reason, so the cashier knows whether to wait or send again.
 */
export function MpesaPrompts({
  state,
  tenantId,
  branchId,
  onCheck,
}: {
  state: TransactionState;
  tenantId: string;
  branchId: string;
  onCheck: (intentId: string) => Promise<string>;
}) {
  const [checking, setChecking] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const since = Date.now() - 2 * 60 * 60 * 1000;
  const prompts = (state.paymentOperations?.intents ?? [])
    .filter(
      (intent) =>
        intent.tenantId === tenantId &&
        intent.branchId === branchId &&
        intent.providerReference &&
        Date.parse(intent.updatedAt) >= since &&
        (waitingStatuses.includes(intent.status) || intent.status === "FAILED"),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12);
  if (!prompts.length) return null;
  const check = async (intentId: string) => {
    setChecking(intentId);
    try {
      const outcome = await onCheck(intentId);
      setResults((current) => ({ ...current, [intentId]: outcome }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [intentId]: error instanceof Error ? error.message : "Could not check the payment",
      }));
    } finally {
      setChecking("");
    }
  };
  return (
    <div className="space-y-2 px-4 pt-4">
      <h3 className="text-[13px] font-semibold">Payment prompts in the last 2 hours</h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {prompts.map((intent) => {
          const waiting = waitingStatuses.includes(intent.status);
          const reason = intent.metadata["failureReason"];
          const paidAwaitingReceipt = intent.metadata["providerReportsPaid"] === true;
          return (
            <li
              key={intent.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]"
            >
              <span className="min-w-0">
                <span className="font-semibold">
                  {formatMinor(intent.amountRequestedMinor, intent.currency)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {intent.invoiceIds[0] ?? intent.id} ·{" "}
                  {new Date(intent.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="block break-words">
                  {results[intent.id] ??
                    (waiting
                      ? paidAwaitingReceipt
                        ? "Safaricom says paid; waiting for the receipt"
                        : "Waiting for the customer"
                      : typeof reason === "string"
                        ? reason
                        : "Not completed")}
                </span>
              </span>
              {waiting && (
                <Btn disabled={checking === intent.id} onClick={() => void check(intent.id)}>
                  {checking === intent.id ? "Checking…" : "Check now"}
                </Btn>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
