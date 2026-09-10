import { Children, isValidElement, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { ksh } from "@/lib/currency";
import { cn } from "@/lib/utils";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-card", className)}>
      {children}
    </section>
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
  reconciled: "bg-success-soft text-success",
  matched: "bg-success-soft text-success",
  succeeded: "bg-success-soft text-success",
  open: "bg-info-soft text-info",
  sent_to_kitchen: "bg-info-soft text-info",
  in_progress: "bg-warning-soft text-warning",
  awaiting_payment: "bg-warning-soft text-warning",
  partially_paid: "bg-warning-soft text-warning",
  partial: "bg-warning-soft text-warning",
  unpaid: "bg-warning-soft text-warning",
  unmatched: "bg-warning-soft text-warning",
  suggested: "bg-warning-soft text-warning",
  requested: "bg-warning-soft text-warning",
  variance_review: "bg-warning-soft text-warning",
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

function statusText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return statusText(child.props.children);
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function Status({ children, className }: { children: ReactNode; className?: string }) {
  const label = statusText(children);
  const tone = toneMap[label.toLowerCase()] ?? "bg-secondary text-muted-foreground";
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
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="num mt-1.5 text-[20px] font-bold leading-none">
        {display}
        {suffix}
      </div>
      {delta !== undefined && (
        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium">
          <span
            className={cn(
              "inline-flex items-center gap-0.5",
              good ? "text-success" : "text-danger",
            )}
          >
            {delta >= 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(delta)}%
          </span>
          <span className="truncate text-muted-foreground">{note ?? "vs previous period"}</span>
        </div>
      )}
    </div>
  );
}

type ChipItem =
  | string
  | {
      label: string;
      value: string;
      options?: string[];
      selectedOption?: string;
      onOptionChange?: (value: string) => void;
      dateValue?: string;
      onDateChange?: (value: string) => void;
      onClear?: () => void;
    };

function Chip({ item }: { item: ChipItem }) {
  const dateRef = useRef<HTMLInputElement | null>(null);

  if (typeof item === "string") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 text-[12px] font-medium">
        {item}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 text-[12px] font-medium">
      <span className="relative inline-flex items-center">
        <button
          type="button"
          onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.click()}
          className="font-medium"
        >
          {item.label ? `${item.label}: ${item.value}` : item.value}
        </button>
        {item.options && item.onOptionChange && (
          <select
            aria-label={item.label}
            value={item.selectedOption ?? item.value}
            onChange={(event) => item.onOptionChange?.(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {item.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        )}
        {item.onDateChange && (
          <input
            ref={dateRef}
            type="date"
            value={item.dateValue ?? ""}
            onChange={(event) => item.onDateChange?.(event.target.value)}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            tabIndex={-1}
          />
        )}
      </span>
      {item.onClear && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            item.onClear?.();
          }}
          className="relative z-10 text-muted-foreground hover:text-foreground"
        >
          x
        </button>
      )}
    </span>
  );
}

export function Chips({ items, onClear }: { items: ChipItem[]; onClear?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <Chip key={typeof item === "string" ? item : `${item.label}:${item.value}`} item={item} />
      ))}
      {onClear && (
        <button
          onClick={onClear}
          className="px-1 text-[12px] font-semibold text-primary hover:underline"
        >
          Clear all
        </button>
      )}
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
            value === o
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
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
  disabled = false,
  type = "button",
  ...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger";
}) {
  const v = {
    default: "border border-border bg-card hover:bg-secondary",
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
    danger: "bg-danger-soft text-danger hover:opacity-90",
  }[variant];
  const handleClick: ButtonHTMLAttributes<HTMLButtonElement>["onClick"] = (event) => {
    if (disabled) return;
    if (onClick) {
      onClick(event);
      return;
    }
    const label = getTextFromChildren(children).trim();
    if (!label || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("seramet:workflow-action", { detail: { label } }));
  };

  return (
    <button
      {...buttonProps}
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        v,
        className,
      )}
    >
      {children}
    </button>
  );
}

function getTextFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return getTextFromChildren(child.props.children);
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ");
}

export function Empty({ title, body, action }: { title: string; body: string; action: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-lg bg-accent text-accent-foreground">
        +
      </div>
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

export function TD({ children, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...rest}
      className={cn("border-b border-border px-3 py-2.5 text-[13px] align-middle", className)}
    >
      {children}
    </td>
  );
}
