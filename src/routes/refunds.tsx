import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate } from "@/lib/date-filters";
import { recordBusinessDate } from "@/lib/pos-workflow";
import { businessDateForTimestamp } from "@/lib/business-date";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { permissions } from "@/platform/permissions";
import { majorFromMinor, parseMajorAmount } from "@/payments/money";
import { refundableReceiptMinor } from "@/payments/refund-eligibility";

export const Route = createFileRoute("/refunds")({
  head: () => ({ meta: [{ title: "Refunds - Seramet" }] }),
  component: Refunds,
});

function Refunds() {
  const {
    activeTenantId,
    branchId,
    branchLabel,
    branchRecords,
    currentUser,
    matchesBranch,
    timeZone,
    hasPermission,
    isAllBranches,
  } = useAppContext();
  const { state, mutate } = useTransactionEngine();
  const currency = getConfigurationRepository().getTenant(activeTenantId).defaultCurrency;
  const scope = `${activeTenantId}:${branchId}:${currentUser.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [operation, setOperation] = useState<{
    kind: "request" | "approve" | "reject";
    scope: string;
    refundId?: string;
    requestKey: string;
  } | null>(null);
  const [draft, setDraft] = useState({ receiptId: "", method: "", amount: "", reason: "" });
  const [statusFilter, setStatusFilter] = useState("All");
  const branch = branchRecords.find((item) => item.id === branchId);
  const [periodDate, setPeriodDate] = useState(() =>
    businessDateForTimestamp(
      new Date(),
      branch?.timezone ?? timeZone,
      Number(branch?.metadata["businessDayCutoffMinutes"] ?? 0),
    ),
  );
  const canRequest = hasPermission(permissions.paymentsRefundRequest) && !isAllBranches;
  const canApprove = hasPermission(permissions.paymentsRefundApprove) && !isAllBranches;
  const refundDate = (row: (typeof state.refunds)[number]) => {
    const source = branchRecords.find((item) => item.id === row.branchId);
    return recordBusinessDate(
      row.businessDate,
      row.createdAt,
      source?.timezone ?? timeZone,
      Number(source?.metadata["businessDayCutoffMinutes"] ?? 0),
    );
  };
  const rows = state.refunds
    .filter((row) => matchesBranch(row.branchId ?? row.branch))
    .filter((row) => statusFilter === "All" || row.status === statusFilter)
    .filter((row) => !periodDate || refundDate(row) === periodDate);
  const selected = rows.find((row) => row.id === selectedId);
  const receipts = state.receipts.filter(
    (row) =>
      matchesBranch(row.branchId ?? row.branch) &&
      (!row.tenantId || row.tenantId === activeTenantId),
  );
  const receipt = receipts.find((row) => row.id === draft.receiptId);
  const remaining =
    receipt && draft.method ? refundableReceiptMinor(state, receipt, draft.method, currency) : 0;
  let validAmount = false;
  try {
    const amount = parseMajorAmount(draft.amount, currency);
    validAmount = amount > 0 && amount <= remaining;
  } catch {
    /* Incomplete draft. */
  }
  const pending = operation?.refundId
    ? rows.find((row) => row.id === operation.refundId)
    : undefined;
  const confirm = async () => {
    if (!operation || busyRef.current || operation.scope !== scope) return;
    if (
      operation.kind === "request" &&
      (!canRequest || !receipt || !validAmount || draft.reason.trim().length < 3)
    )
      return;
    if (operation.kind !== "request" && (!canApprove || !pending || pending.status !== "REQUESTED"))
      return;
    if (operation.kind === "reject" && draft.reason.trim().length < 3) return;
    const requestedScope = scope;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (operation.kind === "request" && receipt) {
        const result = await mutate("requestRefund", {
          input: {
            tenantId: activeTenantId,
            branchId,
            branch: receipt.branch,
            orderId: receipt.orderId,
            invoiceId: receipt.invoiceId,
            receiptId: receipt.id,
            amount: majorFromMinor(parseMajorAmount(draft.amount, currency), currency),
            method: draft.method,
            reason: draft.reason.trim(),
            requestedBy: currentUser.name,
            requestKey: operation.requestKey,
          },
        });
        if (scopeRef.current !== requestedScope) return;
        const confirmed = result?.state?.refunds.find(
          (row) => row.requestKey === operation.requestKey && row.receiptId === receipt.id,
        );
        if (!confirmed || (result && "offline" in result && result.offline))
          throw new Error(
            "The server has not confirmed this refund request. Your entries were retained.",
          );
        setSelectedId(confirmed.id);
        setNotice(
          `Refund ${confirmed.id} requested for receipt ${receipt.id}. No payout has been made.`,
        );
      } else if (pending) {
        const result = await mutate(
          operation.kind === "reject" ? "rejectRefund" : "approveRefund",
          {
            refundId: pending.id,
            branchId,
            ...(operation.kind === "reject" ? { reason: draft.reason.trim() } : {}),
          },
        );
        if (scopeRef.current !== requestedScope) return;
        if (
          result?.state?.refunds.find((row) => row.id === pending.id)?.status !==
            (operation.kind === "reject" ? "REJECTED" : "APPROVED") ||
          (result && "offline" in result && result.offline)
        )
          throw new Error("The server has not confirmed approval.");
        setNotice(
          operation.kind === "reject"
            ? `Refund ${pending.id} rejected. No payout has been made.`
            : `Refund ${pending.id} approved. No payout has been confirmed.`,
        );
      }
      setOperation(null);
    } catch (cause) {
      if (scopeRef.current === requestedScope)
        setError(
          cause instanceof Error
            ? cause.message
            : "Refund operation failed. Your entries were retained.",
        );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const beginApproval = () => {
    if (!selected || selected.status !== "REQUESTED" || !canApprove) return;
    setError("");
    setOperation({
      kind: "approve",
      scope,
      refundId: selected.id,
      requestKey: crypto.randomUUID(),
    });
  };
  return (
    <AppShell
      title="Refunds"
      subtitle={`Receipt-linked requests and approval - ${branchLabel}`}
      actions={
        <>
          <Btn disabled={!canApprove || selected?.status !== "REQUESTED"} onClick={beginApproval}>
            Approve selected
          </Btn>
          <Btn
            disabled={!canApprove || selected?.status !== "REQUESTED"}
            onClick={() => {
              if (!selected) return;
              setError("");
              setDraft({ ...draft, reason: "" });
              setOperation({
                kind: "reject",
                scope,
                refundId: selected.id,
                requestKey: crypto.randomUUID(),
              });
            }}
          >
            Reject selected
          </Btn>
          <Btn
            variant="danger"
            disabled={!canRequest}
            onClick={() => {
              setDraft({ receiptId: "", method: "", amount: "", reason: "" });
              setError("");
              setOperation({ kind: "request", scope, requestKey: crypto.randomUUID() });
            }}
          >
            Request refund
          </Btn>
        </>
      }
    >
      {notice && (
        <p role="status" className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          {notice}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric label="Matching requests" value={rows.length} />
        <Metric
          label="Requested value"
          value={rows.reduce((sum, row) => sum + row.amount, 0)}
          money
        />
        <Metric
          label="Awaiting approval"
          value={rows.filter((row) => row.status === "REQUESTED").length}
        />
      </div>
      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead
            title="Refund requests"
            sub="Source receipts and approval records are retained"
          />
          <div className="border-b border-border p-3">
            <Chips
              items={[
                { label: "Scope", value: branchLabel },
                {
                  label: "Status",
                  value: statusFilter,
                  options: ["All", "REQUESTED", "APPROVED", "REJECTED", "COMPLETED"],
                  selectedOption: statusFilter,
                  onOptionChange: setStatusFilter,
                  onClear: () => setStatusFilter("All"),
                },
                {
                  label: "Period",
                  value: formatFilterDate(periodDate),
                  dateValue: periodDate,
                  onDateChange: setPeriodDate,
                  onClear: () => setPeriodDate(""),
                },
              ]}
              onClear={() => {
                setStatusFilter("All");
                setPeriodDate("");
              }}
            />
          </div>
          <DataTable
            cols={["Refund", "Receipt", "Invoice", "Method", { l: "Amount", r: true }, "Status"]}
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <TD>
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    aria-pressed={selectedId === row.id}
                    onClick={() => setSelectedId(row.id)}
                  >
                    {row.id}
                  </button>
                </TD>
                <TD>{row.receiptId ?? "Not recorded"}</TD>
                <TD>{row.invoiceId}</TD>
                <TD>{row.method}</TD>
                <TD className="text-right">{ksh(row.amount)}</TD>
                <TD>
                  <Status>{row.status}</Status>
                </TD>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <TD colSpan={6}>No refund requests match the selected filters.</TD>
              </tr>
            )}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title={selected?.id ?? "Refund detail"}
            sub={
              selected
                ? `${selected.receiptId ?? "Source not recorded"} - ${ksh(selected.amount)}`
                : "No refund selected"
            }
          />
          {selected && (
            <dl className="space-y-3 p-4 text-sm">
              <div>
                <dt>Reason</dt>
                <dd>{selected.reason}</dd>
              </div>
              <div>
                <dt>Requested by</dt>
                <dd>{selected.requestedBy}</dd>
              </div>
              <div>
                <dt>Business date</dt>
                <dd>{refundDate(selected)}</dd>
              </div>
              <div>
                <dt>Approval</dt>
                <dd>{selected.approvedBy ?? "Not approved"}</dd>
              </div>
              {selected.rejectionReason && (
                <div>
                  <dt>Rejection reason</dt>
                  <dd>
                    {selected.rejectionReason} - {selected.rejectedBy}
                  </dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd>
                  <Status>{selected.status}</Status>
                </dd>
              </div>
            </dl>
          )}
        </Panel>
      </div>
      <Dialog
        open={!!operation && operation.scope === scope}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setOperation(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {operation?.kind === "reject"
                ? "Confirm refund rejection"
                : operation?.kind === "approve"
                  ? "Confirm refund approval"
                  : "Request a refund"}
            </DialogTitle>
            <DialogDescription>
              {operation?.kind !== "request"
                ? "Approval records authorization; it does not confirm a customer payout."
                : "Choose the exact paid receipt, collected method, amount and reason."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {operation?.kind === "request" ? (
              <fieldset disabled={busy} className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  Source receipt
                  <select
                    aria-label="Source receipt"
                    required
                    value={draft.receiptId}
                    onChange={(event) =>
                      setDraft({ ...draft, receiptId: event.target.value, method: "", amount: "" })
                    }
                    className="h-10 min-w-0 rounded-md border border-border bg-background px-2"
                  >
                    <option value="">Choose receipt</option>
                    {receipts.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.id} - {row.customer} - {ksh(row.paidAmount)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Collected method
                  <select
                    aria-label="Collected method"
                    required
                    value={draft.method}
                    onChange={(event) =>
                      setDraft({ ...draft, method: event.target.value, amount: "" })
                    }
                    className="h-10 rounded-md border border-border bg-background px-2"
                  >
                    <option value="">Choose method</option>
                    {[...new Set(receipt?.paymentBreakdown.map((row) => row.method) ?? [])].map(
                      (method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <p className="text-sm">
                  Remaining refundable: {ksh(majorFromMinor(remaining, currency))}
                </p>
                <label className="grid gap-1 text-sm">
                  Refund amount ({currency})
                  <input
                    aria-label="Refund amount"
                    required
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                    className="h-10 rounded-md border border-border bg-background px-3"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Reason
                  <textarea
                    aria-label="Refund reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    value={draft.reason}
                    onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                    className="min-h-20 rounded-md border border-border bg-background p-3"
                  />
                </label>
                {draft.amount && !validAmount && (
                  <p role="alert" className="text-sm text-danger">
                    Enter a positive amount no greater than the remaining confirmed collection.
                  </p>
                )}
              </fieldset>
            ) : (
              pending && (
                <div className="space-y-2 text-sm">
                  <p>
                    {pending.id} - Receipt {pending.receiptId} - Invoice {pending.invoiceId}
                  </p>
                  <p>
                    {ksh(pending.amount)} via {pending.method}
                  </p>
                  <p>{pending.reason}</p>
                </div>
              )
            )}
            {operation?.kind === "reject" && (
              <label className="grid gap-1 text-sm">
                Rejection reason
                <textarea
                  aria-label="Rejection reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  disabled={busy}
                  value={draft.reason}
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                  className="min-h-20 rounded-md border border-border bg-background p-3"
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn type="button" disabled={busy} onClick={() => setOperation(null)}>
                Cancel
              </Btn>
              <Btn
                type="submit"
                variant="danger"
                disabled={
                  busy ||
                  (operation?.kind === "request"
                    ? !receipt || !validAmount || draft.reason.trim().length < 3
                    : !pending ||
                      pending.status !== "REQUESTED" ||
                      (operation?.kind === "reject" && draft.reason.trim().length < 3))
                }
              >
                {busy
                  ? "Saving..."
                  : operation?.kind === "reject"
                    ? "Confirm rejection"
                    : operation?.kind === "approve"
                      ? "Confirm approval"
                      : "Confirm refund request"}
              </Btn>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
