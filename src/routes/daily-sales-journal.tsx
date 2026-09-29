import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
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

const journal: [string, string, number, number][] = [
  ["1010", "Cash on hand", 96400, 0],
  ["1020", "M-Pesa clearing", 187900, 0],
  ["1025", "Card settlement clearing", 64200, 0],
  ["1200", "Accounts receivable - corporate", 18400, 0],
  ["4000", "Food sales", 0, 268300],
  ["4010", "Beverage sales", 0, 58900],
  ["4020", "Delivery fees", 0, 6200],
  ["4900", "Discounts and comps", 9100, 0],
  ["2200", "VAT payable (16%)", 0, 34760],
  ["2210", "Catering levy (2%)", 0, 4344],
  ["6900", "Cash over / short", 104, 0],
];

const tenders = [
  { tender: "Cash", declared: 96400, system: 96296, variance: 104, status: "Attention" },
  { tender: "M-Pesa", declared: 187900, system: 187900, variance: 0, status: "Reconciled" },
  { tender: "Card", declared: 64200, system: 64200, variance: 0, status: "Reconciled" },
  { tender: "Credit / account", declared: 18400, system: 18400, variance: 0, status: "Reconciled" },
];

function DailySalesJournal() {
  const { branchLabel } = useAppContext();
  const debit = journal.reduce((sum, row) => sum + row[2], 0);
  const credit = journal.reduce((sum, row) => sum + row[3], 0);
  return (
    <AppShell
      title="Daily sales journal"
      subtitle={`Z-report JV for 16 August 2026  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Print Z report</Btn>
          <Btn variant="primary">Post journal</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Gross sales" value={333400} money />
        <Metric label="Tax collected" value={39104} money />
        <Metric label="Net takings" value={366900} money />
        <Metric label="Cash variance" value={104} money invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Journal voucher JV-DS-0816"
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