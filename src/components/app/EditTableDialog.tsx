import { useState, type FormEvent } from "react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { permissions } from "@/platform/permissions";
import { Btn } from "@/components/app/ui";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Area = {id:string;name:string};
type Table = {id:string;code:string;seats:number;serviceAreaId:string|null};

export function EditTableDialog({table,areas,onSaved}:{
  table:Table;
  areas:Area[];
  onSaved:(areaName:string|null)=>void;
}) {
  const {hasPermission,refreshAccess}=useAppContext();
  const [open,setOpen]=useState(false);
  const [seats,setSeats]=useState(String(table.seats));
  const [areaId,setAreaId]=useState(table.serviceAreaId ?? "");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  if (!hasPermission(permissions.tableManage)) return null;

  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    setError("");
    try {
      const response=await authenticatedFetch(
        `/api/seramet/tables/configuration/${encodeURIComponent(table.id)}`,
        {method:"PATCH",headers:{"content-type":"application/json"},
          body:JSON.stringify({seats:Number(seats),serviceAreaId:areaId||null})},
      );
      const body=(await response.json().catch(()=>({}))) as {
        table?:{code:string};message?:string;
      };
      if(!response.ok||!body.table)
        throw new Error(body.message??`Unable to update table (${response.status})`);
      await refreshAccess();
      onSaved(areas.find((a)=>a.id===areaId)?.name??null);
      setOpen(false);
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Unable to update table");
    }finally{
      setBusy(false);
    }
  };
  return <>
    <Btn onClick={()=>{
      setSeats(String(table.seats));
      setAreaId(table.serviceAreaId??"");
      setError("");
      setOpen(true);
    }}>Edit table</Btn>
    <Dialog open={open} onOpenChange={(next)=>!busy&&setOpen(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit table {table.code}</DialogTitle>
          <DialogDescription>Change capacity or dining area. Table numbers remain stable for existing orders.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event)=>void submit(event)} className="space-y-4">
          <label className="block space-y-1 text-[13px] font-semibold">
            <span>Seats</span>
            <input type="number" min={1} max={30} step={1} required value={seats}
              onChange={(event)=>setSeats(event.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3" />
          </label>
          <label className="block space-y-1 text-[13px] font-semibold">
            <span>Dining area</span>
            <select value={areaId} onChange={(event)=>setAreaId(event.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3">
              <option value="">Unassigned</option>
              {areas.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {error&&<p className="text-[12px] text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Btn type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={busy||!seats||Number(seats)<1||Number(seats)>30}>
              {busy?"Saving...":"Save table"}
            </Btn>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
