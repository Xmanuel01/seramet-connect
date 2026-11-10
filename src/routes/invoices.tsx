import { createFileRoute } from "@tanstack/react-router";
import { recordBusinessDate, resolvePosTimeZone } from "@/lib/pos-workflow";
import { useBusinessToday } from "@/hooks/use-business-today";
import { useEffect, useRef, useState } from "react";
import { DocumentEmailDialog } from "@/components/app/DocumentEmailDialog";
import { DocumentTextPreview } from "@/components/app/DocumentTextPreview";
import { InvoiceSplitDialog } from "@/components/app/InvoiceSplitDialog";
import { invoiceDisplayName } from "@/lib/invoice-split";
import { permissions } from "@/platform/permissions";
import { AlertTriangle, CheckCircle2, Download, FileText, Mail, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { activeLocale, activeTimeZone, formatMoney } from "@/lib/currency";
import { formatMinor, parseMajorAmount } from "@/payments/money";
import type { AcceptedCurrency, FxPaymentQuote } from "@/onboarding/location-currency-types";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate } from "@/lib/date-filters";
import { TransactionEngine, type BillingRecord } from "@/lib/transaction-engine";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { billingDocumentToPrintOrder } from "@/lib/print-order-adapter";
import {
  createDeliveryLog,
  createInvoicePdfBlob,
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
import { RequestError, UserFacingError, reportError, userMessage } from "@/lib/user-facing-error";
import { mergeDocuments, useDocumentList, type InvoiceListStatus } from "@/lib/use-document-list";

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
  const [splitInvoice, setSplitInvoice] = useState<BillingRecord | null>(null);
  const [settleInvoice, setSettleInvoice] = useState<BillingRecord | null>(null);
  const [settlementMethod, setSettlementMethod] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [settlementCustomerPhone, setSettlementCustomerPhone] = useState("");
  const [settlementAmount, setSettlementAmount] = useState(0);
  // Split payment: part of the bill in one method, the rest in others (e.g. cash + M-Pesa).
  const [splitMode, setSplitMode] = useState(false);
  const [splitRows, setSplitRows] = useState<
    { methodId: string; amount: number; reference: string }[]
  >([]);
  const [cashReceived, setCashReceived] = useState(0);
  // Change to hand back, already formatted in the currency it is given in.
  const [changeGiven, setChangeGiven] = useState("");
  const [acceptedCurrencies, setAcceptedCurrencies] = useState<AcceptedCurrency[]>([]);
  const [tenderCurrency, setTenderCurrency] = useState("");
  const [fxQuote, setFxQuote] = useState<FxPaymentQuote | null>(null);
  const [settling, setSettling] = useState(false);
  const [receiptPrompt, setReceiptPrompt] = useState<BillingRecord | null>(null);
  const [printPreview, setPrintPreview] = useState<PrintPreviewState | null>(null);
  const [emailInvoice, setEmailInvoice] = useState<{ id: string; scope: string } | null>(null);
  const [warning, setWarning] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Paid" | "Unpaid" | "Pending">("Unpaid");
  const {
    activeTenantId,
    branchId,
    branchLabel,
    branchRecords,
    currentUser,
    matchesBranch,
    hasPermission,
    role,
    timeZone,
  } = useAppContext();
  // Opens on today's unpaid invoices. Until the user picks or clears a date, the date
  // follows the active branch's current business day, across branch switches and the cutoff.
  const [chosenDate, setPeriodDate] = useState<string | null>(null);
  const businessToday = useBusinessToday(
    branchRecords.find((branch) => branch.id === branchId)?.metadata["businessDayCutoffMinutes"],
    timeZone,
  );
  const periodDate = chosenDate ?? businessToday;
  const canSplit = hasPermission(permissions.invoicesManage);
  const scope = `${activeTenantId}:${branchId}:${currentUser.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const splitScope = useRef("");
  const currency = getConfigurationRepository().getTenant(activeTenantId).defaultCurrency;
  const { state, mutate, syncFromBackend } = useTransactionEngine();
  const { printCustomerDocument } = useSerametPrintQueue(branchId);
  useEffect(() => {
    const controller = new AbortController();
    const token = getSerametAccessToken();
    void fetch("/api/seramet/setup/payment-currencies", {
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-seramet-user-id": currentUser.id,
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-branch-id": branchId,
        "x-seramet-user": currentUser.name,
        "x-seramet-role": role,
      },
    })
      .then(async (response) => {
        const body = (await response.json()) as { currencies?: AcceptedCurrency[] };
        if (response.ok && body.currencies) setAcceptedCurrencies(body.currencies);
      })
      // Without the list, cash is taken in the base currency only.
      .catch(() => undefined);
    return () => controller.abort();
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, role]);
  const settlementService = new SettlementService();
  const settlementMethods = settlementService.listMethods(activeTenantId);
  const selectedSettlementMethod = settlementMethods.find(
    (method) => method.id === settlementMethod,
  );
  // Foreign cash this branch takes with the chosen method; the base currency always comes first.
  const foreignCurrencies =
    selectedSettlementMethod?.category === "CASH"
      ? acceptedCurrencies.filter(
          (option) =>
            !option.isBase &&
            option.status === "ACTIVE" &&
            option.cashEligible &&
            (!option.branchIds.length || option.branchIds.includes(branchId)) &&
            (!option.paymentMethodIds.length ||
              option.paymentMethodIds.includes(selectedSettlementMethod.id)),
        )
      : [];
  const tender = foreignCurrencies.some((option) => option.code === tenderCurrency)
    ? tenderCurrency
    : currency;
  const foreignTender = tender !== currency;
  let identity = { email: "", phone: "" };
  let identityConfigurationError = "";
  try {
    const configuredIdentity = getConfigurationRepository().getDocumentIdentity(
      activeTenantId,
      branchId,
    );
    identity = { email: configuredIdentity.email, phone: configuredIdentity.phone };
  } catch (error) {
    identityConfigurationError = userMessage(
      error,
      "Add the business email and phone in Settings to send invoices.",
    );
  }
  const invoiceTimeZone = (() => {
    try {
      const config = getConfigurationRepository();
      const tenant = config.getTenant(activeTenantId);
      const branch = config.getBranch(activeTenantId, branchId);
      return resolvePosTimeZone(
        branch.timezone,
        tenant.timezone,
        tenant.countryCode,
        tenant.defaultCurrency,
      );
    } catch {
      return activeTimeZone();
    }
  })();
  // The same cutoff-adjusted day the server files the invoice under.
  const invoiceDay = (invoice: BillingRecord) => {
    const record = branchRecords.find((candidate) => candidate.id === invoice.branchId);
    return recordBusinessDate(
      invoice.businessDate,
      invoice.issuedAt,
      record?.timezone ?? invoiceTimeZone,
      Number(record?.metadata["businessDayCutoffMinutes"] ?? 0),
    );
  };
  // Actions need the till's own copy (payments, orders); a row that so far has
  // only arrived from the server waits for it.
  const loadedLocally = (invoice: BillingRecord) => {
    if (state.bills.some((bill) => bill.id === invoice.id)) return true;
    setWarning("This invoice is still loading on this till. Try again in a moment.");
    return false;
  };
  // A chosen day comes straight from the server, so it shows before the till has
  // loaded its full copy; the till's own bills (including offline ones) win by id.
  const server = useDocumentList("invoices", periodDate, {
    status: statusFilter.toLowerCase() as InvoiceListStatus,
  });
  const rows = mergeDocuments(server.rows, state.bills).filter((bill) =>
    matchesBranch(bill.branchId ?? bill.branch),
  );
  const activeRows = rows
    .filter((row) => row.status !== "MERGED" && row.status !== "SPLIT")
    .filter((row) => !periodDate || invoiceDay(row) === periodDate)
    .filter((row) => {
      if (statusFilter === "Paid") return row.paymentStatus === "PAID";
      if (statusFilter === "Unpaid") return row.paid < row.total && row.status !== "PENDING";
      if (statusFilter === "Pending") return row.status === "PENDING";
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
    if (!loadedLocally(invoice)) return;
    try {
      const profile = SerametPrintService.getBranchHardwareProfile(invoice.branch);
      const source = billingDocumentToPrintOrder(invoice, state, documentType);
      if (!source) throw new UserFacingError("This invoice has no payment receipt yet.");
      const job = SerametPrintService.createDocumentJob(profile, source, documentType);
      setPrintPreview({
        billingId: invoice.id,
        title: `${documentType === "RECEIPT" ? "Receipt for" : "Invoice"} ${invoiceDisplayName(invoice.id)}`,
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
      setWarning(reportError(error, "Couldn't prepare this document for printing. Try again."));
    }
  };

  const openEmail = (invoice: BillingRecord) => {
    setEmailInvoice({ id: invoice.id, scope });
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
    if (selectedBills.length !== 1) {
      setWarning("Select one invoice before splitting.");
      return;
    }
    openSplit(selectedBills[0]!);
  };
  const openSplit = (invoice: BillingRecord) => {
    if (!loadedLocally(invoice)) return;
    if (!canSplit) {
      setWarning("Invoice management permission is required to split invoices.");
      return;
    }
    if (invoice.status !== "OPEN" || invoice.paymentStatus !== "UNPAID" || invoice.paid !== 0) {
      setWarning("Only an open unpaid invoice can be split.");
      return;
    }
    splitScope.current = scope;
    setSplitInvoice(invoice);
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
    if (!loadedLocally(invoice)) return;
    setSettleInvoice(invoice);
    setSettlementMethod(
      settlementService.recommendMethod(activeTenantId, invoice, state)?.id ??
        settlementMethods[0]?.id ??
        "",
    );
    setSettlementAmount(invoice.total - invoice.paid);
    setCashReceived(0);
    setTenderCurrency(currency);
    setFxQuote(null);
    setSettlementReference("");
    setSettlementCustomerPhone("");
    setSplitMode(false);
    setSplitRows([]);
  };

  const fxHeaders = () => {
    const token = getSerametAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": currentUser.id,
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
    };
  };

  const settleInForeignCash = async (
    invoice: BillingRecord,
    amount: number,
    paymentMethodId: string,
  ) => {
    if (settling) return;
    setSettling(true);
    try {
      const amountMinor = parseMajorAmount(amount, currency);
      // First press: lock the rate so the cashier can tell the customer what to pay.
      if (!fxQuote) {
        const response = await fetch("/api/seramet/setup/fx-quotes", {
          method: "POST",
          headers: fxHeaders(),
          body: JSON.stringify({
            branchId: invoice.branchId ?? branchId,
            invoiceId: invoice.id,
            paymentMethodId,
            baseAmountMinor: amountMinor,
            tenderCurrency: tender,
            idempotencyKey: `fx-quote:${crypto.randomUUID()}`,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          quote?: FxPaymentQuote;
          message?: string;
        };
        if (!response.ok || !body.quote)
          throw new RequestError(response.ok ? 502 : response.status, body.message ?? "");
        setFxQuote(body.quote);
        return;
      }
      const tenderedMinor = cashReceived
        ? parseMajorAmount(cashReceived, fxQuote.tenderCurrency)
        : fxQuote.tenderAmountMinor;
      if (tenderedMinor < fxQuote.tenderAmountMinor) {
        setWarning("Cash received is less than the amount due in this currency.");
        return;
      }
      await mutate("applyConfiguredPayment", {
        invoiceId: invoice.id,
        paymentMethodId,
        amountMinor,
        cashTenderedMinor: tenderedMinor,
        fxQuoteId: fxQuote.id,
        tenderCurrency: fxQuote.tenderCurrency,
        tenderedAmountMinor: tenderedMinor,
      });
      const changeMinor = tenderedMinor - fxQuote.tenderAmountMinor;
      setChangeGiven(
        changeMinor > 0 ? formatMinor(changeMinor, fxQuote.tenderCurrency, activeLocale()) : "",
      );
      setReceiptPrompt(invoice);
      setSettleInvoice(null);
    } catch (error) {
      // A rejected or expired rate is dropped so the next press asks for a fresh one.
      setFxQuote(null);
      setWarning(reportError(error, "Couldn't take payment in this currency. Try again."));
    } finally {
      setSettling(false);
    }
  };

  const splitMethods = settlementMethods.filter((method) => !method.metadata["providerOperation"]);
  const startSplit = () => {
    if (!settleInvoice) return;
    const outstanding = settleInvoice.total - settleInvoice.paid;
    const first = splitMethods[0]?.id ?? "";
    const second = splitMethods.find((method) => method.id !== first)?.id ?? first;
    setSplitRows([
      { methodId: first, amount: outstanding, reference: "" },
      { methodId: second, amount: 0, reference: "" },
    ]);
    setSplitMode(true);
  };
  const confirmSplit = async () => {
    if (!settleInvoice) return;
    const outstanding = settleInvoice.total - settleInvoice.paid;
    const rows = splitRows.filter((row) => row.amount > 0);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    if (rows.length < 1) return;
    if (total > outstanding + 0.001) {
      setWarning(
        `The parts add up to ${formatMoney(total)}, more than the ${formatMoney(outstanding)} owed.`,
      );
      return;
    }
    for (const row of rows) {
      const method = splitMethods.find((item) => item.id === row.methodId);
      if (!method) return;
      if (method.requiresReference && method.category !== "CARD" && !row.reference.trim()) {
        setWarning(`Enter the ${method.displayName} reference.`);
        return;
      }
    }
    setSettling(true);
    let recorded = 0;
    try {
      // One payment per part, in order. If one fails, the parts before it stay recorded and
      // the invoice stays open for the rest, so nothing is charged twice.
      for (const [index, row] of rows.entries()) {
        await mutate("settleInvoice", {
          input: {
            tenantId: activeTenantId,
            invoiceId: settleInvoice.id,
            paymentMethodId: row.methodId,
            amount: row.amount,
            reference:
              row.reference.trim() ||
              `SPLIT-${settleInvoice.id}-${index + 1}-${Date.now().toString(36).toUpperCase()}`,
            cashier: currentUser.name,
          },
        });
        recorded += row.amount;
      }
    } catch (error) {
      setWarning(
        recorded > 0
          ? `${formatMoney(recorded)} was recorded; the rest wasn't. Settle the remaining ${formatMoney(
              outstanding - recorded,
            )} again.`
          : reportError(error, "Couldn't record the payment. Try again."),
      );
      setSettling(false);
      setSettleInvoice(null);
      return;
    }
    setSettling(false);
    if (recorded >= outstanding - 0.001) {
      setChangeGiven("");
      setReceiptPrompt(settleInvoice);
    } else {
      setWarning(
        `${formatMoney(recorded)} recorded. ${formatMoney(outstanding - recorded)} is still owed.`,
      );
    }
    setSettleInvoice(null);
  };

  const confirmSettlement = async () => {
    if (!settleInvoice) return;
    if (splitMode) {
      await confirmSplit();
      return;
    }
    if (settlementMethod === "PENDING") {
      await mutate("markBillPending", { invoiceId: settleInvoice.id, module: "Invoices" });
      setSettleInvoice(null);
      return;
    }
    if (settlementAmount <= 0) return;
    const outstanding = settleInvoice.total - settleInvoice.paid;
    const amount = Math.min(settlementAmount, outstanding);
    const isCash = selectedSettlementMethod?.category === "CASH";
    if (isCash && foreignTender && selectedSettlementMethod) {
      await settleInForeignCash(settleInvoice, amount, selectedSettlementMethod.id);
      return;
    }
    if (isCash && cashReceived > 0 && cashReceived < amount) {
      setWarning("Cash received is less than the amount being paid.");
      return;
    }
    // Change is only given when the whole balance is paid in cash; the server
    // keeps the balance and records the change from what was handed over.
    const change = isCash && amount >= outstanding ? Math.max(0, cashReceived - amount) : 0;
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
        setWarning(
          reportError(
            new RequestError(response.status, body.message ?? ""),
            "Couldn't send the payment request. Try again.",
          ),
        );
        return;
      }
      await syncFromBackend();
      setWarning("Payment request sent. The invoice stays open until the payment is confirmed.");
      setSettleInvoice(null);
      return;
    }
    try {
      await mutate("settleInvoice", {
        input: {
          tenantId: activeTenantId,
          invoiceId: settleInvoice.id,
          paymentMethodId: settlementMethod,
          amount: amount + change,
          reference: settlementReference,
          cashier: currentUser.name,
        },
      });
    } catch (error) {
      setWarning(reportError(error, "Couldn't record the payment. Try again."));
      return;
    }
    if (disposition === "CONFIRMED") {
      setChangeGiven(change > 0 ? formatMoney(change) : "");
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
      subtitle={`Customer invoices and settlement - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={mergeFirstOpenBills}>Merge selected</Btn>
          <Btn disabled={!canSplit} onClick={splitFirstOpenBill}>
            Split selected
          </Btn>
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
      {server.error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning">
          <span>{server.error} Records made on this till are still shown.</span>
          <button type="button" className="font-semibold underline" onClick={server.refresh}>
            Retry
          </button>
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="Invoices"
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
                options: ["Unpaid", "Paid", "Pending", "All"],
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
              { label: "Overdue exposure", value: formatMoney(overdue) },
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
                    aria-label={`Select ${invoiceDisplayName(row.id)}`}
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleInvoice(row.id)}
                    className="h-4 w-4 accent-primary"
                  />
                </TD>
                <TD className="num font-semibold">
                  <button
                    type="button"
                    className="text-left underline underline-offset-2"
                    onClick={() => openSplit(row)}
                  >
                    {invoiceDisplayName(row.id)}
                  </button>
                </TD>
                <TD className="num text-muted-foreground">{row.orderIds.join(", ")}</TD>
                <TD>{row.customer}</TD>
                <TD className="num text-right">{formatMoney(row.total)}</TD>
                <TD className="num text-right font-semibold">
                  {formatMoney(row.total - row.paid)}
                </TD>
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
                <div className="flex min-w-0 items-start gap-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${invoiceDisplayName(row.id)}`}
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleInvoice(row.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <button
                      type="button"
                      className="num block text-left text-[13px] font-bold underline underline-offset-2"
                      onClick={() => openSplit(row)}
                    >
                      {invoiceDisplayName(row.id)}
                    </button>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {row.customer}
                    </span>
                  </span>
                </div>
                <Status>{settlementLabel(row)}</Status>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <span className="block text-muted-foreground">Amount</span>
                  <span className="num font-semibold">{formatMoney(row.total)}</span>
                </div>
                <div className="text-right">
                  <span className="block text-muted-foreground">Outstanding</span>
                  <span className="num font-bold">{formatMoney(row.total - row.paid)}</span>
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
              {settleInvoice && invoiceDisplayName(settleInvoice.id)} - {settleInvoice?.customer}
            </DialogDescription>
          </DialogHeader>
          {settleInvoice && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-secondary/50 p-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span className="num text-[20px] font-extrabold">
                    {formatMoney(settleInvoice.total - settleInvoice.paid)}
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
                {splitMethods.length > 1 && (
                  <button
                    type="button"
                    className="mt-2 text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
                    onClick={() => (splitMode ? setSplitMode(false) : startSplit())}
                  >
                    {splitMode
                      ? "Pay with one method"
                      : "Split payment (e.g. part cash, part M-Pesa)"}
                  </button>
                )}
              </div>
              {splitMode && (
                <div className="space-y-2">
                  {splitRows.map((row, index) => {
                    const method = splitMethods.find((item) => item.id === row.methodId);
                    const update = (patch: Partial<typeof row>) =>
                      setSplitRows((rows) =>
                        rows.map((item, at) => (at === index ? { ...item, ...patch } : item)),
                      );
                    return (
                      <div
                        key={index}
                        className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-2"
                      >
                        <select
                          aria-label={`Part ${index + 1} method`}
                          value={row.methodId}
                          onChange={(event) =>
                            update({ methodId: event.target.value, reference: "" })
                          }
                          className="h-10 rounded-md border border-border bg-card px-2 text-[13px]"
                        >
                          {splitMethods.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Part ${index + 1} amount`}
                          type="number"
                          min={0}
                          value={row.amount || ""}
                          onChange={(event) => update({ amount: Number(event.target.value) })}
                          className="h-10 rounded-md border border-border bg-card px-2 text-right text-[13px]"
                        />
                        <button
                          type="button"
                          aria-label={`Remove part ${index + 1}`}
                          disabled={splitRows.length <= 2}
                          onClick={() =>
                            setSplitRows((rows) => rows.filter((_, at) => at !== index))
                          }
                          className="h-10 rounded-md px-2 text-[16px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          ×
                        </button>
                        {method?.requiresReference && (
                          <input
                            aria-label={`Part ${index + 1} reference`}
                            maxLength={64}
                            value={row.reference}
                            placeholder={settlementReferenceLabel(method)}
                            onChange={(event) =>
                              update({
                                reference: event.target.value
                                  .replace(/[^a-z0-9._/-]/gi, "")
                                  .toUpperCase()
                                  .slice(0, 64),
                              })
                            }
                            className="col-span-3 h-10 rounded-md border border-border bg-card px-3 text-[13px] uppercase"
                          />
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between text-[12px]">
                    <button
                      type="button"
                      className="font-semibold text-primary hover:underline"
                      onClick={() =>
                        setSplitRows((rows) => [
                          ...rows,
                          { methodId: splitMethods[0]?.id ?? "", amount: 0, reference: "" },
                        ])
                      }
                    >
                      + Add another method
                    </button>
                    {(() => {
                      const left =
                        settleInvoice.total -
                        settleInvoice.paid -
                        splitRows.reduce((sum, row) => sum + (row.amount || 0), 0);
                      return (
                        <span
                          className={`num font-semibold ${left < -0.001 ? "text-danger" : left > 0.001 ? "text-warning" : "text-success"}`}
                        >
                          {left > 0.001
                            ? `${formatMoney(left)} left to pay`
                            : left < -0.001
                              ? `${formatMoney(-left)} too much`
                              : "Fully covered"}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}
              <div className={splitMode ? "hidden" : "grid gap-3 sm:grid-cols-2"}>
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  Amount
                  <input
                    type="number"
                    min={0}
                    value={settlementAmount}
                    onChange={(event) => {
                      setSettlementAmount(Number(event.target.value));
                      setFxQuote(null);
                    }}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                  />
                </label>
                {foreignCurrencies.length > 0 && (
                  <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                    Currency
                    <select
                      value={tender}
                      onChange={(event) => {
                        setTenderCurrency(event.target.value);
                        setCashReceived(0);
                        setFxQuote(null);
                      }}
                      className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                    >
                      <option value={currency}>{currency}</option>
                      {foreignCurrencies.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.code} - {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedSettlementMethod?.category === "CASH" && (
                  <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                    {foreignTender ? `Cash received (${tender})` : "Cash received"}
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={cashReceived || ""}
                      placeholder={foreignTender ? "" : String(settlementAmount)}
                      onChange={(event) => setCashReceived(Number(event.target.value))}
                      className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                    />
                  </label>
                )}
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
              {foreignTender && fxQuote && (
                <div className="flex items-center justify-between rounded-md bg-info-soft px-3 py-2 text-[13px] font-semibold text-info">
                  <span>Customer pays (rate held 5 minutes)</span>
                  <span className="num text-[16px]">
                    {formatMinor(fxQuote.tenderAmountMinor, fxQuote.tenderCurrency, activeLocale())}
                  </span>
                </div>
              )}
              {selectedSettlementMethod?.category === "CASH" &&
                !foreignTender &&
                cashReceived > settlementAmount &&
                settlementAmount >= settleInvoice.total - settleInvoice.paid && (
                  <div className="flex items-center justify-between rounded-md bg-success-soft px-3 py-2 text-[13px] font-semibold text-success">
                    <span>Change due</span>
                    <span className="num text-[16px]">
                      {formatMoney(cashReceived - settlementAmount)}
                    </span>
                  </div>
                )}
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
                <Btn variant="primary" disabled={settling} onClick={confirmSettlement}>
                  {splitMode
                    ? "Record payments"
                    : settlementMethod === "PENDING"
                      ? "Mark pending"
                      : foreignTender && !fxQuote
                        ? `Get ${tender} amount`
                        : "Settle invoice"}
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
              {receiptPrompt?.id} is paid.
              {changeGiven && ` Give ${changeGiven} change.`}
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
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-[760px] grid-cols-[minmax(0,1fr)] overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle>{printPreview?.title}</DialogTitle>
            <DialogDescription className="sr-only">Print preview</DialogDescription>
          </DialogHeader>
          {printPreview && (
            <div className="space-y-4">
              <DocumentTextPreview content={printPreview.content} />
              <div className="flex flex-wrap justify-end gap-2">
                <Btn onClick={() => setPrintPreview(null)}>Close</Btn>
                <Btn
                  variant="primary"
                  onClick={() => {
                    const source = state.bills.find((bill) => bill.id === printPreview.billingId);
                    if (!source) {
                      setWarning("The billing record is no longer available to print.");
                      return;
                    }
                    const document = billingDocumentToPrintOrder(
                      source,
                      state,
                      printPreview.documentType,
                    );
                    if (!document) {
                      setWarning("This invoice has no payment receipt yet.");
                      return;
                    }
                    const result = printCustomerDocument(document, printPreview.documentType);
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
      {emailInvoice?.scope === scope && (
        <DocumentEmailDialog
          key={`${scope}:${emailInvoice.id}`}
          title={`invoice ${emailInvoice.id}`}
          documentType="INVOICE"
          recordId={emailInvoice.id}
          close={() => setEmailInvoice(null)}
        />
      )}
      {splitInvoice && splitScope.current === scope && (
        <InvoiceSplitDialog
          key={`${scope}:${splitInvoice.id}`}
          invoiceId={splitInvoice.id}
          total={splitInvoice.total}
          currency={currency}
          close={() => {
            if (scopeRef.current === scope)
              setSplitInvoice((current) => (current?.id === splitInvoice.id ? null : current));
          }}
          confirm={async (splits) => {
            const requestedScope = scope;
            const result = await mutate("splitBill", { billId: splitInvoice.id, splits });
            if (scopeRef.current !== requestedScope) return;
            const confirmed = result?.state?.bills.filter(
              (invoice) => invoice.splitFromBillId === splitInvoice.id,
            );
            if (
              (result && "offline" in result && result.offline) ||
              confirmed?.length !== splits.length
            )
              throw new UserFacingError(
                "The split wasn't saved. Your amounts are still here; try again.",
              );
            setSelectedIds([]);
          }}
        />
      )}
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
