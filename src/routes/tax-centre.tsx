import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/tax-centre")({
  head: () => ({
    meta: [
      { title: "Tax Centre - Seramet" },
      {
        name: "description",
        content: "VAT, catering levy, withholding tax and payroll statutory obligations with filing deadlines.",
      },
      { property: "og:title", content: "Tax Centre - Seramet" },
      { property: "og:description", content: "Every tax the restaurant collects or owes, with its return period and due date." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TaxCentre,
});

const obligations = [
  { tax: "VAT (16%)", period: "Jul 2026", due: "20 Aug", output: 660400, input: 218900, payable: 441500, status: "Pending" },
  { tax: "Catering levy (2%)", period: "Jul 2026", due: "20 Aug", output: 82550, input: 0, payable: 82550, status: "Pending" },
  { tax: "PAYE", period: "Jul 2026", due: "09 Aug", output: 186400, input: 0, payable: 186400, status: "Paid" },
  { tax: "Withholding VAT on suppliers", period: "Jul 2026", due: "20 Aug", output: 24600, input: 0, payable: 24600, status: "Pending" },
  { tax: "NSSF / NHIF", period: "Jul 2026", due: "09 Aug", output: 92800, input: 0, payable: 92800, status: "Paid" },
];

const vatBreakdown = [
  ["Standard rated food and beverage sales", 4128600, 660576],
  ["Zero rated exports and exempt items", 42800, 0],
  ["Purchases with input VAT", 1368100, 218896],
  ["Non-claimable purchases", 116400, 0],
];

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
        <Metric label="Output VAT (MTD)" value={660576} money />
        <Metric label="Input VAT (MTD)" value={218896} money />
        <Metric label="Next filing" value="20 Aug" />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Obligations" sub="Each return period with its computed liability" right={<Status>Live</Status>} />
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
                  <TD className="num text-right text-muted-foreground">{row.input ? ksh(row.input) : "-"}</TD>
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
