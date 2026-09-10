import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
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
        content:
          "Double-entry journal postings generated from sales, purchases, cash and expenses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GeneralLedger,
});

const rows: JournalEntry[] = emptyRecords();

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

const chartOfAccounts = emptyRecords();

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
          filters={[`Branch: ${branch}`, "Period: Current"]}
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
              <span className="text-[11px] font-semibold text-muted-foreground">
                {account.type}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
