import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/supplier-bills")({
  head: () => ({ meta: [{ title: "Supplier Bills - Seramet" }] }),
  component: SupplierBills,
});

function SupplierBills() {
  const { branchId, branchLabel, currency } = useAppContext();
  const control = useInventoryControlCentre(true);
  const branch = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = branch?.procurement.supplierInvoices ?? [];
  const receipts = branch?.procurement.receipts ?? [];
  const orders = branch?.procurement.purchaseOrders ?? [];
  const suppliers = branch?.procurement.suppliers ?? [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const outstanding = rows.filter((row) => row.status !== "PAID").reduce((sum, row) => sum + Number(row.total_minor), 0);
  const overdue = rows.filter((row) => row.due_date && new Date(row.due_date) < new Date() && row.status !== "PAID").reduce((sum, row) => sum + Number(row.total_minor), 0);
  const matched = rows.length ? Math.round(rows.filter((row) => row.match_status === "MATCHED").length / rows.length * 100) : 0;

  return (
    <AppShell
      title="Supplier bills"
      subtitle={"Three-way matched supplier invoices - " + branchLabel}
      actions={<><Btn onClick={() => void control.refresh()}>Refresh</Btn><Btn variant="primary" onClick={() => setOpen(true)}>Enter bill</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Supplier payables" value={outstanding / 100} money />
        <Metric label="Overdue" value={overdue / 100} money invert />
        <Metric label="Bills" value={rows.length} />
        <Metric label="Matched bills" value={matched} suffix="%" />
      </div>
      {notice && <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{notice}</div>}
      <Panel className="mt-4 overflow-x-auto">
        <PanelHead title="Bill register" sub={control.error || "Posted bills create payables; they do not create cash or bank payments"} />
        {rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">No supplier bills posted for this branch.</div>
        ) : (
          <table className="w-full min-w-[980px]"><thead><tr><TH>Supplier</TH><TH>Invoice</TH><TH>PO</TH><TH>Receipt</TH><TH>Due</TH><TH className="text-right">Amount</TH><TH>Match</TH><TH>Status</TH></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}>
              <TD className="font-semibold">{row.supplier_name}</TD><TD className="num">{row.invoice_number}</TD>
              <TD className="num">{row.purchase_order_id ?? "—"}</TD><TD className="num">{row.goods_receipt_id ?? "—"}</TD>
              <TD>{row.due_date ?? "Not set"}</TD><TD className="num text-right font-semibold">{ksh(Number(row.total_minor) / 100)}</TD>
              <TD><Status>{row.match_status ?? "REVIEW"}</Status>{row.variance_minor ? <div className="num mt-1 text-[11px] text-muted-foreground">{ksh(Number(row.variance_minor) / 100)} variance</div> : null}</TD>
              <TD><Status>{row.status}</Status></TD>
            </tr>)}</tbody>
          </table>
        )}
      </Panel>
      <BillDialog open={open} onOpenChange={setOpen} branchId={branchId} currency={currency} receipts={receipts} orders={orders} suppliers={suppliers} busy={busy}
        onSubmit={async (body: unknown) => {
          setBusy(true); setNotice("");
          try { await control.command("/api/seramet/procurement/supplier-invoices", body); setOpen(false); setNotice("Supplier invoice posted and three-way match recalculated."); }
          catch (error) { setNotice(error instanceof Error ? error.message : "Could not post supplier bill"); }
          finally { setBusy(false); }
        }}
      />
    </AppShell>
  );
}

function BillDialog({ open, onOpenChange, branchId, currency, receipts, orders, suppliers, busy, onSubmit }: any) {
  const [receiptId, setReceiptId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("0");
  const [due, setDue] = useState("");
  const receipt = receipts.find((row: any) => row.id === receiptId);
  const po = orders.find((row: any) => row.id === receipt?.purchase_order_id);
  const supplier = suppliers.find((row: any) => row.id === receipt?.supplier_id);
  const totalMinor = Math.round(Number(amount || 0) * 100);
  const taxMinor = Math.round(Number(tax || 0) * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>Enter supplier bill</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <label className="text-[12px] font-semibold">Goods receipt
          <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2" value={receiptId} onChange={(event) => {
            setReceiptId(event.target.value);
            const selected = receipts.find((row: any) => row.id === event.target.value);
            if (selected) setAmount((Number(selected.total_minor) / 100).toFixed(2));
          }}>
            <option value="">Select receipt</option>
            {receipts.map((row: any) => <option key={row.id} value={row.id}>{row.receipt_number} - {ksh(Number(row.total_minor) / 100)}</option>)}
          </select>
        </label>
        <div className="text-[12px] text-muted-foreground">{supplier?.name ?? "Supplier"}{po ? " • " + po.purchase_order_number : ""}</div>
        <label className="text-[12px] font-semibold">Supplier invoice number<input className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2" value={invoice} onChange={(event) => setInvoice(event.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-semibold">Total ({currency})<input type="number" min="0" step="0.01" className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="text-[12px] font-semibold">Tax ({currency})<input type="number" min="0" step="0.01" className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2" value={tax} onChange={(event) => setTax(event.target.value)} /></label>
        </div>
        <label className="text-[12px] font-semibold">Due date<input type="date" className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2" value={due} onChange={(event) => setDue(event.target.value)} /></label>
        <Btn variant="primary" disabled={busy || !receipt || !po || !invoice.trim() || totalMinor <= 0 || taxMinor > totalMinor}
          onClick={() => void onSubmit({
            branchId, supplierId: receipt.supplier_id, purchaseOrderId: receipt.purchase_order_id, goodsReceiptId: receipt.id,
            invoiceNumber: invoice.trim(), invoiceDate: new Date().toISOString().slice(0, 10), ...(due ? { dueDate: due } : {}),
            currency: po.currency || currency, subtotalMinor: totalMinor - taxMinor, taxMinor, totalMinor,
          })}>
          Post supplier bill
        </Btn>
      </div>
    </DialogContent></Dialog>
  );
}
