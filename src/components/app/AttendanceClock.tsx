import { ArrowRight, Check, Clock3, LoaderCircle, LogOut, MapPin } from "lucide-react";
import { Btn } from "@/components/app/ui";

type Props = {
  name: string;
  branch: string;
  businessDate?: string;
  loaded: boolean;
  working: boolean;
  completed: boolean;
  clockIn: string;
  clockOut: string;
  schedule: string;
  minutesLate?: number | null;
  workedMinutes?: number | null;
  locationEnabled: boolean;
  // On the branch's registered till PC presence comes from the device, not GPS.
  tillClock?: boolean;
  // The viewer can set the workplace location on this page.
  canSetLocation?: boolean;
  openElsewhere: boolean;
  unknown: boolean;
  busy: boolean;
  onPunch: () => void;
};

export function AttendanceClock(props: Props) {
  const { loaded, working, completed, unknown, busy, locationEnabled, openElsewhere } = props;
  const Icon = busy ? LoaderCircle : completed ? Check : working ? LogOut : Clock3;
  const status = !loaded
    ? "Loading attendance"
    : completed
      ? "Shift completed"
      : working
        ? "Clocked in"
        : "Not clocked in";
  return (
    <section
      aria-labelledby="my-attendance-heading"
      className="mx-auto mt-4 max-w-2xl py-4 sm:py-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <h2 id="my-attendance-heading" className="font-medium">
          My attendance
        </h2>
        {props.businessDate && <time dateTime={props.businessDate}>{props.businessDate}</time>}
      </div>
      <div className="py-7 text-center sm:py-9">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon
            aria-hidden="true"
            className={`h-7 w-7 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
        </div>
        <p className="break-words text-2xl font-semibold leading-tight">{props.name}</p>
        <p className="mt-2 break-words text-sm text-muted-foreground">{props.branch}</p>
        <p
          className={`mt-4 inline-flex items-center gap-2 text-sm font-medium ${working || completed ? "text-primary" : "text-muted-foreground"}`}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
          {status}
        </p>
      </div>
      <dl className="grid grid-cols-2 divide-x divide-border border-y border-border py-5 text-center">
        <div className="px-2">
          <dt className="text-sm text-muted-foreground">Clock in</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">{props.clockIn}</dd>
        </div>
        <div className="px-2">
          <dt className="text-sm text-muted-foreground">Clock out</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">{props.clockOut}</dd>
        </div>
      </dl>
      <Btn
        variant="primary"
        className="mt-6 h-14 w-full gap-3 text-base"
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
          ? "Verifying…"
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
        <p className="mt-3 flex items-start justify-center gap-2 text-center text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {openElsewhere
            ? "Clock out at your other branch first."
            : props.tillClock
              ? "Clocking in at this restaurant's till."
              : locationEnabled
                ? "Location checked when you clock in or out."
                : props.canSetLocation
                  ? "Set your workplace location below to turn on clock-in."
                  : "Ask your manager to set up workplace location."}
        </p>
      )}
      <details className="mt-6 border-t border-border pt-4 text-sm">
        <summary className="cursor-pointer rounded-sm py-2 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Shift details
        </summary>
        <dl className="mt-3 grid gap-3 text-muted-foreground">
          {[
            ["Schedule", props.schedule],
            ["Late", props.minutesLate == null ? "Not determined" : `${props.minutesLate} min`],
            [
              "Worked",
              props.workedMinutes == null
                ? working
                  ? "In progress"
                  : "Not recorded"
                : `${props.workedMinutes} min`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt>{label}</dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
