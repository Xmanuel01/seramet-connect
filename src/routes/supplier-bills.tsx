import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FilePlus2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { currentDateKey, formatDate, ksh } from "@/lib/currency";
import { formatMinor, majorFromMinor, parseMajorAmount } from "@/payments/money";
import { useAppContext } from "@/lib/app-context";
import { reportError } from "@/lib/user-facing-error";

export const Route = createFileRoute("/supplier-bills")({
  head: () => ({
    meta: [{ title: "Supplier Bills - Seramet" }],
  }),
  component: SupplierBills,
});

function SupplierBills() {
  const { branchId, branchLabel, currency } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const data = control.data.find((row) => row.branchId === branchId);
  const invoices = useMemo(
    () => data?.procurement.supplierInvoices ?? [],
    [data?.procurement.supplierInvoices],
  );
  const receipts = data?.procurement.receipts ?? [];

  const [entryOpen, setEntryOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const today = currentDateKey();
  const visibleCurrencies = Array.from(new Set(invoices.map((row) => row.currency)));
  const overdueBills = invoices.filter(
    (row) => row.due_date && row.due_date < today && !["PAID", "DISPUTED"].includes(row.status),
  );
  const overdueMinor = overdueBills.reduce((sum, row) => sum + Number(row.total_minor), 0);
  const visibleCurrency = visibleCurrencies[0] ?? currency;
  const exceptions = invoices.filter(
    (row) => row.match_status && row.match_status !== "MATCHED",
  ).length;
  const matched = invoices.filter((row) => row.match_status === "MATCHED").length;
  const matchedPercent = invoices.length ? Math.round((matched / invoices.length) * 100) : 0;

  const invoicedReceiptIds = useMemo(
    () => new Set(invoices.map((row) => row.goods_receipt_id).filter(Boolean)),
    [invoices],
  );
  const availableReceipts = receipts.filter(
    (receipt) =>
      receipt.status === "POSTED" &&
      Number(receipt.accepted_quantity_minor) > 0 &&
      !receipt.invoice_linked &&
      !invoicedReceiptIds.has(receipt.id),
  );

  const run = async (
    operation: () => Promise<unknown>,
    success: string | ((result: unknown) => string),
  ) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await operation();
      setNotice(typeof success === "function" ? success(result) : success);
      return true;
    } catch (error) {
      setNotice(reportError(error, "Couldn't save the supplier bill. Try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Supplier bills"
      subtitle={branchLabel}
      actions={
        <>
          <Link to="/receiving">
            <Btn>Receiving</Btn>
          </Link>
          <Btn disabled={!authoritative} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || busy || availableReceipts.length === 0}
            onClick={() => setEntryOpen(true)}
          >
            <FilePlus2 className="h-4 w-4" /> Enter supplier bill
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Recent bills" value={invoices.length} />
        <Metric
          label={visibleCurrencies.length > 1 ? "Overdue bills" : "Overdue value"}
          value={
            visibleCurrencies.length > 1
              ? overdueBills.length
              : formatMinor(overdueMinor, visibleCurrency)
          }
          invert={overdueBills.length > 0}
        />
        <Metric label="Match exceptions" value={exceptions} invert={exceptions > 0} />
        <Metric label="Matched bills" value={matchedPercent} suffix="%" />
      </div>

      {(!authoritative || notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {!authoritative
            ? "Supplier bills can be posted once this device is back online."
            : notice || control.error}
        </div>
      )}

      {authoritative && availableReceipts.length === 0 && receipts.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-secondary/30 px-3 py-2 text-[12px] text-muted-foreground">
          Every received delivery already has a bill. Refresh to check for new deliveries.
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead title="Bills" />
        {!invoices.length ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No supplier bills yet. Receive the delivery first, then enter its bill here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr>
                  <TH>Supplier</TH>
                  <TH>Invoice</TH>
                  <TH>Purchase order</TH>
                  <TH>Goods receipt</TH>
                  <TH>Invoice date</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Subtotal</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Match</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {invoices.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary/40">
                    <TD className="font-semibold">{row.supplier_name}</TD>
                    <TD className="num">{row.invoice_number}</TD>
                    <TD className="num text-muted-foreground">
                      {row.purchase_order_number ?? "—"}
                    </TD>
                    <TD className="num text-muted-foreground">{row.receipt_number ?? "—"}</TD>
                    <TD className="text-muted-foreground">{formatDate(row.invoice_date)}</TD>
                    <TD
                      className={
                        isOverdue(row.due_date, row.status, today)
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {row.due_date ? formatDate(row.due_date) : "Not set"}
                    </TD>
                    <TD className="num text-right">
                      {formatMinor(Number(row.subtotal_minor), row.currency)}
                    </TD>
                    <TD className="num text-right">
                      {formatMinor(Number(row.tax_minor), row.currency)}
                    </TD>
                    <TD className="num text-right font-semibold">
                      {formatMinor(Number(row.total_minor), row.currency)}
                    </TD>
                    <TD className="num text-right">
                      {row.variance_minor === null
                        ? "—"
                        : formatMinor(Number(row.variance_minor), row.currency)}
                    </TD>
                    <TD>
                      <Status>{displayStatus(row.match_status ?? "Pending")}</Status>
                    </TD>
                    <TD>
                      <Status>{displayStatus(row.status)}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <EnterSupplierBillDialog
        open={entryOpen}
        onOpenChange={setEntryOpen}
        data={data}
        receipts={availableReceipts}
        branchId={branchId}
        fallbackCurrency={currency}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/supplier-invoices", body),
            (result) => {
              const response = result as { supplierInvoice?: { matchStatus?: string } };
              const status = response.supplierInvoice?.matchStatus;
              return status === "MATCHED"
                ? "Bill posted. It matches the order and the delivery."
                : "Bill posted, but it doesn't match the order or delivery. Check it before paying.";
            },
          ).then((succeeded) => {
            if (succeeded) setEntryOpen(false);
          })
        }
      />
    </AppShell>
  );
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];
type ReceiptRow = BranchData["procurement"]["receipts"][number];

function EnterSupplierBillDialog({
  open,
  onOpenChange,
  data,
  receipts,
  branchId,
  fallbackCurrency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BranchData | undefined;
  receipts: ReceiptRow[];
  branchId: string;
  fallbackCurrency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [receiptId, setReceiptId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(currentDateKey());
  const [dueDate, setDueDate] = useState("");
  const [subtotal, setSubtotal] = useState("0");
  const [tax, setTax] = useState("0");

  const receipt = receipts.find((row) => row.id === receiptId) ?? receipts[0];
  const purchaseOrder = data?.procurement.purchaseOrders.find(
    (row) => row.id === receipt?.purchase_order_id,
  );
  const supplier = data?.procurement.suppliers.find((row) => row.id === receipt?.supplier_id);
  const invoiceCurrency = purchaseOrder?.currency || supplier?.currency || fallbackCurrency;

  useEffect(() => {
    if (!open || !receipt) return;
    setReceiptId((current) => current || receipt.id);
  }, [open, receipt]);

  useEffect(() => {
    if (!receipt) return;
    setSubtotal(String(majorFromMinor(Number(receipt.total_minor), invoiceCurrency)));
    setTax("0");
  }, [receipt?.id]);

  useEffect(() => {
    if (!invoiceDate || !supplier) return;
    const terms = Math.max(0, Number(supplier.payment_terms_days) || 0);
    setDueDate(addDays(invoiceDate, terms));
  }, [invoiceDate, supplier?.id, supplier?.payment_terms_days]);

  useEffect(() => {
    if (!open) {
      setInvoiceNumber("");
      setInvoiceDate(currentDateKey());
      setDueDate("");
      setSubtotal("0");
      setTax("0");
      setReceiptId("");
    }
  }, [open]);

  // Amounts are kept in the currency's minor units, so a currency without cents isn't scaled by 100.
  const subtotalMinor = nonNegativeMinor(subtotal, invoiceCurrency);
  const taxMinor = nonNegativeMinor(tax, invoiceCurrency);
  const totalMinor = subtotalMinor === null || taxMinor === null ? null : subtotalMinor + taxMinor;
  const valid =
    Boolean(receipt && purchaseOrder && supplier && invoiceNumber.trim()) &&
    Boolean(invoiceDate) &&
    subtotalMinor !== null &&
    taxMinor !== null &&
    totalMinor !== null &&
    (!dueDate || dueDate >= invoiceDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enter supplier bill</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Goods receipt">
            <select
              value={receipt?.id ?? ""}
              onChange={(event) => setReceiptId(event.target.value)}
              className={inputClass}
            >
              {receipts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.receipt_number} - {row.supplier_name} -{" "}
                  {formatMinor(
                    Number(row.total_minor),
                    data?.procurement.purchaseOrders.find(
                      (order) => order.id === row.purchase_order_id,
                    )?.currency || fallbackCurrency,
                  )}
                </option>
              ))}
            </select>
          </Field>
          <ReadOnlyField
            label="Purchase order"
            value={purchaseOrder?.purchase_order_number ?? "—"}
          />
          <ReadOnlyField label="Supplier" value={supplier?.name ?? receipt?.supplier_name ?? "—"} />
          <ReadOnlyField label="Currency" value={invoiceCurrency} />
          <Field label="Supplier invoice number">
            <input
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              className={inputClass}
              maxLength={120}
              placeholder="e.g. INV-2048"
            />
          </Field>
          <Field label="Invoice date">
            <input
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              min={invoiceDate}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <ReadOnlyField
            label="Receipt value"
            value={receipt ? formatMinor(Number(receipt.total_minor), invoiceCurrency) : "—"}
          />
          <Field label="Bill amount before tax">
            <input
              inputMode="decimal"
              value={subtotal}
              onChange={(event) => setSubtotal(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Tax on the bill">
            <input
              inputMode="decimal"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-3">
          <Evidence
            label="Order total"
            value={
              purchaseOrder ? formatMinor(Number(purchaseOrder.total_minor), invoiceCurrency) : "—"
            }
          />
          <Evidence
            label="Delivery received"
            value={receipt ? formatMinor(Number(receipt.total_minor), invoiceCurrency) : "—"}
          />
          <Evidence
            label="Bill total"
            value={
              totalMinor === null ? "Check the amounts" : formatMinor(totalMinor, invoiceCurrency)
            }
          />
        </div>

        {!receipts.length && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Every received delivery already has a bill. Receive the delivery before entering its
            bill.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                branchId,
                supplierId: supplier!.id,
                purchaseOrderId: purchaseOrder!.id,
                goodsReceiptId: receipt!.id,
                invoiceNumber: invoiceNumber.trim(),
                invoiceDate,
                ...(dueDate ? { dueDate } : {}),
                currency: invoiceCurrency,
                subtotalMinor: subtotalMinor!,
                taxMinor: taxMinor!,
                totalMinor: totalMinor!,
              })
            }
          >
            Post supplier bill
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      <div className="flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3">
        {value}
      </div>
    </div>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="num mt-1 text-[14px] font-bold">{value}</div>
    </div>
  );
}

function isOverdue(dueDate: string | null, status: string, today: string) {
  return Boolean(dueDate && dueDate < today && !["PAID", "DISPUTED"].includes(status));
}

function displayStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nonNegativeMinor(value: string, currency: string) {
  try {
    const minor = parseMajorAmount(value, currency);
    return minor >= 0 ? minor : null;
  } catch {
    return null;
  }
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year!, month! - 1, day!);
  value.setDate(value.getDate() + days);
  const nextYear = value.getFullYear();
  const nextMonth = String(value.getMonth() + 1).padStart(2, "0");
  const nextDay = String(value.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[12px] outline-none focus:border-primary";
