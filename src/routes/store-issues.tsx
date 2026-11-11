import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PackageMinus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { useReasonPrompt } from "@/components/app/ReasonDialog";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { formatMoney } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/store-issues")({
  head: () => ({
    meta: [
      { title: "Store Issues - Seramet" },
      {
        name: "description",
        content:
          "Request items from the store, record items already taken, and approve and issue them.",
      },
    ],
  }),
  component: StoreIssues,
});

type Workspace = {
  warehouses: { id: string; name: string; location_type: string }[];
  items: {
    id: string;
    code: string;
    sku: string | null;
    name: string;
    unit_symbol: string | null;
  }[];
  balances: {
    warehouse_id: string;
    item_id: string;
    quantity_minor: number;
    average_unit_cost_minor: number;
  }[];
  departments: { id: string; code: string; name: string }[];
  canApprove: boolean;
  canViewAll: boolean;
};

type IssueLine = {
  id: string;
  line_number: number;
  inventory_item_id: string;
  item_name: string;
  sku: string | null;
  code: string;
  unit_symbol: string | null;
  requested_quantity_minor: number;
  approved_quantity_minor: number | null;
  issued_quantity_minor: number;
  unit_cost_minor: number | null;
  total_cost_minor: number;
  movement_id: string | null;
  reversal_movement_id: string | null;
};

type Issue = {
  id: string;
  branch_id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  issue_number: string;
  kind: "REQUEST" | "DIRECT";
  status: string;
  department_code: string;
  department_name: string;
  reason: string;
  notes: string | null;
  requested_by: string;
  approved_by: string | null;
  issued_by: string | null;
  reviewed_by: string | null;
  rejected_by: string | null;
  decision_reason: string | null;
  total_cost_minor: number;
  business_date: string;
  created_at: string;
  lines: IssueLine[];
};

/** Used when the restaurant has not set up departments yet. */
const defaultDepartments = [
  { code: "KITCHEN", name: "Kitchen" },
  { code: "BAR", name: "Bar" },
  { code: "HOUSEKEEPING", name: "Housekeeping" },
  { code: "FRONT_OF_HOUSE", name: "Front of house" },
  { code: "MAINTENANCE", name: "Maintenance" },
  { code: "ADMIN", name: "Admin & office" },
];

const openStatuses = new Set(["REQUESTED", "APPROVED", "PENDING_REVIEW"]);
const statusLabel: Record<string, string> = {
  REQUESTED: "Awaiting approval",
  APPROVED: "Approved",
  ISSUED: "Issued",
  PENDING_REVIEW: "Taken - to review",
  REVIEWED: "Confirmed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

type Tab = "open" | "history";
type FormKind = "REQUEST" | "DIRECT";
type Decision = { issue: Issue; action: "approve" | "issue" };

function StoreIssues() {
  const { activeTenantId, branchId, branchLabel, currentUser, hasPermission, isAllBranches } =
    useAppContext();
  const canRequest = hasPermission(permissions.inventoryIssueRequest);
  const scope = JSON.stringify([activeTenantId, branchId, currentUser.id]);
  const active = useRef(scope);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("open");
  const [form, setForm] = useState<FormKind | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [askReason, reasonDialog] = useReasonPrompt();

  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      "content-type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }, [activeTenantId, branchId]);

  const load = useCallback(async () => {
    const query = `branchId=${encodeURIComponent(branchId)}`;
    setLoading(true);
    try {
      const [ws, list] = await Promise.all([
        getJson<{ workspace: Workspace }>(
          `/api/seramet/inventory/store-issues/workspace?${query}`,
          headers,
        ),
        getJson<{ issues: Issue[] }>(
          `/api/seramet/inventory/store-issues?${query}&limit=200`,
          headers,
        ),
      ]);
      if (active.current !== scope) return;
      setWorkspace(ws.workspace);
      setIssues(list.issues);
    } catch (error) {
      if (active.current === scope)
        setNotice(error instanceof Error ? error.message : "Store issues unavailable");
    } finally {
      if (active.current === scope) setLoading(false);
    }
  }, [branchId, headers, scope]);

  useEffect(() => {
    active.current = scope;
    setWorkspace(null);
    setIssues([]);
    setNotice("");
    setForm(null);
    setDecision(null);
    void load();
    return () => {
      active.current = "";
    };
  }, [load, scope]);

  const post = async (path: string, body: unknown, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`);
      setNotice(success);
      await load();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Store issue action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const simpleAction = async (
    issue: Issue,
    action: "review" | "reject" | "cancel",
    title: string,
    success: string,
  ) => {
    const reason = await askReason({
      title,
      defaultValue: action === "review" ? "Checked with the department" : "",
      confirmLabel:
        action === "review" ? "Confirm" : action === "cancel" ? "Cancel request" : "Reject",
      destructive: action !== "review",
    });
    if (!reason) return;
    await post(
      `/api/seramet/inventory/store-issues/${encodeURIComponent(issue.id)}/${action}`,
      { reason: reason.trim() },
      success,
    );
  };

  const openRows = issues.filter((row) => openStatuses.has(row.status));
  const historyRows = issues.filter((row) => !openStatuses.has(row.status));
  const rows = tab === "open" ? openRows : historyRows;
  const count = (status: string) => issues.filter((row) => row.status === status).length;
  const issuedValue = issues
    .filter((row) => ["ISSUED", "PENDING_REVIEW", "REVIEWED"].includes(row.status))
    .reduce((sum, row) => sum + Number(row.total_cost_minor ?? 0), 0);
  const ready = !!workspace && !loading;

  return (
    <AppShell
      title="Store issues"
      subtitle={branchLabel}
      actions={
        <>
          <Btn disabled={loading} onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          {canRequest && (
            <>
              <Btn disabled={!ready || busy} onClick={() => setForm("DIRECT")}>
                <PackageMinus className="h-4 w-4" /> Record items taken
              </Btn>
              <Btn variant="primary" disabled={!ready || busy} onClick={() => setForm("REQUEST")}>
                <Plus className="h-4 w-4" /> Request items
              </Btn>
            </>
          )}
        </>
      }
    >
      {reasonDialog}
      {isAllBranches && (
        <Notice>
          Showing {branchLabel}. Choose a branch to work with another branch's stores.
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Awaiting approval"
          value={count("REQUESTED")}
          invert={count("REQUESTED") > 0}
        />
        <Metric label="Ready to issue" value={count("APPROVED")} invert={count("APPROVED") > 0} />
        <Metric
          label="Taken, to review"
          value={count("PENDING_REVIEW")}
          invert={count("PENDING_REVIEW") > 0}
        />
        <Metric label="Issued value (loaded)" value={issuedValue / 100} money />
      </div>

      {form && workspace && (
        <IssueForm
          kind={form}
          workspace={workspace}
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={async (body) => {
            const ok = await post(
              "/api/seramet/inventory/store-issues",
              { ...body, branchId, kind: form, idempotencyKey: crypto.randomUUID() },
              form === "DIRECT"
                ? "Recorded. Stock has been reduced; a storekeeper will review it."
                : "Request sent. Stock changes only when the items are issued.",
            );
            if (ok) setForm(null);
          }}
        />
      )}

      {decision && (
        <DecisionForm
          decision={decision}
          busy={busy}
          onCancel={() => setDecision(null)}
          onSubmit={async (body) => {
            const ok = await post(
              `/api/seramet/inventory/store-issues/${encodeURIComponent(decision.issue.id)}/${decision.action}`,
              body,
              decision.action === "issue"
                ? "Items issued. Stock and the expense account have been updated."
                : "Request approved. Issue the items when they are handed over.",
            );
            if (ok) setDecision(null);
          }}
        />
      )}

      <div
        role="tablist"
        aria-label="Store issue view"
        className="mb-3 mt-4 flex flex-wrap items-center gap-1 border-b border-border"
      >
        {(
          [
            ["open", `Open (${openRows.length})`],
            ["history", `History (${historyRows.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Panel>
        <PanelHead
          title={tab === "open" ? "Open store issues" : "Store issue history"}
          sub={
            workspace?.canViewAll
              ? "All store issues for this branch"
              : "Your requests and the items you recorded"
          }
        />
        <DataTable
          cols={[
            "Issue",
            "Department",
            "Store",
            "Items",
            { l: "Cost", r: true },
            "Date",
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id} className="align-top hover:bg-secondary/50">
              <TD>
                <div className="num font-semibold">{row.issue_number}</div>
                <div className="text-[11px] text-muted-foreground">
                  {row.kind === "DIRECT" ? "Already taken" : "Request"} · {row.reason}
                </div>
              </TD>
              <TD>{row.department_name}</TD>
              <TD className="text-muted-foreground">{row.warehouse_name ?? "-"}</TD>
              <TD>
                <ul className="grid gap-0.5 text-[12px]">
                  {row.lines.map((line) => (
                    <li key={line.id}>
                      {line.item_name}:{" "}
                      <span className="num">
                        {formatQuantity(
                          line.issued_quantity_minor ||
                            (line.approved_quantity_minor ?? line.requested_quantity_minor),
                        )}
                      </span>{" "}
                      {line.unit_symbol ?? ""}
                      {line.issued_quantity_minor > 0 &&
                        line.issued_quantity_minor !== line.requested_quantity_minor && (
                          <span className="text-muted-foreground">
                            {" "}
                            (asked {formatQuantity(line.requested_quantity_minor)})
                          </span>
                        )}
                    </li>
                  ))}
                </ul>
              </TD>
              <TD className="num text-right font-semibold">
                {row.total_cost_minor ? formatMoney(row.total_cost_minor / 100) : "-"}
              </TD>
              <TD className="num text-muted-foreground">{row.business_date}</TD>
              <TD>
                <Status>{statusLabel[row.status] ?? row.status}</Status>
              </TD>
              <TD>
                <RowActions
                  row={row}
                  canApprove={!!workspace?.canApprove}
                  isRequester={row.requested_by === currentUser.id}
                  canRequest={canRequest}
                  busy={busy}
                  onDecision={(action) => setDecision({ issue: row, action })}
                  onAction={(action, title, success) =>
                    void simpleAction(row, action, title, success)
                  }
                />
              </TD>
            </tr>
          ))}
        </DataTable>
        {!rows.length && ready && (
          <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">
            {tab === "open" ? "Nothing waiting." : "No store issues yet."}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}

function RowActions({
  row,
  canApprove,
  isRequester,
  canRequest,
  busy,
  onDecision,
  onAction,
}: {
  row: Issue;
  canApprove: boolean;
  isRequester: boolean;
  canRequest: boolean;
  busy: boolean;
  onDecision: (action: "approve" | "issue") => void;
  onAction: (action: "review" | "reject" | "cancel", title: string, success: string) => void;
}) {
  const buttons: ReactNode[] = [];
  const link = (key: string, label: string, onClick: () => void, danger = false) => (
    <button
      key={key}
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "text-[12px] font-semibold hover:underline disabled:opacity-50",
        danger ? "text-danger" : "text-primary",
      )}
    >
      {label}
    </button>
  );
  if (canApprove && row.status === "REQUESTED")
    buttons.push(link("approve", "Approve", () => onDecision("approve")));
  if (canApprove && (row.status === "REQUESTED" || row.status === "APPROVED"))
    buttons.push(link("issue", "Issue", () => onDecision("issue")));
  if (canApprove && row.status === "PENDING_REVIEW")
    buttons.push(
      link("review", "Confirm", () =>
        onAction("review", "Confirm items taken", "Confirmed. The issue is final."),
      ),
    );
  if (canApprove && ["REQUESTED", "APPROVED"].includes(row.status))
    buttons.push(
      link(
        "reject",
        "Reject",
        () => onAction("reject", "Reject store request", "Request rejected. No stock moved."),
        true,
      ),
    );
  if (canApprove && row.status === "PENDING_REVIEW")
    buttons.push(
      link(
        "reject",
        "Reject",
        () =>
          onAction(
            "reject",
            "Reject and put the stock back",
            "Rejected. The stock is back in the store and the expense is reversed.",
          ),
        true,
      ),
    );
  if (row.status === "REQUESTED" && (canApprove || (isRequester && canRequest)))
    buttons.push(
      link(
        "cancel",
        "Cancel",
        () => onAction("cancel", "Cancel store request", "Request cancelled."),
        true,
      ),
    );
  if (!buttons.length)
    return (
      <span className="text-[11px] text-muted-foreground">
        {row.decision_reason || (openStatuses.has(row.status) ? "Waiting" : "Final")}
      </span>
    );
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}

type DraftLine = { key: string; itemId: string; quantity: string };

function IssueForm({
  kind,
  workspace,
  busy,
  onCancel,
  onSubmit,
}: {
  kind: FormKind;
  workspace: Workspace;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const departments = workspace.departments.length
    ? workspace.departments.map((row) => ({ value: `id:${row.id}`, label: row.name }))
    : defaultDepartments.map((row) => ({ value: `code:${row.code}`, label: row.name }));
  const [warehouseId, setWarehouseId] = useState(workspace.warehouses[0]?.id ?? "");
  const [department, setDepartment] = useState(departments[0]?.value ?? "");
  const [otherDepartment, setOtherDepartment] = useState("");
  const [reason, setReason] = useState(kind === "DIRECT" ? "Taken for service" : "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { key: crypto.randomUUID(), itemId: "", quantity: "" },
  ]);

  const balance = (itemId: string) =>
    workspace.balances.find((row) => row.warehouse_id === warehouseId && row.item_id === itemId);
  const estimated = lines.reduce((sum, line) => {
    const row = balance(line.itemId);
    return sum + Number(line.quantity || 0) * (Number(row?.average_unit_cost_minor ?? 0) / 100);
  }, 0);
  const chosen = lines.filter((line) => line.itemId);
  const duplicate = new Set(chosen.map((line) => line.itemId)).size !== chosen.length;
  const valid =
    !!warehouseId &&
    !!reason.trim() &&
    chosen.length > 0 &&
    !duplicate &&
    chosen.every((line) => Number(line.quantity) > 0) &&
    (department !== "other" || !!otherDepartment.trim());

  const departmentBody = () => {
    if (department.startsWith("id:")) return { departmentId: department.slice(3) };
    if (department.startsWith("code:")) {
      const code = department.slice(5);
      return {
        departmentCode: code,
        departmentName: defaultDepartments.find((row) => row.code === code)?.name ?? code,
      };
    }
    const name = otherDepartment.trim();
    return {
      departmentCode:
        name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40) || "OTHER",
      departmentName: name,
    };
  };

  return (
    <Panel className="my-4">
      <PanelHead
        title={
          kind === "DIRECT" ? "Record items taken from the store" : "Request items from the store"
        }
        sub={
          kind === "DIRECT"
            ? "Stock reduces now at the store's average cost. A storekeeper reviews it afterwards."
            : "A storekeeper or manager approves and issues the items. Stock reduces when issued."
        }
      />
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <Field label="From store">
          <select
            className={inputClass}
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            {workspace.warehouses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="For department">
          <select
            className={inputClass}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            {departments.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
            <option value="other">Other…</option>
          </select>
        </Field>
        {department === "other" ? (
          <Field label="Department name">
            <input
              className={inputClass}
              value={otherDepartment}
              maxLength={60}
              onChange={(event) => setOtherDepartment(event.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}
        <Field label="Reason">
          <input
            className={inputClass}
            value={reason}
            maxLength={160}
            placeholder="e.g. Lunch prep, cleaning, event"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground md:col-span-2">
          Notes
          <input
            className={inputClass}
            value={notes}
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-2 border-t border-border px-4 py-3">
        {lines.map((line, index) => {
          const row = balance(line.itemId);
          const item = workspace.items.find((candidate) => candidate.id === line.itemId);
          return (
            <div
              key={line.key}
              className="grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]"
            >
              <Field label={index === 0 ? "Item" : ""}>
                <select
                  className={inputClass}
                  value={line.itemId}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((entry) =>
                        entry.key === line.key ? { ...entry, itemId: event.target.value } : entry,
                      ),
                    )
                  }
                >
                  <option value="">Choose an item</option>
                  {workspace.items.map((candidate) => {
                    const stock = workspace.balances.find(
                      (entry) =>
                        entry.warehouse_id === warehouseId && entry.item_id === candidate.id,
                    );
                    return (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} · {formatQuantity(stock?.quantity_minor ?? 0)}{" "}
                        {candidate.unit_symbol ?? "unit"} in store
                      </option>
                    );
                  })}
                </select>
              </Field>
              <Field
                label={
                  index === 0 ? `Quantity${item?.unit_symbol ? ` (${item.unit_symbol})` : ""}` : ""
                }
              >
                <input
                  className={inputClass}
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((entry) =>
                        entry.key === line.key ? { ...entry, quantity: event.target.value } : entry,
                      ),
                    )
                  }
                />
              </Field>
              <div className="flex h-9 items-center gap-2">
                {row && Number(line.quantity) * 1_000_000 > row.quantity_minor && (
                  <span className="text-[11px] text-danger">More than in store</span>
                )}
                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove item"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() =>
                      setLines((current) => current.filter((entry) => entry.key !== line.key))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Btn
            disabled={lines.length >= 100}
            onClick={() =>
              setLines((current) => [
                ...current,
                { key: crypto.randomUUID(), itemId: "", quantity: "" },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add item
          </Btn>
          <span className="text-[12px] text-muted-foreground">
            {duplicate ? "Each item can be listed once. " : ""}Estimated cost{" "}
            <span className="num font-semibold text-foreground">{formatMoney(estimated)}</span>
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={busy || !valid}
          onClick={() =>
            void onSubmit({
              warehouseId,
              ...departmentBody(),
              reason: reason.trim(),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
              lines: chosen.map((line) => ({
                inventoryItemId: line.itemId,
                quantityMicro: Math.round(Number(line.quantity) * 1_000_000),
              })),
            })
          }
        >
          {kind === "DIRECT" ? "Record items taken" : "Send request"}
        </Btn>
      </div>
    </Panel>
  );
}

function DecisionForm({
  decision,
  busy,
  onCancel,
  onSubmit,
}: {
  decision: Decision;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { issue, action } = decision;
  const limitOf = (line: IssueLine) =>
    action === "issue"
      ? (line.approved_quantity_minor ?? line.requested_quantity_minor)
      : line.requested_quantity_minor;
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(issue.lines.map((line) => [line.id, String(limitOf(line) / 1_000_000)])),
  );
  const [reason, setReason] = useState(action === "approve" ? "Approved" : "");
  const parsed = issue.lines.map((line) => ({
    line,
    micro: Math.round(Number(quantities[line.id] || 0) * 1_000_000),
  }));
  const valid =
    parsed.every(({ line, micro }) => micro >= 0 && micro <= limitOf(line)) &&
    (action === "approve" ? !!reason.trim() : parsed.some(({ micro }) => micro > 0));

  return (
    <Panel className="my-4">
      <PanelHead
        title={`${action === "issue" ? "Issue" : "Approve"} ${issue.issue_number} · ${issue.department_name}`}
        sub={
          action === "issue"
            ? "Enter what is handed over. Stock leaves the store at its average cost now."
            : "Approve the full request or reduce quantities. Stock moves when you issue."
        }
      />
      <div className="grid gap-2 p-4">
        {parsed.map(({ line, micro }) => (
          <div key={line.id} className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_160px]">
            <div className="text-[13px]">
              <span className="font-semibold">{line.item_name}</span>{" "}
              <span className="text-muted-foreground">
                asked {formatQuantity(line.requested_quantity_minor)} {line.unit_symbol ?? ""}
                {line.approved_quantity_minor !== null &&
                  `, approved ${formatQuantity(line.approved_quantity_minor)}`}
              </span>
            </div>
            <input
              className={cn(inputClass, micro > limitOf(line) && "border-danger")}
              type="number"
              min="0"
              step="0.001"
              aria-label={`${line.item_name} quantity`}
              value={quantities[line.id] ?? ""}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
              }
            />
          </div>
        ))}
        <Field label={action === "approve" ? "Approval note" : "Note (optional)"}>
          <input
            className={inputClass}
            value={reason}
            maxLength={160}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={busy || !valid}
          onClick={() =>
            void onSubmit({
              ...(reason.trim() ? { reason: reason.trim() } : {}),
              lines: parsed.map(({ line, micro }) => ({ lineId: line.id, quantityMicro: micro })),
            })
          }
        >
          {action === "issue" ? "Issue items" : "Approve"}
        </Btn>
      </div>
    </Panel>
  );
}

async function getJson<T>(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers, signal: AbortSignal.timeout(15000) });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`);
  return payload;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
      {children}
    </div>
  );
}

function formatQuantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
