import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Search, Bell, HelpCircle, Plus, ChevronDown, PanelLeftClose, PanelLeft, Sparkles,
} from "lucide-react";
import { navGroups } from "./nav";
import { Logo } from "./Logo";
import { CommandPalette } from "./CommandPalette";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppShell({
  title,
  subtitle,
  actions,
  children,
  bare,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bare?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [branch, setBranch] = useState("Westlands");
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-[236px]",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Logo compact={collapsed} />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {navGroups.map((g) => (
            <div key={g.group} className="mb-1">
              {g.group && !collapsed && (
                <div className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {g.group}
                </div>
              )}
              {g.items
                .filter((i, idx) => (collapsed ? idx === 0 : true))
                .map((item) => {
                  const active = item.to === path;
                  const Icon = item.icon;
                  const content = (
                    <span
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />}
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </span>
                  );
                  return item.to ? (
                    <Link key={item.label + item.to} to={item.to} title={item.label}>
                      {content}
                    </Link>
                  ) : (
                    <div key={item.label} className="cursor-default opacity-70">
                      {content}
                    </div>
                  );
                })}
            </div>
          ))}
        </nav>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary md:flex md:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">Search orders, items, people…</span>
            <kbd className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left hover:bg-secondary">
                <div className="min-w-0">
                  <div className="text-[11px] leading-tight text-muted-foreground">Mona Swahili</div>
                  <div className="truncate text-[13px] font-semibold leading-tight">{branch}</div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Branch context</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {["All Branches", "Westlands", "Ngong Road"].map((b) => (
                  <DropdownMenuItem key={b} onClick={() => setBranch(b)}>
                    {b}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Create</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {["New Sale", "Purchase Order", "Expense", "Stock Transfer", "Customer", "Waste Entry", "Task"].map(
                  (o) => (
                    <DropdownMenuItem key={o}>{o}</DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Link to="/ai" className="grid h-9 w-9 place-items-center rounded-md hover:bg-secondary" title="Seramet AI">
              <Sparkles className="h-[18px] w-[18px] text-primary" />
            </Link>
            <button className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-secondary">
              <Bell className="h-[18px] w-[18px] text-muted-foreground" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
            </button>
            <button className="hidden h-9 w-9 place-items-center rounded-md hover:bg-secondary sm:grid">
              <HelpCircle className="h-[18px] w-[18px] text-muted-foreground" />
            </button>
            <div className="ml-1 flex items-center gap-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
                EK
              </div>
              <div className="hidden leading-tight xl:block">
                <div className="text-[13px] font-semibold">Emmanuel K.</div>
                <div className="text-[11px] text-muted-foreground">General Manager</div>
              </div>
            </div>
          </div>
        </header>

        {bare ? (
          <main className="min-w-0 flex-1">{children}</main>
        ) : (
          <main className="min-w-0 flex-1 px-4 py-5 md:px-6">
            {title && (
              <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h1 className="truncate text-[22px] font-bold tracking-tight">{title}</h1>
                  {subtitle && <div className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</div>}
                </div>
                {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
              </div>
            )}
            {children}
          </main>
        )}
      </div>
    </div>
  );
}