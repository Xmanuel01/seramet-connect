import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PosCustomerPicker } from "@/components/app/PosCustomerPicker";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus, shortDate } from "@/crm/crm-ui";
import { crmErrorMessage, crmFieldClass, useCrmScreenQuery } from "@/crm/use-crm-screen";
import { useCrmApi } from "@/crm/use-crm";
import type { PosCustomerIdentity } from "@/crm/pos-customer-link";
import { useAppContext } from "@/lib/app-context";
import { formatMinor } from "@/payments/money";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/crm-pipeline")({
  head: () => ({ meta: [{ title: "CRM pipeline - Seramet" }] }),
  component: CrmPipeline,
});

const stages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
type Stage = (typeof stages)[number];
type Lead = {
  id: string;
  branchId: string;
  contactName: string;
  companyName: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  source: string;
  ownerName: string;
  estimatedValueMinor: number;
  currency: string;
  stage: Stage;
  nextAction: string | null;
  dueAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type LeadPage = { ok: boolean; leads: Lead[]; nextCursor: string | null };
type LeadSummary = {
  ok: boolean;
  summary: {
    stages: Array<{
      currency: string;
      stage: Stage;
      lead_count: number;
      estimated_value_minor: number;
    }>;
    overdueCount: number;
  };
};
type History = {
  id: string;
  from_stage: string | null;
  to_stage: string;
  note: string | null;
  action_by: string;
  created_at: string;
};
type HistoryResponse = { ok: boolean; history: History[] };
const allowedTransitions: Record<Stage, Stage[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "LOST"],
  QUALIFIED: ["PROPOSAL", "LOST"],
  PROPOSAL: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

function CrmPipeline() {
  const { branchId, branchLabel, hasPermission, locale } = useAppContext();
  const canView = hasPermission(permissions.crmView);
  const canManage = hasPermission(permissions.crmCustomerManage);
  const { command } = useCrmApi();
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [filter, setFilter] = useState<Stage | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [contactName, setContactName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [source, setSource] = useState("REFERRAL");
  const [value, setValue] = useState(0);
  const [nextAction, setNextAction] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [customer, setCustomer] = useState<PosCustomerIdentity | null>(null);
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<Lead | null>(null);
  const [nextStage, setNextStage] = useState<Stage>("CONTACTED");
  const [action, setAction] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [updateKey, setUpdateKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setCursor(null);
    setHistoryStack([]);
    setSelected(null);
  }, [branchId, filter]);

  const params = new URLSearchParams({ branchId, limit: "30" });
  if (filter !== "ALL") params.set("stage", filter);
  if (cursor) params.set("cursor", cursor);
  const leads = useCrmScreenQuery<LeadPage>(
    "/api/seramet/crm/leads?" + params.toString(),
    canView,
  );
  const summary = useCrmScreenQuery<LeadSummary>(
    "/api/seramet/crm/leads/summary?branchId=" + encodeURIComponent(branchId),
    canView,
  );
  const leadHistory = useCrmScreenQuery<HistoryResponse>(
    selected ? "/api/seramet/crm/leads/" + encodeURIComponent(selected.id) + "/history" : null,
    canView && selected !== null,
  );
  const totalRows = summary.data?.summary.stages ?? [];
  const currencies = [...new Set(totalRows.map((row) => row.currency))];
  const open = totalRows
    .filter((row) => !["WON", "LOST"].includes(row.stage))
    .reduce((sum, row) => sum + row.lead_count, 0);
  const totals = currencies.map((currency) => ({
    currency,
    amountMinor: totalRows
      .filter((row) => row.currency === currency && !["WON", "LOST"].includes(row.stage))
      .reduce((sum, row) => sum + row.estimated_value_minor, 0),
  }));
  const money = (minor: number, currency: string) => formatMinor(minor, currency, locale);

  function refresh() {
    leads.refresh();
    summary.refresh();
    if (selected) leadHistory.refresh();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setError("");
    try {
      const amount = Math.round(value * 100);
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error("Estimated value must be a valid nonnegative amount.");
      }
      await command("/api/seramet/crm/leads", {
        branchId,
        contactName: customer?.displayName || contactName.trim(),
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
        ...(customer ? { customerId: customer.id } : {}),
        source,
        estimatedValueMinor: amount,
        ...(nextAction.trim() ? { nextAction: nextAction.trim() } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        requestKey: createKey,
      });
      setShowCreate(false);
      setContactName("");
      setCompanyName("");
      setNextAction("");
      setDueAt("");
      setValue(0);
      setCustomer(null);
      setCreateKey(crypto.randomUUID());
      setNotice("New lead recorded on the server.");
      refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function select(row: Lead) {
    setSelected(row);
    setNextStage(allowedTransitions[row.stage][0] ?? row.stage);
    setAction(row.nextAction ?? "");
    setActionDue(row.dueAt ? row.dueAt.slice(0, 16) : "");
    setClosureReason("");
    setUpdateKey(crypto.randomUUID());
    setError("");
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage || busy) return;
    setBusy(true);
    setError("");
    try {
      await command("/api/seramet/crm/leads/" + encodeURIComponent(selected.id) + "/updates", {
        stage: nextStage,
        expectedVersion: selected.version,
        requestKey: updateKey,
        nextAction: action.trim(),
        dueAt: actionDue ? new Date(actionDue).toISOString() : null,
        ...(closureReason.trim() ? { reason: closureReason.trim() } : {}),
      });
      setSelected(null);
      setUpdateKey(crypto.randomUUID());
      setNotice("Lead updated and its immutable transition recorded.");
      refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="CRM pipeline"
      subtitle={"Corporate and catering opportunities in the selected branch - " + branchLabel}
      actions={
        canManage ? (
          <Btn variant="primary" onClick={() => setShowCreate((previous) => !previous)}>
            {showCreate ? "Cancel" : "New lead"}
          </Btn>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="Access restricted" body="CRM viewing permission is required." />
        </Panel>
      ) : (
        <>
          {notice && <p role="status" className="mb-3 text-[12px] text-success">{notice}</p>}
          {error && <p role="alert" className="mb-3 text-[12px] text-danger">{error}</p>}
          {showCreate && canManage && (
            <Panel className="mb-4">
              <PanelHead
                title="Create opportunity"
                sub="Estimated deal value is not recognized revenue. The creating staff member is the owner."
              />
              <form onSubmit={create} className="grid gap-3 p-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <PosCustomerPicker value={customer} disabled={busy} onSelect={setCustomer} />
                </div>
                {!customer && (
                  <label className="grid gap-1 text-[12px]">
                    Contact name
                    <input
                      className={crmFieldClass}
                      required
                      maxLength={160}
                      value={contactName}
                      onChange={(event) => setContactName(event.target.value)}
                    />
                  </label>
                )}
                <label className="grid gap-1 text-[12px]">
                  Company (optional)
                  <input
                    className={crmFieldClass}
                    maxLength={160}
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Lead source
                  <select
                    className={crmFieldClass}
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    <option value="REFERRAL">Referral</option>
                    <option value="WALK_IN">Walk-in</option>
                    <option value="PHONE">Phone</option>
                    <option value="WEBSITE">Website inquiry</option>
                    <option value="MANUAL">Other direct inquiry</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[12px]">
                  Estimated deal value (branch currency)
                  <input
                    className={crmFieldClass}
                    type="number"
                    min={0}
                    step={0.01}
                    value={value}
                    onChange={(event) => setValue(Number(event.target.value))}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Next action
                  <input
                    className={crmFieldClass}
                    maxLength={500}
                    value={nextAction}
                    onChange={(event) => setNextAction(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Follow-up time
                  <input
                    className={crmFieldClass}
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                </label>
                <div className="md:col-span-2">
                  <Btn type="submit" variant="primary" disabled={busy}>
                    {busy ? "Saving..." : "Record lead"}
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Open leads (all pages)" value={open} />
            <Metric label="Overdue actions" value={summary.data?.summary.overdueCount ?? "Loading"} />
            <Metric
              label="Open estimated pipeline"
              value={
                summary.status === "ready"
                  ? totals.length
                    ? totals.map((item) => money(item.amountMinor, item.currency)).join(" / ")
                    : "No open estimates"
                  : "Loading"
              }
            />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Opportunity register"
              sub="Stage totals come from the complete authorized branch dataset."
              right={<Btn onClick={refresh}>Refresh</Btn>}
            />
            <div className="border-b border-border p-4">
              <label className="grid max-w-xs gap-1 text-[12px]">
                Stage
                <select
                  className={crmFieldClass}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as Stage | "ALL")}
                >
                  <option value="ALL">All stages</option>
                  {stages.map((stage) => (
                    <option key={stage} value={stage}>
                      {readableStatus(stage)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {leads.status === "loading" || summary.status === "loading" ? (
              <CrmLoading label="Loading live opportunities" />
            ) : leads.status === "error" || summary.status === "error" ? (
              <CrmError message={leads.error || summary.error} retry={refresh} />
            ) : leads.data?.leads.length === 0 ? (
              <CrmEmpty title="No opportunities found" body="No leads match the selected branch and stage." />
            ) : (
              <>
                <div className="divide-y divide-border">
                  {leads.data?.leads.map((row) => (
                    <article key={row.id} className="space-y-1 p-4 text-[13px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{row.contactName}</strong>
                        <Status>{readableStatus(row.stage)}</Status>
                      </div>
                      <p>{row.companyName || "Individual"} · {money(row.estimatedValueMinor, row.currency)}</p>
                      <p className="text-[12px] text-muted-foreground">
                        Owner: {row.ownerName} · Source: {readableStatus(row.source)}
                      </p>
                      {row.nextAction && <p>Next: {row.nextAction}</p>}
                      {row.dueAt && <p className="text-[12px]">Due: {shortDate(row.dueAt)}</p>}
                      <Btn onClick={() => select(row)}>Details and update</Btn>
                    </article>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-border p-4">
                  <Btn
                    disabled={historyStack.length === 0}
                    onClick={() => {
                      const previous = historyStack[historyStack.length - 1];
                      setHistoryStack((items) => items.slice(0, -1));
                      setCursor(previous || null);
                    }}
                  >
                    Previous
                  </Btn>
                  <span className="text-[12px]">Page {historyStack.length + 1}</span>
                  <Btn
                    disabled={!leads.data?.nextCursor}
                    onClick={() => {
                      if (!leads.data?.nextCursor) return;
                      setHistoryStack((items) => [...items, cursor ?? ""]);
                      setCursor(leads.data.nextCursor);
                    }}
                  >
                    Next
                  </Btn>
                </div>
              </>
            )}
          </Panel>
          {selected && selected.branchId === branchId && (
            <Panel className="mt-4">
              <PanelHead
                title={"Opportunity: " + selected.contactName}
                sub="Stage changes and notes are recorded as immutable events."
                right={<Btn onClick={() => setSelected(null)}>Close</Btn>}
              />
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {canManage && !["WON", "LOST"].includes(selected.stage) && (
                  <form onSubmit={update} className="space-y-3">
                    <label className="grid gap-1 text-[12px]">
                      Next stage
                      <select
                        className={crmFieldClass}
                        value={nextStage}
                        onChange={(event) => {
                          setNextStage(event.target.value as Stage);
                          setUpdateKey(crypto.randomUUID());
                        }}
                      >
                        <option value={selected.stage}>Remain in {readableStatus(selected.stage)}</option>
                        {allowedTransitions[selected.stage].map((stage) => (
                          <option key={stage} value={stage}>{readableStatus(stage)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[12px]">
                      Next action
                      <input
                        className={crmFieldClass}
                        maxLength={500}
                        value={action}
                        onChange={(event) => {
                          setAction(event.target.value);
                          setUpdateKey(crypto.randomUUID());
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-[12px]">
                      Due
                      <input
                        className={crmFieldClass}
                        type="datetime-local"
                        value={actionDue}
                        onChange={(event) => {
                          setActionDue(event.target.value);
                          setUpdateKey(crypto.randomUUID());
                        }}
                      />
                    </label>
                    {["WON", "LOST"].includes(nextStage) && (
                      <label className="grid gap-1 text-[12px]">
                        Closure reason
                        <input
                          className={crmFieldClass}
                          minLength={4}
                          maxLength={500}
                          required
                          value={closureReason}
                          onChange={(event) => {
                            setClosureReason(event.target.value);
                            setUpdateKey(crypto.randomUUID());
                          }}
                        />
                      </label>
                    )}
                    <Btn type="submit" variant="primary" disabled={busy}>
                      {busy ? "Saving..." : "Save authorized change"}
                    </Btn>
                    <p className="text-[11px] text-muted-foreground">
                      Won records an agreement, not a paid POS invoice.
                    </p>
                  </form>
                )}
                <div>
                  <h3 className="text-[13px] font-semibold">Audit history</h3>
                  {leadHistory.status === "loading" ? (
                    <CrmLoading label="Loading lead history" />
                  ) : leadHistory.status === "error" ? (
                    <CrmError message={leadHistory.error} retry={leadHistory.refresh} />
                  ) : (
                    <ol className="mt-2 space-y-2">
                      {leadHistory.data?.history.map((row) => (
                        <li key={row.id} className="rounded-md border border-border p-3 text-[12px]">
                          {readableStatus(row.from_stage)} → {readableStatus(row.to_stage)}
                          <p>{row.note || "No closure note"}</p>
                          <p className="text-muted-foreground">{shortDate(row.created_at)}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </>
      )}
    </AppShell>
  );
}
