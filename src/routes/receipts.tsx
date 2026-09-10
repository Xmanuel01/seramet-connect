import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import { receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Receipts - Seramet" },
      {
        name: "description",
        content:
          "Every receipt issued across tills and branches, with reprint and delivery options.",
      },
      { property: "og:title", content: "Receipts - Seramet" },
      {
        property: "og:description",
        content: "Till receipts with reprint, WhatsApp and email delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Receipts,
});

function Receipts() {
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const [printNotice, setPrintNotice] = useState("");
  const { activeTenantId, branchId, branchLabel, currentUser, matchesBranch } = useAppContext();
  const { state, mutate } = useTransactionEngine();
  const { configurationError, printCustomerDocument } = useSerametPrintQueue(branchId);
  const configuration = getConfigurationRepository();
  const businessName = configuration.getTenant(activeTenantId).tradingName;
  const rows = state.receipts
    .filter((receipt) => matchesBranch(receipt.branchId ?? receipt.branch))
    .filter((receipt) => !periodDate || receipt.issuedAt.slice(0, 10) === periodDate);
  const value = rows.reduce((sum, receipt) => sum + receipt.paidAmount, 0);
  const reprints = rows.reduce((sum, receipt) => sum + receipt.reprints.length, 0);

  const printReceipt = (receiptId: string, reason = "Receipt register print") => {
    const receipt = state.receipts.find((item) => item.id === receiptId);
    if (!receipt) return;
    const order = receiptRecordToPrintOrder(receipt, state);
    if (!order) return;

    const result = printCustomerDocument(order, "RECEIPT");
    if (result.jobs.length === 0) {
      setPrintNotice(result.skipped[0] ?? "Printing is not configured for this branch.");
      return;
    }
    setPrintNotice("");
    void mutate("recordReceiptReprint", { receiptId: receipt.id, reason });
  };

  const sendWhatsApp = (receiptId: string) => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${businessName} receipt ${receiptId} is ready.`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const sendEmail = (receiptId: string) => {
    window.location.href = `mailto:?subject=${encodeURIComponent(`Receipt ${receiptId}`)}&body=${encodeURIComponent(`${businessName} receipt ${receiptId} is ready.`)}`;
  };

  const exportRows = () => {
    const csv = [
      ["Receipt", "Order", "Invoice", "Issued", "Cashier", "Amount", "Methods"],
      ...rows.map((receipt) => [
        receipt.id,
        receipt.orderId,
        receipt.invoiceId,
        receipt.issuedAt,
        receipt.cashier,
        String(receipt.paidAmount),
        receipt.paymentBreakdown.map((payment) => payment.method).join(" + "),
      ]),
    ]
      .map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipts-${periodDate || "all"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const reprintFirst = () => {
    const receipt = rows[0];
    if (!receipt) return;
    printReceipt(receipt.id, "Customer requested duplicate copy");
  };

  return (
    <AppShell
      title="Receipts"
      subtitle={`Immutable issued receipt register - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={exportRows}>Export</Btn>
          <Btn variant="primary" onClick={reprintFirst}>
            Reprint with reason
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Receipts" value={rows.length} />
        <Metric label="Value" value={value} money />
        <Metric label="Reprints" value={reprints} note="requires reason" />
        <Metric label="Digital delivery" value="Ready" note="WhatsApp + email" />
      </div>
      {(printNotice || configurationError) && (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning">
          Printing unavailable: {printNotice || configurationError}
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="Receipt register"
          sub="Immutable log - receipts are created only after confirmed payment"
          right={<SearchInput placeholder="Search receipt or order..." />}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips
            items={[
              {
                label: "Period",
                value: formatFilterDate(periodDate),
                dateValue: periodDate,
                onDateChange: setPeriodDate,
                onClear: () => setPeriodDate(""),
              },
              { label: "Scope", value: branchLabel },
              { label: "Payment", value: "All" },
              { label: "Retention", value: "Permanent" },
            ]}
            onClear={() => setPeriodDate("")}
          />
        </div>
        <DataTable
          cols={[
            "Receipt",
            "Order",
            "Invoice",
            "Issued",
            "Cashier",
            { l: "Amount", r: true },
            "Method",
            "Status",
            "Send",
          ]}
        >
          {rows.map((receipt) => (
            <tr key={receipt.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{receipt.id}</TD>
              <TD className="num text-muted-foreground">{receipt.orderId}</TD>
              <TD className="num text-muted-foreground">{receipt.invoiceId}</TD>
              <TD className="text-muted-foreground">{receipt.issuedAt.slice(11, 16)}</TD>
              <TD>{receipt.cashier}</TD>
              <TD className="num text-right font-semibold">{ksh(receipt.paidAmount)}</TD>
              <TD>
                {receipt.paymentBreakdown
                  .map((payment) => payment.method.replaceAll("_", " "))
                  .join(" + ")}
              </TD>
              <TD>
                <Status>{receipt.reprints.length ? "Reprinted" : "Paid"}</Status>
              </TD>
              <TD>
                <div className="flex gap-1.5 text-[12px] font-semibold text-primary">
                  <button onClick={() => printReceipt(receipt.id)}>Print</button>
                  <button onClick={() => sendWhatsApp(receipt.id)}>WhatsApp</button>
                  <button onClick={() => sendEmail(receipt.id)}>Email</button>
                </div>
              </TD>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <TD className="text-muted-foreground" colSpan={9}>
                No paid receipts in the selected branch yet.
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
