import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  RefreshCcw,
  PencilLine,
  FileDown,
} from "lucide-react";
import { Btn, PanelHead, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { attendanceCollection, attendanceTime } from "@/lib/attendance-display";
import { attendanceDuration } from "@/lib/attendance-summary";
import { shiftBusinessDate } from "@/lib/business-date";
import { AttendanceTimeline } from "@/components/app/AttendanceTimeline";

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
  scheduledMinutes?: number | null;
  overtimeMinutes?: number | null;
  missingClockOut?: boolean;
};
type Summary = {
  workedMinutes: number;
  overtimeMinutes: number;
  unassessedDays: number;
  sessions: number;
  late: number;
  missingClockOut: number;
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
const input = "min-h-11 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm";
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
  employeeId,
  mode = "timecards",
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
  employeeId?: string;
  mode?: "personal" | "timecards" | "reports";
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
  const [period, setPeriod] = useState("today");
  useEffect(() => {
    if (period === "custom") return;
    const days = period === "week" ? 6 : period === "month" ? 29 : period === "yesterday" ? 1 : 0;
    setFrom(shiftBusinessDate(date, -days));
    setTo(period === "yesterday" ? shiftBusinessDate(date, -1) : date);
    setOffset(0);
  }, [date, period]);
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    query: string;
    records: Row[];
    hasMore: boolean;
    summary: Summary | null;
    serverNow: string;
  } | null>(null);
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
    ...(employeeId || employee ? { employeeId: employeeId || employee } : {}),
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
          summary?: Summary | null;
          serverNow?: string;
        };
        if (!response.ok) throw new Error(body.message ?? "Attendance history unavailable");
        if (active) {
          setResult({
            scope,
            query,
            summary: body.summary ?? null,
            serverNow: body.serverNow ?? new Date().toISOString(),
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
  const currentResult = result?.scope === scope && result.query === query ? result : null;
  const records = currentResult?.records ?? [];
  const download = async (format: "csv" | "pdf") => {
    setBusy(true);
    try {
      const response = await fetch(
        "/api/seramet/attendance/export?" + query + "&format=" + format,
        {
          headers: headers(),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message ?? "Export unavailable");
      }
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `seramet-attendance-${from}-${to}.${format}`;
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
    <section
      className="mt-4 min-w-0 border-y border-border"
      aria-label={mode === "reports" ? "Attendance reports" : "Timecards"}
    >
      <PanelHead
        title={
          mode === "reports"
            ? "Attendance report"
            : mode === "personal"
              ? "My timecards"
              : "Timecards"
        }
        sub={timezone}
        right={
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy}
              onClick={() => void download("csv")}
              title="Export audited timesheet as CSV"
            >
              <Download className="h-4 w-4" />
              CSV
            </Btn>
            <Btn
              disabled={busy}
              onClick={() => void download("pdf")}
              title="Export audited timesheet as PDF"
            >
              <FileDown className="h-4 w-4" />
              PDF
            </Btn>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2 px-4 pt-4">
        <label className="flex items-center gap-2 text-sm">
          Period
          <select
            aria-label="Attendance period"
            className={input}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
      </div>
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
              setPeriod("custom");
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
              setPeriod("custom");
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
              <option value="">All employees</option>
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
            {[
              ["ALL", "All statuses"],
              ["OPEN", "Working"],
              ["COMPLETED", "Completed"],
              ["LATE", "Late arrivals"],
              ["EXCEPTION", "Exceptions"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
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
            {[
              ["ALL", "All methods"],
              ["GEOFENCE", "Location verified"],
              ["SUPERVISOR", "Supervisor exception"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
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
      {currentResult && (
        <dl className="grid grid-cols-2 gap-5 border-b border-border p-4 sm:grid-cols-4">
          {[
            ["Worked hours", attendanceDuration(currentResult.summary?.workedMinutes)],
            [
              "Overtime (over schedule)",
              attendanceDuration(currentResult.summary?.overtimeMinutes),
            ],
            ["Late arrivals", currentResult.summary?.late ?? "--"],
            ["Missing clock-out", currentResult.summary?.missingClockOut ?? "--"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {currentResult?.summary?.unassessedDays ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          {currentResult.summary.unassessedDays} employee-days have no comparable schedule. Overtime
          is not assessed for those days.
        </p>
      ) : null}
      {currentResult && !currentResult.summary && (
        <p role="status" className="p-4 text-sm">
          More than 5,000 sessions match. Narrow the period for complete totals and exports.
        </p>
      )}
      {mode !== "reports" && (
        <AttendanceTimeline
          rows={records}
          timezone={timezone}
          now={Date.parse(currentResult?.serverNow ?? new Date().toISOString())}
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <TH>Employee / business date</TH>
              <TH>In</TH>
              <TH>Out</TH>
              <TH>Worked</TH>
              <TH>Late / missing</TH>
              <TH>Source</TH>
              <TH>Actions</TH>
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
                <TD>
                  {row.workedMinutes === null
                    ? "In progress"
                    : attendanceDuration(row.workedMinutes)}
                </TD>
                <TD>
                  {row.missingClockOut ||
                  (!row.clockOutAt &&
                    row.scheduledMinutes == null &&
                    Date.parse(currentResult?.serverNow ?? "") - Date.parse(row.clockInAt) >=
                      86400000)
                    ? "Missing clock-out"
                    : row.minutesLate == null
                      ? "--"
                      : `${row.minutesLate} min late`}
                </TD>
                <TD>
                  {row.clockInSource}
                  {row.clockOutSource && row.clockOutSource !== row.clockInSource
                    ? " / " + row.clockOutSource
                    : ""}
                </TD>
                <TD>
                  <div className="flex gap-1">
                    <Btn title="View correction history" onClick={() => void showHistory(row.id)}>
                      <History className="h-4 w-4" />
                    </Btn>
                    {managed && (
                      <Btn title="Correct attendance" onClick={() => onReview(row)}>
                        <PencilLine className="h-4 w-4" />
                      </Btn>
                    )}
                  </div>
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
          disabled={busy || !currentResult?.hasMore}
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
    </section>
  );
}
