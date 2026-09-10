import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/tax-centre")({
  head: () => ({
    meta: [
      { title: "Tax Centre - Seramet" },
      {
        name: "description",
        content:
          "VAT, catering levy, withholding tax and payroll statutory obligations with filing deadlines.",
      },
      { property: "og:title", content: "Tax Centre - Seramet" },
      {
        property: "og:description",
        content: "Every tax the restaurant collects or owes, with its return period and due date.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TaxCentre,
});

const obligations = emptyRecords();

const vatBreakdown = emptyRecords();

function TaxCentre() {
  const { branchLabel } = useAppContext();
  const payable = obligations.filter((o) => o.status !== "Paid").reduce((s, o) => s + o.payable, 0);
  return (
    <AppShell
      title="Tax centre"
      subtitle={`Statutory obligations and returns  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Tax settings</Btn>
          <Btn variant="primary">Prepare return</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Outstanding tax" value={payable} money invert />
        <Metric label="Output VAT (MTD)" value={0} money />
        <Metric label="Input VAT (MTD)" value={0} money />
        <Metric label="Next filing" value="Not scheduled" />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Obligations"
          sub="Each return period with its computed liability"
          right={<Status>{obligations.length ? "Live" : "Not configured"}</Status>}
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH>Tax</TH>
                <TH>Period</TH>
                <TH>Due</TH>
                <TH className="text-right">Output</TH>
                <TH className="text-right">Input</TH>
                <TH className="text-right">Payable</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {obligations.map((row) => (
                <tr key={row.tax} className="hover:bg-secondary/40">
                  <TD className="font-semibold">{row.tax}</TD>
                  <TD className="text-muted-foreground">{row.period}</TD>
                  <TD>{row.due}</TD>
                  <TD className="num text-right">{ksh(row.output)}</TD>
                  <TD className="num text-right text-muted-foreground">
                    {row.input ? ksh(row.input) : "-"}
                  </TD>
                  <TD className="num text-right font-semibold">{ksh(row.payable)}</TD>
                  <TD>
                    <Status>{row.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="VAT return working" sub="Taxable base and tax for the current period" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Line</TH>
              <TH className="text-right">Base</TH>
              <TH className="text-right">Tax</TH>
            </tr>
          </thead>
          <tbody>
            {vatBreakdown.map(([label, base, tax]) => (
              <tr key={String(label)} className="hover:bg-secondary/40">
                <TD className="font-semibold">{label}</TD>
                <TD className="num text-right">{ksh(Number(base))}</TD>
                <TD className="num text-right font-semibold">{ksh(Number(tax))}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
