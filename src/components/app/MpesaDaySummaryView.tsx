import { formatMinor } from "@/payments/money";
import { mpesaChannelLabels, type MpesaDaySummary } from "@/payments/mpesa-day-summary";

/** The day's M-Pesa money: by channel, how much is on bills, and what still needs a bill. */
export function MpesaDaySummaryView({
  summary,
  carryOverReason,
}: {
  summary: MpesaDaySummary;
  carryOverReason?: string;
}) {
  const money = (amount: number) => formatMinor(amount, summary.currency);
  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">M-Pesa</h4>
        <span>
          <strong>{money(summary.receivedMinor)}</strong>{" "}
          <span className="text-muted-foreground">from {summary.count} payments</span>
        </span>
      </div>
      {summary.channels.length > 0 && (
        <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
          {summary.channels.map((row) => (
            <li key={row.channel} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{mpesaChannelLabels[row.channel]}</span>
              <span>
                {money(row.amountMinor)} ({row.count})
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between gap-2 border-t pt-2 text-[13px]">
        <span className="text-muted-foreground">On bills</span>
        <span>{money(summary.onBillsMinor)}</span>
      </div>
      <div className="flex justify-between gap-2 text-[13px]">
        <span className="text-muted-foreground">Not on a bill yet (all days)</span>
        <span className={summary.stillToMatch.length ? "font-semibold text-warning" : ""}>
          {money(summary.stillToMatchMinor)} ({summary.stillToMatch.length})
        </span>
      </div>
      {summary.failedPrompts.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">
            {summary.failedPrompts.length} payment prompt(s) failed
          </summary>
          <ul className="mt-1 space-y-1">
            {summary.failedPrompts.map((row) => (
              <li key={row.intentId}>
                {row.invoiceId ?? row.intentId} · {money(row.amountMinor)}: {row.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {carryOverReason && (
        <p className="text-[13px]">
          <span className="text-muted-foreground">Carried over because: </span>
          {carryOverReason}
        </p>
      )}
    </div>
  );
}
