import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/trial-balance")({
  head: () => ({
    meta: [
      { title: "Trial Balance - Seramet" },
      {
        name: "description",
        content:
          "Period trial balance with opening balance, movement and closing balance per account.",
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

type Line = {
  code: string;
  account: string;
  type: string;
  opening: number;
  debit: number;
  credit: number;
};

const lines: Line[] = emptyRecords();

function TrialBalance() {
  const { branchLabel } = useAppContext();
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <AppShell
      title="Trial balance"
      subtitle={`Current accounting period - ${branchLabel}`}
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
