import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/stock-detail")({
  head: () => ({
    meta: [
      { title: "Stock Detail - Seramet" },
      {
        name: "description",
        content:
          "Authoritative warehouse-level inventory balances, valuation, PAR and stock-health detail.",
      },
    ],
  }),
  component: StockDetail,
});

type StockRow = {
  branchId: string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_code: string;
  item_id: string;
  code: string;
  sku: string | null;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit_symbol: string | null;
  quantity_minor: number;
  quantity_reserved_minor: number;
  quantity_available_minor: number;
  average_unit_cost_minor: number;
  total_value_minor: number;
  last_movement_at: string | null;
  reorder_point_minor: number;
  target_quantity_minor: number;
  safety_stock_minor: number;
};

function StockDetail() {
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [stockStatus, setStockStatus] = useState("ALL");

  const branchKey = control.data.map((row) => row.branchId).join("|");

  useEffect(() => {
    if (!authoritative || !branchKey) {
      setRows([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError("");
    void Promise.all(
      branchKey.split("|").filter(Boolean).map(async (branchId) => {
        const response = await fetch(
          `/api/seramet/inventory/stock-detail?branchId=${encodeURIComponent(branchId)}`,
          { headers: control.headers },
        );
        const body = (await response.json().catch(() => ({}))) as {
          detail?: { rows: Omit<StockRow, "branchId">[] };
          message?: string;
          error?: string;
        };
        if (!response.ok || !body.detail) {
          throw new Error(
            body.message ?? body.error ?? `Stock detail query failed (${response.status})`,
          );
        }
        return body.detail.rows.map((row) => ({ ...row, branchId }));
      }),
    )
      .then((result) => {
        if (cancelled) return;
        setRows(result.flat());
        setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Stock detail query failed");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [authoritative, branchKey, control.headers]);

  const warehouses = useMemo(
    () =>
      [...new Map(rows.map((row) => [`${row.branchId}:${row.warehouse_id}`, row])).values()]
        .map((row) => ({
          key: `${row.branchId}:${row.warehouse_id}`,
          label: isAllBranches
            ? `${row.warehouse_name} · ${row.branchId}`
            : row.warehouse_name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [isAllBranches, rows],
  );
  const categories = useMemo(
    () =>
      [...new Set(rows.map((row) => row.category_name).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = rows.filter((row) => {
    const haystack =
      `${row.name} ${row.sku ?? ""} ${row.code} ${row.category_name ?? ""} ${row.warehouse_name}`.toLowerCase();
    const state = stockState(row);
    return (
      haystack.includes(query.trim().toLowerCase()) &&
      (warehouse === "ALL" || warehouse === `${row.branchId}:${row.warehouse_id}`) &&
      (category === "ALL" || category === (row.category_name ?? "Uncategorized")) &&
      (stockStatus === "ALL" || stockStatus === state)
    );
  });

  const totalValue = filtered.reduce((sum, row) => sum + row.total_value_minor / 100, 0);
  const low = filtered.filter((row) => stockState(row) === "Low stock").length;
  const out = filtered.filter((row) => stockState(row) === "Out of stock").length;

  return (
    <AppShell
      title="Stock detail"
      subtitle={`${branchLabel} - warehouse balances, valuation and PAR position`}
      actions={<Btn onClick={() => exportStock(filtered)}>Export</Btn>}
    >
      {(error || status === "loading" || control.error) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {error || control.error || "Loading authoritative stock detail..."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Stock positions" value={filtered.length} />
        <Metric label="Stock value" value={totalValue} money />
        <Metric label="Low stock" value={low} invert={low > 0} />
        <Metric label="Out of stock" value={out} invert={out > 0} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Warehouse stock"
          sub="One row per item and warehouse, derived from the authoritative inventory ledger"
        />
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          <div className="flex h-9 min-w-[230px] flex-1 items-center gap-2 rounded-md border border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search item, SKU, category or warehouse"
              className="w-full bg-transparent text-[12px] outline-none"
            />
          </div>
          <select
            value={warehouse}
            onChange={(event) => setWarehouse(event.target.value)}
            className={selectClass}
          >
            <option value="ALL">All warehouses</option>
            {warehouses.map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={selectClass}
          >
            <option value="ALL">All categories</option>
            <option value="Uncategorized">Uncategorized</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={stockStatus}
            onChange={(event) => setStockStatus(event.target.value)}
            className={selectClass}
          >
            <option value="ALL">All statuses</option>
            <option value="Healthy">Healthy</option>
            <option value="Low stock">Low stock</option>
            <option value="Out of stock">Out of stock</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead>
              <tr>
                <TH>Item</TH>
                <TH>Category</TH>
                <TH>Warehouse</TH>
                {isAllBranches && <TH>Branch</TH>}
                <TH className="text-right">On hand</TH>
                <TH className="text-right">Reserved</TH>
                <TH className="text-right">Available</TH>
                <TH className="text-right">Reorder</TH>
                <TH className="text-right">PAR</TH>
                <TH className="text-right">Unit cost</TH>
                <TH className="text-right">Value</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={`${row.branchId}:${row.warehouse_id}:${row.item_id}`}
                  className="hover:bg-secondary/50"
                >
                  <TD>
                    <Link
                      to="/items/$sku"
                      params={{ sku: row.sku ?? row.code }}
                      className="font-semibold hover:text-primary"
                    >
                      {row.name}
                    </Link>
                    <div className="num text-[10px] text-muted-foreground">
                      {row.sku ?? row.code}
                    </div>
                  </TD>
                  <TD className="text-muted-foreground">
                    {row.category_name || "Uncategorized"}
                  </TD>
                  <TD>
                    <div className="font-semibold">{row.warehouse_name}</div>
                    <div className="num text-[10px] text-muted-foreground">
                      {row.warehouse_code}
                    </div>
                  </TD>
                  {isAllBranches && (
                    <TD className="num text-muted-foreground">{row.branchId}</TD>
                  )}
                  <TD className="num text-right">
                    {quantity(row.quantity_minor)} {row.unit_symbol ?? "unit"}
                  </TD>
                  <TD className="num text-right">
                    {quantity(row.quantity_reserved_minor)} {row.unit_symbol ?? "unit"}
                  </TD>
                  <TD className="num text-right font-semibold">
                    {quantity(row.quantity_available_minor)} {row.unit_symbol ?? "unit"}
                  </TD>
                  <TD className="num text-right text-muted-foreground">
                    {quantity(row.reorder_point_minor)}
                  </TD>
                  <TD className="num text-right text-muted-foreground">
                    {quantity(row.target_quantity_minor)}
                  </TD>
                  <TD className="num text-right">
                    {ksh(row.average_unit_cost_minor / 100)}
                  </TD>
                  <TD className="num text-right font-semibold">
                    {ksh(row.total_value_minor / 100)}
                  </TD>
                  <TD>
                    <Status>{stockState(row)}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && status === "ready" && (
          <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">
            No warehouse stock positions match the current filters.
          </div>
        )}
      </Panel>
    </AppShell>
  );
}

function stockState(row: StockRow) {
  if (row.quantity_minor <= 0) return "Out of stock";
  if (row.reorder_point_minor > 0 && row.quantity_minor <= row.reorder_point_minor) {
    return "Low stock";
  }
  return "Healthy";
}

function quantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function exportStock(rows: StockRow[]) {
  const data = [
    [
      "branch",
      "warehouse",
      "sku",
      "item",
      "category",
      "on_hand",
      "reserved",
      "available",
      "reorder",
      "par_target",
      "unit_cost",
      "stock_value",
      "status",
    ],
    ...rows.map((row) => [
      row.branchId,
      row.warehouse_name,
      row.sku ?? row.code,
      row.name,
      row.category_name ?? "Uncategorized",
      row.quantity_minor / 1_000_000,
      row.quantity_reserved_minor / 1_000_000,
      row.quantity_available_minor / 1_000_000,
      row.reorder_point_minor / 1_000_000,
      row.target_quantity_minor / 1_000_000,
      row.average_unit_cost_minor / 100,
      row.total_value_minor / 100,
      stockState(row),
    ]),
  ];
  const csv = data
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `seramet-stock-detail-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(href);
}

const selectClass =
  "h-9 rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
