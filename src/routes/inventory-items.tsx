import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  useInventoryControlCentre,
  type InventoryListRow,
} from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/inventory-items")({
  head: () => ({
    meta: [
      { title: "Inventory Items - Seramet" },
      {
        name: "description",
        content:
          "Authoritative inventory item catalogue, stock position, suppliers and item setup.",
      },
    ],
  }),
  component: InventoryItems,
});

type ItemView = InventoryListRow & {
  branchCount: number;
  unit: string;
  status: "Healthy" | "Low stock" | "Out of stock" | "Needs attention";
};

function InventoryItems() {
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo(
    () => aggregateItems(control.data, isAllBranches),
    [control.data, isAllBranches],
  );
  const filtered = rows.filter((row) => {
    const haystack =
      `${row.name} ${row.sku ?? ""} ${row.code} ${row.category_name ?? ""} ${row.preferred_supplier_name ?? ""}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "ALL" || row.status === statusFilter;
    return matchesQuery && matchesStatus;
  });
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const totalValue = rows.reduce((sum, row) => sum + row.total_value_minor / 100, 0);
  const outCount = rows.filter((row) => row.status === "Out of stock").length;
  const attentionCount = rows.filter((row) => row.status !== "Healthy").length;

  return (
    <AppShell
      title="Inventory items"
      subtitle={`${branchLabel} - authoritative item master and stock position`}
      actions={
        <>
          <Btn onClick={() => exportRows(filtered)}>Export</Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || control.status !== "ready"}
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Close form" : "Add item"}
          </Btn>
        </>
      }
    >
      {(notice || control.error) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      {showCreate && (
        <CreateItemPanel
          data={control.data}
          onCancel={() => setShowCreate(false)}
          onCreate={async (body) => {
            setNotice("");
            try {
              await control.command("/api/seramet/inventory/items", body);
              setNotice("Inventory item created successfully.");
              setShowCreate(false);
            } catch (error) {
              setNotice(
                error instanceof Error ? error.message : "Inventory item could not be created",
              );
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Active items" value={rows.length} />
        <Metric label="Inventory value" value={totalValue} money />
        <Metric label="Need attention" value={attentionCount} invert={attentionCount > 0} />
        <Metric label="Out of stock" value={outCount} invert={outCount > 0} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Item catalogue"
          sub={`${filtered.length} matching item${filtered.length === 1 ? "" : "s"}`}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search name, SKU, code or supplier"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-border bg-background px-3 text-[12px]"
          >
            <option value="ALL">All statuses</option>
            <option value="Healthy">Healthy</option>
            <option value="Low stock">Low stock</option>
            <option value="Needs attention">Needs attention</option>
            <option value="Out of stock">Out of stock</option>
          </select>
        </div>

        <div className="grid gap-3 p-3 md:hidden">
          {visible.map((row) => (
            <article
              key={row.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to="/items/$sku"
                    params={{ sku: row.sku ?? row.code }}
                    className="truncate text-[13px] font-bold hover:text-primary"
                  >
                    {row.name}
                  </Link>
                  <div className="num text-[11px] text-muted-foreground">
                    {row.sku ?? row.code} · {row.unit}
                  </div>
                </div>
                <Status>{row.status}</Status>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <Info label="On hand" value={formatQuantity(row.quantity_minor / 1_000_000)} />
                <Info
                  label="Available"
                  value={formatQuantity(row.quantity_available_minor / 1_000_000)}
                />
                <Info label="Unit cost" value={ksh(row.average_unit_cost_minor / 100)} />
                <Info label="Value" value={ksh(row.total_value_minor / 100)} />
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                {row.preferred_supplier_name || "No preferred supplier"} · {row.warehouse_count}{" "}
                warehouse
                {row.warehouse_count === 1 ? "" : "s"}
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr>
                <TH>Item</TH>
                <TH>SKU / code</TH>
                <TH>Category</TH>
                <TH>Supplier</TH>
                <TH className="text-right">On hand</TH>
                <TH className="text-right">Available</TH>
                <TH className="text-right">PAR target</TH>
                <TH className="text-right">Unit cost</TH>
                <TH className="text-right">Value</TH>
                <TH className="text-right">Warehouses</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="hover:bg-secondary/50">
                  <TD>
                    <Link
                      to="/items/$sku"
                      params={{ sku: row.sku ?? row.code }}
                      className="font-semibold hover:text-primary"
                    >
                      {row.name}
                    </Link>
                  </TD>
                  <TD className="num text-muted-foreground">{row.sku ?? row.code}</TD>
                  <TD className="text-muted-foreground">{row.category_name || "Uncategorized"}</TD>
                  <TD className="text-muted-foreground">
                    {row.preferred_supplier_name || "Not assigned"}
                  </TD>
                  <TD className="num text-right">
                    {formatQuantity(row.quantity_minor / 1_000_000)} {row.unit}
                  </TD>
                  <TD className="num text-right">
                    {formatQuantity(row.quantity_available_minor / 1_000_000)} {row.unit}
                  </TD>
                  <TD className="num text-right text-muted-foreground">
                    {formatQuantity((row.target_quantity_minor ?? 0) / 1_000_000)} {row.unit}
                  </TD>
                  <TD className="num text-right">{ksh(row.average_unit_cost_minor / 100)}</TD>
                  <TD className="num text-right font-semibold">
                    {ksh(row.total_value_minor / 100)}
                  </TD>
                  <TD className="num text-right">{row.warehouse_count}</TD>
                  <TD>
                    <Status>{row.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!visible.length && control.status === "ready" && (
          <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">
            No inventory items match the current filters.
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
          <span>
            Page {safePage + 1} of {pageCount} · {filtered.length} items
          </span>
          <div className="flex gap-2">
            <Btn onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Btn>
            <Btn onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</Btn>
          </div>
        </div>
      </Panel>
    </AppShell>
  );
}

function CreateItemPanel({
  data,
  onCancel,
  onCreate,
}: {
  data: ReturnType<typeof useInventoryControlCentre>["data"];
  onCancel: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const units = uniqueById(data.flatMap((branch) => branch.units));
  const categories = uniqueById(data.flatMap((branch) => branch.categories));
  const suppliers = uniqueById(data.flatMap((branch) => branch.procurement.suppliers));
  const warehouses = data.flatMap((branch) =>
    branch.warehouses.map((warehouse) => ({
      ...warehouse,
      branchId: branch.branchId,
    })),
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [baseUnitId, setBaseUnitId] = useState(units[0]?.id ?? "");
  const [purchaseUnitId, setPurchaseUnitId] = useState("");
  const [defaultWarehouseId, setDefaultWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = name.trim() && code.trim() && baseUnitId && defaultWarehouseId;

  return (
    <Panel className="mb-4">
      <PanelHead
        title="Add inventory item"
        sub="Create tenant-wide item master data before receiving stock"
      />
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Item name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Item code">
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BEEF-BONELESS"
          />
        </Field>
        <Field label="SKU (optional)">
          <input
            className={inputClass}
            value={sku}
            onChange={(e) => setSku(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Base unit">
          <select
            className={inputClass}
            value={baseUnitId}
            onChange={(e) => setBaseUnitId(e.target.value)}
          >
            <option value="">Select unit</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default warehouse">
          <select
            className={inputClass}
            value={defaultWarehouseId}
            onChange={(event) => setDefaultWarehouseId(event.target.value)}
          >
            <option value="">Select warehouse</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name} ({warehouse.code})
                {data.length > 1 ? ` · ${warehouse.branchId}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purchase unit">
          <select
            className={inputClass}
            value={purchaseUnitId}
            onChange={(e) => setPurchaseUnitId(e.target.value)}
          >
            <option value="">Same as base unit</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            className={inputClass}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Preferred supplier">
          <select
            className={inputClass}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Not assigned</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-[12px]">
          <input
            type="checkbox"
            checked={trackExpiry}
            onChange={(event) => setTrackExpiry(event.target.checked)}
          />
          Track expiry / lots
        </label>
      </div>
      {(!units.length || !warehouses.length) && (
        <div className="px-4 pb-3 text-[12px] text-warning">
          {!units.length
            ? "Create at least one unit definition before adding inventory items."
            : "Create an active warehouse for the branch before adding inventory items."}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() => {
            setBusy(true);
            void onCreate({
              code: code.trim().toUpperCase(),
              ...(sku.trim() ? { sku: sku.trim().toUpperCase() } : {}),
              name: name.trim(),
              ...(description.trim() ? { description: description.trim() } : {}),
              baseUnitId,
              purchaseUnitId: purchaseUnitId || baseUnitId,
              defaultWarehouseId,
              ...(categoryId ? { categoryId } : {}),
              ...(supplierId ? { preferredSupplierId: supplierId } : {}),
              trackInventory: true,
              trackExpiry,
            }).finally(() => setBusy(false));
          }}
        >
          {busy ? "Creating..." : "Create item"}
        </Btn>
      </div>
    </Panel>
  );
}

function aggregateItems(
  data: ReturnType<typeof useInventoryControlCentre>["data"],
  allBranches: boolean,
): ItemView[] {
  const grouped = new Map<
    string,
    {
      row: InventoryListRow;
      branchIds: Set<string>;
      statuses: string[];
    }
  >();

  for (const branch of data) {
    for (const item of branch.items) {
      const reorder = Number(item.reorder_point_minor ?? 0);
      const status =
        item.quantity_minor <= 0
          ? "Out of stock"
          : reorder > 0 && item.quantity_minor <= reorder
            ? "Low stock"
            : "Healthy";
      const existing = grouped.get(item.id);
      if (!existing) {
        grouped.set(item.id, {
          row: { ...item },
          branchIds: new Set([branch.branchId]),
          statuses: [status],
        });
        continue;
      }
      existing.branchIds.add(branch.branchId);
      existing.statuses.push(status);
      existing.row.quantity_minor += item.quantity_minor;
      existing.row.quantity_reserved_minor += item.quantity_reserved_minor;
      existing.row.quantity_available_minor += item.quantity_available_minor;
      existing.row.total_value_minor += item.total_value_minor;
      existing.row.reorder_point_minor =
        (existing.row.reorder_point_minor ?? 0) + (item.reorder_point_minor ?? 0);
      existing.row.target_quantity_minor =
        (existing.row.target_quantity_minor ?? 0) + (item.target_quantity_minor ?? 0);
      existing.row.safety_stock_minor =
        (existing.row.safety_stock_minor ?? 0) + (item.safety_stock_minor ?? 0);
      existing.row.warehouse_count += item.warehouse_count;
      if (existing.row.quantity_minor > 0) {
        existing.row.average_unit_cost_minor = Math.round(
          (existing.row.total_value_minor * 1_000_000) / existing.row.quantity_minor,
        );
      }
    }
  }

  return [...grouped.values()]
    .map(({ row, branchIds, statuses }) => {
      const unit =
        row.base_unit_symbol ??
        data.flatMap((branch) => branch.units).find((unitRow) => unitRow.id === row.base_unit_id)
          ?.symbol ??
        "unit";
      let status: ItemView["status"] = "Healthy";
      if (allBranches) {
        if (statuses.every((value) => value === "Out of stock")) status = "Out of stock";
        else if (statuses.some((value) => value !== "Healthy")) status = "Needs attention";
      } else if (statuses[0] === "Out of stock") status = "Out of stock";
      else if (statuses[0] === "Low stock") status = "Low stock";
      return { ...row, branchCount: branchIds.size, unit, status };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueById<T extends { id: string }>(rows: T[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
      <span className="text-muted-foreground">{label} </span>
      <span className="num font-semibold">{value}</span>
    </div>
  );
}

function formatQuantity(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function exportRows(rows: ItemView[]) {
  const values = [
    [
      "sku",
      "code",
      "name",
      "unit",
      "on_hand",
      "available",
      "target",
      "average_unit_cost",
      "inventory_value",
      "preferred_supplier",
      "warehouses",
      "status",
    ],
    ...rows.map((row) => [
      row.sku ?? "",
      row.code,
      row.name,
      row.unit,
      row.quantity_minor / 1_000_000,
      row.quantity_available_minor / 1_000_000,
      (row.target_quantity_minor ?? 0) / 1_000_000,
      row.average_unit_cost_minor / 100,
      row.total_value_minor / 100,
      row.preferred_supplier_name ?? "",
      row.warehouse_count,
      row.status,
    ]),
  ];
  const csv = values
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `seramet-inventory-items-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
