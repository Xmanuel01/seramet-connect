import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapPin, RefreshCcw, Clock3, ShieldCheck, LocateFixed, Download } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/attendance")({
  head: () => ({ meta: [{ title: "Attendance - Seramet" }, { name: "description", content: "Secure, location-verified employee clock-in and clock-out." }] }),
  component: Attendance,
});

type Session = {
  id: string; employeeId: string; branchId: string; businessDate: string;
  clockInAt: string; clockOutAt: string | null; minutesLate: number | null;
  clockInSource: string; clockOutSource: string | null; version: number;
};
type Employee = { id: string; name: string; employee_code: string | null; scheduled_start: string | null; schedule_version: number | null };
type Fence = {
  enabled: boolean; radiusMeters: number; maxAccuracyMeters: number;
  maxFixAgeSeconds: number; graceMinutes: number; version: number;
  latitude?: number | null; longitude?: number | null;
};
type Data = {
  ok: boolean; branchId: string; businessDate: string; branchTimezone: string;
  me: Session | null; canManage: boolean; records: Session[];
  employees: Employee[]; geofence: Fence;
};
const readableTime = (value: string | null | undefined, zone = "Africa/Nairobi") => {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("en-KE", { timeZone: zone, hour:"2-digit",minute:"2-digit",hour12:false }).format(new Date(value)); }
  catch { return "—"; }
};
const inputClass = "min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30";
function locationOnce(): Promise<{latitude:number;longitude:number;accuracyMeters:number;capturedAt:string}> {
  return new Promise((resolve,reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error("Location requires HTTPS and a GPS-enabled browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude:position.coords.latitude,longitude:position.coords.longitude,
        accuracyMeters:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString(),
      }),
      (error) => reject(new Error(error.code === 1
        ? "Location permission denied. Enable precise location in browser settings or ask your supervisor for a recorded exception."
        : "An accurate location could not be obtained. Try near an open window or ask your supervisor.")),
      { enableHighAccuracy:true, maximumAge:0, timeout:20000 },
    );
  });
}
function Attendance() {
  const { branchId, branchLabel, activeTenantId, hasPermission } = useAppContext();
  const [data,setData] = useState<Data | null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [reason,setReason] = useState("");
  const [selected,setSelected] = useState("");
  const [manualAction,setManualAction] = useState<"IN"|"OUT"|"CORRECT_IN"|"CORRECT_OUT">("IN");
  const [occurredAt,setOccurredAt] = useState("");
  const [schedule,setSchedule] = useState("");
  const [editFence,setEditFence] = useState<Fence | null>(null);
  const punchKey = useRef<{ action: "IN"|"OUT"; key: string } | null>(null);
  const canConfigure = hasPermission(permissions.staffManage) && hasPermission(permissions.settingsBranchManage);
  const headers = useCallback(() => ({
    "content-type":"application/json",
    "x-seramet-tenant-id":activeTenantId,
    "x-seramet-branch-id":branchId,
    ...(getSerametAccessToken() ? { Authorization:"Bearer " + getSerametAccessToken() } : {}),
  }),[activeTenantId,branchId]);
  const api = useCallback(async (path:string, method = "GET", body?: unknown) => {
    const response = await fetch(path,{ method,credentials:"same-origin",headers:headers(),...(body ? { body:JSON.stringify(body) } : {}) });
    const value = await response.json().catch(() => ({})) as {message?:string;ok?:boolean};
    if (!response.ok) throw new Error(value.message ?? "Attendance request failed (" + response.status + ")");
    return value;
  },[headers]);
  const refresh = useCallback(async () => {
    try {
      const answer = await api("/api/seramet/attendance?branchId=" + encodeURIComponent(branchId)) as Data;
      setData(answer);
      setEditFence(answer.geofence);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load attendance");
    }
  },[api,branchId]);
  useEffect(() => { setData(null);setSelected("");setEditFence(null);void refresh(); },[refresh]);
  const run = async (work:()=>Promise<void>) => {
    if (busy) return;
    setBusy(true);setMessage("");
    try { await work();await refresh(); } catch(error) {
      setMessage(error instanceof Error ? error.message : "Request could not be completed");
    } finally { setBusy(false); }
  };
  const ownPunch = (action:"IN"|"OUT") => void run(async () => {
    setMessage("Checking your precise location…");
    const gps = await locationOnce();
    const existing = punchKey.current;
    const idempotencyKey = existing?.action === action ? existing.key : crypto.randomUUID();
    punchKey.current = { action, key:idempotencyKey };
    await api("/api/seramet/attendance/punch","POST",{action,branchId,idempotencyKey,location:gps});
    punchKey.current = null;
    setMessage(action === "IN" ? "Clock-in recorded by the server." : "Clock-out recorded by the server.");
  });
  const managePunch = () => void run(async () => {
    if (!selected) throw new Error("Choose an employee");
    if (reason.trim().length < 8) throw new Error("A meaningful reason of at least eight characters is required");
    const record = data?.records.find((row)=>row.employeeId===selected);
    const correcting = manualAction.startsWith("CORRECT");
    if (correcting && !record) throw new Error("Select an employee with an attendance record to correct");
    if (correcting && !occurredAt) throw new Error("Enter the correct punch time");
    await api("/api/seramet/attendance/supervisor","POST",{
      branchId,employeeId:selected,action:manualAction,reason:reason.trim(),
      idempotencyKey:crypto.randomUUID(),
      ...(correcting ? {sessionId:record?.id, expectedVersion:record?.version,occurredAt:new Date(occurredAt).toISOString()} : {}),
    });
    setReason("");setOccurredAt("");
  });
  const updateSchedule = () => void run(async () => {
    if (!selected) throw new Error("Choose an employee");
    await api("/api/seramet/attendance/schedule","PUT",{branchId,employeeId:selected,scheduledStart:schedule||null,expectedVersion:selectedEmployee?.schedule_version??0});
  });
  const saveFence = () => void run(async () => {
    if (!editFence || editFence.latitude == null || editFence.longitude == null) throw new Error("Set the worksite latitude and longitude");
    await api("/api/seramet/attendance/geofence","PUT",{
      branchId, enabled:editFence.enabled,latitude:editFence.latitude,longitude:editFence.longitude,
      radiusMeters:editFence.radiusMeters,maxAccuracyMeters:editFence.maxAccuracyMeters,
      maxFixAgeSeconds:editFence.maxFixAgeSeconds,graceMinutes:editFence.graceMinutes,
      expectedVersion:editFence.version,
    });
  });
  const exportTimesheet = () => {
    if (!data) return;
    const staff = new Map(data.employees.map((person)=>[person.id,person.name]));
    const rows = [["Employee","Date","Clock in (UTC)","Clock out (UTC)","Late minutes","Verification"],
      ...data.records.map(row=>[staff.get(row.employeeId)??row.employeeId,row.businessDate,row.clockInAt,row.clockOutAt??"",row.minutesLate?.toString()??"",row.clockInSource])];
    const csv=rows.map(row=>row.map(field=>'"'+field.replaceAll('"','""')+'"').join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="seramet-verified-attendance-"+data.businessDate+".csv";a.click();URL.revokeObjectURL(url);
  };
  const selectedEmployee = data?.employees.find((e)=>e.id===selected);
  const current = data?.me;
  const staffCount=data?.employees.length??0;
  const clocked=data?.records.length??0;
  return (
    <AppShell title="Attendance" subtitle={"Location-verified timekeeping · "+branchLabel}
      actions={<Btn onClick={()=>void refresh()} disabled={busy}><RefreshCcw className="h-4 w-4"/>Refresh</Btn>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Recorded today" value={clocked}/>
        <Metric label="Currently working" value={data?.records.filter(r=>!r.clockOutAt).length??0}/>
        <Metric label="Late" value={data?.records.filter(r=>(r.minutesLate??0)>0).length??0}/>
        <Metric label="Not clocked" value={data?.canManage?Math.max(0,staffCount-clocked):0}/>
      </div>
      {message && <p role="status" className="mt-3 rounded-md border border-border bg-card px-4 py-3 text-sm">{message}</p>}
      <Panel className="mt-4">
        <PanelHead title="My attendance" sub={"Authenticated employee · "+(data?.businessDate??"Today")} right={<Clock3 className="h-5 w-5 text-primary"/>}/>
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="text-sm font-semibold">{!data?"Loading…":current?.clockOutAt?"Shift completed":current?"Clocked in":"Not clocked in"}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              In: {readableTime(current?.clockInAt,data?.branchTimezone)} · Out: {readableTime(current?.clockOutAt,data?.branchTimezone)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-4 w-4"/>
              {data?.geofence.enabled
                ? "Within "+data.geofence.radiusMeters+" m of your assigned branch · precise location required"
                : "Geofenced punches are disabled until a manager configures the workplace"}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Your location is requested only when you punch. Poor GPS accuracy may require supervisor assistance.
            </p>
          </div>
          <Btn variant="primary" disabled={!data||busy||!data.geofence.enabled||Boolean(current?.clockOutAt)}
            onClick={()=>ownPunch(current&&!current.clockOutAt?"OUT":"IN")}>
            <LocateFixed className="h-4 w-4"/>
            {busy?"Verifying…":current&&!current.clockOutAt?"Clock out":"Clock in"}
          </Btn>
        </div>
      </Panel>
      {data?.canManage && <>
        <Panel className="mt-4">
          <PanelHead title="Supervisor · Live attendance" sub="Server-authoritative records; changes are audited"
            right={<Btn onClick={exportTimesheet}><Download className="h-4 w-4"/>CSV</Btn>}/>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead><tr><TH>Employee</TH><TH>Clock in</TH><TH>Clock out</TH><TH>Late</TH><TH>Source</TH><TH>Status</TH></tr></thead>
              <tbody>
                {data.employees.map(employee=>{
                  const record=data.records.find(r=>r.employeeId===employee.id);
                  return <tr key={employee.id}>
                    <TD className="font-semibold">{employee.name}</TD>
                    <TD>{readableTime(record?.clockInAt,data.branchTimezone)}</TD>
                    <TD>{readableTime(record?.clockOutAt,data.branchTimezone)}</TD>
                    <TD>{record?.minutesLate==null?"Not scheduled":record.minutesLate+" min"}</TD>
                    <TD>{record?.clockInSource??"—"}</TD>
                    <TD><Status>{!record?"NOT CLOCKED":record.clockOutAt?"COMPLETED":(record.minutesLate??0)>0?"LATE":"PRESENT"}</Status></TD>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="mt-4">
          <PanelHead title="Supervisor · Attendance exception" sub="When GPS is unavailable or a punch was missed, record the reason and employee"/>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold">Employee
              <select className={inputClass} value={selected} onChange={e=>{setSelected(e.target.value);setSchedule(data.employees.find(v=>v.id===e.target.value)?.scheduled_start??"");}}>
                <option value="">Choose employee</option>
                {data.employees.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold">Action
              <select className={inputClass} value={manualAction} onChange={e=>setManualAction(e.target.value as typeof manualAction)}>
                <option value="IN">Clock in now</option><option value="OUT">Clock out now</option>
                <option value="CORRECT_IN">Correct existing clock-in</option><option value="CORRECT_OUT">Correct existing clock-out</option>
              </select>
            </label>
            {manualAction.startsWith("CORRECT")&&<label className="grid gap-1 text-xs font-semibold">Corrected date and time
              <input className={inputClass} type="datetime-local" value={occurredAt} onChange={e=>setOccurredAt(e.target.value)}/>
            </label>}
            <label className="grid gap-1 text-xs font-semibold md:col-span-2">Reason for exception (required)
              <textarea className={inputClass} rows={2} value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="Employee arrived late; GPS unavailable inside restaurant"/>
            </label>
            <div className="md:col-span-2 flex justify-end"><Btn variant="primary" disabled={busy||!selected||reason.trim().length<8} onClick={managePunch}><ShieldCheck className="h-4 w-4"/>Record exception</Btn></div>
            <div className="md:col-span-2 border-t border-border pt-3 text-sm">
              <p className="font-semibold">Scheduled start for {selectedEmployee?.name??"selected employee"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input aria-label="Scheduled start" type="time" className={inputClass+" max-w-44"} value={schedule} onChange={e=>setSchedule(e.target.value)}/>
                <Btn disabled={!selected||busy} onClick={updateSchedule}>Save assigned start time</Btn>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Lateness is calculated only when an employee's start time is assigned. No automatic pay deductions.</p>
            </div>
          </div>
        </Panel>
      </>}
      {data?.canManage&&canConfigure&&editFence&&<Panel className="mt-4">
        <PanelHead title="Worksite geofence" sub="Requires full administrator authentication and branch settings permission"/>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs font-semibold">Latitude
            <input type="number" step="any" className={inputClass} value={editFence.latitude??""} onChange={e=>setEditFence({...editFence,latitude:e.target.value===""?null:Number(e.target.value)})}/>
          </label>
          <label className="grid gap-1 text-xs font-semibold">Longitude
            <input type="number" step="any" className={inputClass} value={editFence.longitude??""} onChange={e=>setEditFence({...editFence,longitude:e.target.value===""?null:Number(e.target.value)})}/>
          </label>
          <label className="grid gap-1 text-xs font-semibold">Radius (metres)
            <input type="number" min="10" max="500" className={inputClass} value={editFence.radiusMeters} onChange={e=>setEditFence({...editFence,radiusMeters:Number(e.target.value)})}/>
          </label>
          <label className="grid gap-1 text-xs font-semibold">Max GPS uncertainty (metres)
            <input type="number" min="1" max="100" className={inputClass} value={editFence.maxAccuracyMeters} onChange={e=>setEditFence({...editFence,maxAccuracyMeters:Number(e.target.value)})}/>
          </label>
          <label className="grid gap-1 text-xs font-semibold">GPS age limit (seconds)
            <input type="number" min="5" max="120" className={inputClass} value={editFence.maxFixAgeSeconds} onChange={e=>setEditFence({...editFence,maxFixAgeSeconds:Number(e.target.value)})}/>
          </label>
          <label className="grid gap-1 text-xs font-semibold">Grace time (minutes)
            <input type="number" min="0" max="120" className={inputClass} value={editFence.graceMinutes} onChange={e=>setEditFence({...editFence,graceMinutes:Number(e.target.value)})}/>
          </label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={editFence.enabled} onChange={e=>setEditFence({...editFence,enabled:e.target.checked})}/>Enable geofence</label>
          <Btn variant="primary" disabled={busy} onClick={saveFence}>Save worksite policy</Btn>
          <p className="col-span-full text-xs text-muted-foreground">Set coordinates from a trusted survey/map. A 10 m radius is extremely strict indoors; inaccurate readings fail closed and need an audited supervisor exception.</p>
        </div>
      </Panel>}
    </AppShell>
  );
}
