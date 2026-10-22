import { useEffect, useRef, useState } from "react";
import { Clock3, Send } from "lucide-react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAttendanceDelays, type DelayRequest } from "@/hooks/use-attendance-delays";
import { attendanceTime } from "@/lib/attendance-display";

type Pending = { path: string; body: Record<string, unknown> };
function readPending(key: string): Pending | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
      at: number;
      pending: Pending;
    } | null;
    if (!data || Date.now() - data.at > 8 * 3600000 || data.at > Date.now()) return null;
    const p = data.pending;
    if (
      typeof p.path !== "string" ||
      !(p.path === "" || /^\/[\w-]+\/decision$/.test(p.path)) ||
      typeof p.body?.idempotencyKey !== "string"
    )
      return null;
    return p;
  } catch {
    return null;
  }
}
export function AttendanceDelays({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const feed = useAttendanceDelays();
  const [minutes, setMinutes] = useState("30");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<DelayRequest | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const active = useRef(feed.scope);
  const lock = useRef(false);
  const storage = "seramet.attendance.delay." + feed.scope;
  useEffect(() => {
    active.current = feed.scope;
    lock.current = false;
    setBusy(false);
    setOpen(false);
    setReason("");
    setNote("");
    setSelected(null);
    setMessage("");
    setPending(readPending(storage));
    return () => {
      active.current = "";
    };
  }, [feed.scope, storage, setOpen]);
  async function submit(command: Pending) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const scope = feed.scope;
    setPending(command);
    try {
      sessionStorage.setItem(storage, JSON.stringify({ at: Date.now(), pending: command }));
    } catch {
      /* In-memory recovery remains available. */
    }
    try {
      await feed.command(command.path, command.body);
      if (active.current !== scope) return;
      setPending(null);
      try {
        sessionStorage.removeItem(storage);
      } catch {
        /* No persisted draft. */
      }
      setOpen(false);
      setSelected(null);
      setReason("");
      setNote("");
      setMessage(
        command.path
          ? "Decision recorded. Actual attendance is unchanged."
          : "Delay request recorded. You must still clock in when you arrive.",
      );
    } catch (error) {
      if (active.current !== scope) return;
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        setPending(null);
        try {
          sessionStorage.removeItem(storage);
        } catch {
          /* No persisted draft. */
        }
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Request not confirmed. Retry the original request.",
      );
    } finally {
      if (active.current === scope) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const date = (value: string) => attendanceTime(value, feed.timeZone, true);
  return (
    <Panel className="mt-4">
      <PanelHead
        title={feed.canManage ? "Arrival requests" : "My arrival requests"}
        right={
          <Btn onClick={() => setOpen(true)} disabled={busy || !!pending}>
            <Clock3 className="h-4 w-4" />
            Report a delay
          </Btn>
        }
      />
      <div className="space-y-3 p-4">
        {(message || feed.error) && <p role="status">{message || feed.error}</p>}
        {pending && (
          <Btn disabled={busy} onClick={() => void submit(pending)}>
            Check / retry delay request
          </Btn>
        )}
        {feed.ready && feed.requests.length === 0 && (
          <p className="text-sm text-muted-foreground">No arrival requests.</p>
        )}
        {feed.requests.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 text-sm"
          >
            <div className="min-w-0 flex-1 break-words">
              <strong>{row.employee}</strong>
              <p>Expected: {date(row.expectedArrivalAt)}</p>
              <p className="whitespace-pre-wrap">{row.reason}</p>
              {row.decisionNote && (
                <p>
                  {row.decidedBy}: {row.decisionNote}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Status>{row.status}</Status>
              {feed.canManage && row.status === "PENDING" && row.employeeId !== feed.employeeId && (
                <Btn
                  disabled={busy || !!pending}
                  onClick={() => {
                    setSelected(row);
                    setNote("");
                    void feed
                      .command(`/${row.id}/read`, { branchId: feed.branchId })
                      .catch(() => {});
                  }}
                >
                  Review delay
                </Btn>
              )}
            </div>
          </div>
        ))}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy && !pending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report a delay</DialogTitle>
            <DialogDescription>
              This does not clock you in or change your actual arrival time.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit({
                path: "",
                body: {
                  branchId: feed.branchId,
                  idempotencyKey: crypto.randomUUID(),
                  expectedArrivalAt: new Date(Date.now() + Number(minutes) * 60000).toISOString(),
                  reason: reason.trim(),
                },
              });
            }}
          >
            <label className="grid gap-1">
              Expected arrival in (minutes)
              <input
                className="rounded border p-2"
                type="number"
                min="1"
                max="1440"
                required
                value={minutes}
                disabled={busy || !!pending}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              Reason for delay
              <textarea
                className="rounded border p-2"
                required
                minLength={8}
                maxLength={500}
                value={reason}
                disabled={busy || !!pending}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Btn
              type="submit"
              variant="primary"
              disabled={busy || !!pending || reason.trim().length < 8}
            >
              <Send className="h-4 w-4" />
              Send delay request
            </Btn>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(value) => {
          if (!value && !busy && !pending) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review delay request</DialogTitle>
            <DialogDescription>
              {selected?.employee}: {selected?.reason}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1">
            Supervisor response
            <textarea
              className="rounded border p-2"
              minLength={3}
              maxLength={500}
              value={note}
              disabled={busy || !!pending}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            {(["APPROVED", "REJECTED"] as const).map((status) => (
              <Btn
                key={status}
                variant={status === "APPROVED" ? "primary" : "default"}
                disabled={busy || !!pending || note.trim().length < 3}
                onClick={() =>
                  selected &&
                  void submit({
                    path: `/${selected.id}/decision`,
                    body: {
                      branchId: feed.branchId,
                      idempotencyKey: crypto.randomUUID(),
                      expectedVersion: selected.version,
                      status,
                      note: note.trim(),
                    },
                  })
                }
              >
                {status === "APPROVED" ? "Approve delay" : "Reject delay"}
              </Btn>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
