import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

type Receivable = {
  id: string;
  customer: string;
  invoice: string;
  due: string;
  amount: number;
  paid: number;
  outstanding: number;
  age: string;
  status: string;
  source: string;
};

export const Route = createFileRoute("/receivables")({
  head: () => ({ meta: [{ title: "Accounts Receivable - Seramet" }] }),
  component: Receivables,
});

const customerRows: Receivable[] = emptyRecords();

const columns: EnterpriseColumn<Receivable>[] = [
  { key: "source", label: "Source", sortable: true },
  { key: "customer", label: "Customer", sortable: true },
  { key: "invoice", label: "Invoice", sortable: true },
  { key: "due", label: "Due", sortable: true },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.amount)}</span>,
  },
  {
    key: "paid",
    label: "Paid",
    align: "right",
    sortable: true,
    render: (row) => <span className="num text-muted-foreground">{ksh(row.paid)}</span>,
  },
  {
    key: "outstanding",
    label: "Outstanding",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.outstanding)}</span>,
  },
  { key: "age", label: "Age", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Receivables() {
  const { activeTenantId, matchesBranch } = useAppContext();
  const { state } = useTransactionEngine();
  const configuration = getConfigurationRepository();
  const providerById = new Map(
    configuration.listProviders().map((provider) => [provider.id, provider.displayName]),
  );
  const marketplaceRows: Receivable[] = state.marketplaceReceivables
    .filter((receivable) => matchesBranch(receivable.branchId))
    .map((receivable) => ({
      id: receivable.id,
      customer: providerById.get(receivable.providerId) ?? "Marketplace provider",
      invoice: receivable.invoiceId,
      due: "Provider settlement",
      amount: receivable.grossAmount,
      paid: receivable.settledAmount,
      outstanding: receivable.outstandingAmount,
      age: ageLabel(receivable.createdAt),
      status: receivable.status.replaceAll("_", " "),
      source: "Marketplace receivable",
    }));
  const rows = [...marketplaceRows, ...customerRows];
  const openRows = rows.filter((row) => row.outstanding > 0);
  const receivables = openRows.reduce((sum, row) => sum + row.outstanding, 0);
  const providerReceivables = marketplaceRows
    .filter((row) => row.outstanding > 0)
    .reduce((sum, row) => sum + row.outstanding, 0);
  return (
    <AppShell
      title="Accounts receivable"
      subtitle="Customer invoices, ageing and collection status"
      actions={
        <>
          <Btn>Send reminders</Btn>
          <Btn variant="primary">New invoice</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Receivables" value={receivables} money />
        <Metric label="Marketplace due" value={providerReceivables} money />
        <Metric label="Overdue" value={0} money invert />
        <Metric label="Open accounts" value={openRows.length} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Customer ageing" sub="Search, sort, saved views and bulk reminders" />
        <EnterpriseTable
          rows={rows}
          columns={columns}
          filters={["Source: All", "Age: All", `Tenant: ${activeTenantId}`, "Status: Open"]}
        />
      </Panel>
    </AppShell>
  );
}

function ageLabel(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  return days === 0 ? "Today" : `${days}d`;
}
