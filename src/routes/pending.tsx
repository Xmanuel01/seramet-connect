import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import { type BillingRecord } from "@/lib/transaction-engine";
import { SettlementService, settlementReferenceLabel } from "@/payments/settlement-service";
import { getSerametAccessToken } from "@/lib/access-token";

export const Route = createFileRoute("/pending")({
  head: () => ({
    meta: [
      { title: "Pending Invoices - Seramet" },
      {
        name: "description",
        content: "Invoices deferred after close or still awaiting settlement.",
      },
    ],
  }),
  component: PendingInvoices,
});

function PendingInvoices() {
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const [statusFilter, setStatusFilter] = useState<"Pending" | "Unpaid" | "Paid" | "All">(
    "Pending",
  );
  const [settleInvoice, setSettleInvoice] = useState<BillingRecord | null>(null);
  const [settlementMethod, setSettlementMethod] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [settlementCustomerPhone, setSettlementCustomerPhone] = useState("");
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [receiptPrompt, setReceiptPrompt] = useState<BillingRecord | null>(null);
  const [warning, setWarning] = useState("");
  const {
    activeTenantId,
    branch,
    branchId,
    branchLabel,
    currentUser,
    isAllBranches,
    matchesBranch,
  } = useAppContext();
  const { state, mutate, syncFromBackend } = useTransactionEngine();
  const settlementService = new SettlementService();
  const settlementMethods = settlementService.listMethods(activeTenantId);
  const selectedSettlementMethod = settlementMethods.find(
    (method) => method.id === settlementMethod,
  );
  const rows = state.bills
    .filter((bill) => matchesBranch(bill.branchId ?? bill.branch))
    .filter((bill) => bill.status !== "MERGED" && bill.status !== "SPLIT")
    .filter((bill) => !periodDate || bill.issuedAt.slice(0, 10) === periodDate)
    .filter((bill) => {
      if (statusFilter === "Paid") return bill.paymentStatus === "PAID";
      if (statusFilter === "Unpaid")
        return bill.paymentStatus === "UNPAID" && bill.status !== "PENDING";
      if (statusFilter === "Pending")
        return bill.status === "PENDING" || bill.paymentStatus === "UNPAID";
      return (
        bill.status === "PENDING" ||
        bill.paymentStatus === "UNPAID" ||
        bill.paymentStatus === "PAID" ||
        bill.paymentStatus === "PARTIAL"
      );
    });
  const value = rows.reduce((sum, bill) => sum + bill.total - bill.paid, 0);
  const oldest = rows.at(-1)?.issuedAt.slice(0, 10) ?? "None";
  const paidCount = rows.filter((bill) => bill.paymentStatus === "PAID").length;

  const settlementLabel = (invoice: BillingRecord) => {
    if (invoice.status === "PENDING") return "Pending";
    const methods = state.payments
      .filter((payment) => payment.invoiceId === invoice.id)
      .map((payment) => payment.method.replaceAll("_", " "));
    if (methods.length === 0) return invoice.paymentStatus === "PAID" ? "Settled" : "Not settled";
    return Array.from(new Set(methods)).join(" + ");
  };

  const exportRows = () => {
    const headers = [
      "Invoice",
      "Orders",
      "Customer",
      "Issued",
      "Outstanding",
      "Settlement",
      "Status",
    ];
    const csvRows = rows.map((row) => [
      row.id,
      row.orderIds.join(" "),
      row.customer,
      row.issuedAt.slice(0, 10),
      String(row.total - row.paid),
      settlementLabel(row),
      row.paymentStatus === "PAID" ? "Paid" : row.status,
    ]);
    const csv = [headers, ...csvRows]
      .map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pending-invoices-${periodDate || "all"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openSettle = (invoice: BillingRecord) => {
    if (invoice.paymentStatus === "PAID") {
      setWarning(`${invoice.id} is already paid.`);
      return;
    }
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
      await mutate("markBillPending", { invoiceId: settleInvoice.id, module: "Pending" });
      setSettleInvoice(null);
      return;
    }
    if (settlementAmount <= 0) {
      setWarning("Enter a settlement amount before settling.");
      return;
    }
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
            idempotencyKey: `pending:${settleInvoice.id}:${selectedSettlementMethod.id}:${amount}`,
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
      title="Pending"
      subtitle={`Deferred invoices and unpaid bills - ${branchLabel}`}
      actions={<Btn onClick={exportRows}>Export</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Pending invoices" value={rows.length} />
        <Metric label="Pending value" value={value} money invert />
        <Metric label="Paid in view" value={paidCount} />
        <Metric label="Branch scope" value={isAllBranches ? "All" : branch} />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Pending settlements"
          sub="Invoices that need to be collected or reconciled later"
          right={<SearchInput placeholder="Search pending invoice..." />}
        />
        <div className="px-4 pt-3">
          <Chips
            items={[
              { label: "Scope", value: branchLabel },
              {
                label: "Status",
                value: statusFilter,
                options: ["Pending", "Unpaid", "Paid", "All"],
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
              { label: "Oldest", value: oldest },
            ]}
            onClear={() => {
              setStatusFilter("All");
              setPeriodDate("");
            }}
          />
        </div>
        <DataTable
          cols={[
            "Invoice",
            "Orders",
            "Customer",
            "Issued",
            { l: "Outstanding", r: true },
            "Settlement",
            "Status",
            "Settle",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{row.id}</TD>
              <TD className="num text-muted-foreground">{row.orderIds.join(", ")}</TD>
              <TD>{row.customer}</TD>
              <TD className="text-muted-foreground">{row.issuedAt.slice(0, 10)}</TD>
              <TD className="num text-right font-semibold">{ksh(row.total - row.paid)}</TD>
              <TD>
                <Status>{settlementLabel(row)}</Status>
              </TD>
              <TD>
                <Status>{row.paymentStatus === "PAID" ? "Paid" : row.status}</Status>
              </TD>
              <TD>
                {row.paymentStatus !== "PAID" ? (
                  <Btn onClick={() => openSettle(row)}>Settle</Btn>
                ) : (
                  <Status>Paid</Status>
                )}
              </TD>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <TD className="text-muted-foreground" colSpan={8}>
                No pending invoices match this filter.
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>
      <Dialog open={!!settleInvoice} onOpenChange={(open) => !open && setSettleInvoice(null)}>
        <DialogContent className="max-w-[560px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Settle pending invoice</DialogTitle>
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
                  Credit settlement posts this pending invoice to the customer or partner receivable
                  account.
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
                  {settlementMethod === "PENDING" ? "Keep pending" : "Settle invoice"}
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
              {receiptPrompt?.id} has been settled and moved into the paid receipt flow.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setReceiptPrompt(null)}>Do not print</Btn>
            <Btn
              variant="primary"
              onClick={() => {
                window.print();
                setReceiptPrompt(null);
              }}
            >
              Print receipt
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!warning} onOpenChange={(open) => !open && setWarning("")}>
        <DialogContent className="max-w-[420px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Action needed
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
