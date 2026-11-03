import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead } from "@/components/app/ui";
import { reportMoney } from "@/finance/finance-ui";
import { humanize } from "@/finance/finance-labels";
import { useAppContext } from "@/lib/app-context";
import { useManagementIntelligence } from "@/management/use-management-intelligence";
import { QualityStatus, ManagementReadModelState } from "@/management/ui";

/** Cost of sales plus labour, against net revenue. */
export function PrimeCostPage() {
  const { branchLabel } = useAppContext();
  const intelligence = useManagementIntelligence();
  const pnl = intelligence.control?.flashPnl;
  const cost = pnl ? pnl.cogsMinor + pnl.labourCostMinor : null;
  const share =
    pnl && cost !== null && pnl.netRevenueMinor > 0
      ? `${((cost / pnl.netRevenueMinor) * 100).toFixed(1)}%`
      : "—";
  return (
    <AppShell
      title="Prime cost"
      subtitle={branchLabel}
      actions={<Btn onClick={() => void intelligence.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState
        status={intelligence.status}
        error={intelligence.error}
        empty={!pnl}
      />
      {intelligence.status === "ready" && pnl && cost !== null && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Metric label="Net revenue" value={reportMoney(pnl.netRevenueMinor, pnl.currency)} />
            <Metric label="Cost of sales" value={reportMoney(pnl.cogsMinor, pnl.currency)} />
            <Metric label="Labour" value={reportMoney(pnl.labourCostMinor, pnl.currency)} />
            <Metric label="Prime cost" value={reportMoney(cost, pnl.currency)} />
            <Metric label="Of net revenue" value={share} />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title={`${pnl.periodStart} – ${pnl.periodEnd}`}
              right={<QualityStatus quality={pnl.quality} />}
            />
            <p className="p-4 text-[12px] text-muted-foreground">
              {pnl.qualityReasons.length
                ? `Some costs may be missing: ${pnl.qualityReasons.map((reason) => humanize(reason).toLowerCase()).join(", ")}.`
                : "Live figures from today's sales, stock and staff records, before closing."}
            </p>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
