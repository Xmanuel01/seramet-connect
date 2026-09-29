import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { AppShell } from "@/components/app/AppShell";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory Overview - Seramet" },
      {
        name: "description",
        content:
          "Authoritative inventory value, stock health, reorder exceptions and movement activity.",
      },
    ],
  }),
  component: InventoryOverview,
});

function InventoryOverview() {
  const navigate = useNavigate();
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);

  const rows = control.data.flatMap((branchData) =>
    branchData.items.map((item) => {
      const unit =
        item.base_unit_symbol ??
        branchData.units.find((row) => row.id === item.base_unit_id)?.symbol ??
        "unit";
      const onHand = item.quantity_minor / 1_000_000;
      const available = item.quantity_available_minor / 1_000_000;
      const reorder = (item.reorder_point_minor ?? 0) / 1_000_000;
      const target = (item.target_quantity_minor ?? item.reorder_point_minor ?? 0) / 1_000_000;
      return {
        ...item,
        branchId: branchData.branchId,
        unit,
        onHand,
        available,
        reorder,
        target,
        value: item.total_value_minor / 100,
        status:
          onHand <= 0 ? "Out of stock" : reorder > 0 && onHand <= reorder ? "Low stock" : "Healthy",
      };
    }),
  );

  const uniqueItemCount = new Set(rows.map((row) => row.id)).size;
  const inventoryValue = control.data.reduce(
    (sum, row) => sum + row.summary.inventoryValueMinor / 100,
    0,
  );
  const lowStockCount = control.data.reduce((sum, row) => sum + row.summary.lowStockCount, 0);
  const outOfStockCount = control.data.reduce((sum, row) => sum + row.summary.outOfStockCount, 0);
  const nearExpiryCount = control.data.reduce((sum, row) => sum + row.summary.nearExpiryCount, 0);
  const openPoCount = control.data.reduce(
    (sum, row) => sum + row.summary.openPurchaseOrderCount,
    0,
  );

  const exceptions = rows
    .filter((row) => row.status !== "Healthy")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "Out of stock" ? -1 : 1;
      return a.available - b.available;
    })
    .slice(0, 12);

  const movements = control.data
    .flatMap((branchData) =>
      branchData.controlCentre.movements.map((movement) => ({
        ...movement,
        branchId: branchData.branchId,
      })),
    )
    .sort((a, b) =>
      String(b["occurred_at"] ?? b["business_date"] ?? "").localeCompare(
        String(a["occurred_at"] ?? a["business_date"] ?? ""),
      ),
    )
    .slice(0, 10);

  return (
    <AppShell
      title="Inventory overview"
      subtitle={`${branchLabel} - authoritative stock health, valuation and exceptions`}
      actions={
        <>
          <Btn onClick={() => void navigate({ to: "/inventory-items" })}>Items</Btn>
          <Btn
            onClick={() => {
              void control.recalculate().then(() => void control.refresh());
            }}
          >
            Recalculate
          </Btn>
        </>
      }
    >
      {!authoritative && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[12px]">
          Inventory control requires authoritative persistence. Connect the server database to use
          live balances, valuation and stock exceptions.
        </div>
      )}

      {(control.error || control.status === "loading") && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {control.error || "Loading authoritative inventory..."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Inventory value" value={inventoryValue} money />
        <Metric label="Active items" value={uniqueItemCount} />
        <Metric label="Low stock" value={lowStockCount} invert={lowStockCount > 0} />
        <Metric label="Out of stock" value={outOfStockCount} invert={outOfStockCount > 0} />
        <Metric label="Near expiry" value={nearExpiryCount} invert={nearExpiryCount > 0} />
        <Metric label="Open POs" value={openPoCount} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel>
          <PanelHead
            title="Stock exceptions"
            sub={
              exceptions.length
                ? `${exceptions.length} highest-priority exceptions shown`
                : "No low-stock or out-of-stock exceptions"
            }
            right={
              <Btn onClick={() => void navigate({ to: "/inventory-items" })}>View all items</Btn>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <TH>Item</TH>
                  {isAllBranches && <TH>Branch</TH>}
                  <TH className="text-right">On hand</TH>
                  <TH className="text-right">Available</TH>
                  <TH className="text-right">Reorder</TH>
                  <TH className="text-right">Value</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((row) => (
                  <tr key={`${row.branchId}:${row.id}`} className="hover:bg-secondary/50">
                    <TD>
                      <Link
                        to="/items/$sku"
                        params={{ sku: row.sku ?? row.code }}
                        className="font-semibold hover:text-primary"
                      >
                        {row.name}
                      </Link>
                      <div className="num text-[11px] text-muted-foreground">
                        {row.sku ?? row.code}
                      </div>
                    </TD>
                    {isAllBranches && <TD className="num text-muted-foreground">{row.branchId}</TD>}
                    <TD className="num text-right">
                      {formatQuantity(row.onHand)} {row.unit}
                    </TD>
                    <TD className="num text-right">
                      {formatQuantity(row.available)} {row.unit}
                    </TD>
                    <TD className="num text-right text-muted-foreground">
                      {formatQuantity(row.reorder)} {row.unit}
                    </TD>
                    <TD className="num text-right font-semibold">{ksh(row.value)}</TD>
                    <TD>
                      <Status>{row.status}</Status>
                    </TD>
                  </tr>
                ))}
                {!exceptions.length && control.status === "ready" && (
                  <tr>
                    <TD
                      colSpan={isAllBranches ? 7 : 6}
                      className="py-10 text-center text-[12px] text-muted-foreground"
                    >
                      Stock levels are currently above configured reorder points.
                    </TD>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Recent movement" sub="Latest immutable inventory ledger activity" />
          <ul className="divide-y divide-border">
            {movements.map((movement) => (
              <li key={String(movement["id"])} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">
                      {String(movement["name"] ?? movement["sku"] ?? "Inventory item")}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {String(movement["movement_type"] ?? "Movement")} ·{" "}
                      {String(movement["source_type"] ?? "System")}
                    </div>
                  </div>
                  <div className="num whitespace-nowrap text-right text-[12px] font-semibold">
                    {formatQuantity(Number(movement["quantity_minor"] ?? 0) / 1_000_000)}{" "}
                    {String(movement["unit_symbol"] ?? "")}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {String(movement["occurred_at"] ?? movement["business_date"] ?? "")}
                </div>
              </li>
            ))}
            {!movements.length && control.status === "ready" && (
              <li className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                No stock movement has been posted for this branch yet.
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}

function formatQuantity(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
