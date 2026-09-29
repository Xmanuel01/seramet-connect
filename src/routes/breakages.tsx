import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/breakages")({
  head: () => ({
    meta: [
      { title: "Breakages - Seramet" },
      {
        name: "description",
        content: "Audited breakage incidents for equipment, service items and smallwares.",
      },
    ],
  }),
  component: Breakages,
});

function Breakages() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const operations = useInventoryOperations(authoritative);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => operations.data.flatMap((row) => row.breakages), [operations.data]);
  const pending = rows.filter((row) => row.status === "PENDING").length;
  const approved = rows.filter((row) => row.status === "APPROVED");
  const rejected = rows.filter((row) => row.status === "REJECTED").length;
  const approvedValue = approved.reduce(
    (sum, row) => sum + Number(row.estimated_value_minor ?? 0),
    0,
  );

  const decide = async (id: string, action: "approve" | "reject") => {
    const reason = window.prompt(
      action === "approve" ? "Approval reason" : "Rejection reason",
      action === "approve" ? "Verified breakage incident" : "",
    );
    if (!reason?.trim()) return;
    try {
      await operations.command(
        `/api/seramet/inventory/breakages/${encodeURIComponent(id)}/${action}`,
        { reason: reason.trim() },
      );
      setNotice(action === "approve" ? "Breakage approved." : "Breakage rejected.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Breakage decision failed");
    }
  };

  return (
    <AppShell
      title="Breakages"
      subtitle={`${branchLabel} - assets, smallwares and service-item damage register`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || operations.control.status !== "ready"}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close form" : "Record breakage"}
        </Btn>
      }
    >
      {(notice || operations.error || operations.control.error) && (
        <Notice>{notice || operations.error || operations.control.error}</Notice>
      )}

      {showForm && (
        <BreakageForm
          branches={operations.control.data}
          busy={operations.status === "loading"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (body) => {
            try {
              await operations.command("/api/seramet/inventory/breakages", body);
              setNotice("Breakage submitted for approval.");
              setShowForm(false);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Breakage submission failed");
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Incidents" value={rows.length} />
        <Metric label="Awaiting approval" value={pending} invert={pending > 0} />
        <Metric
          label="Approved value"
          value={approvedValue / 100}
          money
          invert={approvedValue > 0}
        />
        <Metric label="Rejected" value={rejected} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Breakage register"
          sub="Breakage approval is audited but does not falsely reduce food inventory"
        />
        <DataTable
          cols={[
            "Item",
            "Store",
            { l: "Quantity", r: true },
            "Reason",
            { l: "Estimated value", r: true },
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-secondary/50">
              <TD className="font-semibold">{row.asset_name ?? "Legacy breakage"}</TD>
              <TD className="text-muted-foreground">{row.warehouse_name ?? "-"}</TD>
              <TD className="num text-right">
                {row.quantity_minor === null ? "-" : formatQuantity(row.quantity_minor)}{" "}
                {row.unit_label ?? ""}
              </TD>
              <TD className="text-muted-foreground">{row.reason_code ?? "-"}</TD>
              <TD className="num text-right font-semibold">
                {ksh(Number(row.estimated_value_minor ?? 0) / 100)}
              </TD>
              <TD>
                <Status>{row.status}</Status>
              </TD>
              <TD>
                {row.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void decide(row.id, "approve")}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(row.id, "reject")}
                      className="text-[12px] font-semibold text-danger hover:underline"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {row.decision_reason || "Final"}
                  </span>
                )}
              </TD>
            </tr>
          ))}
        </DataTable>
        {!rows.length && operations.status === "ready" && (
          <Empty>No breakage incidents recorded.</Empty>
        )}
      </Panel>
    </AppShell>
  );
}

function BreakageForm({
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
  const [assetName, setAssetName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitLabel, setUnitLabel] = useState("pcs");
  const [reasonCode, setReasonCode] = useState("DAMAGED");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");

  const setBranch = (next: string) => {
    setBranchId(next);
    const selected = branches.find((row) => row.branchId === next);
    setWarehouseId(selected?.warehouses[0]?.id ?? "");
  };

  const valid =
    Boolean(branchId && assetName.trim() && unitLabel.trim() && reasonCode.trim()) &&
    Number(quantity) > 0 &&
    Number(value) >= 0;

  return (
    <Panel className="mb-4">
      <PanelHead
        title="Record breakage"
        sub="For equipment, service items and smallwares; no inventory movement is created"
      />
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <Field label="Branch">
          <select
            value={branchId}
            onChange={(event) => setBranch(event.target.value)}
            className={inputClass}
          >
            {branches.map((row) => (
              <option key={row.branchId} value={row.branchId}>
                {row.branchId}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Warehouse / area">
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className={inputClass}
          >
            <option value="">Not linked to a warehouse</option>
            {(branch?.warehouses ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Damaged item">
          <input
            className={inputClass}
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            placeholder="Plate, blender jar, serving tray..."
          />
        </Field>
        <Field label="Quantity">
          <input
            className={inputClass}
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label="Unit">
          <input
            className={inputClass}
            value={unitLabel}
            onChange={(event) => setUnitLabel(event.target.value)}
          />
        </Field>
        <Field label="Estimated value (KES)">
          <input
            className={inputClass}
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label="Reason code">
          <input
            className={inputClass}
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value.toUpperCase())}
          />
        </Field>
        <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground md:col-span-2">
          Notes / evidence reference
          <input
            className={inputClass}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional photo/reference notes"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() =>
            void onSubmit({
              branchId,
              ...(warehouseId ? { warehouseId } : {}),
              assetName: assetName.trim(),
              quantityMicro: Math.round(Number(quantity) * 1_000_000),
              unitLabel: unitLabel.trim(),
              reasonCode: reasonCode.trim().toUpperCase(),
              estimatedValueMinor: Math.round(Number(value) * 100),
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
function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">{children}</div>;
}
function formatQuantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
