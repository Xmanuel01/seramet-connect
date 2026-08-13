import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tabs({ tabs, children }: { tabs: string[]; children?: (t: string) => ReactNode }) {
  const [active, setActive] = useState(tabs[0] ?? "");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
              active === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="pt-4">{children?.(active)}</div>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchInput({ placeholder = "Search…" }: { placeholder?: string }) {
  return (
    <input
      placeholder={placeholder}
      className="h-9 w-full max-w-xs rounded-md border border-border bg-card px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
    />
  );
}

export function DataTable({ cols, children }: { cols: (string | { l: string; r?: boolean })[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr>
            {cols.map((c) => {
              const label = typeof c === "string" ? c : c.l;
              const right = typeof c === "string" ? false : c.r;
              return (
                <th
                  key={label}
                  className={cn(
                    "sticky top-0 whitespace-nowrap border-b border-border bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground",
                    right && "text-right",
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Timeline({ items }: { items: [string, string][] }) {
  return (
    <ol className="space-y-3 px-4 py-4 text-[12px]">
      {items.map(([t, m]) => (
        <li key={t} className="flex gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div>
            <div className="font-semibold">{t}</div>
            <div className="text-muted-foreground">{m}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
