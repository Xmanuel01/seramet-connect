import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type JournalEntry = {
  id: string;
  date: string;
  account: string;
  accountCode: string;
  source: string;
  branch: string;
  debit: number;
  credit: number;
  status: string;
};

export const Route = createFileRoute("/general-ledger")({
  head: () => ({
    meta: [
      { title: "General Ledger - Seramet" },
      {
        name: "description",
        content:
          "Chart of accounts, journal entries and trial balance with branch as an accounting dimension.",
      },
      { property: "og:title", content: "General Ledger - Seramet" },
      {
        property: "og:description",
        content: "Double-entry journal postings generated from sales, purchases, cash and expenses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GeneralLedger,
});

const rows: JournalEntry[] = [
  { id: "JV-4401", date: "15 Aug", account: "Sales revenue", accountCode: "4000", source: "POS settlement", branch: "Westlands", debit: 0, credit: 184300, status: "Posted" },
  { id: "JV-4401", date: "15 Aug", account: "Cash on hand", accountCode: "1010", source: "POS settlement", branch: "Westlands", debit: 96400, credit: 0, status: "Posted" },
  { id: "JV-4401", date: "15 Aug", account: "M-Pesa clearing", accountCode: "1020", source: "POS settlement", branch: "Westlands", debit: 87900, credit: 0, status: "Posted" },
  { id: "JV-4402", date: "15 Aug", account: "Inventory", accountCode: "1300", source: "Goods received GRN-118", branch: "Ngong Road", debit: 62400, credit: 0, status: "Posted" },
  { id: "JV-4402", date: "15 Aug", account: "Accounts payable", accountCode: "2100", source: "Goods received GRN-118", branch: "Ngong Road", debit: 0, credit: 62400, status: "Posted" },
  { id: "JV-4403", date: "15 Aug", account: "Utilities expense", accountCode: "6200", source: "Electricity token", branch: "Ngong Road", debit: 15000, credit: 0, status: "Draft" },
  { id: "JV-4403", date: "15 Aug", account: "Bank", accountCode: "1030", source: "Electricity token", branch: "Ngong Road", debit: 0, credit: 15000, status: "Draft" },
];

const columns: EnterpriseColumn<JournalEntry>[] = [
  { key: "id", label: "Voucher", sortable: true },
  { key: "date", label: "Date", sortable: true },
  { key: "accountCode", label: "Code", sortable: true },
  { key: "account", label: "Account", sortable: true },
  { key: "source", label: "Source document" },
  { key: "branch", label: "Branch", sortable: true },
  {
    key: "debit",
    label: "Debit",
    align: "right",
    sortable: true,
    render: (row) => <span className="num">{row.debit ? ksh(row.debit) : "-"}</span>,
  },
  {
    key: "credit",
    label: "Credit",
    align: "right",
    sortable: true,
    render: (row) => <span className="num">{row.credit ? ksh(row.credit) : "-"}</span>,
  },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

const chartOfAccounts = [
  { code: "1010", name: "Cash on hand", type: "Asset" },
  { code: "1020", name: "M-Pesa clearing", type: "Asset" },
  { code: "1030", name: "Bank", type: "Asset" },
  { code: "1200", name: "Accounts receivable", type: "Asset" },
  { code: "1300", name: "Inventory", type: "Asset" },
  { code: "1500", name: "Fixed assets", type: "Asset" },
  { code: "2100", name: "Accounts payable", type: "Liability" },
  { code: "2200", name: "Tax payable", type: "Liability" },
  { code: "3000", name: "Owner equity", type: "Equity" },
  { code: "4000", name: "Sales revenue", type: "Income" },
  { code: "5000", name: "Cost of sales", type: "Expense" },
  { code: "6200", name: "Utilities expense", type: "Expense" },
];

function GeneralLedger() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const debit = scopedRows.reduce((sum, row) => sum + row.debit, 0);
  const credit = scopedRows.reduce((sum, row) => sum + row.credit, 0);
  return (
    <AppShell
      title="General Ledger"
      subtitle={`Chart of accounts, journals and trial balance  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Trial balance</Btn>
          <Btn variant="primary">New journal entry</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Total debit" value={debit} money />
        <Metric label="Total credit" value={credit} money />
        <Metric label="Out of balance" value={Math.abs(debit - credit)} money invert />
        <Metric
          label="Draft vouchers"
          value={new Set(scopedRows.filter((r) => r.status === "Draft").map((r) => r.id)).size}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Journal entries"
          sub="Every posting carries its source document and branch dimension"
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Period: Aug 2026"]}
        />
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Chart of accounts" sub="Branch is a dimension, not a separate ledger" />
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {chartOfAccounts.map((account) => (
            <div
              key={account.code}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]"
            >
              <span>
                <span className="num text-muted-foreground">{account.code}</span> {account.name}
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground">{account.type}</span>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
