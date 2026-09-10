import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/daily-sales-journal")({
  head: () => ({
    meta: [
      { title: "Daily Sales Journal - Seramet" },
      {
        name: "description",
        content:
          "Day-end Z report turned into a balanced double-entry journal: sales, tax, tenders and variances.",
      },
      { property: "og:title", content: "Daily Sales Journal - Seramet" },
      {
        property: "og:description",
        content: "One balanced journal per trading day, per branch, straight from the POS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DailySalesJournal,
});

const journal: [string, string, number, number][] = emptyRecords();

const tenders = emptyRecords();

function DailySalesJournal() {
  const { branchLabel } = useAppContext();
  const debit = journal.reduce((sum, row) => sum + row[2], 0);
  const credit = journal.reduce((sum, row) => sum + row[3], 0);
  return (
    <AppShell
      title="Daily sales journal"
      subtitle={`Z-report journal for the selected business date - ${branchLabel}`}
      actions={
        <>
          <Btn>Print Z report</Btn>
          <Btn variant="primary">Post journal</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Gross sales" value={0} money />
        <Metric label="Tax collected" value={0} money />
        <Metric label="Net takings" value={0} money />
        <Metric label="Cash variance" value={0} money invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Daily sales journal"
          sub="Balanced automatically from the day's settled orders"
          right={<Status>{debit === credit ? "Balanced" : "Out of balance"}</Status>}
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Code</TH>
              <TH>Account</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
            </tr>
          </thead>
          <tbody>
            {journal.map(([code, account, dr, cr]) => (
              <tr key={code} className="hover:bg-secondary/40">
                <TD className="num text-muted-foreground">{code}</TD>
                <TD className="font-semibold">{account}</TD>
                <TD className="num text-right">{dr ? ksh(dr) : "-"}</TD>
                <TD className="num text-right">{cr ? ksh(cr) : "-"}</TD>
              </tr>
            ))}
            <tr className="bg-secondary/50">
              <TD className="font-bold">Total</TD>
              <TD className="font-bold">&nbsp;</TD>
              <TD className="num text-right font-bold">{ksh(debit)}</TD>
              <TD className="num text-right font-bold">{ksh(credit)}</TD>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel className="mt-4">
        <PanelHead title="Tender reconciliation" sub="Declared cash-up against system takings" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Tender</TH>
              <TH className="text-right">Declared</TH>
              <TH className="text-right">System</TH>
              <TH className="text-right">Variance</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {tenders.map((row) => (
              <tr key={row.tender} className="hover:bg-secondary/40">
                <TD className="font-semibold">{row.tender}</TD>
                <TD className="num text-right">{ksh(row.declared)}</TD>
                <TD className="num text-right text-muted-foreground">{ksh(row.system)}</TD>
                <TD className="num text-right font-semibold">{ksh(row.variance)}</TD>
                <TD>
                  <Status>{row.status}</Status>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
