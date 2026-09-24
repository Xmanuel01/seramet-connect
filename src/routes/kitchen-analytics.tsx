import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BookOpenCheck,
  ChefHat,
  ClipboardCheck,
  Factory,
  RefreshCw,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  type KitchenAnalyticsPeriod,
  useKitchenAnalytics,
} from "@/kitchen/use-kitchen-analytics";
import { useAppContext } from "@/lib/app-context";
import { formatDuration } from "@/management/ui";

export const Route = createFileRoute("/kitchen-analytics")({
  head: () => ({
    meta: [
      { title: "Kitchen Analytics - Seramet" },
      {
        name: "description",
        content:
          "Authoritative kitchen performance across stations, prep, production yield and Cookbook coverage.",
      },
    ],
  }),
  component: KitchenAnalytics,
});

function KitchenAnalytics() {
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const [periodDays, setPeriodDays] = useState<KitchenAnalyticsPeriod>(7);
  const analytics = useKitchenAnalytics(authoritative && !isAllBranches, periodDays);
  const overview = analytics.overview;

  return (
    <AppShell
      title="Kitchen analytics"
      subtitle={
        overview
          ? `${overview.periodStart} → ${overview.periodEnd} · ${branchLabel}`
          : `Kitchen execution intelligence · ${branchLabel}`
      }
      actions={
        <>
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {[1, 7, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setPeriodDays(days as KitchenAnalyticsPeriod)}
                className={
                  "rounded px-3 py-1.5 text-[11px] font-semibold " +
                  (periodDays === days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary")
                }
              >
                {days === 1 ? "Today" : days + " days"}
              </button>
            ))}
          </div>
          <Btn
            disabled={!authoritative || isAllBranches || analytics.status === "loading"}
            onClick={() => void analytics.refresh()}
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
        </>
      }
    >
      {(analytics.error || !authoritative || isAllBranches) && (
        <div className="mb-4 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {analytics.error ||
            (!authoritative
              ? "Kitchen Analytics requires the authoritative Seramet server."
              : "Select one branch to view Kitchen Analytics.")}
        </div>
      )}

      {analytics.status === "loading" && !overview ? (
        <Panel>
          <div className="p-10 text-center text-[12px] text-muted-foreground">
            Loading authoritative kitchen metrics…
          </div>
        </Panel>
      ) : null}

      {overview ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Tickets" value={overview.summary.ticketCount} />
            <Metric
              label="Completed"
              value={percentage(overview.summary.completionBps)}
              suffix="%"
            />
            <Metric label="Late tickets" value={overview.summary.lateCount} />
            <Metric
              label="Late rate"
              value={percentage(overview.summary.lateBps)}
              suffix="%"
              invert={overview.summary.lateBps > 1_000}
            />
            <Metric
              label="Average prep"
              value={formatDuration(overview.summary.averagePrepMs)}
            />
            <Metric
              label="Cookbook coverage"
              value={percentage(overview.cookbook.coverageBps)}
              suffix="%"
              invert={overview.cookbook.missingCount > 0}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Panel>
              <PanelHead
                title="Prep execution"
                sub="Authoritative prep recommendation lifecycle"
                right={<ClipboardCheck className="h-4 w-4 text-primary" />}
              />
              <div className="grid grid-cols-2 gap-3 p-4">
                <Info label="Tasks" value={overview.prep.taskCount} />
                <Info
                  label="Completion"
                  value={percentage(overview.prep.completionBps) + "%"}
                />
                <Info label="Started" value={overview.prep.startedCount} />
                <Info label="Approved" value={overview.prep.approvedCount} />
                <Info label="Awaiting approval" value={overview.prep.awaitingApprovalCount} />
                <Info label="Dismissed" value={overview.prep.dismissedCount} />
              </div>
            </Panel>

            <Panel>
              <PanelHead
                title="Production yield"
                sub="Completed batch output versus planned standard"
                right={<Factory className="h-4 w-4 text-primary" />}
              />
              <div className="grid grid-cols-2 gap-3 p-4">
                <Info label="Batches" value={overview.production.batchCount} />
                <Info label="Completed" value={overview.production.completedCount} />
                <Info label="In progress" value={overview.production.inProgressCount} />
                <Info label="Cancelled" value={overview.production.cancelledCount} />
                <Info
                  label="Avg yield variance"
                  value={formatBps(overview.production.averageYieldVarianceBps)}
                />
                <Info
                  label="Below target >5%"
                  value={overview.production.belowTargetCount}
                  warning={overview.production.belowTargetCount > 0}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHead
                title="Kitchen standards"
                sub="Current recipe versions with published Cookbook methods"
                right={<BookOpenCheck className="h-4 w-4 text-primary" />}
              />
              <div className="grid grid-cols-2 gap-3 p-4">
                <Info label="Active recipes" value={overview.cookbook.recipeCount} />
                <Info label="Published methods" value={overview.cookbook.publishedCount} />
                <Info
                  label="Missing methods"
                  value={overview.cookbook.missingCount}
                  warning={overview.cookbook.missingCount > 0}
                />
                <Info
                  label="Coverage"
                  value={percentage(overview.cookbook.coverageBps) + "%"}
                />
              </div>
            </Panel>
          </div>

          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Station performance"
              sub="Period totals with weighted preparation and pickup timing"
              right={<ChefHat className="h-4 w-4 text-primary" />}
            />
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>Station</TH>
                  <TH className="text-right">Tickets</TH>
                  <TH className="text-right">Completed</TH>
                  <TH className="text-right">Late</TH>
                  <TH className="text-right">Late rate</TH>
                  <TH className="text-right">Avg prep</TH>
                  <TH className="text-right">Ready pickup</TH>
                  <TH className="text-right">Throughput/hr</TH>
                  <TH>Quality</TH>
                </tr>
              </thead>
              <tbody>
                {overview.stations.map((station) => (
                  <tr key={station.stationId}>
                    <TD className="font-semibold">{station.stationName}</TD>
                    <TD className="num text-right">{station.ticketCount}</TD>
                    <TD className="num text-right">{station.completedCount}</TD>
                    <TD className="num text-right">{station.lateCount}</TD>
                    <TD className="num text-right">{percentage(station.lateBps)}%</TD>
                    <TD className="num text-right">{formatDuration(station.averagePrepMs)}</TD>
                    <TD className="num text-right">
                      {formatDuration(station.averageReadyPickupMs)}
                    </TD>
                    <TD className="num text-right">
                      {station.throughputPerHourMilli === null
                        ? "—"
                        : (station.throughputPerHourMilli / 1_000).toFixed(1)}
                    </TD>
                    <TD>
                      <Status>{station.quality}</Status>
                    </TD>
                  </tr>
                ))}
                {!overview.stations.length ? (
                  <tr>
                    <TD colSpan={9} className="py-8 text-center text-muted-foreground">
                      No persisted station metrics exist for this period yet.
                    </TD>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Panel>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Panel className="overflow-x-auto">
              <PanelHead
                title="Daily kitchen trend"
                sub="Late-rate and preparation-time movement across the selected period"
                right={<Timer className="h-4 w-4 text-primary" />}
              />
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <TH>Date</TH>
                    <TH className="text-right">Tickets</TH>
                    <TH className="text-right">Completed</TH>
                    <TH className="text-right">Late</TH>
                    <TH className="text-right">Late rate</TH>
                    <TH className="text-right">Avg prep</TH>
                  </tr>
                </thead>
                <tbody>
                  {overview.daily.map((day) => (
                    <tr key={day.businessDate}>
                      <TD className="font-semibold">{day.businessDate}</TD>
                      <TD className="num text-right">{day.ticketCount}</TD>
                      <TD className="num text-right">{day.completedCount}</TD>
                      <TD className="num text-right">{day.lateCount}</TD>
                      <TD className="num text-right">{percentage(day.lateBps)}%</TD>
                      <TD className="num text-right">{formatDuration(day.averagePrepMs)}</TD>
                    </tr>
                  ))}
                  {!overview.daily.length ? (
                    <tr>
                      <TD colSpan={6} className="py-8 text-center text-muted-foreground">
                        No daily timing history exists for this period.
                      </TD>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Panel>

            <Panel>
              <PanelHead
                title="Today's prep blockers"
                sub="Issues that prevent authoritative prep execution"
                right={
                  overview.currentPrep.blockerCount > 0 ? (
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  ) : (
                    <ClipboardCheck className="h-4 w-4 text-primary" />
                  )
                }
              />
              <div className="divide-y divide-border">
                {overview.currentPrep.blockers.map((blocker) => (
                  <div key={blocker.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[13px] font-semibold">{blocker.recipeName}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {blocker.reasons.map(formatRisk).join(" · ")}
                        </div>
                      </div>
                      <Status>{blocker.status}</Status>
                    </div>
                  </div>
                ))}
                {!overview.currentPrep.blockers.length ? (
                  <div className="p-8 text-center text-[12px] text-muted-foreground">
                    No recipe-version or Cookbook blockers on today's active prep plan.
                  </div>
                ) : null}
              </div>
            </Panel>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

function Info({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string | number;
  warning?: boolean;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className={"mt-1 text-[14px] font-semibold " + (warning ? "text-warning" : "")}>
        {value}
      </div>
    </div>
  );
}

function percentage(value: number) {
  return Number((value / 100).toFixed(1));
}

function formatBps(value: number | null) {
  if (value === null) return "—";
  const percent = value / 100;
  return (percent > 0 ? "+" : "") + percent.toFixed(1) + "%";
}

function formatRisk(value: string) {
  if (value === "RECIPE_VERSION_CHANGED") return "Recipe version changed";
  if (value === "COOKBOOK_NOT_PUBLISHED") return "Cookbook method missing";
  return value.replaceAll("_", " ").toLowerCase();
}
