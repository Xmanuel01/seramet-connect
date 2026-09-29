import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Mail, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import {
  TransactionEngine,
  type BillingRecord,
  type PaymentMethod,
  type PaymentRecord,
} from "@/lib/transaction-engine";
import {
  SerametPrintService,
  type OrderForPrint,
  type ProductionStation,
} from "@/lib/seramet-print-service";
import {
  createDeliveryLog,
  createInvoicePdfBlob,
  invoiceEmailLink,
  invoiceWhatsAppLink,
  type DeliveryLogEntry,
  type InvoiceDeliveryRecord,
} from "@/lib/document-delivery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices - Seramet" },
      {
        name: "description",
        content: "Issue, track and settle customer invoices with ageing and payment status.",
      },
      { property: "og:title", content: "Invoices - Seramet" },
      { property: "og:description", content: "Customer invoices, ageing and settlement tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Invoices,
});

function invoiceDeliveryRecord(row: BillingRecord): InvoiceDeliveryRecord {
  return {
    id: row.id,
    customer: row.customer,
    branch: row.branch,
    issued: row.issuedAt.slice(0, 10),
    due: row.dueAt.slice(0, 10),
    amount: row.total,
    paid: row.paid,
    status: row.status,
    email: "accounts@mona.example",
    phone: "254700111222",
    lines: row.lines.map((line) => ({
      description: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  };
}

function invoicePrintOrder(row: BillingRecord, payments: PaymentRecord[]): OrderForPrint {
  const invoicePayments = payments.filter((payment) => payment.invoiceId === row.id);
  return {
    orderId: row.orderIds[0] ?? row.id,
    branch: row.branch,
    terminalId: `${row.branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-POS-01`,
    table: row.table,
    orderType:
      row.customer.includes("Glovo") ||
      row.customer.includes("Bolt") ||
      row.customer.includes("Uber")
        ? "Online"
        : row.table
          ? "Dine-In"
          : "Take Away",
    requestedBy: invoicePayments[0]?.cashier ?? "Emmanuel Obiambo",
    cashier: invoicePayments[0]?.cashier ?? "Emmanuel Obiambo",
    waiter: invoicePayments[0]?.cashier ?? "Emmanuel Obiambo",
    createdAt: row.issuedAt,
    customer: row.customer,
    receiptNumber: row.paymentStatus === "PAID" ? row.id.replace(/^INV/i, "RCP") : undefined,
    invoiceNumber: row.id,
    paymentMethod: invoicePayments[0]?.method.replaceAll("_", " ") ?? undefined,
    paymentReference: invoicePayments[0]?.reference,
    paymentBreakdown: invoicePayments.map((payment) => ({
      method: payment.method.replaceAll("_", " "),
      amount: payment.amount,
      reference: payment.reference,
    })),
    lines: row.lines.map((line) => ({
      id: line.id,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      productionStation: (line.productionStation ?? "MAIN KITCHEN") as ProductionStation,
      itemNote: line.itemNote,
    })),
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    paid: row.paid,
  };
}

type PrintPreviewState = {
  title: string;
  documentType: "BILL" | "RECEIPT" | "INVOICE";
  template: string;
  content: string;
};

function Invoices() {
  const [deliveryLog, setDeliveryLog] = useState<DeliveryLogEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settleInvoice, setSettleInvoice] = useState<BillingRecord | null>(null);
  const [settlementMethod, setSettlementMethod] = useState<
    "Credit" | "M-Pesa" | "Cash" | "Bank" | "Card" | "Pending"
  >("M-Pesa");
  const [mpesaReference, setMpesaReference] = useState("");
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [receiptPrompt, setReceiptPrompt] = useState<BillingRecord | null>(null);
  const [printPreview, setPrintPreview] = useState<PrintPreviewState | null>(null);
  const [warning, setWarning] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Paid" | "Open" | "Pending">("Open");
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const { branch, branchLabel } = useAppContext();
  const { state, apply } = useTransactionEngine();
  const rows = state.bills.filter((bill) => branch === "All Branches" || bill.branch === branch);
  const activeRows = rows
    .filter((row) => row.status !== "MERGED" && row.status !== "SPLIT")
    .filter((row) => !periodDate || row.issuedAt.slice(0, 10) === periodDate)
    .filter((row) => {
      if (statusFilter === "Paid") return row.paymentStatus === "PAID";
      if (statusFilter === "Open") return row.status === "OPEN" || row.paymentStatus === "PARTIAL";
      if (statusFilter === "Pending")
        return row.status === "PENDING" || row.paymentStatus === "UNPAID";
      return true;
    });
  const outstanding = activeRows.reduce((sum, row) => sum + row.total - row.paid, 0);
  const paid = activeRows.reduce((sum, row) => sum + row.paid, 0);
  const overdue = activeRows
    .filter((row) => row.paymentStatus !== "PAID")
    .reduce((sum, row) => sum + row.total - row.paid, 0);
  const showSettleColumn = activeRows.some((row) => row.paymentStatus !== "PAID");

  const logDelivery = (entry: DeliveryLogEntry) => {
    setDeliveryLog((current) => [entry, ...current].slice(0, 8));
  };

  const selectedBills = activeRows.filter((row) => selectedIds.includes(row.id));

  const toggleInvoice = (invoiceId: string) => {
    setSelectedIds((current) =>
      current.includes(invoiceId)
        ? current.filter((id) => id !== invoiceId)
        : [...current, invoiceId],
    );
  };

  const settlementLabel = (invoice: BillingRecord) => {
    if (invoice.status === "PENDING") return "Pending";
    const methods = state.payments
      .filter((payment) => payment.invoiceId === invoice.id)
      .map((payment) => payment.method.replaceAll("_", " "));
    if (methods.length === 0) return invoice.paymentStatus === "PAID" ? "Settled" : "Not settled";
    return Array.from(new Set(methods)).join(" + ");
  };

  const downloadPdf = (invoice: BillingRecord) => {
    const record = invoiceDeliveryRecord(invoice);
    const blob = createInvoicePdfBlob(record);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${invoice.id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    logDelivery(createDeliveryLog(record, "PDF", "Downloaded"));
  };

  const openPrintTemplate = (
    invoice: BillingRecord,
    documentType: PrintPreviewState["documentType"],
  ) => {
    const profile = SerametPrintService.getBranchHardwareProfile(invoice.branch);
    const job = SerametPrintService.createDocumentJob(
      profile,
      invoicePrintOrder(invoice, state.payments),
      documentType,
    );
    setPrintPreview({
      title: `${documentType === "INVOICE" ? "A4 tax invoice" : documentType.toLowerCase()} - ${invoice.id}`,
      documentType,
      template: job.template,
      content: job.content,
    });
    logDelivery(
      createDeliveryLog(
        invoiceDeliveryRecord(invoice),
        documentType === "RECEIPT" ? "PDF" : "PDF",
        `Prepared ${job.template}`,
      ),
    );
  };

  const openEmail = (invoice: BillingRecord) => {
    const record = invoiceDeliveryRecord(invoice);
    window.location.href = invoiceEmailLink(record);
    logDelivery(createDeliveryLog(record, "Email", record.email ?? "No email"));
  };

  const openWhatsApp = (invoice: BillingRecord) => {
    const record = invoiceDeliveryRecord(invoice);
    window.open(invoiceWhatsAppLink(record), "_blank", "noopener,noreferrer");
    logDelivery(createDeliveryLog(record, "WhatsApp", record.phone ?? "No phone"));
  };

  const mergeFirstOpenBills = () => {
    if (selectedBills.length < 2) {
      setWarning("Select at least two invoices before merging.");
      return;
    }
    const billIds = selectedBills.map((row) => row.id);
    apply((current) =>
      TransactionEngine.mergeBills(current, billIds, "Emmanuel K.", "Customer requested one bill"),
    );
    setSelectedIds([]);
  };

  const splitFirstOpenBill = () => {
    const bill = selectedBills[0];
    if (!bill) {
      setWarning("Select one invoice before splitting.");
      return;
    }
    apply((current) =>
      TransactionEngine.splitBill(
        current,
        bill.id,
        [
          { label: "Guest 1", amount: Math.floor(bill.total / 2) },
          { label: "Guest 2", amount: bill.total - Math.floor(bill.total / 2) },
        ],
        "Amina W.",
      ),
    );
    setSelectedIds([]);
  };

  const printSelectedInvoice = () => {
    const bill = selectedBills[0];
    if (!bill) {
      setWarning("Select an invoice before printing.");
      return;
    }
    openPrintTemplate(bill, "INVOICE");
  };

  const openSettle = (invoice: BillingRecord) => {
    setSettleInvoice(invoice);
    setSettlementMethod(
      invoice.customer.includes("Glovo") ||
        invoice.customer.includes("Bolt") ||
        invoice.customer.includes("Uber")
        ? "Credit"
        : "M-Pesa",
    );
    setSettlementAmount(invoice.total - invoice.paid);
    setMpesaReference("");
  };

  const paymentMethodForSettlement = (): PaymentMethod => {
    if (settlementMethod === "Credit") return "CUSTOMER_CREDIT";
    if (settlementMethod === "Cash") return "CASH";
    if (settlementMethod === "Card") return "CARD";
    if (settlementMethod === "Bank") return "BANK_TRANSFER";
    return "MPESA_TILL_MANUAL";
  };

  const confirmSettlement = () => {
    if (!settleInvoice) return;
    if (settlementMethod === "Pending") {
      apply((current) => ({
        ...current,
        bills: current.bills.map((bill) =>
          bill.id === settleInvoice.id ? { ...bill, status: "PENDING" } : bill,
        ),
        auditEvents: [
          {
            id: `AUD-PENDING-${Date.now()}`,
            time: new Date().toISOString(),
            actor: "Amina W.",
            role: "Cashier",
            branch: settleInvoice.branch,
            module: "Invoices",
            action: "Marked invoice pending",
            record: settleInvoice.id,
            before: settleInvoice.status,
            after: "PENDING - settlement deferred after close",
          },
          ...current.auditEvents,
        ],
      }));
      setSettleInvoice(null);
      return;
    }
    if (settlementAmount <= 0) return;
    const amount = Math.min(settlementAmount, settleInvoice.total - settleInvoice.paid);
    apply((current) => {
      if (settlementMethod === "Cash") {
        return TransactionEngine.recordCashPayment(current, settleInvoice.id, {
          received: amount,
          cashier: "Amina W.",
          terminal: "WEST-POS-01",
        });
      }
      if (settlementMethod === "Card") {
        return TransactionEngine.recordCardPayment(current, settleInvoice.id, {
          amount,
          reference: `CARD-${Date.now()}`,
          cashier: "Amina W.",
          terminal: "CARD-WEST-01",
          acquirer: "Card Acquirer",
          batch: "BATCH-01",
        });
      }
      if (settlementMethod === "Bank") {
        return TransactionEngine.recordBankPayment(current, settleInvoice.id, {
          amount,
          reference: `BANK-${Date.now()}`,
          cashier: "Amina W.",
          bankAccount: "Mona Swahili Operating",
          sender: settleInvoice.customer,
        });
      }
      if (settlementMethod === "Credit") {
        return TransactionEngine.applyPayment(current, settleInvoice.id, {
          amount,
          method: paymentMethodForSettlement(),
          provider: "Partner Credit",
          reference: `CREDIT-${settleInvoice.id}-${Date.now()}`,
          cashier: "Amina W.",
          terminal: "CHANNEL-CREDIT",
          reconciliationStatus: "RECONCILED",
          settlementStatus: "PENDING",
        });
      }
      return TransactionEngine.recordManualTillPayment(current, settleInvoice.id, {
        amount,
        reference: `MPESA-${mpesaReference || Date.now()}`,
        cashier: "Amina W.",
        terminal: "WEST-POS-01",
      });
    });
    setReceiptPrompt(settleInvoice);
    setSettleInvoice(null);
  };

  return (
    <AppShell
      title="Invoices"
      subtitle={`Customer billing, open bills and settlement - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={mergeFirstOpenBills}>Merge selected</Btn>
          <Btn onClick={splitFirstOpenBill}>Split selected</Btn>
          <Btn onClick={printSelectedInvoice}>Print invoice</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Invoiced"
          value={activeRows.reduce((sum, row) => sum + row.total, 0)}
          money
          delta={12.4}
        />
        <Metric label="Outstanding" value={outstanding} money delta={4.8} invert />
        <Metric label="Paid" value={paid} money />
        <Metric
          label="Open / partial"
          value={activeRows.filter((row) => row.paymentStatus !== "PAID").length}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Bills and invoices"
          sub={`${activeRows.length} active billing records; merged/split source records retained`}
          right={<SearchInput placeholder="Search invoice or customer..." />}
        />
        <div className="px-4 pt-3">
          <Chips
            items={[
              { label: "Scope", value: branchLabel },
              {
                label: "Status",
                value: statusFilter,
                options: ["Open", "Paid", "Pending", "All"],
                selectedOption: statusFilter,
                onOptionChange: (value) => setStatusFilter(value as typeof statusFilter),
                onClear: () => setStatusFilter("All"),
              },
              {
                label: "Period",
                value: formatFilterDate(periodDate),
                dateValue: periodDate,
                onDateChange: setPeriodDate,
                onClear: () => setPeriodDate(""),
              },
              { label: "Overdue exposure", value: ksh(overdue) },
              {
                label: "",
                value: `${selectedIds.length} selected`,
                onClear: () => setSelectedIds([]),
              },
            ]}
            onClear={() => {
              setStatusFilter("All");
              setPeriodDate("");
              setSelectedIds([]);
            }}
          />
        </div>
        <DataTable
          cols={[
            "",
            "Invoice",
            "Orders",
            "Customer",
            { l: "Amount", r: true },
            { l: "Outstanding", r: true },
            "Status",
            "Settlement",
            ...(showSettleColumn ? ["Settle"] : []),
            "Delivery",
          ]}
        >
          {activeRows.map((row) => (
            <tr key={row.id} className="hover:bg-secondary/50">
              <TD>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(row.id)}
                  onChange={() => toggleInvoice(row.id)}
                  className="h-4 w-4 accent-primary"
                />
              </TD>
              <TD className="num font-semibold">{row.id}</TD>
              <TD className="num text-muted-foreground">{row.orderIds.join(", ")}</TD>
              <TD>{row.customer}</TD>
              <TD className="num text-right">{ksh(row.total)}</TD>
              <TD className="num text-right font-semibold">{ksh(row.total - row.paid)}</TD>
              <TD>
                <Status>{row.status}</Status>
              </TD>
              <TD>
                <Status>{settlementLabel(row)}</Status>
              </TD>
              {showSettleColumn && (
                <TD>
                  {row.paymentStatus !== "PAID" && (
                    <Btn onClick={() => openSettle(row)}>Settle</Btn>
                  )}
                </TD>
              )}
              <TD>
                <div className="flex gap-1.5">
                  <button
                    onClick={() =>
                      openPrintTemplate(row, row.paymentStatus === "PAID" ? "RECEIPT" : "BILL")
                    }
                    className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
                    title={row.paymentStatus === "PAID" ? "Preview receipt" : "Preview bill"}
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => downloadPdf(row)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
                    title="Download A4 PDF"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openEmail(row)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
                    title="Email invoice"
                  >
                    <Mail className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openWhatsApp(row)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
                    title="Send WhatsApp invoice"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                </div>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <Panel className="mt-4">
        <PanelHead
          title="Delivery log"
          sub="PDF, email and WhatsApp delivery actions are recorded in-session"
        />
        <DataTable cols={["Invoice", "Channel", "Destination", "Created", "Status"]}>
          {deliveryLog.map((entry) => (
            <tr key={entry.id} className="hover:bg-secondary/50">
              <TD className="font-semibold">{entry.invoiceId}</TD>
              <TD>{entry.channel}</TD>
              <TD className="text-muted-foreground">{entry.destination}</TD>
              <TD className="text-muted-foreground">{entry.createdAt}</TD>
              <TD>
                <Status>{entry.status}</Status>
              </TD>
            </tr>
          ))}
          {deliveryLog.length === 0 && (
            <tr>
              <TD className="text-muted-foreground" colSpan={5}>
                No invoice delivery actions yet.
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>
      <Dialog open={!!settleInvoice} onOpenChange={(open) => !open && setSettleInvoice(null)}>
        <DialogContent className="max-w-[560px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Settle invoice</DialogTitle>
            <DialogDescription>
              {settleInvoice?.id} - {settleInvoice?.customer}
            </DialogDescription>
          </DialogHeader>
          {settleInvoice && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-secondary/50 p-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span className="num text-[20px] font-extrabold">
                    {ksh(settleInvoice.total - settleInvoice.paid)}
                  </span>
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] font-semibold text-muted-foreground">
                  Settlement method
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(["Credit", "M-Pesa", "Cash", "Bank", "Card", "Pending"] as const).map(
                    (method) => (
                      <button
                        key={method}
                        onClick={() => setSettlementMethod(method)}
                        className={`rounded-md border px-3 py-2 text-[13px] font-semibold ${settlementMethod === method ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-secondary"}`}
                      >
                        {method}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  Amount
                  <input
                    type="number"
                    min={0}
                    value={settlementAmount}
                    onChange={(event) => setSettlementAmount(Number(event.target.value))}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                  />
                </label>
                {settlementMethod === "M-Pesa" && (
                  <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                    M-Pesa transaction code
                    <input
                      maxLength={12}
                      value={mpesaReference}
                      onChange={(event) =>
                        setMpesaReference(
                          event.target.value
                            .replace(/[^a-z0-9]/gi, "")
                            .toUpperCase()
                            .slice(0, 12),
                        )
                      }
                      className="h-10 rounded-md border border-border bg-card px-3 text-[13px] uppercase text-foreground outline-none"
                      placeholder="TH7X8A1B2C"
                    />
                  </label>
                )}
              </div>
              {settlementMethod === "Credit" && (
                <div className="rounded-md bg-info-soft px-3 py-2 text-[12px] font-semibold text-info">
                  Credit settlement posts to the customer or partner receivable account for later
                  reconciliation.
                </div>
              )}
              {settlementMethod === "Pending" && (
                <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] font-semibold text-warning">
                  Pending keeps the invoice open for later settlement after restaurant close.
                </div>
              )}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Btn onClick={() => setSettleInvoice(null)}>Cancel</Btn>
                <Btn variant="primary" onClick={confirmSettlement}>
                  {settlementMethod === "Pending" ? "Mark pending" : "Settle invoice"}
                </Btn>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!receiptPrompt} onOpenChange={(open) => !open && setReceiptPrompt(null)}>
        <DialogContent className="max-w-[420px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> Settlement recorded
            </DialogTitle>
            <DialogDescription>
              {receiptPrompt?.id} has been settled and will appear on Receipts once cleared.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setReceiptPrompt(null)}>Do not print</Btn>
            <Btn
              variant="primary"
              onClick={() => {
                if (receiptPrompt) openPrintTemplate(receiptPrompt, "RECEIPT");
                setReceiptPrompt(null);
              }}
            >
              Print receipt
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!printPreview} onOpenChange={(open) => !open && setPrintPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-[760px] overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle>{printPreview?.title}</DialogTitle>
            <DialogDescription>
              Rendered from the Seramet printer template: {printPreview?.template}
            </DialogDescription>
          </DialogHeader>
          {printPreview && (
            <div className="space-y-4">
              <div className="grid place-items-center rounded-xl border border-border bg-secondary/40 p-4">
                <pre
                  className={
                    printPreview.documentType === "INVOICE"
                      ? "w-full max-w-[680px] overflow-auto rounded-sm border border-neutral-300 bg-white p-5 font-mono text-[11px] leading-relaxed text-black shadow-sm"
                      : "w-[320px] overflow-auto rounded-sm border border-neutral-300 bg-white p-4 font-mono text-[11px] leading-relaxed text-black shadow-sm"
                  }
                >
                  {printPreview.content}
                </pre>
              </div>
              <div className="flex justify-end gap-2">
                <Btn onClick={() => setPrintPreview(null)}>Close</Btn>
                <Btn
                  onClick={() => {
                    const blob = new Blob([printPreview.content], {
                      type: "text/plain;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `${printPreview.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download template
                </Btn>
                <Btn variant="primary" onClick={() => window.print()}>
                  Print
                </Btn>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!warning} onOpenChange={(open) => !open && setWarning("")}>
        <DialogContent className="max-w-[420px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Selection required
            </DialogTitle>
            <DialogDescription>{warning}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Btn variant="primary" onClick={() => setWarning("")}>
              OK
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
