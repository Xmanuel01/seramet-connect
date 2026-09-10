import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";

type Category = {
  id: string;
  category: string;
  items: number;
  stockValue: number;
  lowStock: number;
  margin: string;
  status: string;
};

export const Route = createFileRoute("/categories")({
  head: () => ({ meta: [{ title: "Inventory Categories - Seramet" }] }),
  component: Categories,
});

const rows: Category[] = emptyRecords();

const columns: EnterpriseColumn<Category>[] = [
  { key: "category", label: "Category", sortable: true },
  { key: "items", label: "Items", align: "right", sortable: true },
  {
    key: "stockValue",
    label: "Stock value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.stockValue)}</span>,
  },
  { key: "lowStock", label: "Low stock", align: "right", sortable: true },
  { key: "margin", label: "Avg margin", align: "right", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Categories() {
  return (
    <AppShell
      title="Inventory categories"
      subtitle="Category health, stock value and low-stock concentration"
      actions={
        <>
          <Btn>Import</Btn>
          <Btn variant="primary">Add category</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Categories" value={0} />
        <Metric label="Stock value" value={0} money />
        <Metric label="Critical categories" value={0} invert />
        <Metric label="Low-stock items" value={0} invert />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Category table" sub="Search, sort, select, hide columns and export" />
        <EnterpriseTable rows={rows} columns={columns} filters={["Branch: All", "Status: Any"]} />
      </Panel>
    </AppShell>
  );
}
