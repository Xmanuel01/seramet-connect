import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileLock2,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import type { EnterpriseNode } from "@/enterprise/types";
import { useEnterprise } from "@/enterprise/use-enterprise";
import { useAppContext } from "@/lib/app-context";
import type { ModuleKey } from "@/platform/module-access-registry";

export const Route = createFileRoute("/enterprise")({
  head: () => ({ meta: [{ title: "Enterprise - Seramet" }] }),
  component: EnterpriseControlCentre,
});

const views: ReadonlyArray<{ label: string; moduleKey: ModuleKey }> = [
  { label: "Overview", moduleKey: "hq-command" },
  { label: "Organisation", moduleKey: "organization" },
  { label: "Policies", moduleKey: "policies" },
  { label: "Rollouts", moduleKey: "rollouts" },
  { label: "Procurement", moduleKey: "central-procurement" },
  { label: "Franchises", moduleKey: "franchises" },
  { label: "Readiness", moduleKey: "compliance" },
  { label: "Finance", moduleKey: "enterprise-finance" },
  { label: "Audit", moduleKey: "enterprise-audit" },
] as const;
type View = (typeof views)[number]["label"];

type EnterpriseRecord = Record<string, unknown> & {
  id?: unknown;
  name?: unknown;
  code?: unknown;
  category?: unknown;
  scope_node_id?: unknown;
  policy_code?: unknown;
  scope_name?: unknown;
  state?: unknown;
  status?: unknown;
  reason?: unknown;
  rollout_type?: unknown;
  supplier_name?: unknown;
  contract_reference?: unknown;
  negotiated_price_minor?: unknown;
  currency?: unknown;
  lead_time_days?: unknown;
  franchisee_name?: unknown;
  franchisor_name?: unknown;
  agreement_reference?: unknown;
  fee_name?: unknown;
  basis_minor?: unknown;
  amount_minor?: unknown;
  quality?: unknown;
  branch_name?: unknown;
  check_code?: unknown;
  severity?: unknown;
  message?: unknown;
  latest_version?: unknown;
  published_version?: unknown;
  branch_count?: unknown;
  effective_from?: unknown;
  effective_to?: unknown;
  scheduled_at?: unknown;
  updated_at?: unknown;
  period_start?: unknown;
  period_end?: unknown;
  calculated_at?: unknown;
  actor_id?: unknown;
  action?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  correlation_id?: unknown;
  created_at?: unknown;
};

function EnterpriseControlCentre() {
  const enterprise = useEnterprise();
  const { canAccessModule } = useAppContext();
  const [view, setView] = useState<View>("Overview");
  const allowedViews = views.filter((item) => canAccessModule(item.moduleKey));
  const overview = enterprise.overview;
  const dashboard = enterprise.dashboard;

  useEffect(() => {
    if (!allowedViews.some((item) => item.label === view) && allowedViews[0]) {
      setView(allowedViews[0].label);
    }
  }, [allowedViews, view]);

  return (
    <AppShell
      title="Enterprise control"
      subtitle="Scoped group, legal-entity, brand, region and branch operations"
      actions={
        <Btn onClick={() => void enterprise.refresh()} disabled={enterprise.status === "loading"}>
          <RefreshCw
            className={`h-4 w-4 ${enterprise.status === "loading" ? "animate-spin" : ""}`}
          />
          Refresh
        </Btn>
      }
    >
      <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex max-w-full gap-1 overflow-x-auto pb-1"
          aria-label="Enterprise sections"
        >
          {allowedViews.map((item) => (
            <button
              type="button"
              key={item.label}
              onClick={() => setView(item.label)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                view === item.label
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 items-center gap-2 text-[12px] font-semibold">
          <span className="shrink-0 text-muted-foreground">Scope</span>
          <select
            aria-label="Enterprise scope"
            value={enterprise.scopeNodeId}
            onChange={(event) => void enterprise.selectScope(event.target.value)}
            className="h-9 min-w-0 max-w-[320px] rounded-md border border-border bg-card px-3 text-[12px]"
          >
            {(overview?.nodes ?? []).map((node) => (
              <option key={node.id} value={node.id}>
                {`${"  ".repeat(node.depth)}${node.name} (${pretty(node.type)})`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {enterprise.status === "loading" && !overview && (
        <Panel className="p-5 text-[13px] text-muted-foreground">
          Loading authorized enterprise scope...
        </Panel>
      )}
      {enterprise.status === "error" && (
        <Panel className="border-danger/30 p-5">
          <div className="flex items-start gap-3 text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="text-[13px] font-semibold">Enterprise data unavailable</div>
              <div className="mt-1 text-[12px]">{enterprise.error}</div>
            </div>
          </div>
        </Panel>
      )}

      {overview && view === "Overview" && (
        <OverviewView overview={overview} dashboard={dashboard} period={enterprise.period} />
      )}
      {overview && view === "Organisation" && <OrganisationView nodes={overview.nodes} />}
      {overview && view === "Policies" && (
        <PoliciesView policies={overview.policies} exceptions={overview.policyExceptions} />
      )}
      {overview && view === "Rollouts" && (
        <RolloutsView rollouts={overview.rollouts} templates={overview.templates} />
      )}
      {overview && view === "Procurement" && (
        <ProcurementView contracts={overview.supplierContracts} />
      )}
      {overview && view === "Franchises" && (
        <FranchiseView
          franchises={overview.franchises}
          fees={overview.franchiseFees}
          compliance={overview.compliance}
        />
      )}
      {overview && view === "Finance" && (
        <OverviewView overview={overview} dashboard={dashboard} period={enterprise.period} />
      )}
      {overview && view === "Readiness" && (
        <ReadinessView readiness={overview.readiness} capability={overview.capabilityStatus} />
      )}
      {overview && view === "Audit" && (
        <AuditView
          events={enterprise.auditEvents}
          exportMessage={enterprise.exportMessage}
          canExport={canAccessModule("enterprise-audit", "SENSITIVE")}
          onExport={() => void enterprise.requestAuditExport()}
        />
      )}
    </AppShell>
  );
}

function OverviewView({
  overview,
  dashboard,
  period,
}: {
  overview: NonNullable<ReturnType<typeof useEnterprise>["overview"]>;
  dashboard: ReturnType<typeof useEnterprise>["dashboard"];
  period: { start: string; end: string };
}) {
  const totals = dashboard?.totals;
  const currency = dashboard?.currency;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Authorized branches" value={totals?.branchCount ?? 0} />
        <Metric label="Net sales" value={money(totals?.netSalesMinor, currency)} />
        <Metric label="Gross profit" value={money(totals?.grossProfitMinor, currency)} />
        <Metric label="Orders" value={totals?.orderCount ?? 0} />
        <Metric label="Open actions" value={totals?.actionCount ?? 0} />
        <Metric label="Rollout issues" value={totals?.rolloutIssueCount ?? 0} />
      </div>
      {dashboard?.crossCurrency && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Monetary totals are unavailable because this scope contains multiple currencies and no
          authoritative FX basis is configured.
        </div>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead
            title="Branch performance"
            sub={`${period.start} to ${period.end} - management aggregation, not statutory consolidation`}
          />
          <DataTable
            columns={[
              "Branch",
              "Currency",
              "Net sales",
              "Gross profit",
              "Food cost",
              "Orders",
              "Quality",
            ]}
            rows={(dashboard?.branches ?? []).map((branch) => [
              branch.branchName,
              branch.currency,
              money(branch.netSalesMinor, branch.currency),
              money(branch.grossProfitMinor, branch.currency),
              `${(branch.foodCostBps / 100).toFixed(1)}%`,
              branch.orderCount.toLocaleString(),
              <Status key={`${branch.branchId}:quality`}>{pretty(branch.quality)}</Status>,
            ])}
            empty="No persisted branch metrics exist for this period."
          />
        </Panel>
        <div className="grid content-start gap-4">
          <Panel>
            <PanelHead title="Control coverage" sub="Records in the authorized scope" />
            <div className="grid grid-cols-2 gap-px bg-border">
              <SmallMetric label="Policies" value={overview.policies.length} />
              <SmallMetric label="Rollouts" value={overview.rollouts.length} />
              <SmallMetric label="Franchises" value={overview.franchises.length} />
              <SmallMetric label="Readiness checks" value={overview.readiness.length} />
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-success" />
              <div>
                <div className="text-[13px] font-semibold">Management reporting boundary</div>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Figures retain branch and legal-entity attribution. Statutory consolidation is not
                  presented as available.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function OrganisationView({ nodes }: { nodes: EnterpriseNode[] }) {
  const [query, setQuery] = useState("");
  const filtered = nodes.filter((node) => {
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      `${node.name} ${node.code} ${node.type} ${node.status}`.toLowerCase().includes(needle)
    );
  });
  return (
    <Panel>
      <PanelHead
        title="Organization hierarchy"
        sub="Effective-dated authoritative scope tree"
        right={
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              aria-label="Search organization hierarchy"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-9 w-[180px] rounded-md border border-border bg-card pl-8 pr-3 text-[12px] outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        }
      />
      <DataTable
        columns={["Scope", "Type", "Code", "Status", "Children", "Currency"]}
        rows={filtered.map((node) => [
          <div
            key={node.id}
            className="flex items-center gap-2"
            style={{ paddingLeft: `${Math.min(node.depth, 6) * 12}px` }}
          >
            {node.depth === 0 ? (
              <Network className="h-4 w-4 text-primary" />
            ) : (
              <Building2 className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-semibold">{node.name}</span>
          </div>,
          pretty(node.type),
          node.code,
          <Status key={`${node.id}:status`}>{pretty(node.status)}</Status>,
          node.childCount,
          node.currency ?? "Inherited",
        ])}
        empty="No enterprise nodes are visible in your authorized scope."
      />
    </Panel>
  );
}

function AuditView({
  events,
  exportMessage,
  canExport,
  onExport,
}: {
  events: Array<Record<string, unknown>>;
  exportMessage: string;
  canExport: boolean;
  onExport: () => void;
}) {
  return (
    <Panel>
      <PanelHead
        title="Enterprise audit"
        sub="Authorized scope, bounded to the 100 most recent events"
        right={
          canExport ? (
            <Btn onClick={onExport} title="Create a server-authorized audit export">
              <Download className="h-4 w-4" />
              Export
            </Btn>
          ) : undefined
        }
      />
      {exportMessage && (
        <div className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
          {exportMessage}
        </div>
      )}
      <DataTable
        columns={["Time", "Actor", "Action", "Domain", "Entity", "Correlation"]}
        rows={events.map((event, index) => [
          shortDate(event["created_at"]),
          textValue(event["actor_id"]),
          pretty(textValue(event["action"])),
          pretty(textValue(event["entity_type"])),
          textValue(event["entity_id"]),
          <span key={`audit:${index}`} className="font-mono text-[11px]">
            {textValue(event["correlation_id"])}
          </span>,
        ])}
        empty="No audit events are visible in this authorized scope."
      />
    </Panel>
  );
}

function PoliciesView({
  policies,
  exceptions,
}: {
  policies: EnterpriseRecord[];
  exceptions: EnterpriseRecord[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <Panel>
        <PanelHead title="Policy inheritance" sub="Configured source, state and effective period" />
        <DataTable
          columns={["Policy", "Category", "Scope", "State", "Effective", "Until"]}
          rows={policies.map((row, index) => [
            textValue(row.name ?? row.code),
            pretty(textValue(row.category)),
            textValue(row.scope_node_id, "Definition only"),
            <Status key={`policy:${index}`}>{pretty(textValue(row.state, "Inherited"))}</Status>,
            shortDate(row.effective_from),
            shortDate(row.effective_to),
          ])}
          empty="No enterprise policies are configured."
        />
      </Panel>
      <Panel>
        <PanelHead title="Exception queue" sub="Explicit, reviewable deviations" />
        <div className="divide-y divide-border">
          {exceptions.map((row, index) => (
            <div key={textValue(row.id, String(index))} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[12px] font-semibold">{textValue(row.policy_code)}</div>
                <Status>{pretty(textValue(row.status))}</Status>
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {textValue(row.scope_name)}
              </div>
              <div className="mt-2 text-[12px] leading-5">{textValue(row.reason)}</div>
            </div>
          ))}
          {!exceptions.length && <Empty text="No policy exceptions require review." />}
        </div>
      </Panel>
    </div>
  );
}

function RolloutsView({
  rollouts,
  templates,
}: {
  rollouts: EnterpriseRecord[];
  templates: EnterpriseRecord[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHead
          title="Controlled rollouts"
          sub="Previewed, approved and idempotent branch changes"
        />
        <DataTable
          columns={["Type", "Scope", "Status", "Scheduled", "Updated"]}
          rows={rollouts.map((row, index) => [
            pretty(textValue(row.rollout_type)),
            textValue(row.scope_node_id),
            <Status key={`rollout:${index}`}>{pretty(textValue(row.status))}</Status>,
            shortDate(row.scheduled_at),
            shortDate(row.updated_at),
          ])}
          empty="No rollouts have been created."
        />
      </Panel>
      <Panel>
        <PanelHead title="Branch templates" sub="Versioned configuration baselines" />
        <DataTable
          columns={["Template", "Status", "Latest", "Published", "Branches"]}
          rows={templates.map((row, index) => [
            textValue(row.name),
            <Status key={`template:${index}`}>{pretty(textValue(row.status))}</Status>,
            textValue(row.latest_version),
            textValue(row.published_version),
            textValue(row.branch_count, "0"),
          ])}
          empty="No branch templates are configured."
        />
      </Panel>
    </div>
  );
}

function ProcurementView({ contracts }: { contracts: EnterpriseRecord[] }) {
  return (
    <Panel>
      <PanelHead title="Central procurement" sub="Scoped supplier contracts and negotiated terms" />
      <DataTable
        columns={["Supplier", "Contract", "Price", "Lead time", "Status", "Effective"]}
        rows={contracts.map((row, index) => [
          textValue(row.supplier_name),
          textValue(row.contract_reference),
          money(numberValue(row.negotiated_price_minor), textValue(row.currency)),
          row.lead_time_days == null ? "Not set" : `${textValue(row.lead_time_days)} days`,
          <Status key={`contract:${index}`}>{pretty(textValue(row.status))}</Status>,
          shortDate(row.effective_from),
        ])}
        empty="No supplier contracts are available in this scope."
      />
    </Panel>
  );
}

function FranchiseView({
  franchises,
  fees,
  compliance,
}: {
  franchises: EnterpriseRecord[];
  fees: EnterpriseRecord[];
  compliance: EnterpriseRecord[];
}) {
  return (
    <div className="grid gap-4">
      <Panel>
        <PanelHead
          title="Franchise relationships"
          sub="Separate legal entities with explicitly governed access"
        />
        <DataTable
          columns={["Franchisee", "Franchisor", "Agreement", "Branches", "Status"]}
          rows={franchises.map((row, index) => [
            textValue(row.franchisee_name),
            textValue(row.franchisor_name),
            textValue(row.agreement_reference),
            textValue(row.branch_count, "0"),
            <Status key={`franchise:${index}`}>{pretty(textValue(row.status))}</Status>,
          ])}
          empty="No franchise relationship is configured."
        />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHead title="Fee periods" sub="Deterministic basis and evidence quality" />
          <DataTable
            columns={["Fee", "Period", "Basis", "Amount", "Quality", "Status"]}
            rows={fees.map((row, index) => [
              textValue(row.fee_name),
              `${shortDate(row.period_start)} - ${shortDate(row.period_end)}`,
              money(numberValue(row.basis_minor), textValue(row.currency)),
              money(numberValue(row.amount_minor), textValue(row.currency)),
              <Status key={`fee-quality:${index}`}>{pretty(textValue(row.quality))}</Status>,
              <Status key={`fee-status:${index}`}>{pretty(textValue(row.status))}</Status>,
            ])}
            empty="No franchise fee period has been calculated."
          />
        </Panel>
        <Panel>
          <PanelHead
            title="Compliance evidence"
            sub="Factual checks; missing evidence remains unknown"
          />
          <DataTable
            columns={["Branch", "Check", "Status", "Message"]}
            rows={compliance.map((row, index) => [
              textValue(row.branch_name, "Relationship"),
              pretty(textValue(row.check_code)),
              <Status key={`compliance:${index}`}>{pretty(textValue(row.status))}</Status>,
              textValue(row.message),
            ])}
            empty="No compliance evidence has been calculated."
          />
        </Panel>
      </div>
    </div>
  );
}

function ReadinessView({
  readiness,
  capability,
}: {
  readiness: EnterpriseRecord[];
  capability: NonNullable<ReturnType<typeof useEnterprise>["overview"]>["capabilityStatus"];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <PanelHead
          title="Branch readiness"
          sub="Worker-calculated rollout and operational checks"
        />
        <DataTable
          columns={["Check", "Status", "Severity", "Message", "Calculated"]}
          rows={readiness.map((row, index) => [
            pretty(textValue(row.check_code)),
            <Status key={`ready:${index}`}>{pretty(textValue(row.status))}</Status>,
            pretty(textValue(row.severity)),
            textValue(row.message),
            shortDate(row.calculated_at),
          ])}
          empty="No readiness results are available yet."
        />
      </Panel>
      <Panel>
        <PanelHead title="Enterprise boundaries" sub="Capabilities reported honestly" />
        <div className="divide-y divide-border">
          {Object.entries(capability).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold">
                {value === "NOT_SUPPORTED" || value === "SPEC_REQUIRED" ? (
                  <FileLock2 className="h-4 w-4 text-warning" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-info" />
                )}
                {pretty(key)}
              </div>
              <Status>{pretty(value)}</Status>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  empty: string;
}) {
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr>
            {columns.map((column) => (
              <TH key={column}>{column}</TH>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <TD key={cellIndex}>{cell}</TD>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-5 text-[12px] text-muted-foreground">{text}</p>;
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card p-4">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-[20px] font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

function money(value: number | null | undefined, currency?: string) {
  if (value == null || !currency) return "Unavailable";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function textValue(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function pretty(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function shortDate(value: unknown) {
  const text = textValue(value, "");
  return text ? text.slice(0, 10) : "-";
}
