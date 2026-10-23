import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, RefreshCcw, ShieldCheck } from "lucide-react";
import { AttendanceClock } from "@/components/app/AttendanceClock";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { AttendanceHistory } from "@/components/app/AttendanceHistory";
import { AttendanceDelays } from "@/components/app/AttendanceDelays";
import { attendanceCollection } from "@/lib/attendance-display";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  readAttendanceDraft,
  writeAttendanceDraft,
  type AttendanceDraft,
} from "@/lib/attendance-draft";

type Session = {
  id: string;
  employeeId: string;
  branchId: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  minutesLate: number | null;
  clockInSource: string;
  clockOutSource: string | null;
  version: number;
  workedMinutes: number | null;
};
type Employee = {
  id: string;
  name: string;
  employee_code: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  rest_day: number | null;
  schedule_version: number | null;
};
type Fence = {
  enabled: boolean;
  radiusMeters: number;
  maxAccuracyMeters: number;
  maxFixAgeSeconds: number;
  graceMinutes: number;
  version: number;
  latitude?: number | null;
  longitude?: number | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
};
type Data = {
  ok: boolean;
  branchId: string;
  businessDate: string;
  branchTimezone: string;
  me: Session | null;
  openElsewhere: boolean;
  canManage: boolean;
  records: Session[];
  employees: Employee[];
  geofence: Fence;
  canConfigure: boolean;
  serverNow: string;
  mySchedule: {
    scheduled_start: string | null;
    scheduled_end: string | null;
    rest_day: number;
  } | null;
  summary: {
    total: number;
    recorded: number;
    working: number;
    completed: number;
    late: number;
    exceptions: number;
    not_recorded: number;
  } | null;
};
const readableTime = (value: string | null | undefined, zone = "Africa/Nairobi") => {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return "—";
  }
};
const inputClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30";
function locationOnce(): Promise<{
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error("Location requires HTTPS and a GPS-enabled browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? "Location permission denied. Enable precise location in browser settings or ask your supervisor for a recorded exception."
              : error.code === 3
                ? "Location request timed out. Try again outdoors or ask your supervisor."
                : "Geolocation is unavailable. Enable precise device location or ask your supervisor.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  });
}
export function Attendance({ scheduling = false }: { scheduling?: boolean }) {
  const {
    branchId,
    branchLabel,
    activeTenantId,
    currentUser,
    hasPermission,
    sessionId,
    deviceId,
    authenticationLevel,
  } = useAppContext();
  const scope = JSON.stringify([
    activeTenantId,
    branchId,
    currentUser.id,
    sessionId ?? "development",
    deviceId ?? "account",
    authenticationLevel,
    [...currentUser.permissions].sort(),
  ]);
  const activeScope = useRef(scope);
  const scopeGeneration = useRef(0);
  const refreshSequence = useRef(0);
  const operation = useRef(false);
  const [storedData, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [punchError, setPunchError] = useState("");
  const [delayOpen, setDelayOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [correctionRecord, setCorrectionRecord] = useState<Session | null>(null);
  const [manualAction, setManualAction] = useState<AttendanceDraft["action"]>("IN");
  const [occurredAt, setOccurredAt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [restDay, setRestDay] = useState(false);
  const [draftScope, setDraftScope] = useState("");
  const data = draftScope === scope && storedData?.branchId === branchId ? storedData : null;
  const refreshFlight = useRef<Promise<void> | null>(null);
  const supervisorRequest = useRef<{ payload: string; key: string } | null>(null);
  const currentDraft = useRef<AttendanceDraft>({
    selected: "",
    sessionId: "",
    reason: "",
    occurredAt: "",
    action: "IN",
  });
  const [unknown, setUnknown] = useState(false);
  const [editFence, setEditFence] = useState<Fence | null>(null);
  const punchKey = useRef<NonNullable<AttendanceDraft["pending"]> | null>(null);
  const canConfigure =
    hasPermission(permissions.staffManage) && hasPermission(permissions.settingsBranchManage);
  const headers = useCallback(
    () => ({
      "content-type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      ...(getSerametAccessToken() ? { Authorization: "Bearer " + getSerametAccessToken() } : {}),
    }),
    [activeTenantId, branchId],
  );
  const api = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const generation = scopeGeneration.current;
      if (activeScope.current !== scope) throw new Error("Attendance branch changed; try again");
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        headers: headers(),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = (await response.json().catch(() => ({}))) as { message?: string; ok?: boolean };
      if (activeScope.current !== scope || generation !== scopeGeneration.current)
        throw new Error("Attendance branch changed; try again");
      if (!response.ok)
        throw Object.assign(
          new Error(value.message ?? "Attendance request failed (" + response.status + ")"),
          { status: response.status },
        );
      return value;
    },
    [headers, scope],
  );
  const refresh = useCallback(
    (preserveSettings = false): Promise<void> => {
      if (refreshFlight.current) return refreshFlight.current;
      const flight = (async () => {
        const sequence = ++refreshSequence.current;
        try {
          const answer = (await api(
            "/api/seramet/attendance?branchId=" + encodeURIComponent(branchId),
          )) as Data;
          if (sequence !== refreshSequence.current) return;
          attendanceCollection<Employee>(answer, "employees", ["id", "name"]);
          attendanceCollection<Session>(answer, "records", ["id", "employeeId", "clockInAt"]);
          if (
            !answer.geofence ||
            typeof answer.branchTimezone !== "string" ||
            answer.branchId !== branchId
          )
            throw new Error(
              "Attendance configuration is incomplete. Refresh or contact your supervisor.",
            );
          setData(answer);
          if (!preserveSettings) setEditFence(answer.geofence);
        } catch (error) {
          if (activeScope.current === scope && sequence === refreshSequence.current)
            setMessage(error instanceof Error ? error.message : "Could not load attendance");
        }
      })();
      refreshFlight.current = flight;
      void flight.finally(() => {
        if (refreshFlight.current === flight) refreshFlight.current = null;
      });
      return flight;
    },
    [api, branchId, scope],
  );
  useEffect(() => {
    scopeGeneration.current += 1;
    refreshSequence.current += 1;
    activeScope.current = scope;
    operation.current = false;
    punchKey.current = null;
    setDraftScope("");
    refreshFlight.current = null;
    supervisorRequest.current = null;
    setBusy(false);
    setMessage("");
    setReason("");
    setPunchError("");
    setDelayOpen(false);
    setOccurredAt("");
    setSchedule("");
    setScheduledEnd("");
    setRestDay(false);
    setData(null);
    setSelected("");
    setSelectedSession("");
    setCorrectionRecord(null);
    setEditFence(null);
    void refresh();
    const saved = readAttendanceDraft(scope);
    if (saved) {
      setSelected(saved.selected);
      setSelectedSession(saved.sessionId);
      setReason(saved.reason);
      setOccurredAt(saved.occurredAt);
      setManualAction(saved.action);
      punchKey.current = saved.pending ?? null;
      supervisorRequest.current = saved.supervisor ?? null;
      setUnknown(Boolean(saved.pending));
    } else setUnknown(false);
    setDraftScope(scope);
    return () => {
      activeScope.current = "";
      scopeGeneration.current += 1;
    };
  }, [refresh, scope]);
  useEffect(() => {
    if (draftScope !== scope || activeScope.current !== scope) return;
    currentDraft.current = {
      selected,
      sessionId: selectedSession,
      reason,
      occurredAt,
      action: manualAction,
      pending: punchKey.current ?? undefined,
      supervisor: supervisorRequest.current ?? undefined,
    };
    writeAttendanceDraft(scope, currentDraft.current);
  }, [scope, draftScope, selected, selectedSession, reason, occurredAt, manualAction, unknown]);
  useEffect(() => {
    let running = false;
    const timer = window.setInterval(() => {
      if (running || operation.current || document.visibilityState !== "visible") return;
      running = true;
      void refresh(true).finally(() => {
        running = false;
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const run = async (work: () => Promise<void>, punch = false) => {
    if (operation.current || activeScope.current !== scope) return;
    const generation = scopeGeneration.current;
    operation.current = true;
    setBusy(true);
    setMessage("");
    try {
      // Drain a pre-command read so its older snapshot cannot stand in for the
      // authoritative confirmation read after this mutation. Polling is paused.
      await refreshFlight.current;
      if (activeScope.current !== scope || generation !== scopeGeneration.current) return;
      await work();
      if (activeScope.current === scope && generation === scopeGeneration.current) {
        await refresh(true);
        setHistoryRevision((revision) => revision + 1);
      }
    } catch (error) {
      if (activeScope.current === scope && generation === scopeGeneration.current) {
        const failure = error instanceof Error ? error.message : "Request could not be completed";
        setMessage(punch ? "" : failure);
        if (punch) setPunchError(failure);
      }
    } finally {
      if (activeScope.current === scope && generation === scopeGeneration.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  const ownPunch = (action: "IN" | "OUT") =>
    void run(async () => {
      const pending = punchKey.current;
      if (pending) {
        const result = (await api(
          `/api/seramet/attendance/requests/${pending.key}?branchId=${encodeURIComponent(branchId)}`,
        )) as { found: boolean };
        if (result.found) {
          punchKey.current = null;
          setUnknown(false);
          writeAttendanceDraft(scope, { ...currentDraft.current, pending: undefined });
          setMessage("The server confirmed your previous attendance request.");
          return;
        }
        if (pending.action !== action)
          throw new Error("Confirm or safely retry the previous attendance request first");
      }
      setMessage("Checking your precise location…");
      const generation = scopeGeneration.current;
      const gps = await locationOnce();
      if (activeScope.current !== scope || generation !== scopeGeneration.current) return;
      const existing = punchKey.current;
      const idempotencyKey = existing?.action === action ? existing.key : crypto.randomUUID();
      punchKey.current = {
        action,
        key: idempotencyKey,
        ...(action === "OUT"
          ? {
              sessionId: existing?.sessionId ?? current?.id,
              expectedVersion: existing?.expectedVersion ?? current?.version,
            }
          : {}),
      };
      setUnknown(true);
      writeAttendanceDraft(scope, { ...currentDraft.current, pending: punchKey.current });
      try {
        await api("/api/seramet/attendance/punch", "POST", {
          action,
          branchId,
          idempotencyKey,
          location: gps,
          ...(action === "OUT"
            ? {
                sessionId: punchKey.current.sessionId,
                expectedVersion: punchKey.current.expectedVersion,
              }
            : {}),
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          punchKey.current = null;
          setUnknown(false);
          writeAttendanceDraft(scope, { ...currentDraft.current, pending: undefined });
          throw error;
        }
        throw new Error("Attendance is not confirmed. Retry safely when connected.");
      }
      punchKey.current = null;
      setUnknown(false);
      writeAttendanceDraft(scope, { ...currentDraft.current, pending: undefined });
      setMessage(
        action === "IN" ? "Clock-in recorded by the server." : "Clock-out recorded by the server.",
      );
    }, true);
  const managePunch = () =>
    void run(async () => {
      if (supervisorRequest.current) {
        const pending = supervisorRequest.current;
        const status = (await api(
          `/api/seramet/attendance/requests/${pending.key}?branchId=${encodeURIComponent(branchId)}`,
        )) as { found: boolean };
        try {
          if (!status.found)
            await api("/api/seramet/attendance/supervisor", "POST", {
              ...(JSON.parse(pending.payload) as Record<string, unknown>),
              idempotencyKey: pending.key,
            });
        } catch (error) {
          const code = (error as { status?: number }).status;
          if (code && code >= 400 && code < 500) {
            supervisorRequest.current = null;
            writeAttendanceDraft(scope, { ...currentDraft.current, supervisor: undefined });
          }
          throw error;
        }
        supervisorRequest.current = null;
        writeAttendanceDraft(scope, { ...currentDraft.current, supervisor: undefined });
        setReason("");
        setOccurredAt("");
        setMessage("Previous supervisor exception confirmed by the server.");
        return;
      }
      if (!selected) throw new Error("Choose an employee");
      if (reason.trim().length < 8)
        throw new Error("A meaningful reason of at least eight characters is required");
      const record =
        manualAction === "OUT"
          ? data?.records.find((row) => row.employeeId === selected && !row.clockOutAt)
          : correctionRecord?.id === selectedSession && correctionRecord.employeeId === selected
            ? correctionRecord
            : data?.records.find(
                (row) => row.id === selectedSession && row.employeeId === selected,
              );
      const correcting = manualAction.startsWith("CORRECT") || manualAction === "EXPLAIN";
      if (correcting && !record)
        throw new Error("Select an employee with an attendance record to correct");
      if (manualAction === "OUT" && !record)
        throw new Error("Refresh and select an employee with an open session");
      if (manualAction.startsWith("CORRECT") && !occurredAt)
        throw new Error("Enter the correct punch time");
      const command = {
        branchId,
        employeeId: selected,
        action: manualAction,
        reason: reason.trim(),
        ...(correcting || manualAction === "OUT"
          ? {
              sessionId: record?.id,
              expectedVersion: record?.version,
              ...(manualAction.startsWith("CORRECT")
                ? { occurredAt: new Date(occurredAt).toISOString() }
                : {}),
            }
          : {}),
      };
      const payload = JSON.stringify(command);
      supervisorRequest.current = { payload, key: crypto.randomUUID() };
      writeAttendanceDraft(scope, {
        ...currentDraft.current,
        supervisor: supervisorRequest.current,
      });
      try {
        await api("/api/seramet/attendance/supervisor", "POST", {
          ...command,
          idempotencyKey: supervisorRequest.current.key,
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          supervisorRequest.current = null;
          writeAttendanceDraft(scope, { ...currentDraft.current, supervisor: undefined });
        }
        throw error;
      }
      supervisorRequest.current = null;
      writeAttendanceDraft(scope, { ...currentDraft.current, supervisor: undefined });
      setReason("");
      setOccurredAt("");
    });
  const updateSchedule = () =>
    void run(async () => {
      if (!selected) throw new Error("Choose an employee");
      await api("/api/seramet/attendance/schedule", "PUT", {
        branchId,
        employeeId: selected,
        scheduledStart: schedule || null,
        scheduledEnd: scheduledEnd || null,
        restDay,
        expectedVersion: selectedEmployee?.schedule_version ?? 0,
      });
    });
  const saveFence = () =>
    void run(async () => {
      if (!editFence || editFence.latitude == null || editFence.longitude == null)
        throw new Error("Set the worksite latitude and longitude");
      await api("/api/seramet/attendance/geofence", "PUT", {
        branchId,
        enabled: editFence.enabled,
        latitude: editFence.latitude,
        longitude: editFence.longitude,
        radiusMeters: editFence.radiusMeters,
        maxAccuracyMeters: editFence.maxAccuracyMeters,
        maxFixAgeSeconds: editFence.maxFixAgeSeconds,
        graceMinutes: editFence.graceMinutes,
        expectedVersion: editFence.version,
      });
      await refresh();
    });
  const selectedEmployee = data?.employees.find((e) => e.id === selected);
  const current = data?.me;
  return (
    <AppShell
      title={scheduling ? "Schedule" : "Attendance"}
      subtitle={branchLabel}
      actions={
        <Btn onClick={() => void refresh()} disabled={busy}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Btn>
      }
    >
      {data?.canManage && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Recorded today" value={data?.summary?.recorded ?? (current ? 1 : 0)} />
          <Metric
            label="Currently working"
            value={data?.summary?.working ?? (current && !current.clockOutAt ? 1 : 0)}
          />
          <Metric
            label="Late"
            value={data?.summary?.late ?? ((current?.minutesLate ?? 0) > 0 ? 1 : 0)}
          />
          <Metric label="Not recorded" value={data?.summary?.not_recorded ?? 0} />
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 rounded-md border border-border bg-card px-4 py-3 text-sm">
          {message}
        </p>
      )}
      <AttendanceClock
        name={currentUser.name}
        branch={branchLabel}
        businessDate={data?.businessDate}
        loaded={Boolean(data)}
        working={Boolean(current && !current.clockOutAt)}
        completed={Boolean(current?.clockOutAt)}
        clockIn={readableTime(current?.clockInAt, data?.branchTimezone)}
        clockOut={readableTime(current?.clockOutAt, data?.branchTimezone)}
        schedule={
          data?.mySchedule?.rest_day
            ? "Day off"
            : data?.mySchedule?.scheduled_start
              ? `${data.mySchedule.scheduled_start} - ${data.mySchedule.scheduled_end ?? "Not assigned"}`
              : "Not assigned"
        }
        minutesLate={current?.minutesLate}
        workedMinutes={current?.workedMinutes}
        locationEnabled={Boolean(data?.geofence.enabled)}
        openElsewhere={Boolean(data?.openElsewhere)}
        unknown={unknown}
        busy={busy}
        onPunch={() =>
          ownPunch(punchKey.current?.action ?? (current && !current.clockOutAt ? "OUT" : "IN"))
        }
      />
      {!scheduling && <AttendanceDelays open={delayOpen} setOpen={setDelayOpen} />}
      <Dialog
        open={!!punchError}
        onOpenChange={(open) => {
          if (!open) setPunchError("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attendance not confirmed</DialogTitle>
            <DialogDescription>{punchError}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => setPunchError("")}>Back to attendance</Btn>
            {!scheduling && !unknown && (
              <Btn
                variant="primary"
                onClick={() => {
                  setPunchError("");
                  setDelayOpen(true);
                }}
              >
                Report a delay
              </Btn>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {data?.canManage && (
        <>
          <Panel className="mt-4">
            <PanelHead
              title="Supervisor · Live attendance"
              sub="Server-authoritative records; changes are audited"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <TH>Employee</TH>
                    <TH>Clock in</TH>
                    <TH>Clock out</TH>
                    <TH>Late</TH>
                    <TH>Source</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((employee) => {
                    const record =
                      data.records.find((r) => r.employeeId === employee.id && !r.clockOutAt) ??
                      data.records.find((r) => r.employeeId === employee.id);
                    return (
                      <tr key={employee.id}>
                        <TD className="font-semibold">{employee.name}</TD>
                        <TD>{readableTime(record?.clockInAt, data.branchTimezone)}</TD>
                        <TD>{readableTime(record?.clockOutAt, data.branchTimezone)}</TD>
                        <TD>
                          {record?.minutesLate == null
                            ? "Not scheduled"
                            : record.minutesLate + " min"}
                        </TD>
                        <TD>{record?.clockInSource ?? "—"}</TD>
                        <TD>
                          <Status>
                            {!record
                              ? "NOT CLOCKED"
                              : record.clockOutAt
                                ? "COMPLETED"
                                : (record.minutesLate ?? 0) > 0
                                  ? "LATE"
                                  : "PRESENT"}
                          </Status>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel className="mt-4">
            <PanelHead
              title="Supervisor · Attendance exception"
              sub="When GPS is unavailable or a punch was missed, record the reason and employee"
            />
            <div className="grid gap-3 p-4 md:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold">
                Employee
                <select
                  className={inputClass}
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setSelectedSession("");
                    setCorrectionRecord(null);
                    const employee = data.employees.find((v) => v.id === e.target.value);
                    setScheduledEnd(employee?.scheduled_end ?? "");
                    setRestDay(Boolean(employee?.rest_day));
                    setSchedule(
                      data.employees.find((v) => v.id === e.target.value)?.scheduled_start ?? "",
                    );
                  }}
                >
                  <option value="">Choose employee</option>
                  {data.employees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold">
                Action
                <select
                  className={inputClass}
                  value={manualAction}
                  onChange={(e) => setManualAction(e.target.value as typeof manualAction)}
                >
                  <option value="IN">Clock in now</option>
                  <option value="OUT">Clock out now</option>
                  <option value="CORRECT_IN">Correct existing clock-in</option>
                  <option value="CORRECT_OUT">Correct existing clock-out</option>
                  <option value="EXPLAIN">Append explanation without changing times</option>
                </select>
              </label>
              {(manualAction.startsWith("CORRECT") || manualAction === "EXPLAIN") && (
                <label className="grid gap-1 text-xs font-semibold">
                  Attendance session
                  <select
                    className={inputClass}
                    value={selectedSession}
                    onChange={(e) => {
                      setSelectedSession(e.target.value);
                      setCorrectionRecord(
                        data.records.find((row) => row.id === e.target.value) ?? null,
                      );
                    }}
                  >
                    <option value="">Choose exact session</option>
                    {(correctionRecord && !data.records.some((r) => r.id === correctionRecord.id)
                      ? [...data.records, correctionRecord]
                      : data.records
                    )
                      .filter((r) => r.employeeId === selected)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.businessDate} · {readableTime(r.clockInAt, data.branchTimezone)} —{" "}
                          {readableTime(r.clockOutAt, data.branchTimezone)} · revision {r.version}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {manualAction.startsWith("CORRECT") && (
                <label className="grid gap-1 text-xs font-semibold">
                  Corrected date and time ({Intl.DateTimeFormat().resolvedOptions().timeZone}, with
                  explicit conversion to UTC)
                  <input
                    className={inputClass}
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(e) => setOccurredAt(e.target.value)}
                  />
                </label>
              )}
              <label className="grid gap-1 text-xs font-semibold md:col-span-2">
                Reason for exception (required)
                <textarea
                  className={inputClass}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="Employee arrived late; GPS unavailable inside restaurant"
                />
              </label>
              <div className="md:col-span-2 flex justify-end">
                <Btn
                  variant="primary"
                  disabled={
                    busy || (!supervisorRequest.current && (!selected || reason.trim().length < 8))
                  }
                  onClick={managePunch}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {supervisorRequest.current
                    ? "Check / retry previous exception"
                    : "Record exception"}
                </Btn>
              </div>
              <div className="md:col-span-2 border-t border-border pt-3 text-sm">
                <p className="font-semibold">
                  Scheduled start for {selectedEmployee?.name ?? "selected employee"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    aria-label="Scheduled start"
                    type="time"
                    className={inputClass + " max-w-44"}
                    value={schedule}
                    disabled={restDay}
                    onChange={(e) => setSchedule(e.target.value)}
                  />
                  <input
                    aria-label="Scheduled end"
                    type="time"
                    className={inputClass + " max-w-44"}
                    value={scheduledEnd}
                    disabled={restDay}
                    onChange={(e) => setScheduledEnd(e.target.value)}
                  />
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={restDay}
                      onChange={(e) => {
                        setRestDay(e.target.checked);
                        if (e.target.checked) {
                          setSchedule("");
                          setScheduledEnd("");
                        }
                      }}
                    />
                    OFF / rest day
                  </label>
                  <Btn disabled={!selected || busy} onClick={updateSchedule}>
                    Save schedule
                  </Btn>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lateness is calculated only when an employee's start time is assigned. No
                  automatic pay deductions.
                </p>
              </div>
            </div>
          </Panel>
        </>
      )}
      {data && (
        <AttendanceHistory
          revision={historyRevision}
          key={scope}
          scope={scope}
          branchId={branchId}
          date={data.businessDate}
          timezone={data.branchTimezone}
          employees={data.employees}
          managed={data.canManage}
          headers={headers}
          onReview={(record) => {
            setSelected(record.employeeId);
            setSelectedSession(record.id);
            setCorrectionRecord(record);
            setManualAction("EXPLAIN");
          }}
        />
      )}
      {data?.canConfigure && canConfigure && editFence && (
        <Panel className="mt-4">
          <PanelHead
            title="Worksite geofence"
            sub="Requires full administrator authentication and branch settings permission"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold">
              Latitude
              <input
                type="number"
                step="any"
                className={inputClass}
                value={editFence.latitude ?? ""}
                onChange={(e) =>
                  setEditFence({
                    ...editFence,
                    latitude: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Longitude
              <input
                type="number"
                step="any"
                className={inputClass}
                value={editFence.longitude ?? ""}
                onChange={(e) =>
                  setEditFence({
                    ...editFence,
                    longitude: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Radius (metres)
              <input
                type="number"
                min="10"
                max="500"
                className={inputClass}
                value={editFence.radiusMeters}
                onChange={(e) =>
                  setEditFence({ ...editFence, radiusMeters: Number(e.target.value) })
                }
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Max GPS uncertainty (metres)
              <input
                type="number"
                min="1"
                max="100"
                className={inputClass}
                value={editFence.maxAccuracyMeters}
                onChange={(e) =>
                  setEditFence({ ...editFence, maxAccuracyMeters: Number(e.target.value) })
                }
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              GPS age limit (seconds)
              <input
                type="number"
                min="5"
                max="120"
                className={inputClass}
                value={editFence.maxFixAgeSeconds}
                onChange={(e) =>
                  setEditFence({ ...editFence, maxFixAgeSeconds: Number(e.target.value) })
                }
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Grace time (minutes)
              <input
                type="number"
                min="0"
                max="120"
                className={inputClass}
                value={editFence.graceMinutes}
                onChange={(e) =>
                  setEditFence({ ...editFence, graceMinutes: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={editFence.enabled}
                onChange={(e) => setEditFence({ ...editFence, enabled: e.target.checked })}
              />
              Enable geofence
            </label>
            <Btn variant="primary" disabled={busy} onClick={saveFence}>
              Save worksite policy
            </Btn>
            <p className="col-span-full text-xs text-muted-foreground">
              Policy revision {editFence.version} · Updated{" "}
              {editFence.updatedAt ?? "not yet configured"}{" "}
              {editFence.updatedBy ? `by ${editFence.updatedBy}` : ""}. Set coordinates from a
              trusted survey/map. A 10 m radius is extremely strict indoors; inaccurate readings
              fail closed and need an audited supervisor exception.
            </p>
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
