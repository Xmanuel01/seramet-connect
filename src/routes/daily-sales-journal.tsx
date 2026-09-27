import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { currentDateKey } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { projectFinancialLifecycle } from "@/lib/financial-lifecycle";
import { formatMinor, majorFromMinor, sumMinor } from "@/payments/money";

export const Route = createFileRoute("/daily-sales-journal")({
  head: () => ({
    meta: [
      { title: "Daily Sales Journal - Seramet" },
      { name: "description", content: "Authoritative day-close sales and journal evidence." },
    ],
  }),
  component: DailySalesJournal,
});

function DailySalesJournal() {
  const { activeTenantId, branchId, branchLabel, currency, timeZone } = useAppContext();
  const { state, backendStatus } = useTransactionEngine();
  const businessDate = currentDateKey(new Date(), timeZone);
  const dayClose = state.paymentOperations?.dayCloses.find(
    (item) => item.branchId === branchId && item.businessDate === businessDate,
  );
  const live = projectFinancialLifecycle(state, {
    tenantId: activeTenantId,
    branchId,
    businessDate,
    currency,
  });
  const report = dayClose?.status === "CLOSED" && dayClose.snapshot ? dayClose.snapshot : live;
  const reportCurrency = report.currency === "XXX" ? currency : report.currency;
  const debitMinor = sumMinor(report.journal.map((line) => line.debitMinor));
  const creditMinor = sumMinor(report.journal.map((line) => line.creditMinor));
  const closed = dayClose?.status === "CLOSED" && Boolean(dayClose.snapshot);

  return (
    <AppShell
      title="Daily sales journal"
      subtitle={`${closed ? "Closed snapshot" : "Live preview"} for ${report.businessDate} - ${branchLabel}`}
      actions={<Btn onClick={() => window.print()}>Print Z report</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Settled sales"
          value={majorFromMinor(report.settledMinor, reportCurrency)}
          money
        />
        <Metric
          label="Tax collected"
          value={majorFromMinor(report.taxMinor, reportCurrency)}
          money
        />
        <Metric
          label="Collected"
          value={majorFromMinor(report.collectedMinor, reportCurrency)}
          money
        />
        <Metric
          label="Cash variance"
          value={majorFromMinor(report.cashVarianceMinor, reportCurrency)}
          money
          invert
        />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Daily sales journal"
          sub={`Revision ${dayClose?.snapshot?.revision ?? 0} - as of ${report.calculatedAt}`}
          right={
            <Status>
              {backendStatus !== "synced"
                ? "Data not synchronized"
                : closed
                  ? debitMinor === creditMinor
                    ? "Closed and balanced"
                    : "Closed out of balance"
                  : "Not closed"}
            </Status>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH>Account</TH>
                <TH className="text-right">Debit</TH>
                <TH className="text-right">Credit</TH>
              </tr>
            </thead>
            <tbody>
              {report.journal.map((line) => (
                <tr key={line.account} className="hover:bg-secondary/40">
                  <TD className="font-semibold">{line.account}</TD>
                  <TD className="num text-right">
                    {line.debitMinor ? formatMinor(line.debitMinor, reportCurrency) : "-"}
                  </TD>
                  <TD className="num text-right">
                    {line.creditMinor ? formatMinor(line.creditMinor, reportCurrency) : "-"}
                  </TD>
                </tr>
              ))}
              {!report.journal.length ? (
                <tr>
                  <TD className="text-muted-foreground" colSpan={3}>
                    No posted journal lines exist for this business date.
                  </TD>
                </tr>
              ) : null}
              <tr className="bg-secondary/50">
                <TD className="font-bold">Total</TD>
                <TD className="num text-right font-bold">
                  {formatMinor(debitMinor, reportCurrency)}
                </TD>
                <TD className="num text-right font-bold">
                  {formatMinor(creditMinor, reportCurrency)}
                </TD>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Tender reconciliation"
          sub="Authoritative collections by payment method"
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Tender</TH>
              <TH className="text-right">System collected</TH>
            </tr>
          </thead>
          <tbody>
            {report.tenders.map((row) => (
              <tr key={row.method} className="hover:bg-secondary/40">
                <TD className="font-semibold">{row.method}</TD>
                <TD className="num text-right">{formatMinor(row.amountMinor, reportCurrency)}</TD>
              </tr>
            ))}
            {!report.tenders.length ? (
              <tr>
                <TD className="text-muted-foreground" colSpan={2}>
                  No collections exist for this business date.
                </TD>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
