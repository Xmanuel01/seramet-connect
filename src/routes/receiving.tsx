import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/receiving")({
  head: () => ({ meta: [{ title: "Receiving - Seramet" }] }),
  component: Receiving,
});

function Receiving() {
  const { branchId, branchLabel } = useAppContext();
  const control=useInventoryControlCentre(true);
  const branch=control.data.find((r)=>r.branchId===branchId)??control.data[0];
  const available=useMemo(()=> (branch?.procurement.purchaseOrders??[]).filter((po)=>["APPROVED","PARTIALLY_RECEIVED"].includes(po.status)),[branch]);
  const [selectedId,setSelectedId]=useState(""); const [qty,setQty]=useState<Record<string,number>>({});
  const [busy,setBusy]=useState(false); const [notice,setNotice]=useState("");
  useEffect(()=>{if(!available.some((po)=>po.id===selectedId))setSelectedId(available[0]?.id??"");},[available,selectedId]);
  const po=available.find((p)=>p.id===selectedId)??available[0];
  useEffect(()=>{if(!po){setQty({});return;} setQty(Object.fromEntries(po.lines.map((l)=>[l.id,Math.max(0,(Number(l.ordered_quantity_minor)-Number(l.received_purchase_quantity_minor))/1_000_000)])));},[po]);
  const worksheet=(po?.lines??[]).map((line)=>{
    const remaining=Math.max(0,(Number(line.ordered_quantity_minor)-Number(line.received_purchase_quantity_minor))/1_000_000);
    const receive=Math.max(0,Number(qty[line.id]??0));
    return {...line,remaining,receive,value:Math.round(receive*Number(line.unit_price_minor))};
  });
  const expected=worksheet.reduce((s,l)=>s+l.remaining*Number(l.unit_price_minor),0);
  const received=worksheet.reduce((s,l)=>s+l.value,0);
  async function post(){
    if(!po)return;
    const lines=worksheet.filter((l)=>l.receive>0).map((l)=>({
      purchaseOrderLineId:l.id,
      receivedPurchaseQuantityMicro:Math.round(l.receive*1_000_000),
      acceptedPurchaseQuantityMicro:Math.round(l.receive*1_000_000),
      rejectedPurchaseQuantityMicro:0,
      unitPriceMinor:Number(l.unit_price_minor),
      qualityStatus:"ACCEPTED",
    }));
    if(lines.length===0){setNotice("Enter at least one received quantity.");return;}
    setBusy(true);setNotice("");
    try{
      await control.command("/api/seramet/procurement/goods-receipts",{
        branchId,warehouseId:po.warehouse_id,purchaseOrderId:po.id,supplierId:po.supplier_id,
        idempotencyKey:`receipt:${po.id}:${crypto.randomUUID()}`,lines
      });
      setNotice("Goods receipt posted. Accepted quantities, inventory value and PO progress were updated atomically.");
    }catch(e){setNotice(e instanceof Error?e.message:"Receipt failed");}finally{setBusy(false);}
  }
  return <AppShell title="Receiving" subtitle={po?`${po.purchase_order_number} - ${po.supplier_name} - ${branchLabel}`:`No approved purchase order awaiting receipt - ${branchLabel}`}
    actions={<>{available.length>1&&<select value={po?.id??""} onChange={(e)=>setSelectedId(e.target.value)} className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold">{available.map((x)=><option key={x.id} value={x.id}>{x.purchase_order_number} - {x.supplier_name}</option>)}</select>}<Btn onClick={()=>void control.refresh()}>Refresh</Btn><Btn variant="primary" disabled={!po||busy} onClick={()=>void post()}>Post receipt</Btn></>}>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Expected value" value={Math.round(expected)/100} money/><Metric label="Receive now" value={Math.round(received)/100} money/><Metric label="Open POs" value={available.length}/><Metric label="Lines checked" value={worksheet.length}/></div>
    {notice&&<div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{notice}</div>}
    <Panel className="mt-4 overflow-x-auto"><PanelHead title="Receiving worksheet" sub={control.error||"Partial receipt, over-receipt policy and idempotency are enforced by the server"} right={<Status>{po?.status?.replaceAll("_"," ")??"WAITING"}</Status>}/>
      {!po?<div className="p-8 text-center text-[13px] text-muted-foreground">Approve a purchase order first.</div>:
      <table className="w-full min-w-[820px]"><thead><tr><TH>Item</TH><TH className="text-right">Ordered</TH><TH className="text-right">Previously received</TH><TH className="text-right">Remaining</TH><TH className="text-right">Receive now</TH><TH className="text-right">Value</TH></tr></thead>
      <tbody>{worksheet.map((l)=><tr key={l.id}><TD className="font-semibold">{l.item_name}</TD>
      <TD className="num text-right">{(Number(l.ordered_quantity_minor)/1_000_000).toFixed(3)} {l.unit_symbol??""}</TD>
      <TD className="num text-right">{(Number(l.received_purchase_quantity_minor)/1_000_000).toFixed(3)}</TD>
      <TD className="num text-right">{l.remaining.toFixed(3)}</TD><TD className="text-right"><input type="number" min="0" step="0.001" value={qty[l.id]??0} onChange={(e)=>setQty((q)=>({...q,[l.id]:Number(e.target.value)}))} className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right"/></TD>
      <TD className="num text-right font-semibold">{ksh(l.value/100)}</TD></tr>)}</tbody></table>}
    </Panel>
  </AppShell>;
}
