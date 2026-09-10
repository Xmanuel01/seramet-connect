import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import {
  configuredTenantCurrency,
  formatBps,
  formatDuration,
  formatMinor,
  ManagementReadModelState,
  QualityStatus,
  severityLabel,
} from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/command-centre")({
  head: () => ({ meta: [{ title: "Command Centre - Seramet" }] }),
  component: CommandCentre,
});

function CommandCentre() {
  const { activeTenantId, branchLabel, isAllBranches, platformState } = useAppContext();
  const management = useManagementIntelligence();
  const control = management.control;
  const latest = control?.latest;
  const currency =
    latest?.currency ?? configuredTenantCurrency(platformState.tenants, activeTenantId);
  const branchRows = management.owner?.branches ?? [];
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  return (
    <AppShell
      title="Command centre"
      subtitle={`${branchLabel} - authoritative daily management view`}
      actions={
        <>
          <Btn onClick={() => void management.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn variant="primary" onClick={() => void management.recalculate()}>
            Recalculate
          </Btn>
        </>
      }
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={management.status === "ready" && management.controls.length === 0}
      />
      {management.status === "ready" && management.controls.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Metric
              label="Net sales"
              value={formatMinor(management.combined.netSalesMinor, currency)}
            />
            <Metric
              label="Gross profit"
              value={formatMinor(management.combined.grossProfitMinor, currency)}
            />
            <Metric label="Orders" value={management.combined.orderCount} />
            <Metric
              label="Food cost"
              value={latest ? formatBps(latest.foodCostBps) : "Unavailable"}
            />
            <Metric
              label="Average prep"
              value={formatDuration(latest?.averagePrepTimeMs ?? null)}
            />
            <Metric label="Open actions" value={management.combined.openActions} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel>
              <PanelHead
                title="Needs attention"
                sub="Persisted exceptions generated from configured thresholds"
                right={
                  control?.latest ? <QualityStatus quality={control.latest.quality} /> : undefined
                }
              />
              {control?.actions.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr>
                        <TH>Severity</TH>
                        <TH>Issue</TH>
                        <TH>Evidence</TH>
                        <TH>Status</TH>
                        <TH>Action</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {control.actions.map((action) => {
                        const deepLink =
                          typeof action.evidence["deepLink"] === "string"
                            ? action.evidence["deepLink"]
                            : undefined;
                        return (
                          <tr key={action.id}>
                            <TD>
                              <Status>{severityLabel(action.severity)}</Status>
                            </TD>
                            <TD className="font-semibold">
                              {action.actionType.replaceAll("_", " ")}
                            </TD>
                            <TD className="num text-muted-foreground">
                              {action.metricValue ?? "-"} / {action.thresholdValue ?? "-"}
                            </TD>
                            <TD>
                              <Status>{action.status.replaceAll("_", " ")}</Status>
                            </TD>
                            <TD>
                              <div className="flex gap-2">
                                {deepLink && (
                                  <a
                                    href={deepLink}
                                    className="text-[12px] font-semibold text-primary"
                                  >
                                    Evidence
                                  </a>
                                )}
                                {action.status === "OPEN" && (
                                  <Btn
                                    onClick={() =>
                                      void management.transitionAction(
                                        action.id,
                                        "ACKNOWLEDGED",
                                        "Acknowledged from the management action centre",
                                      )
                                    }
                                  >
                                    Acknowledge
                                  </Btn>
                                )}
                                {action.status === "ACKNOWLEDGED" && (
                                  <Btn
                                    onClick={() =>
                                      void management.transitionAction(
                                        action.id,
                                        "IN_PROGRESS",
                                        "Investigation started from the management action centre",
                                      )
                                    }
                                  >
                                    Start
                                  </Btn>
                                )}
                                {action.status === "IN_PROGRESS" && (
                                  <>
                                    <input
                                      aria-label={`Resolution note for ${action.actionType}`}
                                      className="h-8 min-w-[150px] rounded-md border border-border bg-background px-2 text-[12px]"
                                      placeholder="Resolution note"
                                      value={resolutionNotes[action.id] ?? ""}
                                      onChange={(event) =>
                                        setResolutionNotes((current) => ({
                                          ...current,
                                          [action.id]: event.target.value,
                                        }))
                                      }
                                    />
                                    <Btn
                                      variant="primary"
                                      disabled={!resolutionNotes[action.id]?.trim()}
                                      onClick={() => {
                                        const note = resolutionNotes[action.id]?.trim();
                                        if (!note) return;
                                        void management
                                          .transitionAction(action.id, "RESOLVED", note)
                                          .then(() =>
                                            setResolutionNotes((current) => {
                                              const next = { ...current };
                                              delete next[action.id];
                                              return next;
                                            }),
                                          );
                                      }}
                                    >
                                      Resolve
                                    </Btn>
                                  </>
                                )}
                              </div>
                            </TD>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-4 text-[13px] text-muted-foreground">
                  No active threshold exceptions.
                </p>
              )}
            </Panel>

            <div className="grid content-start gap-4">
              <Panel className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Restaurant health
                    </div>
                    <div className="mt-2 text-[22px] font-bold">
                      {control?.health?.status.replaceAll("_", " ") ?? "Unavailable"}
                    </div>
                  </div>
                  {control?.health && <QualityStatus quality={control.health.quality} />}
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground">
                  {control?.health?.evidence.length ?? 0} policy-backed signals explain this state.
                </p>
              </Panel>
              <Panel>
                <PanelHead
                  title="Close readiness"
                  {...(control?.closeReadiness?.businessDate
                    ? { sub: control.closeReadiness.businessDate }
                    : {})}
                />
                <div className="p-4">
                  <Status>
                    {control?.closeReadiness?.status.replaceAll("_", " ") ?? "Unavailable"}
                  </Status>
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    {control?.closeReadiness?.blockerCount ?? 0} blockers and{" "}
                    {control?.closeReadiness?.warningCount ?? 0} warnings.
                  </p>
                </div>
              </Panel>
              <Panel>
                <PanelHead
                  title="Effective targets"
                  {...(control?.periodEnd ? { sub: control.periodEnd } : {})}
                />
                <div className="divide-y divide-border">
                  {control?.targets.length ? (
                    control.targets.map((target) => (
                      <div
                        key={`${target.metricCode}:${target.effectiveFrom}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px]"
                      >
                        <div>
                          <div className="font-semibold">
                            {target.metricCode.replaceAll("_", " ")}
                          </div>
                          <div className="text-muted-foreground">
                            {target.source.replaceAll("_", " ").toLowerCase()}
                          </div>
                        </div>
                        <span className="num font-semibold">
                          {formatTarget(target.targetValue, target.valueUnit, currency)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="p-4 text-[12px] text-muted-foreground">
                      No effective targets for this date.
                    </p>
                  )}
                </div>
              </Panel>
            </div>
          </div>

          {isAllBranches && (
            <Panel className="mt-4 overflow-x-auto">
              <PanelHead
                title="Branch comparison"
                sub="Normalized rates and quality-aware daily facts"
              />
              <table className="w-full min-w-[780px]">
                <thead>
                  <tr>
                    <TH>Branch</TH>
                    <TH className="text-right">Net sales</TH>
                    <TH className="text-right">Food cost</TH>
                    <TH className="text-right">Gross margin</TH>
                    <TH className="text-right">Orders</TH>
                    <TH>Status</TH>
                    <TH>Quality</TH>
                  </tr>
                </thead>
                <tbody>
                  {branchRows.map(({ metric, health }) => (
                    <tr key={metric.branchId}>
                      <TD className="font-semibold">{metric.branchName}</TD>
                      <TD className="num text-right">
                        {formatMinor(metric.netSalesMinor, metric.currency)}
                      </TD>
                      <TD className="num text-right">{formatBps(metric.foodCostBps)}</TD>
                      <TD className="num text-right">{formatBps(metric.grossMarginBps)}</TD>
                      <TD className="num text-right">{metric.orderCount}</TD>
                      <TD>
                        <Status>{health?.status ?? "Unavailable"}</Status>
                      </TD>
                      <TD>
                        <QualityStatus quality={metric.quality} />
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}
    </AppShell>
  );
}

function formatTarget(value: number, unit: string, currency: string) {
  if (unit === "MINOR") return formatMinor(value, currency);
  if (unit === "BPS") return formatBps(value);
  if (unit === "MILLISECONDS") return formatDuration(value);
  return value.toLocaleString();
}
