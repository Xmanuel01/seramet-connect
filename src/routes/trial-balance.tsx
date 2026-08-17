import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/trial-balance")({
  head: () => ({
    meta: [
      { title: "Trial Balance - Seramet" },
      {
        name: "description",
        content: "Period trial balance with opening balance, movement and closing balance per account.",
      },
      { property: "og:title", content: "Trial Balance - Seramet" },
      {
        property: "og:description",
        content: "Proof that every restaurant journal posted in the period balances.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrialBalance,
});

type Line = { code: string; account: string; type: string; opening: number; debit: number; credit: number };

const lines: Line[] = [
  { code: "1010", account: "Cash on hand", type: "Asset", opening: 84200, debit: 1284000, credit: 1268400 },
  { code: "1020", account: "M-Pesa clearing", type: "Asset", opening: 122400, debit: 2184000, credit: 2106000 },
  { code: "1030", account: "Bank", type: "Asset", opening: 279820, debit: 3106000, credit: 3289600 },
  { code: "1200", account: "Accounts receivable", type: "Asset", opening: 341900, debit: 286400, credit: 315500 },
  { code: "1300", account: "Inventory", type: "Asset", opening: 1322000, debit: 1284600, credit: 1322000 },
  { code: "1500", account: "Fixed assets", type: "Asset", opening: 316400, debit: 0, credit: 13820 },
  { code: "2100", account: "Accounts payable", type: "Liability", opening: -274200, debit: 968400, credit: 993200 },
  { code: "2200", account: "VAT payable", type: "Liability", opening: -128400, debit: 128400, credit: 186900 },
  { code: "2300", account: "Payroll liabilities", type: "Liability", opening: -110800, debit: 1006200, credit: 1014000 },
  { code: "3000", account: "Owner equity", type: "Equity", opening: -421000, debit: 0, credit: 63900 },
  { code: "4000", account: "Sales revenue", type: "Income", opening: 0, debit: 9100, credit: 4137700 },
  { code: "5000", account: "Cost of sales", type: "Expense", opening: 0, debit: 1362400, credit: 0 },
  { code: "6100", account: "Wages expense", type: "Expense", opening: 0, debit: 1048900, credit: 0 },
  { code: "6200", account: "Utilities expense", type: "Expense", opening: 0, debit: 186400, credit: 0 },
  { code: "6300", account: "Rent expense", type: "Expense", opening: 0, debit: 360000, credit: 0 },
  { code: "6400", account: "Wastage and breakage", type: "Expense", opening: 0, debit: 42800, credit: 0 },
  { code: "6500", account: "Depreciation", type: "Expense", opening: 0, debit: 13820, credit: 0 },
  { code: "6900", account: "Cash over / short", type: "Expense", opening: 0, debit: 1240, credit: 0 },
];

function TrialBalance() {
  const { branchLabel } = useAppContext();
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <AppShell
      title="Trial balance"
      subtitle={`Period 01 - 16 August 2026  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Change period</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">Drill to ledger</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Total debit" value={totalDebit} money />
        <Metric label="Total credit" value={totalCredit} money />
        <Metric label="Difference" value={Math.abs(totalDebit - totalCredit)} money invert />
        <Metric label="Accounts with movement" value={lines.length} />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Accounts"
          sub="Opening balance, period movement and closing balance"
          right={<Status>{totalDebit === totalCredit ? "Balanced" : "Out of balance"}</Status>}
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH>Code</TH>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH className="text-right">Opening</TH>
                <TH className="text-right">Debit</TH>
                <TH className="text-right">Credit</TH>
                <TH className="text-right">Closing</TH>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.code} className="hover:bg-secondary/40">
                  <TD className="num text-muted-foreground">{line.code}</TD>
                  <TD className="font-semibold">{line.account}</TD>
                  <TD className="text-muted-foreground">{line.type}</TD>
                  <TD className="num text-right text-muted-foreground">{ksh(line.opening)}</TD>
                  <TD className="num text-right">{line.debit ? ksh(line.debit) : "-"}</TD>
                  <TD className="num text-right">{line.credit ? ksh(line.credit) : "-"}</TD>
                  <TD className="num text-right font-semibold">
                    {ksh(line.opening + line.debit - line.credit)}
                  </TD>
                </tr>
              ))}
              <tr className="bg-secondary/50">
                <TD className="font-bold">Total</TD>
                <TD className="font-bold">&nbsp;</TD>
                <TD className="font-bold">&nbsp;</TD>
                <TD className="font-bold">&nbsp;</TD>
                <TD className="num text-right font-bold">{ksh(totalDebit)}</TD>
                <TD className="num text-right font-bold">{ksh(totalCredit)}</TD>
                <TD className="num text-right font-bold">{ksh(0)}</TD>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}