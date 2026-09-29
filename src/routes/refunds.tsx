import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, Timeline } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import { TransactionEngine } from "@/lib/transaction-engine";

export const Route = createFileRoute("/refunds")({
  head: () => ({
    meta: [
      { title: "Refunds - Seramet" },
      {
        name: "description",
        content: "High-risk refund workflow with reason capture, approval chain and payout method.",
      },
      { property: "og:title", content: "Refunds - Seramet" },
      { property: "og:description", content: "Refund requests, approvals and payout tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Refunds,
});

function Refunds() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const { branchLabel, currentUser, matchesBranch } = useAppContext();
  const { state, mutate } = useTransactionEngine();
  const rows = state.refunds
    .filter((refund) => matchesBranch(refund.branchId ?? refund.branch))
    .filter((refund) => statusFilter === "All" || refund.status === statusFilter)
    .filter((refund) => !periodDate || refund.createdAt.slice(0, 10) === periodDate);
  const paidReceipt = state.receipts.find((receipt) =>
    matchesBranch(receipt.branchId ?? receipt.branch),
  );
  const selected = rows[0];

  const requestRefund = () => {
    if (!paidReceipt) return;
    void mutate("requestRefund", {
      input: {
        orderId: paidReceipt.orderId,
        invoiceId: paidReceipt.invoiceId,
        receiptId: paidReceipt.id,
        branch: paidReceipt.branch,
        amount: Math.min(1200, paidReceipt.total),
        method: paidReceipt.paymentBreakdown[0]?.method ?? "CASH",
        reason: "Customer complaint compensation with source receipt attached",
        requestedBy: currentUser.name,
      },
    });
  };

  const approveSelected = () => {
    if (!selected) return;
    void mutate("approveRefund", { refundId: selected.id });
  };

  return (
    <AppShell
      title="Refunds"
      subtitle={`Sensitive action - every refund requires a reason and manager approval - ${branchLabel}`}
      actions={
        <>
          <Btn>Export</Btn>
          <Btn onClick={approveSelected}>Approve selected</Btn>
          <Btn variant="danger" onClick={requestRefund}>
            Request refund
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Refunds this month" value={rows.length} invert />
        <Metric
          label="Refund value"
          value={rows.reduce((sum, refund) => sum + refund.amount, 0)}
          money
          invert
        />
        <Metric label="Refund rate" value="Not available" />
        <Metric
          label="Awaiting approval"
          value={rows.filter((refund) => refund.status === "REQUESTED").length}
        />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHead
            title="Refund requests"
            sub="No hard deletion; source order, invoice and receipt are retained"
          />
          <div className="border-b border-border px-4 py-3">
            <Chips
              items={[
                { label: "Scope", value: branchLabel },
                {
                  label: "Status",
                  value: statusFilter,
                  options: ["All", "REQUESTED", "APPROVED", "REJECTED", "COMPLETED"],
                  selectedOption: statusFilter,
                  onOptionChange: setStatusFilter,
                  onClear: () => setStatusFilter("All"),
                },
                {
                  label: "Period",
                  value: formatFilterDate(periodDate),
                  dateValue: periodDate,
                  onDateChange: setPeriodDate,
                  onClear: () => setPeriodDate(""),
                },
              ]}
              onClear={() => {
                setStatusFilter("All");
                setPeriodDate("");
              }}
            />
          </div>
          <DataTable
            cols={[
              "Refund",
              "Date",
              "Order",
              "Invoice",
              "Method",
              { l: "Amount", r: true },
              "Requested by",
              "Status",
            ]}
          >
            {rows.map((refund) => (
              <tr key={refund.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{refund.id}</TD>
                <TD className="text-muted-foreground">
                  {formatFilterDate(refund.createdAt.slice(0, 10))}
                </TD>
                <TD className="num text-muted-foreground">{refund.orderId}</TD>
                <TD className="num text-muted-foreground">{refund.invoiceId}</TD>
                <TD>{refund.method.replaceAll("_", " ")}</TD>
                <TD className="num text-right font-semibold">{ksh(refund.amount)}</TD>
                <TD className="text-muted-foreground">{refund.requestedBy}</TD>
                <TD>
                  <Status>{refund.status}</Status>
                </TD>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <TD className="text-muted-foreground" colSpan={8}>
                  No refund requests match the selected filters.
                </TD>
              </tr>
            )}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title={selected?.id ?? "Refund detail"}
            sub={
              selected
                ? `${selected.orderId} - ${selected.branch} - ${ksh(selected.amount)}`
                : "No refund selected"
            }
            right={<Status>{selected?.status ?? "Ready"}</Status>}
          />
          <div className="space-y-2 border-b border-border px-4 py-3 text-[13px]">
            <div className="text-muted-foreground">Reason</div>
            <p>
              {selected?.reason ??
                "Refund requests require permission, reason, timestamp, source invoice and audit trail."}
            </p>
          </div>
          <Timeline
            items={
              selected
                ? [
                    ["Requested", `${selected.requestedBy} - ${selected.createdAt.slice(11, 16)}`],
                    [
                      "Manager approval",
                      selected.approvedBy ? `${selected.approvedBy} - approved` : "Pending",
                    ],
                    [
                      "Accounting reversal",
                      selected.status === "COMPLETED" ? "Posted" : "Awaiting completion",
                    ],
                  ]
                : [["Ready", "Create a refund from an eligible paid receipt"]]
            }
          />
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <Btn variant="danger" className="flex-1">
              Reject
            </Btn>
            <Btn variant="primary" className="flex-1" onClick={approveSelected}>
              Approve refund
            </Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
