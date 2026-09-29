import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/stock-detail")({
  head: () => ({ meta: [{ title: "Stock Detail - Seramet" }] }),
  component: StockDetail,
});

const warehouses = [
  {
    warehouse: "Westlands Main Store",
    available: "12.6 kg",
    reserved: "2.0 kg",
    expected: "40 kg",
    par: "30 kg",
    reorder: "15 kg",
    last: "Issue to kitchen - 09:12",
    status: "Low",
  },
  {
    warehouse: "Westlands Kitchen",
    available: "4.3 kg",
    reserved: "0 kg",
    expected: "0 kg",
    par: "6 kg",
    reorder: "3 kg",
    last: "Counted yesterday",
    status: "Attention",
  },
  {
    warehouse: "Ngong Main Store",
    available: "8.2 kg",
    reserved: "1.5 kg",
    expected: "0 kg",
    par: "20 kg",
    reorder: "10 kg",
    last: "Transfer out - 11 Aug",
    status: "Critical",
  },
];

const movements = [
  ["13 Aug 09:12", "Issue to kitchen", "-4.0 kg", "Kelvin M.", "ISS-2211"],
  ["12 Aug 16:40", "Goods received", "+30.0 kg", "Kelvin M.", "GRN-0912"],
  ["12 Aug 11:05", "Wastage", "-0.8 kg", "Musa K.", "WST-0182"],
  ["11 Aug 08:22", "Transfer out", "-6.0 kg", "Kelvin M.", "TRF-0341"],
];

function StockDetail() {
  return (
    <AppShell
      title="Stock detail: Beef Boneless"
      subtitle="MEAT-001 - available, reserved, expected and movement history"
      actions={
        <>
          <Btn>Transfer</Btn>
          <Btn>Adjust</Btn>
          <Btn variant="primary">Generate PO</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Available" value="25.1 kg" />
        <Metric label="Reserved" value="3.5 kg" />
        <Metric label="Expected" value="40 kg" />
        <Metric label="Stock value" value={15562} money />
        <Metric label="Days cover" value="2.3" suffix=" days" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead
            title="Stock by warehouse"
            sub="Available, reserved, expected, PAR and reorder level"
          />
          <table className="w-full">
            <thead>
              <tr>
                <TH>Warehouse</TH>
                <TH className="text-right">Available</TH>
                <TH className="text-right">Reserved</TH>
                <TH className="text-right">Expected</TH>
                <TH className="text-right">PAR</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((row) => (
                <tr key={row.warehouse}>
                  <TD className="font-semibold">{row.warehouse}</TD>
                  <TD className="num text-right">{row.available}</TD>
                  <TD className="num text-right text-muted-foreground">{row.reserved}</TD>
                  <TD className="num text-right text-muted-foreground">{row.expected}</TD>
                  <TD className="num text-right">{row.par}</TD>
                  <TD>
                    <Status>{row.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <PanelHead title="Stock drawer" sub="Context panel summary" />
          <dl className="divide-y divide-border text-[13px]">
            {[
              ["Preferred supplier", "Main Meat Supplier"],
              ["Current cost", ksh(620)],
              ["Reorder level", "15 kg"],
              ["Suggested order", "40 kg"],
              ["Last movement", "13 Aug 09:12"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="num font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel className="mt-4">
        <PanelHead title="Movement history" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH className="text-right">Quantity</TH>
              <TH>User</TH>
              <TH>Reference</TH>
            </tr>
          </thead>
          <tbody>
            {movements.map(([date, type, qty, user, ref]) => (
              <tr key={ref}>
                <TD className="num text-muted-foreground">{date}</TD>
                <TD className="font-semibold">{type}</TD>
                <TD className="num text-right font-semibold">{qty}</TD>
                <TD>{user}</TD>
                <TD className="num text-muted-foreground">{ref}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
