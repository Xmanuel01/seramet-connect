import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/depreciation")({
  head: () => ({
    meta: [
      { title: "Depreciation - Seramet" },
      {
        name: "description",
        content:
          "Fixed asset register with useful life, monthly depreciation charge and net book value.",
      },
      { property: "og:title", content: "Depreciation - Seramet" },
      {
        property: "og:description",
        content: "Kitchen equipment, furniture and vehicles depreciated straight line each month.",
      },
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

const assets: Asset[] = emptyRecords();

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
                  <TD className="num text-right">
                    {ksh(Math.round(asset.cost / (asset.life * 12)))}
                  </TD>
                  <TD className="num text-right text-muted-foreground">{ksh(asset.accumulated)}</TD>
                  <TD className="num text-right font-semibold">
                    {ksh(asset.cost - asset.accumulated)}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
