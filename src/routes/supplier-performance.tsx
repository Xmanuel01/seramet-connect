import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  type ProcurementSupplierRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/supplier-performance")({
  head: () => ({
    meta: [
      { title: "Supplier Performance - Seramet" },
      {
        name: "description",
        content: "Supplier purchase, receipt, timeliness and invoice-match evidence.",
      },
    ],
  }),
  component: SupplierPerformance,
});

type SupplierEvidence = ProcurementSupplierRow & {
  receiptCount: number;
  matchExceptions: number;
  matchedInvoices: number;
  invoiceCount: number;
};

function SupplierPerformance() {
  const { branchLabel } = useAppContext();
  const control = useProcurementControlCentre(true);

  const suppliers = useMemo<SupplierEvidence[]>(() => {
    const byId = new Map<string, SupplierEvidence>();
    for (const branch of control.data) {
      for (const supplier of branch.suppliers) {
        const existing = byId.get(supplier.id);
        if (!existing) {
          byId.set(supplier.id, {
            ...supplier,
            receiptCount: 0,
            matchExceptions: 0,
            matchedInvoices: 0,
            invoiceCount: 0,
          });
        } else {
          existing.order_count += Number(supplier.order_count);
          existing.ordered_minor += Number(supplier.ordered_minor);
          existing.outstanding_minor += Number(supplier.outstanding_minor);
          existing.on_time_count += Number(supplier.on_time_count);
          existing.received_count += Number(supplier.received_count);
        }
      }
      for (const receipt of branch.receipts) {
        const supplier = byId.get(receipt.supplier_id);
        if (supplier) supplier.receiptCount += 1;
      }
      for (const invoice of branch.supplierInvoices) {
        const supplier = byId.get(invoice.supplier_id);
        if (!supplier) continue;
        supplier.invoiceCount += 1;
        if (invoice.match_status === "MATCHED") supplier.matchedInvoices += 1;
        else if (invoice.match_status) supplier.matchExceptions += 1;
      }
    }
    return [...byId.values()].sort(
      (a, b) => Number(b.ordered_minor) - Number(a.ordered_minor) || a.name.localeCompare(b.name),
    );
  }, [control.data]);

  const orderedMinor = suppliers.reduce((sum, row) => sum + Number(row.ordered_minor), 0);
  const outstandingMinor = suppliers.reduce((sum, row) => sum + Number(row.outstanding_minor), 0);
  const matchExceptions = suppliers.reduce((sum, row) => sum + row.matchExceptions, 0);
  const received = suppliers.reduce((sum, row) => sum + Number(row.received_count), 0);
  const onTime = suppliers.reduce((sum, row) => sum + Number(row.on_time_count), 0);
  const overallOnTime = received ? Math.round((onTime / received) * 100) : 0;

  return (
    <AppShell
      title="Supplier performance"
      subtitle={`Purchase, receipt and three-way-match evidence - ${branchLabel}`}
      actions={
        <Btn onClick={() => void control.refresh()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Suppliers" value={suppliers.length} />
        <Metric label="Purchase value" value={orderedMinor / 100} money />
        <Metric label="Open commitments" value={outstandingMinor / 100} money />
        <Metric label="On-time receipts" value={overallOnTime} suffix="%" />
        <Metric label="Match exceptions" value={matchExceptions} invert={matchExceptions > 0} />
      </div>

      {control.error && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {control.error}
        </div>
      )}

      <Panel className="mt-4 overflow-x-auto">
        <PanelHead
          title="Supplier evidence"
          sub="Operational evidence only; Seramet does not auto-replace or blacklist suppliers"
        />
        {control.status === "loading" ? (
          <div className="p-6 text-[13px] text-muted-foreground">Loading supplier evidence...</div>
        ) : suppliers.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Supplier performance will appear after purchasing and receiving activity exists.
          </div>
        ) : (
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr>
                <TH>Supplier</TH>
                <TH className="text-right">Orders</TH>
                <TH className="text-right">Purchases</TH>
                <TH className="text-right">Open</TH>
                <TH className="text-right">Receipts</TH>
                <TH className="text-right">On time</TH>
                <TH className="text-right">Configured lead</TH>
                <TH className="text-right">Invoices</TH>
                <TH className="text-right">Match exceptions</TH>
                <TH>Match quality</TH>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((row) => {
                const receivedCount = Number(row.received_count);
                const onTimeRate = receivedCount
                  ? Math.round((Number(row.on_time_count) / receivedCount) * 100)
                  : null;
                const matchRate = row.invoiceCount
                  ? Math.round((row.matchedInvoices / row.invoiceCount) * 100)
                  : null;
                return (
                  <tr key={row.id}>
                    <TD>
                      <div className="font-semibold">{row.name}</div>
                      <div className="num text-[11px] text-muted-foreground">{row.code}</div>
                    </TD>
                    <TD className="num text-right">{row.order_count}</TD>
                    <TD className="num text-right">{ksh(Number(row.ordered_minor) / 100)}</TD>
                    <TD className="num text-right">{ksh(Number(row.outstanding_minor) / 100)}</TD>
                    <TD className="num text-right">{row.receiptCount}</TD>
                    <TD className="num text-right">
                      {onTimeRate === null ? "No evidence" : `${onTimeRate}%`}
                    </TD>
                    <TD className="num text-right">{row.lead_time_days ?? 0} days</TD>
                    <TD className="num text-right">{row.invoiceCount}</TD>
                    <TD className="num text-right">{row.matchExceptions}</TD>
                    <TD>
                      <Status>
                        {matchRate === null
                          ? "NO INVOICE EVIDENCE"
                          : row.matchExceptions === 0
                            ? "MATCHED"
                            : `${matchRate}% MATCHED`}
                      </Status>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </AppShell>
  );
}
