import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({ meta: [{ title: "Purchase Orders - Seramet" }] }),
  component: PurchaseOrders,
});

function PurchaseOrders() {
  const navigate = useNavigate();
  const { branchId, branchLabel } = useAppContext();
  const control = useInventoryControlCentre(true);
  const branch = control.data.find((row)=>row.branchId===branchId) ?? control.data[0];
  const rows = branch?.procurement.purchaseOrders ?? [];
  const [busy,setBusy]=useState(""); const [notice,setNotice]=useState("");
  const openValue=rows.filter((r)=>!["RECEIVED","CANCELLED"].includes(r.status)).reduce((s,r)=>s+Number(r.total_minor),0);
  async function action(id:string, action:"approve"|"cancel") {
    setBusy(id); setNotice("");
    try {
      await control.command(`/api/seramet/procurement/purchase-orders/${encodeURIComponent(id)}/${action}`, {reason: action==="approve"?"Approved from PO register":"Cancelled from PO register"});
      setNotice(action==="approve" ? "Purchase order approved for receiving." : "Purchase order cancelled.");
    } catch(e){ setNotice(e instanceof Error?e.message:"Purchase order action failed"); } finally {setBusy("");}
  }
  return <AppShell title="Purchase orders" subtitle={`Authoritative approvals, receipt progress and supplier commitments - ${branchLabel}`}
    actions={<><Btn onClick={()=>void control.refresh()}>Refresh</Btn><Btn variant="primary" onClick={()=>void navigate({to:"/procurement"})}>New purchase order</Btn></>}>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Metric label="Visible POs" value={rows.length}/><Metric label="Open value" value={openValue/100} money invert/>
      <Metric label="Pending approval" value={rows.filter((r)=>r.status==="SUBMITTED").length} invert/>
      <Metric label="Received" value={rows.filter((r)=>r.status==="RECEIVED").length}/>
    </div>
    {notice&&<div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{notice}</div>}
    <Panel className="mt-4 overflow-x-auto"><PanelHead title="Purchase order register" sub={control.error||"Every row is loaded from the server procurement ledger"}/>
      {rows.length===0?<div className="p-8 text-center text-[13px] text-muted-foreground">No purchase orders for this branch.</div>:
      <table className="w-full min-w-[980px]"><thead><tr><TH>PO</TH><TH>Supplier</TH><TH>Expected</TH><TH className="text-right">Amount</TH><TH className="text-right">Received lines</TH><TH>Status</TH><TH>Action</TH></tr></thead>
      <tbody>{rows.map((r)=>{const complete=r.lines.filter((l)=>Number(l.received_purchase_quantity_minor)>=Number(l.ordered_quantity_minor)).length;
        return <tr key={r.id}><TD className="num font-semibold">{r.purchase_order_number}</TD><TD>{r.supplier_name}</TD>
        <TD>{r.expected_at?new Date(r.expected_at).toLocaleDateString():"Not set"}</TD><TD className="num text-right">{ksh(Number(r.total_minor)/100)}</TD>
        <TD className="num text-right">{complete}/{r.lines.length}</TD><TD><Status>{r.status.replaceAll("_"," ")}</Status></TD>
        <TD>{r.status==="SUBMITTED"?<div className="flex gap-2"><Btn disabled={busy===r.id} variant="primary" onClick={()=>void action(r.id,"approve")}>Approve</Btn><Btn disabled={busy===r.id} onClick={()=>void action(r.id,"cancel")}>Cancel</Btn></div>:
        ["APPROVED","PARTIALLY_RECEIVED"].includes(r.status)?<Btn onClick={()=>void navigate({to:"/receiving"})}>Receive</Btn>:<span className="text-[12px] text-muted-foreground">Complete</span>}</TD></tr>})}</tbody></table>}
    </Panel>
  </AppShell>;
}
