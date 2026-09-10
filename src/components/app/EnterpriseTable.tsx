import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Columns3, Database, Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Btn, Chips, Status, TD, TH } from "@/components/app/ui";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type EnterpriseColumn<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right";
  hidden?: boolean;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
};

export function EnterpriseTable<T extends { id: string }>({
  title,
  rows,
  columns,
  savedViews = ["All", "Needs attention", "Recently updated"],
  filters = [],
  pageSize = 6,
  renderExpanded,
}: {
  title?: string;
  rows: T[];
  columns: EnterpriseColumn<T>[];
  savedViews?: string[];
  filters?: string[];
  pageSize?: number;
  renderExpanded?: (row: T) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState(savedViews[0] ?? "All");
  const [sort, setSort] = useState<{ key: keyof T & string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(columns.map((col) => [col.key, !col.hidden])),
  );

  const visibleColumns = columns.filter((col) => visible[col.key]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = !needle
      ? rows
      : rows.filter((row) =>
          Object.values(row).some((value) => String(value).toLowerCase().includes(needle)),
        );
    if (!sort) return result;
    return [...result].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [query, rows, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const allPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.includes(row.id));

  const toggleSort = (key: keyof T & string) => {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const toggleSelected = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {title && <div className="mr-auto text-[13px] font-semibold">{title}</div>}
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 md:max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search table"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Btn>
              <Columns3 className="h-4 w-4" /> Columns
            </Btn>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visible[col.key] ?? false}
                onCheckedChange={(checked) =>
                  setVisible((current) => ({ ...current, [col.key]: Boolean(checked) }))
                }
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Btn>
          <Download className="h-4 w-4" /> Export
        </Btn>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="inline-flex rounded-md border border-border bg-secondary/50 p-0.5">
          {savedViews.map((item) => (
            <button
              key={item}
              onClick={() => setView(item)}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-[12px] font-semibold",
                view === item
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        {filters.length > 0 && <Chips items={filters} />}
        {selected.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-[12px]">
            <span className="font-semibold">{selected.length} selected</span>
            <Btn>Bulk update</Btn>
          </div>
        )}
      </div>

      <div className="grid gap-3 p-3 md:hidden">
        {pageRows.length === 0 && (
          <div className="grid min-h-44 place-items-center px-6 text-center">
            <div>
              <Database className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-[13px] font-semibold">No records yet</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                New records will appear here after they are created.
              </p>
            </div>
          </div>
        )}
        {pageRows.map((row) => {
          const primary = visibleColumns[0];
          const secondary = visibleColumns.slice(1, 3);
          const details = visibleColumns.slice(3);
          return (
            <article
              key={row.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  onChange={() => toggleSelected(row.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold">
                    {primary ? renderTableValue(row, primary) : row.id}
                  </div>
                  {secondary.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {secondary.map((col) => (
                        <span
                          key={col.key}
                          className="min-w-0 rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          <span className="font-semibold text-foreground">{col.label}: </span>
                          {renderTableValue(row, col)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {renderExpanded && (
                  <button
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-secondary"
                  >
                    {expanded === row.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              {details.length > 0 && (
                <dl className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                  {details.map((col) => (
                    <div
                      key={col.key}
                      className="min-w-0 rounded-md border border-border px-2.5 py-2"
                    >
                      <dt className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        {col.label}
                      </dt>
                      <dd
                        className={cn(
                          "mt-1 truncate font-semibold",
                          col.align === "right" && "num",
                        )}
                      >
                        {renderTableValue(row, col)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {expanded === row.id && renderExpanded && (
                <div className="mt-3 rounded-lg bg-secondary/40 p-3">{renderExpanded(row)}</div>
              )}
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px]">
          <thead className="sticky top-0 bg-card">
            <tr>
              <TH className="w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={() => {
                    const ids = pageRows.map((row) => row.id);
                    setSelected((current) =>
                      allPageSelected
                        ? current.filter((id) => !ids.includes(id))
                        : Array.from(new Set([...current, ...ids])),
                    );
                  }}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
              </TH>
              {renderExpanded && <TH className="w-10" />}
              {visibleColumns.map((col) => (
                <TH key={col.key} className={cn(col.align === "right" && "text-right")}>
                  <button
                    disabled={!col.sortable}
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1",
                      col.sortable && "hover:text-foreground",
                    )}
                  >
                    {col.label}
                    {sort?.key === col.key &&
                      (sort.dir === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      ))}
                  </button>
                </TH>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <TD className="px-6 py-12 text-center" colSpan={visibleColumns.length + 2}>
                  <Database className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-2 text-[13px] font-semibold">No records yet</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    New records will appear here after they are created.
                  </p>
                </TD>
              </tr>
            )}
            {pageRows.map((row) => (
              <Fragment key={row.id}>
                <tr className="hover:bg-secondary/50">
                  <TD>
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                  </TD>
                  {renderExpanded && (
                    <TD>
                      <button
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                        className="grid h-7 w-7 place-items-center rounded-md hover:bg-secondary"
                      >
                        {expanded === row.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </TD>
                  )}
                  {visibleColumns.map((col) => (
                    <TD key={col.key} className={cn(col.align === "right" && "text-right")}>
                      {renderTableValue(row, col)}
                    </TD>
                  ))}
                </tr>
                {expanded === row.id && renderExpanded && (
                  <tr key={`${row.id}-expanded`}>
                    <TD className="bg-secondary/30" />
                    <TD className="bg-secondary/30" />
                    <TD className="bg-secondary/30 px-4 py-3" colSpan={visibleColumns.length}>
                      {renderExpanded(row)}
                    </TD>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px] text-muted-foreground">
        <span>
          Showing {pageRows.length} of {filtered.length} records
        </span>
        <div className="flex items-center gap-2">
          <Btn onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Btn>
          <span className="num font-semibold text-foreground">
            Page {safePage} / {totalPages}
          </span>
          <Btn onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Btn>
        </div>
      </div>
    </div>
  );
}

function renderTableValue<T>(row: T, col: EnterpriseColumn<T>) {
  return col.render ? col.render(row) : renderCell(row[col.key]);
}

function renderCell(value: unknown) {
  if (
    typeof value === "string" &&
    ["Healthy", "Attention", "Pending", "Critical", "Paid", "Approved", "Draft", "Active"].includes(
      value,
    )
  ) {
    return <Status>{value}</Status>;
  }
  if (typeof value === "number")
    return <span className="num font-semibold">{value.toLocaleString()}</span>;
  return <span>{String(value)}</span>;
}
