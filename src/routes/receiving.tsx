import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/receiving")({
  head: () => ({ meta: [{ title: "Receiving - Seramet" }] }),
  component: Receiving,
});

const lines = [
  {
    item: "Beef Boneless",
    ordered: "40 kg",
    received: "38.4 kg",
    variance: "-1.6 kg",
    value: 23808,
    status: "Attention",
  },
  {
    item: "Chicken Whole",
    ordered: "25 kg",
    received: "25 kg",
    variance: "0",
    value: 12000,
    status: "Healthy",
  },
  {
    item: "Goat Meat",
    ordered: "15 kg",
    received: "15 kg",
    variance: "0",
    value: 10800,
    status: "Healthy",
  },
];

function Receiving() {
  return (
    <AppShell
      title="Receiving"
      subtitle="GRN-2026-0914 - PO-2026-0182 - Main Meat Supplier"
      actions={
        <>
          <Btn>Save draft</Btn>
          <Btn variant="primary">Post receipt</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected value" value={58400} money />
        <Metric label="Received value" value={46608} money />
        <Metric label="Variance" value={992} money invert />
        <Metric label="Lines checked" value="3/3" />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Receiving worksheet"
          sub="Compare ordered, received and accepted quantities"
          right={<Status>Draft</Status>}
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Item</TH>
              <TH className="text-right">Ordered</TH>
              <TH className="text-right">Received</TH>
              <TH className="text-right">Variance</TH>
              <TH className="text-right">Value</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.item}>
                <TD className="font-semibold">{line.item}</TD>
                <TD className="num text-right">{line.ordered}</TD>
                <TD className="num text-right font-semibold">{line.received}</TD>
                <TD className="num text-right">{line.variance}</TD>
                <TD className="num text-right font-semibold">{ksh(line.value)}</TD>
                <TD>
                  <Status>{line.status}</Status>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
