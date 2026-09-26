import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead } from "@/components/app/ui";
import { FinanceFetchState, FinanceQuality, reportMoney } from "@/finance/finance-ui";
import {
  useFinancePeriod,
  useFinanceReport,
  type FinanceStatement,
} from "@/finance/use-finance-report";
import { useAppContext } from "@/lib/app-context";
import { useManagementIntelligence } from "@/management/use-management-intelligence";
import { QualityStatus, ManagementReadModelState } from "@/management/ui";

type UnconfiguredModule = {
  title: string;
  detail: string;
  requirements: string[];
  sourceLabel: string;
  sourceRoute: "/general-ledger" | "/reconciliation" | "/procurement" | "/finance" | "/invoices";
};

function UnconfiguredFinanceModule({ config }: { config: UnconfiguredModule }) {
  const { branchLabel } = useAppContext();
  const period = useFinancePeriod();
  const statement = useFinanceReport<FinanceStatement>("statement", period.from, period.to);
  return (
    <AppShell
      title={config.title}
      subtitle={"Accounting configuration and source evidence — " + branchLabel}
    >
      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-3">
        <label className="grid gap-1 text-[12px]">
          From
          <input
            type="date"
            value={period.from}
            onChange={(event) => period.setFrom(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3"
          />
        </label>
        <label className="grid gap-1 text-[12px]">
          To
          <input
            type="date"
            value={period.to}
            onChange={(event) => period.setTo(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3"
          />
        </label>
        <Btn onClick={statement.refresh}>Refresh actual ledger evidence</Btn>
      </div>
      <FinanceFetchState
        status={statement.status}
        error={statement.error}
        retry={statement.refresh}
      />
      {statement.report && (
        <FinanceQuality quality={statement.report.quality} issues={statement.report.issues} />
      )}
      <Panel className="mt-4 p-5">
        <PanelHead
          title={config.title + " is not configured"}
          sub="No financial posting or creation controls are offered before the actual backend is installed."
        />
        <p className="mt-3 text-[13px]">{config.detail}</p>
        <h3 className="mt-4 text-[13px] font-semibold">Required before activation</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-[12px] text-muted-foreground">
          {config.requirements.map((requirement) => (
            <li key={requirement}>{requirement}</li>
          ))}
        </ul>
        <Link
          className="mt-4 inline-flex rounded-md border border-border px-3 py-2 text-[12px] font-semibold underline"
          to={config.sourceRoute}
        >
          {config.sourceLabel}
        </Link>
      </Panel>
    </AppShell>
  );
}

export function AssetsPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const ledger = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const recordedAssets =
    ledger.report?.lines.filter(
      (account) =>
        ["ASSET", "BANK", "CASH"].includes(account.type) &&
        account.currency === ledger.report?.scope.currency,
    ) ?? [];
  return (
    <AppShell
      title="Asset control"
      subtitle={
        "Actual posted asset balances; fixed-asset subledger not yet configured — " + branchLabel
      }
    >
      <div className="flex gap-3">
        <Btn onClick={ledger.refresh}>Refresh</Btn>
        <Link to="/general-ledger" className="self-center text-[12px] underline">
          Trace source vouchers
        </Link>
      </div>
      <FinanceFetchState status={ledger.status} error={ledger.error} retry={ledger.refresh} />
      {ledger.report && (
        <>
          <FinanceQuality quality={ledger.report.quality} issues={ledger.report.issues} />
          <Panel className="mt-4 p-4">
            <PanelHead
              title="Actual posted asset accounts"
              sub="Asset accounts alone do not establish fixed-asset register values, accumulated depreciation or net book value."
            />
            {recordedAssets.map((item) => (
              <div
                key={item.accountId}
                className="flex justify-between border-t border-border p-3 text-[12px]"
              >
                <span>
                  {item.code} {item.name} ({item.type})
                </span>
                <strong>{reportMoney(item.closingSignedMinor, item.currency)}</strong>
              </div>
            ))}
            {!recordedAssets.length && (
              <p className="p-3 text-[12px]">
                No recorded asset account movement in the selected scope.
              </p>
            )}
          </Panel>
          <Panel className="mt-4 p-4 text-[12px]">
            Asset acquisition, tagging, disposals, depreciation and physical verification require an
            approved fixed-asset subledger and configured account mappings. Add/import controls are
            unavailable until that complete service is implemented.
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function PrimeCostPage() {
  const { branchLabel } = useAppContext();
  const intelligence = useManagementIntelligence();
  const pnl = intelligence.control?.flashPnl;
  const cost = pnl ? pnl.cogsMinor + pnl.labourCostMinor : null;
  return (
    <AppShell
      title="Prime cost"
      subtitle={
        "Authoritative management snapshot, not an accounting posting screen — " + branchLabel
      }
      actions={<Btn onClick={() => void intelligence.refresh()}>Refresh source calculations</Btn>}
    >
      <ManagementReadModelState
        status={intelligence.status}
        error={intelligence.error}
        empty={!pnl}
      />
      {intelligence.status === "ready" && pnl && cost !== null && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric
              label="Period net revenue"
              value={reportMoney(pnl.netRevenueMinor, pnl.currency)}
            />
            <Metric
              label="Posted and calculated COGS"
              value={reportMoney(pnl.cogsMinor, pnl.currency)}
            />
            <Metric
              label="Documented labour"
              value={reportMoney(pnl.labourCostMinor, pnl.currency)}
            />
            <Metric label="Derived prime cost" value={reportMoney(cost, pnl.currency)} />
          </div>
          <Panel className="mt-4 p-4">
            <PanelHead
              title="Evidence quality"
              sub={pnl.periodStart + " through " + pnl.periodEnd}
              right={<QualityStatus quality={pnl.quality} />}
            />
            {pnl.qualityReasons.length ? (
              <p className="mt-3 text-[12px] text-warning">
                Partial costing evidence: {pnl.qualityReasons.join(", ")}. Prime-cost figures must
                not be treated as final accounting results.
              </p>
            ) : (
              <p className="mt-3 text-[12px]">
                This view uses the calculated management source. General ledger postings and full
                payroll evidence must be reconciled separately.
              </p>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function BudgetsPage() {
  return (
    <UnconfiguredFinanceModule
      config={{
        title: "Budget control",
        detail:
          "There is no versioned, approved financial budget register in the authoritative schema. An empty table and a fake New Budget button cannot be represented as completed budgeting.",
        requirements: [
          "Add a tenant- and branch-scoped approved budget version and account/cost-centre lines.",
          "Enforce editable draft, submit, independent approval, frozen version and audit trail.",
          "Compare posted actuals against the matching period, dimension and currency, with incomplete-data flags.",
        ],
        sourceLabel: "Inspect posted actuals",
        sourceRoute: "/general-ledger",
      }}
    />
  );
}

export function CostCentresPage() {
  return (
    <UnconfiguredFinanceModule
      config={{
        title: "Cost centres",
        detail:
          "Branch management P&L is available, but allocation of kitchen, bar, front-of-house and delivery expenses to cost centres is not backed by an approved transaction-level allocation service.",
        requirements: [
          "Define tenant- and branch-authorized cost centre masters and their account mappings.",
          "Implement posted journal dimensions and documented, versioned allocation rules.",
          "Trace every allocation back to original vouchers and keep unassigned expense separately visible.",
        ],
        sourceLabel: "Review real branch finance",
        sourceRoute: "/finance",
      }}
    />
  );
}

export function CreditNotesPage() {
  return (
    <UnconfiguredFinanceModule
      config={{
        title: "Credit and debit notes",
        detail:
          "A production credit-note lifecycle must not be replaced by a blank table or synthetic Refund button. Existing payment refund and supplier return actions have their own independent controls.",
        requirements: [
          "Approve immutable notes linked to original invoice or supplier bill with validated remaining refundable quantity and tax.",
          "Post balanced reversing journal and receivable/payable allocations once per idempotency key.",
          "Route provider refunds only after confirmation and retain source/cancellation/audit links.",
        ],
        sourceLabel: "Review actual payment reconciliation",
        sourceRoute: "/reconciliation",
      }}
    />
  );
}

export function DepreciationPage() {
  return (
    <UnconfiguredFinanceModule
      config={{
        title: "Depreciation",
        detail:
          "A fixed date and zero charge are not evidence of a completed depreciation run. The existing schema has no verified asset-register or approved depreciation schedule.",
        requirements: [
          "Create tagged asset acquisition, depreciation method, useful life and disposal records.",
          "Configure actual expense/accumulated depreciation account mappings and a date-locked posting schedule.",
          "Make each approved monthly posting idempotent and auditable, including linked reversals.",
        ],
        sourceLabel: "Review actual GL postings",
        sourceRoute: "/general-ledger",
      }}
    />
  );
}
