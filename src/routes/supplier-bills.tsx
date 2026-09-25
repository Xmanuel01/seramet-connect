import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementSupplierInvoiceRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { formatDate, ksh } from "@/lib/currency";

export const Route = createFileRoute("/supplier-bills")({
  head: () => ({
    meta: [
      { title: "Supplier Bills - Seramet" },
      {
        name: "description",
        content: "Authoritative supplier invoice register with PO, receipt and three-way match evidence.",
      },
    ],
  }),
  component: SupplierBills,
});

function SupplierBills() {
  const { branchId, branchLabel, currency } = useAppContext();
  const control = useInventoryControlCentre(true);
  const data = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = data?.procurement.supplierInvoices ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const metrics = useMemo(() => {
    const open = rows.filter((row) => !["PAID"].includes(row.status));
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date();
    week.setUTCDate(week.getUTCDate() + 7);
    const weekEnd = week.toISOString().slice(0, 10);
    return {
      payableMinor: open.reduce((sum, row) => sum + Number(row.total_minor), 0),
      overdueMinor: open
        .filter((row) => row.due_date && row.due_date < today)
        .reduce((sum, row) => sum + Number(row.total_minor), 0),
      dueWeekMinor: open
        .filter((row) => row.due_date && row.due_date >= today && row.due_date <= weekEnd)
        .reduce((sum, row) => sum + Number(row.total_minor), 0),
      matchedPct: rows.length
        ? Math.round(
            (rows.filter((row) => row.match_status === "MATCHED").length / rows.length) * 100,
          )
        : 0,
    };
  }, [rows]);

  const submit = async (body: unknown) => {
    setBusy(true);
    setNotice("");
    try {
      await control.command("/api/seramet/procurement/supplier-invoices", body);
      setNotice("Supplier bill posted to the authoritative procurement ledger.");
      setCreateOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Supplier bill could not be posted");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Supplier bills"
      subtitle={`PO, receipt and invoice matching - ${branchLabel}`}
      actions={
        <>
          <Btn disabled={control.status === "loading"} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!data || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> Enter bill
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open invoice value" value={metrics.payableMinor / 100} money />
        <Metric label="Overdue value" value={metrics.overdueMinor / 100} money invert />
        <Metric label="Due next 7 days" value={metrics.dueWeekMinor / 100} money />
        <Metric label="Three-way matched" value={metrics.matchedPct} suffix="%" />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Supplier invoice register"
          sub="Amounts remain invoice values here; cash settlement belongs to Accounts Payable."
        />
        {!rows.length ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No supplier invoices have been posted for this branch.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr>
                  <TH>Supplier</TH>
                  <TH>Invoice</TH>
                  <TH>PO</TH>
                  <TH>Invoice date</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Subtotal</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Match</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <BillRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <NewBillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        data={data}
        branchId={branchId}
        tenantCurrency={currency}
        busy={busy}
        onSubmit={submit}
      />
    </AppShell>
  );
}

function BillRow({ row }: { row: ProcurementSupplierInvoiceRow }) {
  return (
    <tr className="hover:bg-secondary/50">
      <TD className="font-semibold">{row.supplier_name}</TD>
      <TD className="num font-semibold">{row.invoice_number}</TD>
      <TD className="num text-muted-foreground">{row.purchase_order_number ?? "—"}</TD>
      <TD>{formatDate(row.invoice_date)}</TD>
      <TD>{row.due_date ? formatDate(row.due_date) : "—"}</TD>
      <TD className="num text-right">{ksh(Number(row.subtotal_minor) / 100)}</TD>
      <TD className="num text-right">{ksh(Number(row.tax_minor) / 100)}</TD>
      <TD className="num text-right font-semibold">{ksh(Number(row.total_minor) / 100)}</TD>
      <TD>
        <Status>{row.match_status ?? "PENDING MATCH"}</Status>
      </TD>
      <TD>
        <Status>{row.status}</Status>
      </TD>
    </tr>
  );
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];

function NewBillDialog({
  open,
  onOpenChange,
  data,
  branchId,
  tenantCurrency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BranchData | undefined;
  branchId: string;
  tenantCurrency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [tax, setTax] = useState("0");

  const supplier = data?.procurement.suppliers.find((row) => row.id === supplierId)
    ?? data?.procurement.suppliers[0];
  const purchaseOrders =
    data?.procurement.purchaseOrders.filter((row) => !supplier || row.supplier_id === supplier.id) ?? [];
  const po = purchaseOrders.find((row) => row.id === poId) ?? purchaseOrders[0];
  const receipts =
    data?.procurement.receipts.filter(
      (row) => (!po || row.purchase_order_id === po.id) && (!supplier || row.supplier_id === supplier.id),
    ) ?? [];
  const receipt = receipts.find((row) => row.id === receiptId) ?? receipts[0];
  const subtotalMinor = Math.round(Number(subtotal) * 100);
  const taxMinor = Math.round(Number(tax) * 100);
  const totalMinor = subtotalMinor + taxMinor;
  const valid = Boolean(
    supplier &&
      po &&
      receipt &&
      invoiceNumber.trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) &&
      Number.isSafeInteger(subtotalMinor) &&
      subtotalMinor >= 0 &&
      Number.isSafeInteger(taxMinor) &&
      taxMinor >= 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enter supplier bill</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select
              className={inputClass}
              value={supplier?.id ?? ""}
              onChange={(event) => {
                setSupplierId(event.target.value);
                setPoId("");
                setReceiptId("");
              }}
            >
              {data?.procurement.suppliers.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Purchase order">
            <select
              className={inputClass}
              value={po?.id ?? ""}
              onChange={(event) => {
                setPoId(event.target.value);
                setReceiptId("");
              }}
            >
              {purchaseOrders.map((row) => (
                <option key={row.id} value={row.id}>{row.purchase_order_number}</option>
              ))}
            </select>
          </Field>
          <Field label="Goods receipt">
            <select
              className={inputClass}
              value={receipt?.id ?? ""}
              onChange={(event) => setReceiptId(event.target.value)}
            >
              {receipts.map((row) => (
                <option key={row.id} value={row.id}>{row.receipt_number}</option>
              ))}
            </select>
          </Field>
          <Field label="Invoice number">
            <input
              className={inputClass}
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="Invoice date">
            <input
              className={inputClass}
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </Field>
          <Field label="Due date">
            <input
              className={inputClass}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Field label="Subtotal">
            <input
              className={inputClass}
              inputMode="decimal"
              value={subtotal}
              onChange={(event) => setSubtotal(event.target.value)}
              placeholder={po ? String((Number(po.total_minor) / 100).toFixed(2)) : "0.00"}
            />
          </Field>
          <Field label="Tax">
            <input
              className={inputClass}
              inputMode="decimal"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
            />
          </Field>
        </div>
        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          Invoice total: <span className="num font-semibold text-foreground">{ksh(totalMinor / 100)}</span>.
          Posting creates the supplier payable and three-way match evidence; it does not record a cash payment.
        </div>
        {!receipts.length && (
          <div className="text-[12px] text-warning">
            A posted goods receipt is required before this supplier bill can be matched.
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
                supplierId: supplier.id,
                purchaseOrderId: po.id,
                goodsReceiptId: receipt.id,
                invoiceNumber: invoiceNumber.trim(),
                invoiceDate,
                ...(dueDate ? { dueDate } : {}),
                currency: supplier.currency || tenantCurrency,
                subtotalMinor,
                taxMinor,
                totalMinor,
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

const inputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
