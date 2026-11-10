import { activeLocale } from "@/lib/currency";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Clock3, LoaderCircle, LogOut, MapPin, ShieldCheck } from "lucide-react";
import { Btn } from "@/components/app/ui";
import {
  attendanceDuration,
  summarizeAttendance,
  type AttendanceHoursRow,
} from "@/lib/attendance-summary";

type Props = {
  name?: string;
  branch: string;
  businessDate?: string;
  timezone?: string;
  serverNow?: string;
  week?: AttendanceHoursRow[];
  clockInAt?: string;
  shiftBusinessDate?: string;
  loaded: boolean;
  working: boolean;
  completed: boolean;
  clockIn: string;
  clockOut: string;
  schedule: string;
  minutesLate?: number | null;
  workedMinutes?: number | null;
  locationEnabled: boolean;
  radiusMeters?: number;
  tillClock?: boolean;
  canSetLocation?: boolean;
  openElsewhere: boolean;
  unknown: boolean;
  busy: boolean;
  onPunch: () => void;
};

export function AttendanceClock(props: Props) {
  const { loaded, working, completed, unknown, busy, locationEnabled, openElsewhere } = props;
  const name = props.name?.trim() || "Employee";
  const [now, setNow] = useState(() =>
    props.serverNow ? Date.parse(props.serverNow) : Date.now(),
  );
  useEffect(() => {
    const anchor = props.serverNow ? Date.parse(props.serverNow) : Date.now();
    const started = performance.now();
    const update = () => setNow(anchor + performance.now() - started);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [props.serverNow]);
  const zone = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = new Intl.DateTimeFormat(activeLocale(), {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat(activeLocale(), {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const calendarDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  const seconds =
    working && props.clockInAt
      ? Math.max(0, Math.floor((now - Date.parse(props.clockInAt)) / 1000))
      : 0;
  const timer = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const todayHours = summarizeAttendance(
    (props.week ?? []).filter((row) => row.businessDate === props.businessDate),
    now,
  ).workedMinutes;
  const weeklyHours = summarizeAttendance(props.week ?? [], now).workedMinutes;
  const status = !loaded
    ? "Loading attendance"
    : completed
      ? "Shift completed"
      : working
        ? "Clocked in"
        : "Not clocked in";
  const Icon = completed ? Check : working ? Clock3 : ArrowRight;
  return (
    <section aria-labelledby="my-attendance-heading" className="mx-auto max-w-4xl py-2 md:py-8">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-12">
        <div className="contents min-w-0 md:block md:border-r md:border-border md:pr-10">
          <div className="order-1">
            <h2 id="my-attendance-heading" className="text-sm font-medium text-muted-foreground">
              My attendance
            </h2>
            <div
              aria-hidden="true"
              className="mt-5 hidden h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary md:flex"
            >
              {name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")}
            </div>
            <p className="mt-2 break-words text-xl font-semibold leading-tight md:mt-4 md:text-2xl">
              {name}
            </p>
            <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {props.branch}
            </p>
            <div className="mt-3 border-t border-border pt-3 md:mt-6 md:pt-5">
              <p className="text-sm text-muted-foreground">{date}</p>
              <p
                className="mt-1 text-2xl font-semibold tabular-nums md:mt-2 md:text-3xl"
                aria-label="Current time"
              >
                {time}
              </p>
            </div>
          </div>
          <dl className="order-3 grid grid-cols-2 gap-4 border-y border-border py-4 md:mt-6 md:py-5">
            <div>
              <dt className="text-sm text-muted-foreground">Today's hours</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums">
                {loaded && props.week ? attendanceDuration(todayHours) : "--"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">This week</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums">
                {loaded && props.week ? attendanceDuration(weeklyHours) : "--"}
              </dd>
            </div>
          </dl>
          {/* Only after midnight, before the cutoff, does the business day differ from today. */}
          {props.businessDate && props.businessDate !== calendarDate && (
            <p className="order-4 text-xs text-muted-foreground md:mt-3">
              Business date <time dateTime={props.businessDate}>{props.businessDate}</time>
            </p>
          )}
        </div>
        <div className="order-2 min-w-0 py-2 text-center md:order-none md:py-8">
          <div className="mx-auto hidden h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary md:flex">
            <Icon className="h-7 w-7" aria-hidden="true" />
          </div>
          <p role="status" className="text-lg font-semibold md:mt-4">
            {status}
          </p>
          {props.shiftBusinessDate && props.shiftBusinessDate !== props.businessDate && (
            <p className="mt-1 text-xs text-muted-foreground">
              Shift date {props.shiftBusinessDate}
            </p>
          )}
          <p
            className="mt-1 text-4xl font-semibold tabular-nums md:mt-3"
            aria-label={working ? "Active shift duration" : "Shift duration"}
          >
            {working ? timer : completed ? attendanceDuration(props.workedMinutes) : "00:00:00"}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 border-y border-border py-3 text-left md:mt-6 md:py-4">
            <div>
              <dt className="text-xs text-muted-foreground">Clock in</dt>
              <dd className="mt-1 font-semibold tabular-nums">{props.clockIn}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Clock out</dt>
              <dd className="mt-1 font-semibold tabular-nums">{props.clockOut}</dd>
            </div>
          </dl>
          <Btn
            variant="primary"
            className="mt-3 h-14 w-full gap-3 text-base md:mt-6"
            disabled={!loaded || busy || openElsewhere || (!locationEnabled && !unknown)}
            onClick={props.onPunch}
          >
            {busy ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-5 w-5 animate-spin motion-reduce:animate-none"
              />
            ) : working ? (
              <LogOut aria-hidden="true" className="h-5 w-5" />
            ) : (
              <ArrowRight aria-hidden="true" className="h-5 w-5" />
            )}
            {busy
              ? "Verifying..."
              : unknown
                ? "Check / retry request"
                : working
                  ? "Clock out"
                  : "Clock in"}
          </Btn>
          {unknown && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Previous request not confirmed. Retry checks the server before submitting again.
            </p>
          )}
          {loaded && (
            <p className="mt-4 flex items-start justify-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {openElsewhere
                ? "Clock out at your other branch first."
                : props.tillClock
                  ? "Registered workplace device"
                  : locationEnabled
                    ? `Geofence enabled${props.radiusMeters ? ` (${props.radiusMeters} m)` : ""}. Location verified on each punch.`
                    : props.canSetLocation
                      ? "Set the workplace location in Attendance settings."
                      : "Ask your manager to set up workplace location."}
            </p>
          )}
          <details className="mt-6 border-t border-border pt-3 text-left text-sm">
            <summary className="cursor-pointer py-2 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Shift details
            </summary>
            <dl className="mt-3 space-y-3">
              {[
                ["Schedule", props.schedule],
                [
                  "Late arrival",
                  props.minutesLate == null ? "Not assessed" : `${props.minutesLate} min`,
                ],
                [
                  "Total worked",
                  completed
                    ? attendanceDuration(props.workedMinutes)
                    : working
                      ? attendanceDuration(seconds / 60)
                      : "--",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </div>
    </section>
  );
}
