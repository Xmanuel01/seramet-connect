import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementBranchPayload,
  type ProcurementSupplierInvoiceRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { formatDate, ksh } from "@/lib/currency";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/supplier-bills")({
  head: () => ({
    meta: [
      { title: "Supplier Bills - Seramet" },
      {
        name: "description",
        content: "Authoritative supplier invoices with PO, receipt and three-way-match evidence.",
      },
    ],
  }),
  component: SupplierBills,
});

type DisplayBill = ProcurementSupplierInvoiceRow & { branchId: string };

function SupplierBills() {
  const { branchId, branchLabel, currentUser, currency, isAllBranches } = useAppContext();
  const control = useProcurementControlCentre(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const bills = useMemo<DisplayBill[]>(
    () =>
      control.data.flatMap((branch) =>
        branch.supplierInvoices.map((bill) => ({ ...bill, branchId: branch.branchId })),
      ),
    [control.data],
  );
  const branchData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const openBills = bills.filter((bill) => bill.status !== "PAID");
  const openFaceValueMinor = openBills.reduce((sum, bill) => sum + Number(bill.total_minor), 0);
  const today = new Date().toLocaleDateString("en-CA");
  const overdueMinor = openBills
    .filter((bill) => bill.due_date && bill.due_date < today)
    .reduce((sum, bill) => sum + Number(bill.total_minor), 0);
  const matchExceptions = bills.filter(
    (bill) => bill.match_status && bill.match_status !== "MATCHED",
  ).length;
  const matched = bills.filter((bill) => bill.match_status === "MATCHED").length;
  const matchedRate = bills.length ? Math.round((matched / bills.length) * 100) : 0;
  const canEnterBill = currentUser.permissions.includes(permissions.procurementInvoiceApprove);

  return (
    <AppShell
      title="Supplier bills"
      subtitle={`PO, goods receipt and supplier invoice matching - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!canEnterBill || isAllBranches || control.status !== "ready"}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> Enter bill
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open bill face value" value={openFaceValueMinor / 100} money />
        <Metric
          label="Overdue face value"
          value={overdueMinor / 100}
          money
          invert={overdueMinor > 0}
        />
        <Metric label="Match exceptions" value={matchExceptions} invert={matchExceptions > 0} />
        <Metric label="Three-way matched" value={matchedRate} suffix="%" />
      </div>

      {(notice || control.error || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            control.error ||
            "Switch to a single branch before posting a supplier bill. Multi-branch view remains read-only."}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Supplier invoice register"
          sub="Each bill is linked to its purchase order, goods receipt, match result and accounting journal"
        />
        {control.status === "loading" ? (
          <div className="p-6 text-[13px] text-muted-foreground">Loading supplier bills...</div>
        ) : bills.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No supplier bills have been posted in the selected branch scope.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead>
                <tr>
                  <TH>Supplier</TH>
                  <TH>Invoice</TH>
                  <TH>PO</TH>
                  <TH>Receipt</TH>
                  <TH>Invoice date</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Subtotal</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Match variance</TH>
                  <TH>Match</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={`${bill.branchId}:${bill.id}`} className="hover:bg-secondary/50">
                    <TD>
                      <div className="font-semibold">{bill.supplier_name}</div>
                      {isAllBranches && (
                        <div className="text-[11px] text-muted-foreground">{bill.branchId}</div>
                      )}
                    </TD>
                    <TD className="num">{bill.invoice_number}</TD>
                    <TD className="num text-muted-foreground">{bill.purchase_order_number}</TD>
                    <TD className="num text-muted-foreground">{bill.receipt_number}</TD>
                    <TD className="text-muted-foreground">{formatDate(bill.invoice_date)}</TD>
                    <TD className="text-muted-foreground">
                      {bill.due_date ? formatDate(bill.due_date) : "Not set"}
                    </TD>
                    <TD className="num text-right">{ksh(Number(bill.subtotal_minor) / 100)}</TD>
                    <TD className="num text-right">{ksh(Number(bill.tax_minor) / 100)}</TD>
                    <TD className="num text-right font-semibold">
                      {ksh(Number(bill.total_minor) / 100)}
                    </TD>
                    <TD className="num text-right">
                      {bill.variance_minor === null ? "-" : ksh(Number(bill.variance_minor) / 100)}
                    </TD>
                    <TD>
                      <Status>{bill.match_status ?? "REVIEW_REQUIRED"}</Status>
                    </TD>
                    <TD>
                      <Status>{bill.status}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <EnterSupplierBillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        data={branchData}
        branchId={branchId}
        fallbackCurrency={currency}
        busy={busy}
        onSubmit={async (body) => {
          setBusy(true);
          setNotice("");
          try {
            const result = await control.command<{
              supplierInvoice?: { matchStatus?: string; duplicate?: boolean };
            }>("/api/seramet/procurement/supplier-invoices", body);
            const matchStatus = result.supplierInvoice?.matchStatus ?? "recorded";
            setNotice(
              result.supplierInvoice?.duplicate
                ? `This supplier invoice was already posted; existing record returned (${matchStatus}).`
                : `Supplier bill posted. Three-way match: ${matchStatus}.`,
            );
            setCreateOpen(false);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Supplier bill could not be posted");
          } finally {
            setBusy(false);
          }
        }}
      />
    </AppShell>
  );
}

function EnterSupplierBillDialog({
  open,
  onOpenChange,
  data,
  branchId,
  fallbackCurrency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ProcurementBranchPayload | undefined;
  branchId: string;
  fallbackCurrency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [receiptId, setReceiptId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [dueDate, setDueDate] = useState("");
  const [subtotal, setSubtotal] = useState("0");
  const [tax, setTax] = useState("0");

  const receipt = data?.receipts.find((row) => row.id === receiptId) ?? data?.receipts[0];
  const po = data?.purchaseOrders.find((row) => row.id === receipt?.purchase_order_id);
  const supplier = data?.suppliers.find((row) => row.id === receipt?.supplier_id);
  const subtotalMinor = Math.max(0, Math.round(Number(subtotal || 0) * 100));
  const taxMinor = Math.max(0, Math.round(Number(tax || 0) * 100));
  const totalMinor = subtotalMinor + taxMinor;
  const selectedCurrency = po?.currency || supplier?.currency || fallbackCurrency;
  const valid = Boolean(
    receipt &&
    po &&
    supplier &&
    invoiceNumber.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) &&
    totalMinor >= 0,
  );

  const chooseReceipt = (id: string) => {
    setReceiptId(id);
    const selected = data?.receipts.find((row) => row.id === id);
    if (selected) {
      setSubtotal(String(Number(selected.total_minor) / 100));
      setTax("0");
      const linkedSupplier = data?.suppliers.find((row) => row.id === selected.supplier_id);
      if (linkedSupplier?.payment_terms_days && invoiceDate) {
        const date = new Date(`${invoiceDate}T12:00:00`);
        date.setDate(date.getDate() + Number(linkedSupplier.payment_terms_days));
        setDueDate(date.toLocaleDateString("en-CA"));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enter supplier bill</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Goods receipt">
            <select
              value={receipt?.id ?? ""}
              onChange={(event) => chooseReceipt(event.target.value)}
              className={inputClass}
            >
              {data?.receipts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.receipt_number} - {row.supplier_name} - {ksh(Number(row.total_minor) / 100)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invoice number">
            <input
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Purchase order">
            <input value={po?.purchase_order_number ?? ""} readOnly className={inputClass} />
          </Field>
          <Field label="Supplier">
            <input value={supplier?.name ?? ""} readOnly className={inputClass} />
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
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={`Subtotal (${selectedCurrency})`}>
            <input
              inputMode="decimal"
              value={subtotal}
              onChange={(event) => setSubtotal(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={`Tax (${selectedCurrency})`}>
            <input
              inputMode="decimal"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12px]">
          Total: <span className="num font-semibold">{ksh(totalMinor / 100)}</span>. Posting creates
          the supplier payable and three-way match; it does not mark the supplier as paid.
        </div>

        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                branchId,
                supplierId: receipt!.supplier_id,
                purchaseOrderId: receipt!.purchase_order_id,
                goodsReceiptId: receipt!.id,
                invoiceNumber: invoiceNumber.trim(),
                invoiceDate,
                ...(dueDate ? { dueDate } : {}),
                currency: selectedCurrency,
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
  "h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
