import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus } from "@/crm/crm-ui";
import { useCrmApi } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/crm")({
  head: () => ({
    meta: [
      { title: "CRM Overview - Seramet" },
      {
        name: "description",
        content: "Authoritative customer engagement, retention and loyalty overview.",
      },
    ],
  }),
  component: CrmOverview,
});

type CrmDashboard = {
  activeCustomers: number;
  totalCustomers: number;
  repeatCustomers: number;
  returnRateBps: number;
  orderCount: number;
  loyaltyMembers: number;
  pointsIssued: number;
  pointsRedeemed: number;
  vouchersRedeemed: number;
  activeCampaigns: number;
  feedbackCount: number;
  csat: number | null;
  nps: number | null;
  quality: string;
  evidence: { completedCustomerLinks: number };
};
type DashboardResponse = { ok: boolean; dashboard: CrmDashboard };
type DashboardState = {
  path: string;
  status: "loading" | "ready" | "error";
  dashboard: CrmDashboard | null;
  error: string;
};

function CrmOverview() {
  const { activeTenantId, branchId, branchLabel, isAllBranches, hasPermission } = useAppContext();
  const { scopedPath, request } = useCrmApi();
  const canView = hasPermission(permissions.crmView);
  const dashboardPath = canView ? scopedPath("/api/seramet/crm/dashboard") : null;
  const dashboardKey =
    activeTenantId + ":" + (isAllBranches ? "ALL" : branchId) + ":" + (dashboardPath ?? "");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<DashboardState>({
    path: "",
    status: "loading",
    dashboard: null,
    error: "",
  });

  useEffect(() => {
    if (!dashboardPath) return;
    const controller = new AbortController();
    setState({ path: dashboardKey, status: "loading", dashboard: null, error: "" });
    void request<DashboardResponse>(dashboardPath, { signal: controller.signal })
      .then(({ dashboard }) => {
        if (!controller.signal.aborted) {
          setState({ path: dashboardKey, status: "ready", dashboard, error: "" });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setState({
            path: dashboardPath,
            status: "error",
            dashboard: null,
            error: cause instanceof Error ? cause.message : "CRM dashboard unavailable",
          });
        }
      });
    return () => controller.abort();
  }, [dashboardKey, dashboardPath, request, revision]);

  const current = state.path === dashboardKey ? state : null;
  const dashboard = current?.status === "ready" ? current.dashboard : null;
  return (
    <AppShell
      title="CRM overview"
      subtitle={"Authoritative customer growth and service activity - " + branchLabel}
      actions={
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-md border border-border bg-card px-3 py-2 text-[13px] font-semibold"
          disabled={!canView}
        >
          Refresh data
        </button>
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty
            title="CRM access unavailable"
            body="Your role does not permit viewing this overview."
          />
        </Panel>
      ) : !current || current.status === "loading" ? (
        <Panel>
          <CrmLoading label="Loading CRM metrics" />
        </Panel>
      ) : current.status === "error" ? (
        <Panel>
          <CrmError message={current.error} retry={() => setRevision((value) => value + 1)} />
        </Panel>
      ) : dashboard ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Active customer profiles" value={dashboard.totalCustomers} />
            <Metric label="Active last 30 days" value={dashboard.activeCustomers} />
            <Metric label="Repeat customers" value={dashboard.repeatCustomers} />
            <Metric
              label="Customer return rate"
              value={Number((dashboard.returnRateBps / 100).toFixed(1))}
              suffix="%"
            />
            <Metric label="Loyalty members" value={dashboard.loyaltyMembers} />
            <Metric label="Confirmed voucher uses" value={dashboard.vouchersRedeemed} />
            <Metric label="Active campaigns" value={dashboard.activeCampaigns} />
            <Metric label="Feedback received" value={dashboard.feedbackCount} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHead title="Customer engagement" sub="Server-calculated CRM activity" />
              <div className="space-y-3 p-4 text-[13px]">
                <div className="flex items-center justify-between">
                  <span>Linked completed orders</span>
                  <span className="font-semibold">
                    {dashboard.evidence.completedCustomerLinks.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Orders represented in customer metrics</span>
                  <span className="font-semibold">{dashboard.orderCount.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Customer evidence quality</span>
                  <Status>{readableStatus(dashboard.quality)}</Status>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  When transaction evidence is incomplete, CRM trends and segments may not be
                  representative.
                </p>
              </div>
            </Panel>
            <Panel>
              <PanelHead
                title="Loyalty and service"
                sub="Activity from the authoritative CRM ledger"
              />
              <div className="space-y-3 p-4 text-[13px]">
                <div className="flex items-center justify-between">
                  <span>Points issued</span>
                  <span className="font-semibold">{dashboard.pointsIssued.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Points redeemed</span>
                  <span className="font-semibold">{dashboard.pointsRedeemed.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Customer satisfaction (CSAT)</span>
                  <span className="font-semibold">
                    {dashboard.csat === null ? "Insufficient data" : dashboard.csat.toFixed(1)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Net promoter score (NPS)</span>
                  <span className="font-semibold">
                    {dashboard.nps === null ? "Insufficient data" : dashboard.nps}
                  </span>
                </div>
              </div>
            </Panel>
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Customer workflows"
              sub="Open the existing customer directory or related CRM modules"
            />
            <div className="flex flex-wrap gap-2 p-4 text-[13px]">
              <Link
                className="rounded-md border border-border px-3 py-2 font-semibold hover:bg-secondary"
                to="/customers"
              >
                Customer 360
              </Link>
              <Link
                className="rounded-md border border-border px-3 py-2 font-semibold hover:bg-secondary"
                to="/loyalty"
              >
                Loyalty
              </Link>
              <Link
                className="rounded-md border border-border px-3 py-2 font-semibold hover:bg-secondary"
                to="/complaints"
              >
                Complaints
              </Link>
            </div>
          </Panel>
        </>
      ) : (
        <Panel className="p-5">
          <CrmEmpty
            title="CRM metrics unavailable"
            body="No authoritative dashboard data was returned."
          />
        </Panel>
      )}
    </AppShell>
  );
}
