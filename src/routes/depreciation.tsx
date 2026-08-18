import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/depreciation")({
  head: () => ({
    meta: [
      { title: "Depreciation - Seramet" },
      {
        name: "description",
        content: "Fixed asset register with useful life, monthly depreciation charge and net book value.",
      },
      { property: "og:title", content: "Depreciation - Seramet" },
      { property: "og:description", content: "Kitchen equipment, furniture and vehicles depreciated straight line each month." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Depreciation,
});

type Asset = {
  code: string;
  asset: string;
  category: string;
  acquired: string;
  cost: number;
  life: number;
  accumulated: number;
};

const assets: Asset[] = [
  { code: "FA-001", asset: "Combi oven", category: "Kitchen equipment", acquired: "Mar 2024", cost: 486000, life: 8, accumulated: 145800 },
  { code: "FA-002", asset: "Walk-in cold room", category: "Kitchen equipment", acquired: "Jan 2023", cost: 640000, life: 10, accumulated: 224000 },
  { code: "FA-003", asset: "Delivery motorcycle", category: "Vehicles", acquired: "Jun 2025", cost: 268000, life: 5, accumulated: 62200 },
  { code: "FA-004", asset: "Dining furniture set", category: "Furniture", acquired: "Sep 2024", cost: 184000, life: 6, accumulated: 58900 },
  { code: "FA-005", asset: "POS terminals (x6)", category: "IT equipment", acquired: "Feb 2026", cost: 216000, life: 4, accumulated: 27000 },
  { code: "FA-006", asset: "Generator 30kVA", category: "Plant", acquired: "Nov 2022", cost: 720000, life: 12, accumulated: 225000 },
];

function Depreciation() {
  const { branchLabel } = useAppContext();
  const cost = assets.reduce((s, a) => s + a.cost, 0);
  const accumulated = assets.reduce((s, a) => s + a.accumulated, 0);
  const monthly = assets.reduce((s, a) => s + a.cost / (a.life * 12), 0);
  return (
    <AppShell
      title="Depreciation"
      subtitle={`Fixed asset register and monthly charge  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Add asset</Btn>
          <Btn variant="primary">Post monthly depreciation</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Asset cost" value={cost} money />
        <Metric label="Accumulated depreciation" value={accumulated} money invert />
        <Metric label="Net book value" value={cost - accumulated} money />
        <Metric label="Monthly charge" value={Math.round(monthly)} money invert />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Schedule"
          sub="Straight line over useful life, charged to depreciation expense"
          right={<Status>Aug 2026 not yet posted</Status>}
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH>Code</TH>
                <TH>Asset</TH>
                <TH>Category</TH>
                <TH>Acquired</TH>
                <TH className="text-right">Cost</TH>
                <TH className="text-right">Life</TH>
                <TH className="text-right">Monthly</TH>
                <TH className="text-right">Accumulated</TH>
                <TH className="text-right">Net book value</TH>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.code} className="hover:bg-secondary/40">
                  <TD className="num text-muted-foreground">{asset.code}</TD>
                  <TD className="font-semibold">{asset.asset}</TD>
                  <TD className="text-muted-foreground">{asset.category}</TD>
                  <TD className="text-muted-foreground">{asset.acquired}</TD>
                  <TD className="num text-right">{ksh(asset.cost)}</TD>
                  <TD className="num text-right">{asset.life} yr</TD>
                  <TD className="num text-right">{ksh(Math.round(asset.cost / (asset.life * 12)))}</TD>
                  <TD className="num text-right text-muted-foreground">{ksh(asset.accumulated)}</TD>
                  <TD className="num text-right font-semibold">{ksh(asset.cost - asset.accumulated)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
