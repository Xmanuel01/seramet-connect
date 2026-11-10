import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DocumentEmailDialog } from "@/components/app/DocumentEmailDialog";
import { DocumentTextPreview } from "@/components/app/DocumentTextPreview";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { formatMoney } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate } from "@/lib/date-filters";
import { receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { recordBusinessDate } from "@/lib/pos-workflow";
import { useBusinessToday } from "@/hooks/use-business-today";
import { UserFacingError, reportError } from "@/lib/user-facing-error";
import { mergeDocuments, useDocumentList } from "@/lib/use-document-list";
import { useReasonPrompt } from "@/components/app/ReasonDialog";

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
  const [printNotice, setPrintNotice] = useState("");
  const [askReason, reasonDialog] = useReasonPrompt();
  const [emailReceipt, setEmailReceipt] = useState<{ id: string; scope: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; scope: string; content: string } | null>(
    null,
  );
  const {
    activeTenantId,
    branchId,
    branchLabel,
    branchRecords,
    currentUser,
    matchesBranch,
    timeZone,
  } = useAppContext();
  // Opens on today. Until the user picks or clears a date, the date follows the active
  // branch's current business day, across branch switches and the cutoff.
  const [chosenDate, setPeriodDate] = useState<string | null>(null);
  const businessToday = useBusinessToday(
    branchRecords.find((branch) => branch.id === branchId)?.metadata["businessDayCutoffMinutes"],
    timeZone,
  );
  const periodDate = chosenDate ?? businessToday;
  const { state, mutate } = useTransactionEngine();
  const scope = `${activeTenantId}:${branchId}:${currentUser.id}`;
  const { configurationError, printCustomerDocument } = useSerametPrintQueue(branchId);
  const configuration = getConfigurationRepository();
  const businessName = configuration.getTenant(activeTenantId).tradingName;
  const receiptBusinessDate = (receipt: (typeof state.receipts)[number]) => {
    const record = branchRecords.find((candidate) => candidate.id === receipt.branchId);
    return recordBusinessDate(
      receipt.businessDate,
      receipt.issuedAt,
      record?.timezone ?? timeZone,
      Number(record?.metadata["businessDayCutoffMinutes"] ?? 0),
    );
  };
  // The chosen day comes straight from the server, so the list shows before the
  // till has loaded its full copy; the till's own receipts are merged in by id.
  const server = useDocumentList("receipts", periodDate);
  const rows = mergeDocuments(server.rows, state.receipts)
    .filter((receipt) => matchesBranch(receipt.branchId ?? receipt.branch))
    .filter((receipt) => !periodDate || receiptBusinessDate(receipt) === periodDate);
  const value = rows.reduce((sum, receipt) => sum + receipt.paidAmount, 0);
  const reprints = rows.reduce((sum, receipt) => sum + receipt.reprints.length, 0);

  const printReceipt = async (receiptId: string) => {
    const reason = await askReason({
      title: "Print a copy of this receipt",
      description: "Copies are logged with their reason.",
      minLength: 12,
      suggestions: [
        "Customer asked for a copy",
        "Original receipt was lost",
        "Printer jammed or faded",
      ],
      confirmLabel: "Print copy",
    });
    if (!reason) return;
    const receipt = rows.find((item) => item.id === receiptId);
    if (!receipt) return;
    const order = receiptRecordToPrintOrder(receipt, state);
    if (!order) {
      setPrintNotice("This receipt is still loading on this till. Try again in a moment.");
      return;
    }

    const result = printCustomerDocument(order, "RECEIPT", {
      reprintReason: reason,
      authorizationReprintId: crypto.randomUUID(),
    });
    if (result.jobs.length === 0) {
      setPrintNotice(result.skipped[0] ?? "Printing is not configured for this branch.");
      return;
    }
    setPrintNotice("");
    // The print authorization API persists the operator's reprint authorization
    // before returning signed evidence; the bridge never trusts this UI alone.
  };

  const sendWhatsApp = (receiptId: string) => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${businessName} receipt ${receiptId} is ready.`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const sendEmail = (receiptId: string) => {
    setEmailReceipt({ id: receiptId, scope });
  };

  const receiptContent = (receiptId: string) => {
    const receipt = rows.find((row) => row.id === receiptId);
    if (!receipt) throw new Error("The receipt is no longer available in this branch.");
    const order = receiptRecordToPrintOrder(receipt, state);
    if (!order)
      throw new UserFacingError("This receipt isn't available yet. Refresh and try again.");
    return SerametPrintService.createDocumentJob(
      SerametPrintService.getBranchHardwareProfile(receipt.branch),
      order,
      "RECEIPT",
    ).content;
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
    void printReceipt(receipt.id);
  };

  return (
    <AppShell
      title="Receipts"
      subtitle={branchLabel}
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
      {server.error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning">
          <span>{server.error} Records made on this till are still shown.</span>
          <button type="button" className="font-semibold underline" onClick={server.refresh}>
            Retry
          </button>
        </div>
      )}
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
              <TD className="num text-right font-semibold">{formatMoney(receipt.paidAmount)}</TD>
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
                  <button
                    onClick={() => {
                      try {
                        setPreview({ id: receipt.id, scope, content: receiptContent(receipt.id) });
                      } catch (error) {
                        setPrintNotice(reportError(error, "Couldn't open the preview. Try again."));
                      }
                    }}
                  >
                    Preview
                  </button>
                  <button onClick={() => void printReceipt(receipt.id)}>Print</button>
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
      {preview?.scope === scope && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-[760px] grid-cols-[minmax(0,1fr)] overflow-y-auto border-border bg-card">
            <DialogHeader>
              <DialogTitle>Receipt - {preview.id}</DialogTitle>
            </DialogHeader>
            <DocumentTextPreview content={preview.content} />
            <Btn onClick={() => setPreview(null)}>Close</Btn>
          </DialogContent>
        </Dialog>
      )}
      {emailReceipt?.scope === scope && (
        <DocumentEmailDialog
          key={`${scope}:${emailReceipt.id}`}
          title={`receipt ${emailReceipt.id}`}
          documentType="RECEIPT"
          recordId={emailReceipt.id}
          close={() => setEmailReceipt(null)}
        />
      )}
      {reasonDialog}
    </AppShell>
  );
}
