import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { formatDate, ksh } from "@/lib/currency";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders - Seramet" },
      {
        name: "description",
        content:
          "Authoritative purchase order register with approvals, receiving progress and supplier commitments.",
      },
    ],
  }),
  component: PurchaseOrders,
});

function PurchaseOrders() {
  const { branchId, branchLabel } = useAppContext();
  const control = useInventoryControlCentre(true);
  const data = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = data?.procurement.purchaseOrders ?? [];
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const metrics = useMemo(() => {
    const open = rows.filter((row) => !["RECEIVED", "CANCELLED"].includes(row.status));
    return {
      visible: rows.length,
      openMinor: open.reduce((sum, row) => sum + Number(row.total_minor), 0),
      pending: rows.filter((row) => ["DRAFT", "SUBMITTED", "PENDING_APPROVAL"].includes(row.status))
        .length,
      received: rows.filter((row) => row.status === "RECEIVED").length,
    };
  }, [rows]);

  const command = async (rowId: string, action: "approve" | "cancel") => {
    setBusyId(rowId);
    setNotice("");
    try {
      await control.command(
        `/api/seramet/procurement/purchase-orders/${encodeURIComponent(rowId)}/${action}`,
        action === "cancel"
          ? { reason: "Cancelled from purchase order register" }
          : { reason: "Approved from purchase order register" },
      );
      setNotice(action === "approve" ? "Purchase order approved for receiving." : "Purchase order cancelled.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Purchase order action failed");
    } finally {
      setBusyId("");
    }
  };

  return (
    <AppShell
      title="Purchase orders"
      subtitle={`Approval, receiving progress and supplier commitments - ${branchLabel}`}
      actions={
        <>
          <Btn disabled={control.status === "loading"} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Link to="/procurement">
            <Btn variant="primary">New purchase order</Btn>
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Visible POs" value={metrics.visible} />
        <Metric label="Open commitment" value={metrics.openMinor / 100} money />
        <Metric label="Pending approval" value={metrics.pending} invert={metrics.pending > 0} />
        <Metric label="Received" value={metrics.received} />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Purchase order register"
          sub="Server-authorized approvals and receipt progress from the procurement ledger"
        />
        {!rows.length ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No purchase orders exist for this branch.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr>
                  <TH>PO</TH>
                  <TH>Supplier</TH>
                  <TH>Created</TH>
                  <TH>Expected</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Received lines</TH>
                  <TH className="text-right">Progress</TH>
                  <TH>Status</TH>
                  <TH>Action</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((po) => {
                  const ordered = po.lines.reduce(
                    (sum, line) => sum + Number(line.ordered_quantity_minor),
                    0,
                  );
                  const received = po.lines.reduce(
                    (sum, line) => sum + Number(line.received_purchase_quantity_minor),
                    0,
                  );
                  const progress = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
                  return (
                    <tr key={po.id} className="hover:bg-secondary/50">
                      <TD className="num font-semibold">{po.purchase_order_number}</TD>
                      <TD>{po.supplier_name}</TD>
                      <TD className="text-muted-foreground">{formatDate(po.created_at)}</TD>
                      <TD className="text-muted-foreground">
                        {po.expected_at ? formatDate(po.expected_at) : "—"}
                      </TD>
                      <TD className="num text-right font-semibold">{ksh(Number(po.total_minor) / 100)}</TD>
                      <TD className="num text-right text-muted-foreground">
                        {po.lines.filter((line) => Number(line.received_purchase_quantity_minor) > 0).length}/
                        {po.lines.length}
                      </TD>
                      <TD className="num text-right">{progress}%</TD>
                      <TD><Status>{po.status}</Status></TD>
                      <TD>
                        <div className="flex gap-2">
                          {["DRAFT", "SUBMITTED"].includes(po.status) && (
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() => void command(po.id, "approve")}
                              className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          {["DRAFT", "SUBMITTED", "APPROVED"].includes(po.status) && (
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() => void command(po.id, "cancel")}
                              className="text-[12px] font-semibold text-destructive hover:underline disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                          {["APPROVED", "PARTIALLY_RECEIVED", "PARTIAL"].includes(po.status) && (
                            <Link to="/receiving" className="text-[12px] font-semibold text-success hover:underline">
                              Receive
                            </Link>
                          )}
                          {["RECEIVED", "CANCELLED"].includes(po.status) && (
                            <span className="text-[12px] text-muted-foreground">Complete</span>
                          )}
                        </div>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
