import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/warehouses")({
  head: () => ({
    meta: [
      { title: "Warehouses - Seramet" },
      {
        name: "description",
        content: "Authoritative branch storage locations with stock and lifecycle controls.",
      },
    ],
  }),
  component: Warehouses,
});

type WarehouseRow = {
  branchId: string;
  id: string;
  code: string;
  name: string;
  branch_id: string;
  active: number;
  type: "MAIN" | "KITCHEN" | "BAR" | "COLD" | "TRANSIT" | "OTHER";
  stocked_item_count: number;
  quantity_minor: number;
  quantity_reserved_minor: number;
  stock_value_minor: number;
  last_movement_at: string | null;
};

function Warehouses() {
  const { branchId: activeBranchId, branchLabel, branchRecords, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const { branchIds, request, post } = useInventoryOperations(authoritative);
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [branchId, setBranchId] = useState(activeBranchId);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<WarehouseRow["type"]>("MAIN");

  useEffect(() => setBranchId(activeBranchId), [activeBranchId]);

  const load = useCallback(async () => {
    if (!authoritative) return;
    setStatus("loading");
    try {
      const result = await Promise.all(
        branchIds.map(async (selectedBranchId) => {
          const body = await request<{ warehouses: Omit<WarehouseRow, "branchId">[] }>(
            `/api/seramet/inventory/warehouses?branchId=${encodeURIComponent(selectedBranchId)}`,
          );
          return body.warehouses.map((row) => ({ ...row, branchId: selectedBranchId }));
        }),
      );
      setRows(result.flat());
      setStatus("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Warehouses could not be loaded");
      setStatus("error");
    }
  }, [authoritative, branchIds, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const branchNames = new Map(branchRecords.map((branch) => [branch.id, branch.name]));
  const stockValue = rows.reduce((sum, row) => sum + Number(row.stock_value_minor ?? 0), 0);
  const stocked = rows.filter((row) => Number(row.stocked_item_count ?? 0) > 0).length;

  async function create() {
    if (!branchId || !name.trim() || !code.trim()) {
      setNotice("Branch, location name and code are required.");
      return;
    }
    try {
      await post("/api/seramet/inventory/warehouses", {
        branchId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        type,
      });
      setNotice(`${name.trim()} created in the authoritative warehouse master.`);
      setName("");
      setCode("");
      setShowForm(false);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Warehouse could not be created");
    }
  }

  async function archive(row: WarehouseRow) {
    if (
      !window.confirm(
        `Archive ${row.name}? Seramet will refuse if it still has stock, reservations, active counts, open transfers or default-item assignments.`,
      )
    ) {
      return;
    }
    try {
      await post(
        `/api/seramet/inventory/warehouses/${encodeURIComponent(row.id)}/archive`,
        {},
      );
      setNotice(`${row.name} archived. Historical inventory records remain linked to its ID.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Warehouse could not be archived");
    }
  }

  return (
    <AppShell
      title="Warehouses & stores"
      subtitle={`${branchLabel} - authoritative inventory locations and stock exposure`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close form" : "New location"}
        </Btn>
      }
    >
      {(notice || status === "loading") && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || "Loading authoritative warehouses..."}
        </div>
      )}

      {showForm && (
        <Panel className="mb-4">
          <PanelHead
            title="Create storage location"
            sub="Location IDs are authoritative and shared by stock, counts, PAR, production and transfers"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Branch
              <select
                value={branchId}
                disabled={!isAllBranches}
                onChange={(event) => setBranchId(event.target.value)}
                className={inputClass}
              >
                {branchRecords
                  .filter((branch) => branchIds.includes(branch.id))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field label="Location name" value={name} onChange={setName} placeholder="Main Store" />
            <Field
              label="Code"
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              placeholder="MAIN"
            />
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as WarehouseRow["type"])}
                className={inputClass}
              >
                {(["MAIN", "KITCHEN", "BAR", "COLD", "TRANSIT", "OTHER"] as const).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Btn variant="primary" onClick={() => void create()}>
              Create location
            </Btn>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Active locations" value={rows.length} />
        <Metric label="Locations with stock" value={stocked} />
        <Metric
          label="Configured branches"
          value={new Set(rows.map((row) => row.branch_id)).size}
        />
        <Metric label="Stock value" value={stockValue / 100} money />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Location master"
          sub="Archive is blocked while operational dependencies or non-zero stock remain"
        />
        <DataTable
          cols={[
            "Location",
            "Code",
            "Branch",
            "Type",
            { l: "Items", r: true },
            { l: "Stock value", r: true },
            "Last movement",
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={`${row.branchId}:${row.id}`} className="hover:bg-secondary/50">
              <TD className="font-semibold">{row.name}</TD>
              <TD className="num">{row.code}</TD>
              <TD>{branchNames.get(row.branch_id) ?? row.branch_id}</TD>
              <TD>{row.type}</TD>
              <TD className="num text-right">{Number(row.stocked_item_count ?? 0)}</TD>
              <TD className="num text-right font-semibold">
                {ksh(Number(row.stock_value_minor ?? 0) / 100)}
              </TD>
              <TD className="text-muted-foreground">
                {row.last_movement_at
                  ? new Date(row.last_movement_at).toLocaleString()
                  : "No movement"}
              </TD>
              <TD>
                <Status>Active</Status>
              </TD>
              <TD>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-danger hover:underline"
                  onClick={() => void archive(row)}
                >
                  Archive
                </button>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary disabled:opacity-60";
