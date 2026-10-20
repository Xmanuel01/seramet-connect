import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, History, RefreshCcw } from "lucide-react";
import { Btn, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { attendanceCollection, attendanceTime } from "@/lib/attendance-display";

type Row = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  version: number;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number | null;
  earlyDepartureMinutes: number | null;
  minutesLate: number | null;
  clockInSource: string;
  clockOutSource: string | null;
};
type Event = {
  id: string;
  version: number;
  type: string;
  reason: string | null;
  at: string;
  actor: string;
  before_json: string;
  after_json: string;
};
const input = "min-h-11 rounded-md border border-input bg-background px-3 text-sm";
export function AttendanceHistory({
  scope,
  branchId,
  date,
  timezone,
  employees,
  managed,
  headers,
  onReview,
  revision,
}: {
  scope: string;
  branchId: string;
  date: string;
  timezone: string;
  employees: Array<{ id: string; name: string }>;
  managed: boolean;
  headers: () => Record<string, string>;
  onReview: (record: Row) => void;
  revision: number;
}) {
  const [from, setFrom] = useState(date);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [to, setTo] = useState(date);
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ scope: string; records: Row[]; hasMore: boolean } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<{ scope: string; events: Event[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({
    branchId,
    from,
    to,
    status,
    source,
    offset: String(offset),
    ...(employee ? { employeeId: employee } : {}),
  }).toString();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setBusy(true);
    void fetch("/api/seramet/attendance/records?" + query, {
      headers: headers(),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          records: Row[];
          hasMore: boolean;
          message?: string;
        };
        if (!response.ok) throw new Error(body.message ?? "Attendance history unavailable");
        if (active) {
          setResult({
            scope,
            records: attendanceCollection<Row>(body, "records", [
              "id",
              "clockInAt",
              "employeeName",
              "businessDate",
            ]),
            hasMore: body.hasMore === true,
          });
          setNotice("");
        }
      })
      .catch((error: unknown) => {
        if (active)
          setNotice(error instanceof Error ? error.message : "Attendance history unavailable");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [headers, query, refresh, scope, revision]);
  const time = (at: string | null) => attendanceTime(at, timezone, true);
  const records = result?.scope === scope ? result.records : [];
  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/seramet/attendance/export?" + query, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message ?? "Export unavailable");
      }
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `seramet-attendance-${from}-${to}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Timesheet exported; access recorded in the audit history.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export unavailable");
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (id: string) => {
    const selected = records.find((record) => record.id === id);
    if (managed && selected) onReview(selected);
    try {
      const response = await fetch(
        `/api/seramet/attendance/sessions/${id}/history?branchId=${encodeURIComponent(branchId)}`,
        { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      const body = (await response.json()) as { events: Event[]; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Correction history unavailable");
      if (alive.current)
        setHistory({
          scope,
          events: attendanceCollection<Event>(body, "events", [
            "id",
            "type",
            "at",
            "actor",
            "before_json",
            "after_json",
          ]),
        });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Correction history unavailable");
    }
  };
  const effective = (json: string) => {
    try {
      const value = JSON.parse(json) as { at?: string };
      return value.at ? time(value.at) : "Not recorded";
    } catch {
      return "Not recorded";
    }
  };
  return (
    <Panel className="mt-4">
      <PanelHead
        title="Timesheets and correction history"
        sub={timezone}
        right={
          <Btn disabled={busy} onClick={() => void download()} title="Export audited timesheet">
            <Download className="h-4 w-4" />
            CSV
          </Btn>
        }
      />
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="grid gap-1 text-xs font-semibold">
          From business date
          <input
            className={input}
            type="date"
            value={from}
            onChange={(e) => {
              setOffset(0);
              setFrom(e.target.value);
            }}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          To business date
          <input
            className={input}
            type="date"
            value={to}
            onChange={(e) => {
              setOffset(0);
              setTo(e.target.value);
            }}
          />
        </label>
        {managed && (
          <label className="grid gap-1 text-xs font-semibold">
            Employee filter
            <select
              className={input}
              value={employee}
              onChange={(e) => {
                setOffset(0);
                setEmployee(e.target.value);
              }}
            >
              <option value="">All assigned employees</option>
              {employees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold">
          Status filter
          <select
            className={input}
            value={status}
            onChange={(e) => {
              setOffset(0);
              setStatus(e.target.value);
            }}
          >
            {["ALL", "OPEN", "COMPLETED", "LATE", "EXCEPTION"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Verification filter
          <select
            className={input}
            value={source}
            onChange={(e) => {
              setOffset(0);
              setSource(e.target.value);
            }}
          >
            {["ALL", "GEOFENCE", "SUPERVISOR"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <Btn
          className="self-end"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
          title="Refresh timesheets"
        >
          <RefreshCcw className="h-4 w-4" />
        </Btn>
      </div>
      {notice && (
        <p role="status" className="p-4 text-sm">
          {notice}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <TH>Employee / business date</TH>
              <TH>In</TH>
              <TH>Out</TH>
              <TH>Worked</TH>
              <TH>Early departure</TH>
              <TH>Source</TH>
              <TH>History</TH>
            </tr>
          </thead>
          <tbody>
            {records.map((row) => (
              <tr key={row.id}>
                <TD>
                  <div>{row.employeeName}</div>
                  <div className="text-xs text-muted-foreground">{row.businessDate}</div>
                </TD>
                <TD>{time(row.clockInAt)}</TD>
                <TD>{time(row.clockOutAt)}</TD>
                <TD>{row.workedMinutes === null ? "In progress" : `${row.workedMinutes} min`}</TD>
                <TD>
                  {row.earlyDepartureMinutes === null
                    ? "Not assessed"
                    : `${row.earlyDepartureMinutes} min`}
                </TD>
                <TD>
                  {row.clockInSource}
                  {row.clockOutSource && row.clockOutSource !== row.clockInSource
                    ? " / " + row.clockOutSource
                    : ""}
                </TD>
                <TD>
                  <Btn title="View correction history" onClick={() => void showHistory(row.id)}>
                    <History className="h-4 w-4" />
                  </Btn>
                </TD>
              </tr>
            ))}
            {!records.length && (
              <tr>
                <TD colSpan={7}>
                  {busy ? "Loading attendance…" : "No sessions match these filters."}
                </TD>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3 p-3">
        <Btn
          title="Previous timesheet page"
          disabled={busy || offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - 200))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Btn>
        <span className="text-xs">Page {Math.floor(offset / 200) + 1}</span>
        <Btn
          title="Next timesheet page"
          disabled={busy || result?.scope !== scope || !result.hasMore}
          onClick={() => setOffset((value) => value + 200)}
        >
          <ChevronRight className="h-4 w-4" />
        </Btn>
      </div>
      <Dialog
        open={history?.scope === scope}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attendance change history</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {history?.scope === scope &&
              history.events.map((event) => (
                <section key={event.id} className="border-b border-border pb-3 text-sm">
                  <div className="font-semibold">
                    {event.type.replaceAll("_", " ")} · revision {event.version}
                  </div>
                  <div>
                    {event.actor} · {time(event.at)}
                  </div>
                  {event.reason && <p className="mt-1">{event.reason}</p>}
                  {event.type.startsWith("CORRECT") && (
                    <dl className="mt-2 grid gap-1">
                      <div>Previous: {effective(event.before_json)}</div>
                      <div>Corrected: {effective(event.after_json)}</div>
                    </dl>
                  )}
                </section>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
