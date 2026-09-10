import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Mail, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import { TransactionEngine, type BillingRecord } from "@/lib/transaction-engine";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { billingRecordToPrintOrder } from "@/lib/print-order-adapter";
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
import { SettlementService, settlementReferenceLabel } from "@/payments/settlement-service";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { getSerametAccessToken } from "@/lib/access-token";

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

function invoiceDeliveryRecord(
  row: BillingRecord,
  contact: { email: string; phone: string },
): InvoiceDeliveryRecord {
  return {
    id: row.id,
    customer: row.customer,
    branch: row.branch,
    issued: row.issuedAt.slice(0, 10),
    due: row.dueAt.slice(0, 10),
    amount: row.total,
    paid: row.paid,
    status: row.status,
    email: contact.email,
    phone: contact.phone,
    lines: row.lines.map((line) => ({
      description: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  };
}

type PrintPreviewState = {
  billingId: string;
  title: string;
  documentType: "BILL" | "RECEIPT" | "INVOICE";
  template: string;
  content: string;
};

function InvoiceDeliveryActions({
  row,
  openPrintTemplate,
  downloadPdf,
  openEmail,
  openWhatsApp,
}: {
  row: BillingRecord;
  openPrintTemplate: (
    invoice: BillingRecord,
    documentType: PrintPreviewState["documentType"],
  ) => void;
  downloadPdf: (invoice: BillingRecord) => void;
  openEmail: (invoice: BillingRecord) => void;
  openWhatsApp: (invoice: BillingRecord) => void;
}) {
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => openPrintTemplate(row, row.paymentStatus === "PAID" ? "RECEIPT" : "BILL")}
        className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
        title={row.paymentStatus === "PAID" ? "Preview receipt" : "Preview bill"}
      >
        <FileText className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => downloadPdf(row)}
        className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
        title="Download A4 PDF"
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => openEmail(row)}
        className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
        title="Email invoice"
      >
        <Mail className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => openWhatsApp(row)}
        className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-secondary"
        title="Send WhatsApp invoice"
      >
        <MessageCircle className="h-4 w-4" />
      </button>
    </div>
  );
}

function Invoices() {
  const [deliveryLog, setDeliveryLog] = useState<DeliveryLogEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settleInvoice, setSettleInvoice] = useState<BillingRecord | null>(null);
  const [settlementMethod, setSettlementMethod] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [settlementCustomerPhone, setSettlementCustomerPhone] = useState("");
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [receiptPrompt, setReceiptPrompt] = useState<BillingRecord | null>(null);
  const [printPreview, setPrintPreview] = useState<PrintPreviewState | null>(null);
  const [warning, setWarning] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Paid" | "Open" | "Pending">("Open");
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const { activeTenantId, branchId, branchLabel, currentUser, matchesBranch } = useAppContext();
  const { state, mutate, syncFromBackend } = useTransactionEngine();
  const { printCustomerDocument } = useSerametPrintQueue(branchId);
  const settlementService = new SettlementService();
  const settlementMethods = settlementService.listMethods(activeTenantId);
  const selectedSettlementMethod = settlementMethods.find(
    (method) => method.id === settlementMethod,
  );
  let identity = { email: "", phone: "" };
  let identityConfigurationError = "";
  try {
    const configuredIdentity = getConfigurationRepository().getDocumentIdentity(
      activeTenantId,
      branchId,
    );
    identity = { email: configuredIdentity.email, phone: configuredIdentity.phone };
  } catch (error) {
    identityConfigurationError =
      error instanceof Error ? error.message : "Document identity is not configured";
  }
  const rows = state.bills.filter((bill) => matchesBranch(bill.branchId ?? bill.branch));
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
  const showSettleColumn = activeRows.some((row) =>
    ["UNPAID", "PARTIAL"].includes(row.paymentStatus),
  );

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
    if (invoice.paymentStatus === "PROVIDER_RECEIVABLE") return "Provider receivable";
    if (invoice.status === "PENDING") return "Pending";
    const methods = state.payments
      .filter((payment) => payment.invoiceId === invoice.id)
      .map((payment) => payment.method.replaceAll("_", " "));
    if (methods.length === 0) return invoice.paymentStatus === "PAID" ? "Settled" : "Not settled";
    return Array.from(new Set(methods)).join(" + ");
  };

  const downloadPdf = (invoice: BillingRecord) => {
    const record = invoiceDeliveryRecord(invoice, identity);
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
    try {
      const profile = SerametPrintService.getBranchHardwareProfile(invoice.branch);
      const job = SerametPrintService.createDocumentJob(
        profile,
        billingRecordToPrintOrder(invoice, state.payments, state.orders),
        documentType,
      );
      setPrintPreview({
        billingId: invoice.id,
        title: `${documentType === "INVOICE" ? "A4 tax invoice" : documentType.toLowerCase()} - ${invoice.id}`,
        documentType,
        template: job.template,
        content: job.content,
      });
      logDelivery(
        createDeliveryLog(
          invoiceDeliveryRecord(invoice, identity),
          "PDF",
          `Prepared ${job.template}`,
        ),
      );
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Printing is not configured.");
    }
  };

  const openEmail = (invoice: BillingRecord) => {
    if (!identity.email) {
      setWarning(identityConfigurationError || "No document email is configured for this branch.");
      return;
    }
    const record = invoiceDeliveryRecord(invoice, identity);
    window.location.href = invoiceEmailLink(record);
    logDelivery(createDeliveryLog(record, "Email", record.email ?? "No email"));
  };

  const openWhatsApp = (invoice: BillingRecord) => {
    if (!identity.phone) {
      setWarning(identityConfigurationError || "No document phone is configured for this branch.");
      return;
    }
    const record = invoiceDeliveryRecord(invoice, identity);
    window.open(invoiceWhatsAppLink(record), "_blank", "noopener,noreferrer");
    logDelivery(createDeliveryLog(record, "WhatsApp", record.phone ?? "No phone"));
  };

  const mergeFirstOpenBills = () => {
    if (selectedBills.length < 2) {
      setWarning("Select at least two invoices before merging.");
      return;
    }
    const billIds = selectedBills.map((row) => row.id);
    void mutate("mergeBills", { billIds, reason: "Customer requested one bill" });
    setSelectedIds([]);
  };

  const splitFirstOpenBill = () => {
    const bill = selectedBills[0];
    if (!bill) {
      setWarning("Select one invoice before splitting.");
      return;
    }
    void mutate("splitBill", {
      billId: bill.id,
      splits: [
        { label: "Guest 1", amount: Math.floor(bill.total / 2) },
        { label: "Guest 2", amount: bill.total - Math.floor(bill.total / 2) },
      ],
    });
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
      settlementService.recommendMethod(activeTenantId, invoice, state)?.id ??
        settlementMethods[0]?.id ??
        "",
    );
    setSettlementAmount(invoice.total - invoice.paid);
    setSettlementReference("");
    setSettlementCustomerPhone("");
  };

  const confirmSettlement = async () => {
    if (!settleInvoice) return;
    if (settlementMethod === "PENDING") {
      await mutate("markBillPending", { invoiceId: settleInvoice.id, module: "Invoices" });
      setSettleInvoice(null);
      return;
    }
    if (settlementAmount <= 0) return;
    const amount = Math.min(settlementAmount, settleInvoice.total - settleInvoice.paid);
    const disposition = selectedSettlementMethod
      ? settlementService.disposition(selectedSettlementMethod)
      : undefined;
    if (disposition === "PROVIDER_INITIATION_REQUIRED" && selectedSettlementMethod) {
      if (selectedSettlementMethod.requiresCustomer && !settlementCustomerPhone.trim()) {
        setWarning("Enter the customer phone before initiating this payment.");
        return;
      }
      const operation =
        selectedSettlementMethod.metadata["providerOperation"] === "QR_PAYMENT" ? "qr" : "prompt";
      const response = await fetch(
        `/api/seramet/payments/${encodeURIComponent(selectedSettlementMethod.code)}/${operation}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(getSerametAccessToken()
              ? { Authorization: `Bearer ${getSerametAccessToken()}` }
              : {}),
            "x-seramet-user-id": currentUser.id,
            "x-seramet-tenant-id": activeTenantId,
            "x-seramet-branch-id": branchId,
          },
          body: JSON.stringify({
            invoiceId: settleInvoice.id,
            amount,
            ...(settlementCustomerPhone.trim()
              ? { customerPhone: settlementCustomerPhone.trim() }
              : {}),
            idempotencyKey: `invoice:${settleInvoice.id}:${selectedSettlementMethod.id}:${amount}`,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setWarning(body.message ?? "Provider payment could not be initiated.");
        return;
      }
      await syncFromBackend();
      setWarning("Payment request initiated. The invoice stays open until verified confirmation.");
      setSettleInvoice(null);
      return;
    }
    try {
      await mutate("settleInvoice", {
        input: {
          tenantId: activeTenantId,
          invoiceId: settleInvoice.id,
          paymentMethodId: settlementMethod,
          amount,
          reference: settlementReference,
          cashier: currentUser.name,
        },
      });
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Settlement could not be recorded.");
      return;
    }
    if (disposition === "CONFIRMED") {
      setReceiptPrompt(settleInvoice);
    } else if (disposition === "AWAITING_VERIFICATION") {
      setWarning("Payment reference recorded for verification. No paid receipt was generated.");
    } else if (disposition === "ON_ACCOUNT") {
      setWarning("Invoice posted to the configured customer receivable account.");
    }
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
        />
        <Metric label="Outstanding" value={outstanding} money invert />
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
        <div className="hidden md:block">
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
                    {["UNPAID", "PARTIAL"].includes(row.paymentStatus) && (
                      <Btn onClick={() => openSettle(row)}>Settle</Btn>
                    )}
                  </TD>
                )}
                <TD>
                  <InvoiceDeliveryActions
                    row={row}
                    openPrintTemplate={openPrintTemplate}
                    downloadPdf={downloadPdf}
                    openEmail={openEmail}
                    openWhatsApp={openWhatsApp}
                  />
                </TD>
              </tr>
            ))}
          </DataTable>
        </div>
        <div className="mt-3 divide-y divide-border border-t border-border md:hidden">
          {activeRows.map((row) => (
            <article key={row.id} className="space-y-3 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <label className="flex min-w-0 items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleInvoice(row.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="num block truncate text-[13px] font-bold">{row.id}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {row.customer}
                    </span>
                  </span>
                </label>
                <Status>{settlementLabel(row)}</Status>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <span className="block text-muted-foreground">Amount</span>
                  <span className="num font-semibold">{ksh(row.total)}</span>
                </div>
                <div className="text-right">
                  <span className="block text-muted-foreground">Outstanding</span>
                  <span className="num font-bold">{ksh(row.total - row.paid)}</span>
                </div>
                <div className="col-span-2 min-w-0">
                  <span className="block text-muted-foreground">Orders</span>
                  <span className="num block truncate">{row.orderIds.join(", ")}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Status>{row.status}</Status>
                <div className="flex items-center gap-1.5">
                  {showSettleColumn && ["UNPAID", "PARTIAL"].includes(row.paymentStatus) && (
                    <Btn onClick={() => openSettle(row)}>Settle</Btn>
                  )}
                  <InvoiceDeliveryActions
                    row={row}
                    openPrintTemplate={openPrintTemplate}
                    downloadPdf={downloadPdf}
                    openEmail={openEmail}
                    openWhatsApp={openWhatsApp}
                  />
                </div>
              </div>
            </article>
          ))}
          {activeRows.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
              No invoices match the current filters.
            </div>
          )}
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead
          title="Delivery log"
          sub="PDF, email and WhatsApp delivery actions are recorded in-session"
        />
        <div className="hidden md:block">
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
        </div>
        <div className="divide-y divide-border border-t border-border md:hidden">
          {deliveryLog.map((entry) => (
            <article key={entry.id} className="space-y-2 px-4 py-3 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="num font-bold">{entry.invoiceId}</span>
                <Status>{entry.status}</Status>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{entry.channel}</span>
                <span className="text-right text-muted-foreground">{entry.createdAt}</span>
              </div>
              <div className="break-words text-muted-foreground">{entry.destination}</div>
            </article>
          ))}
          {deliveryLog.length === 0 && (
            <div className="px-4 py-6 text-[12px] text-muted-foreground">
              No invoice delivery actions yet.
            </div>
          )}
        </div>
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
                  {settlementMethods.map((method) => (
                    <button
                      key={method.id}
                      onClick={() => setSettlementMethod(method.id)}
                      className={`rounded-md border px-3 py-2 text-[13px] font-semibold ${settlementMethod === method.id ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-secondary"}`}
                    >
                      {method.displayName}
                    </button>
                  ))}
                  <button
                    onClick={() => setSettlementMethod("PENDING")}
                    className={`rounded-md border px-3 py-2 text-[13px] font-semibold ${settlementMethod === "PENDING" ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-secondary"}`}
                  >
                    Pending
                  </button>
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
                {selectedSettlementMethod?.requiresReference && (
                  <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                    {settlementReferenceLabel(selectedSettlementMethod)}
                    <input
                      maxLength={64}
                      value={settlementReference}
                      onChange={(event) =>
                        setSettlementReference(
                          event.target.value
                            .replace(/[^a-z0-9._/-]/gi, "")
                            .toUpperCase()
                            .slice(0, 64),
                        )
                      }
                      className="h-10 rounded-md border border-border bg-card px-3 text-[13px] uppercase text-foreground outline-none"
                      placeholder="Enter provider reference"
                    />
                  </label>
                )}
                {selectedSettlementMethod?.requiresCustomer &&
                  selectedSettlementMethod.metadata["providerOperation"] === "PAYMENT_PROMPT" && (
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      Customer phone
                      <input
                        inputMode="tel"
                        maxLength={16}
                        value={settlementCustomerPhone}
                        onChange={(event) =>
                          setSettlementCustomerPhone(event.target.value.replace(/[^+0-9]/g, ""))
                        }
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                        placeholder="2547XXXXXXXX"
                      />
                    </label>
                  )}
              </div>
              {selectedSettlementMethod?.category === "CREDIT" && (
                <div className="rounded-md bg-info-soft px-3 py-2 text-[12px] font-semibold text-info">
                  Credit settlement posts to the customer or partner receivable account for later
                  reconciliation.
                </div>
              )}
              {settlementMethod === "PENDING" && (
                <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] font-semibold text-warning">
                  Pending keeps the invoice open for later settlement after restaurant close.
                </div>
              )}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Btn onClick={() => setSettleInvoice(null)}>Cancel</Btn>
                <Btn variant="primary" onClick={confirmSettlement}>
                  {settlementMethod === "PENDING" ? "Mark pending" : "Settle invoice"}
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
                if (receiptPrompt) {
                  const refreshed = state.bills.find((bill) => bill.id === receiptPrompt.id);
                  openPrintTemplate(refreshed ?? receiptPrompt, "RECEIPT");
                }
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
                <Btn
                  variant="primary"
                  onClick={() => {
                    const source = state.bills.find((bill) => bill.id === printPreview.billingId);
                    if (!source) {
                      setWarning("The billing record is no longer available to print.");
                      return;
                    }
                    const result = printCustomerDocument(
                      billingRecordToPrintOrder(source, state.payments, state.orders),
                      printPreview.documentType,
                    );
                    if (result.jobs.length === 0) {
                      setWarning(result.skipped[0] ?? "Printing is not configured.");
                    }
                  }}
                >
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
