import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { formatDate, ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine, type PurchaseOrderRecord } from "@/lib/transaction-engine";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders - Seramet" },
      {
        name: "description",
        content:
          "Purchase order list, approval state, receiving progress and supplier commitment tracking.",
      },
    ],
  }),
  component: PurchaseOrders,
});

function shortDate(iso: string) {
  return formatDate(iso, {
    day: "2-digit",
    month: "short",
  });
}

function displayStatus(status: PurchaseOrderRecord["status"]) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PurchaseOrders() {
  const [notice, setNotice] = useState("");
  const { branch, branchLabel, currentUser, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const rows = state.purchaseOrders
    .filter((row) => matchesBranch(row.branchId ?? row.branch))
    .map((po) => {
      const received = po.lines.reduce(
        (sum, line) => sum + line.receivedQuantity * line.unitCost,
        0,
      );
      return {
        ...po,
        created: shortDate(po.createdAt),
        expected: shortDate(po.expectedAt),
        amount: po.total,
        received,
        displayStatus: displayStatus(po.status),
      };
    });
  const openValue = rows
    .filter((row) => row.status !== "RECEIVED")
    .reduce((sum, row) => sum + row.amount - row.received, 0);
  const pending = rows.filter((row) => row.status === "PENDING_APPROVAL").length;

  const generate = () => {
    const result = TransactionEngine.generatePurchaseOrders(state, branch, currentUser.name);
    void mutate("generatePurchaseOrders", { branch });
    setNotice(
      result.created.length
        ? `Created ${result.created.join(", ")} from live PAR shortfalls.`
        : "No PO created. Existing open POs already cover the current shortfalls.",
    );
  };

  const approve = (id: string) => {
    void mutate("approvePurchaseOrder", { purchaseOrderId: id });
    setNotice(`${id} approved and is now available for receiving.`);
  };

  return (
    <AppShell
      title="Purchase orders"
      subtitle={`PO approvals, receiving progress and supplier commitments - ${branchLabel}`}
      actions={
        <>
          <Btn>Saved views</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary" onClick={generate}>
            New purchase order
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Visible POs" value={rows.length} />
        <Metric label="Open value" value={openValue} money invert />
        <Metric label="Pending approval" value={pending} invert />
        <Metric label="Received" value={rows.filter((row) => row.status === "RECEIVED").length} />
      </div>
      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice} Backend: {backendStatus}.
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="Purchase order register"
          sub="Approval, receiving and supplier bill conversion stay in one procurement flow"
          right={<Btn>Columns</Btn>}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips items={[`Branch: ${branch}`, "Status: All", "Expected: Next 7 days"]} />
        </div>
        {rows.length === 0 && (
          <div className="p-6 text-center text-[13px] text-muted-foreground">
            No purchase orders yet. Generate one from current PAR shortfalls.
          </div>
        )}
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map((po) => (
            <article
              key={po.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num text-[13px] font-bold">{po.id}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {po.supplier} - {po.branch}
                  </div>
                </div>
                <Status>{po.displayStatus}</Status>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="block text-muted-foreground">Amount</span>
                  <span className="num font-semibold">{ksh(po.amount)}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="block text-muted-foreground">Received</span>
                  <span className="num font-semibold">{ksh(po.received)}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="block text-muted-foreground">Expected</span>
                  <span className="font-semibold">{po.expected}</span>
                </div>
              </div>
              {po.status === "PENDING_APPROVAL" && (
                <Btn className="mt-3 w-full" variant="primary" onClick={() => approve(po.id)}>
                  Approve PO
                </Btn>
              )}
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr>
                <TH>PO</TH>
                <TH>Supplier</TH>
                <TH>Branch</TH>
                <TH>Created</TH>
                <TH>Expected</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Open</TH>
                <TH>Status</TH>
                <TH>Action</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr key={po.id} className="hover:bg-secondary/50">
                  <TD className="num font-semibold">{po.id}</TD>
                  <TD>{po.supplier}</TD>
                  <TD className="text-muted-foreground">{po.branch}</TD>
                  <TD className="text-muted-foreground">{po.created}</TD>
                  <TD className="text-muted-foreground">{po.expected}</TD>
                  <TD className="num text-right">{ksh(po.amount)}</TD>
                  <TD className="num text-right text-muted-foreground">{ksh(po.received)}</TD>
                  <TD className="num text-right font-semibold">{ksh(po.amount - po.received)}</TD>
                  <TD>
                    <Status>{po.displayStatus}</Status>
                  </TD>
                  <TD>
                    {po.status === "PENDING_APPROVAL" ? (
                      <button
                        type="button"
                        onClick={() => approve(po.id)}
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        Approve
                      </button>
                    ) : po.status === "APPROVED" || po.status === "PARTIAL" ? (
                      <span className="text-[12px] font-semibold text-success">
                        Ready to receive
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">Complete</span>
                    )}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
