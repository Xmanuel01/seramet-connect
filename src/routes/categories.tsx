import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

type CategoryRow = {
  id: string;
  code: string;
  category: string;
  description: string;
  items: number;
  stockValue: number;
  lowStock: number;
  outOfStock: number;
  status: "Healthy" | "Attention" | "Empty";
};

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "Inventory Categories - Seramet" },
      {
        name: "description",
        content: "Authoritative inventory categories with branch stock value and stock-health rollups.",
      },
    ],
  }),
  component: Categories,
});

const columns: EnterpriseColumn<CategoryRow>[] = [
  { key: "category", label: "Category", sortable: true },
  { key: "code", label: "Code", sortable: true },
  { key: "items", label: "Items", align: "right", sortable: true },
  {
    key: "stockValue",
    label: "Stock value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.stockValue)}</span>,
  },
  { key: "lowStock", label: "Low stock", align: "right", sortable: true },
  { key: "outOfStock", label: "Out of stock", align: "right", sortable: true },
  {
    key: "status",
    label: "Status",
    render: (row) => <Status>{row.status}</Status>,
  },
];

function Categories() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo<CategoryRow[]>(() => {
    const grouped = new Map<string, CategoryRow>();
    for (const branch of control.data) {
      for (const category of branch.categories) {
        const existing = grouped.get(category.id);
        if (!existing) {
          grouped.set(category.id, {
            id: category.id,
            code: category.code,
            category: category.name,
            description: category.description ?? "",
            items: Number(category.item_count ?? 0),
            stockValue: Number(category.stock_value_minor ?? 0) / 100,
            lowStock: Number(category.low_stock_count ?? 0),
            outOfStock: Number(category.out_of_stock_count ?? 0),
            status: "Healthy",
          });
          continue;
        }
        existing.items += Number(category.item_count ?? 0);
        existing.stockValue += Number(category.stock_value_minor ?? 0) / 100;
        existing.lowStock += Number(category.low_stock_count ?? 0);
        existing.outOfStock += Number(category.out_of_stock_count ?? 0);
      }
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        status:
          row.items === 0
            ? ("Empty" as const)
            : row.lowStock > 0 || row.outOfStock > 0
              ? ("Attention" as const)
              : ("Healthy" as const),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [control.data]);

  const stockValue = rows.reduce((sum, row) => sum + row.stockValue, 0);
  const attention = rows.filter((row) => row.status === "Attention").length;
  const lowStock = rows.reduce((sum, row) => sum + row.lowStock, 0);

  return (
    <AppShell
      title="Inventory categories"
      subtitle={`${branchLabel} - category health, stock value and low-stock concentration`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || control.status !== "ready"}
          onClick={() => setShowCreate((value) => !value)}
        >
          {showCreate ? "Close form" : "Add category"}
        </Btn>
      }
    >
      {(notice || control.error || control.status === "loading") && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Loading authoritative inventory categories..."}
        </div>
      )}

      {showCreate && (
        <CreateCategory
          busy={control.status === "loading"}
          onCancel={() => setShowCreate(false)}
          onCreate={async (body) => {
            setNotice("");
            try {
              await control.command("/api/seramet/inventory/categories", body);
              setNotice("Inventory category created successfully.");
              setShowCreate(false);
            } catch (error) {
              setNotice(
                error instanceof Error ? error.message : "Inventory category could not be created",
              );
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Categories" value={rows.length} />
        <Metric label="Stock value" value={stockValue} money />
        <Metric label="Need attention" value={attention} invert={attention > 0} />
        <Metric label="Low-stock items" value={lowStock} invert={lowStock > 0} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Category table"
          sub="Tenant-wide category master with branch-aware inventory health"
        />
        <EnterpriseTable
          rows={rows}
          columns={columns}
          filters={[`Branch: ${branchLabel}`, "Status: Any"]}
        />
      </Panel>
    </AppShell>
  );
}

function CreateCategory({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (body: { code: string; name: string; description?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const valid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <Panel className="mb-4">
      <PanelHead
        title="Add inventory category"
        sub="Categories are shared across the tenant and used by inventory item master data"
      />
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
          Category name
          <input
            className={inputClass}
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!code) setCode(slugCode(next));
            }}
            placeholder="Meat & Poultry"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
          Code
          <input
            className={inputClass}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="MEAT-POULTRY"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
          Description
          <input
            className={inputClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() =>
            void onCreate({
              code: code.trim().toUpperCase(),
              name: name.trim(),
              ...(description.trim() ? { description: description.trim() } : {}),
            })
          }
        >
          Create category
        </Btn>
      </div>
    </Panel>
  );
}

function slugCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
