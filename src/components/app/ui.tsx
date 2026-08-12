import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { ksh } from "@/data/mock";

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-card", className)}>{children}</section>
  );
}

export function PanelHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-[14px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="truncate text-[12px] text-muted-foreground">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  );
}

const toneMap: Record<string, string> = {
  healthy: "bg-success-soft text-success",
  success: "bg-success-soft text-success",
  paid: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  approved: "bg-success-soft text-success",
  present: "bg-success-soft text-success",
  available: "bg-success-soft text-success",
  ready: "bg-info-soft text-info",
  reserved: "bg-info-soft text-info",
  info: "bg-info-soft text-info",
  served: "bg-info-soft text-info",
  attention: "bg-warning-soft text-warning",
  warning: "bg-warning-soft text-warning",
  pending: "bg-warning-soft text-warning",
  low: "bg-warning-soft text-warning",
  late: "bg-warning-soft text-warning",
  preparing: "bg-warning-soft text-warning",
  "needs cleaning": "bg-warning-soft text-warning",
  critical: "bg-danger-soft text-danger",
  danger: "bg-danger-soft text-danger",
  absent: "bg-danger-soft text-danger",
  cancelled: "bg-danger-soft text-danger",
  rejected: "bg-danger-soft text-danger",
  occupied: "bg-accent text-accent-foreground",
  new: "bg-accent text-accent-foreground",
};

export function Status({ children, className }: { children: string; className?: string }) {
  const tone = toneMap[children.toLowerCase()] ?? "bg-secondary text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold",
        tone,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  delta,
  money,
  suffix,
  invert,
  note,
}: {
  label: string;
  value: number | string;
  delta?: number;
  money?: boolean;
  suffix?: string;
  invert?: boolean;
  note?: string;
}) {
  const good = delta === undefined ? true : invert ? delta < 0 : delta >= 0;
  const display = typeof value === "number" ? (money ? ksh(value) : value.toLocaleString()) : value;
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="num mt-1.5 text-[20px] font-bold leading-none">
        {display}
        {suffix}
      </div>
      {delta !== undefined && (
        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium">
          <span className={cn("inline-flex items-center gap-0.5", good ? "text-success" : "text-danger")}>
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta)}%
          </span>
          <span className="truncate text-muted-foreground">{note ?? "vs previous period"}</span>
        </div>
      )}
    </div>
  );
}

export function Chips({ items, onClear }: { items: string[]; onClear?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 text-[12px] font-medium"
        >
          {i}
          <button className="text-muted-foreground hover:text-foreground">×</button>
        </span>
      ))}
      <button onClick={onClear} className="px-1 text-[12px] font-semibold text-primary hover:underline">
        Clear all
      </button>
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-secondary/50 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-[12px] font-semibold transition-colors",
            value === o ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Btn({
  children,
  variant = "default",
  className,
  onClick,
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger";
  className?: string;
  onClick?: () => void;
}) {
  const v = {
    default: "border border-border bg-card hover:bg-secondary",
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
    danger: "bg-danger-soft text-danger hover:opacity-90",
  }[variant];
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors",
        v,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-lg bg-accent text-accent-foreground">◇</div>
      <div className="text-[14px] font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</p>
      <Btn variant="primary" className="mt-4">
        {action}
      </Btn>
    </div>
  );
}

export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-border px-3 py-2.5 text-[13px] align-middle", className)}>{children}</td>
  );
}