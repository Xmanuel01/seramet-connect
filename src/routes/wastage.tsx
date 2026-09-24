import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/wastage")({
  head: () => ({
    meta: [
      { title: "Wastage - Seramet" },
      {
        name: "description",
        content: "Approval-backed inventory wastage with evidence-based cost and immutable posting.",
      },
    ],
  }),
  component: Wastage,
});

function Wastage() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const operations = useInventoryOperations(authoritative);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => operations.data.flatMap((row) => row.wastage), [operations.data]);
  const approved = rows.filter((row) => row.status === "APPROVED");
  const pending = rows.filter((row) => row.status === "PENDING").length;
  const rejected = rows.filter((row) => row.status === "REJECTED").length;
  const approvedValue = approved.reduce((sum, row) => sum + Number(row.estimated_cost_minor ?? 0), 0);

  const decide = async (id: string, action: "approve" | "reject") => {
    const reason = window.prompt(
      action === "approve" ? "Approval reason" : "Rejection reason",
      action === "approve" ? "Verified wastage incident" : "",
    );
    if (!reason?.trim()) return;
    try {
      await operations.command(
        `/api/seramet/inventory/wastage/${encodeURIComponent(id)}/${action}`,
        { reason: reason.trim() },
      );
      setNotice(action === "approve" ? "Wastage approved and stock movement posted." : "Wastage rejected.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wastage decision failed");
    }
  };

  return (
    <AppShell
      title="Wastage"
      subtitle={`${branchLabel} - food and inventory loss with manager approval`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || operations.control.status !== "ready"}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close form" : "Log wastage"}
        </Btn>
      }
    >
      {(notice || operations.error || operations.control.error) && (
        <Notice>{notice || operations.error || operations.control.error}</Notice>
      )}

      {showForm && (
        <WastageForm
          branches={operations.control.data}
          busy={operations.status === "loading"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (body) => {
            try {
              await operations.command("/api/seramet/inventory/wastage", body);
              setNotice("Wastage submitted. Inventory will reduce only after approval.");
              setShowForm(false);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Wastage submission failed");
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Wastage incidents" value={rows.length} />
        <Metric label="Awaiting approval" value={pending} invert={pending > 0} />
        <Metric label="Approved waste value" value={approvedValue / 100} money invert={approvedValue > 0} />
        <Metric label="Rejected" value={rejected} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Wastage register"
          sub="Approved entries post a costed WASTAGE movement; pending entries do not touch stock"
        />
        <DataTable
          cols={[
            "Item",
            "Store",
            { l: "Quantity", r: true },
            "Reason",
            { l: "Cost", r: true },
            "Business date",
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-secondary/50">
              <TD>
                <div className="font-semibold">{row.item_name ?? "Legacy wastage entry"}</div>
                <div className="num text-[10px] text-muted-foreground">{row.sku ?? row.code ?? row.id}</div>
              </TD>
              <TD className="text-muted-foreground">{row.warehouse_name ?? "-"}</TD>
              <TD className="num text-right">
                {row.quantity_minor === null ? "-" : formatQuantity(row.quantity_minor)} {row.unit_symbol ?? ""}
              </TD>
              <TD className="text-muted-foreground">{row.reason_code ?? "-"}</TD>
              <TD className="num text-right font-semibold">{ksh(Number(row.estimated_cost_minor ?? 0) / 100)}</TD>
              <TD className="num text-muted-foreground">{row.business_date ?? "-"}</TD>
              <TD><Status>{row.status}</Status></TD>
              <TD>
                {row.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void decide(row.id, "approve")} className="text-[12px] font-semibold text-primary hover:underline">
                      Approve
                    </button>
                    <button type="button" onClick={() => void decide(row.id, "reject")} className="text-[12px] font-semibold text-danger hover:underline">
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{row.decision_reason || "Final"}</span>
                )}
              </TD>
            </tr>
          ))}
        </DataTable>
        {!rows.length && operations.status === "ready" && <Empty>No wastage incidents recorded.</Empty>}
      </Panel>
    </AppShell>
  );
}

function WastageForm({
  branches,
  busy,
  onCancel,
  onSubmit,
}: {
  branches: ReturnType<typeof useInventoryOperations>["control"]["data"];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.branchId ?? "");
  const branch = branches.find((row) => row.branchId === branchId) ?? branches[0];
  const [warehouseId, setWarehouseId] = useState(branch?.warehouses[0]?.id ?? "");
  const [itemId, setItemId] = useState(branch?.items[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] = useState("SPOILAGE");
  const [notes, setNotes] = useState("");

  const setBranch = (next: string) => {
    setBranchId(next);
    const selected = branches.find((row) => row.branchId === next);
    setWarehouseId(selected?.warehouses[0]?.id ?? "");
    setItemId(selected?.items[0]?.id ?? "");
  };

  const selectedItem = branch?.items.find((row) => row.id === itemId);
  const estimatedCost =
    Number(quantity || 0) * (Number(selectedItem?.average_unit_cost_minor ?? 0) / 100);

  return (
    <Panel className="mb-4">
      <PanelHead title="Log wastage" sub="Capture the incident first; approval performs the stock deduction" />
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <Field label="Branch">
          <select value={branchId} onChange={(event) => setBranch(event.target.value)} className={inputClass}>
            {branches.map((row) => <option key={row.branchId} value={row.branchId}>{row.branchId}</option>)}
          </select>
        </Field>
        <Field label="Warehouse">
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={inputClass}>
            {(branch?.warehouses ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field>
        <Field label="Inventory item">
          <select value={itemId} onChange={(event) => setItemId(event.target.value)} className={inputClass}>
            {(branch?.items ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {formatQuantity(row.quantity_available_minor)} {row.base_unit_symbol ?? "unit"} available
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input className={inputClass} type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="Reason code">
          <input className={inputClass} value={reasonCode} onChange={(event) => setReasonCode(event.target.value.toUpperCase())} />
        </Field>
        <div className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
          Estimated cost
          <div className="flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3 text-[12px] text-foreground">
            {ksh(estimatedCost)}
          </div>
        </div>
        <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground md:col-span-3">
          Notes / evidence reference
          <textarea className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={busy || !branchId || !warehouseId || !itemId || Number(quantity) <= 0 || !reasonCode.trim()}
          onClick={() =>
            void onSubmit({
              branchId,
              warehouseId,
              inventoryItemId: itemId,
              quantityMicro: Math.round(Number(quantity) * 1_000_000),
              reasonCode: reasonCode.trim().toUpperCase(),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          Submit for approval
        </Btn>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">{label}{children}</label>;
}
function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{children}</div>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">{children}</div>;
}
function formatQuantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
const inputClass = "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
