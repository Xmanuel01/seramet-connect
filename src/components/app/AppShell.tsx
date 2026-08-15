import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  HelpCircle,
  Menu,
  Moon,
  Package,
  PanelLeft,
  PanelLeftClose,
  Plus,
  ReceiptText,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Truck,
  UserCog,
  Users,
  WalletCards,
} from "lucide-react";
import { getVisibleNavGroups, roleCanAccessPath } from "./nav";
import { Logo } from "./Logo";
import { CommandPalette } from "./CommandPalette";
import { cn } from "@/lib/utils";
import { useAppContext, type AppRole } from "@/lib/app-context";
import { Btn } from "@/components/app/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type IconType = typeof Plus;
type AppNotification = {
  id: string;
  category: string;
  message: string;
  to: string;
  source: string;
  read: boolean;
  icon: IconType;
};
type WorkflowAction = {
  label: string;
  status?: string;
};

const initialNotifications: AppNotification[] = [
  {
    id: "n-approvals",
    category: "Approvals",
    message: "3 purchase orders await review",
    to: "/approvals",
    source: "PO approval queue",
    read: false,
    icon: WalletCards,
  },
  {
    id: "n-inventory",
    category: "Inventory",
    message: "4 items are below PAR",
    to: "/stock-detail",
    source: "Inventory attention report",
    read: false,
    icon: Package,
  },
  {
    id: "n-hr",
    category: "HR",
    message: "2 employees absent today",
    to: "/attendance",
    source: "Attendance exceptions",
    read: false,
    icon: Users,
  },
  {
    id: "n-system",
    category: "System",
    message: "Nightly sales report is ready",
    to: "/reports",
    source: "Scheduled report run",
    read: false,
    icon: CheckCircle2,
  },
];

const quickCreateOptions: {
  id: string;
  label: string;
  to: string;
  icon: IconType;
  roles: AppRole[];
  fields: string[];
}[] = [
  {
    id: "sale",
    label: "New Sale",
    to: "/pos",
    icon: ReceiptText,
    roles: ["General Manager", "Branch Manager", "Cashier"],
    fields: ["Table or customer", "Order channel", "Server"],
  },
  {
    id: "po",
    label: "Purchase Order",
    to: "/procurement",
    icon: Truck,
    roles: ["General Manager", "Branch Manager", "Storekeeper", "Accountant", "Chef"],
    fields: ["Supplier", "Needed by", "Branch"],
  },
  {
    id: "expense",
    label: "Expense",
    to: "/expenses",
    icon: WalletCards,
    roles: ["General Manager", "Branch Manager", "Accountant"],
    fields: ["Vendor", "Amount", "Receipt reference"],
  },
  {
    id: "transfer",
    label: "Stock Transfer",
    to: "/transfers",
    icon: Package,
    roles: ["General Manager", "Branch Manager", "Storekeeper", "Chef"],
    fields: ["From store", "To store", "Item"],
  },
  {
    id: "customer",
    label: "Customer",
    to: "/customers",
    icon: Users,
    roles: ["General Manager", "Branch Manager", "Cashier"],
    fields: ["Name", "Phone", "Segment"],
  },
  {
    id: "waste",
    label: "Waste Entry",
    to: "/wastage",
    icon: Trash2,
    roles: ["General Manager", "Branch Manager", "Storekeeper", "Chef"],
    fields: ["Item", "Quantity", "Reason"],
  },
  {
    id: "task",
    label: "Task",
    to: "/tasks",
    icon: ClipboardList,
    roles: ["General Manager", "Branch Manager", "Accountant", "Storekeeper", "Chef", "Cashier"],
    fields: ["Title", "Owner", "Due date"],
  },
];

export function AppShell({
  title,
  subtitle,
  actions,
  children,
  bare,
  lockedContext,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  lockedContext?: {
    role: string;
    companyName: string;
    branch: string;
    userName?: string;
  };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [mutedCategories, setMutedCategories] = useState<string[]>([]);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateId, setQuickCreateId] = useState(quickCreateOptions[0].id);
  const [createdRecords, setCreatedRecords] = useState<
    { id: string; label: string; branch: string }[]
  >([]);
  const [workflowAction, setWorkflowAction] = useState<WorkflowAction | null>(null);
  const [workflowHistory, setWorkflowHistory] = useState<
    { id: string; label: string; branch: string; path: string }[]
  >([]);
  const { branch, branches, setBranch, role, theme, toggleTheme, currentUser, canSwitchBranch } =
    useAppContext();
  const visibleNavGroups = getVisibleNavGroups(role, branch);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const visibleNotifications = notifications.filter(
    (item) => !mutedCategories.includes(item.category),
  );
  const unreadCount = visibleNotifications.filter((item) => !item.read).length;
  const availableQuickCreate = useMemo(
    () =>
      quickCreateOptions.filter(
        (item) => item.roles.includes(role) && roleCanAccessPath(role, item.to, branch),
      ),
    [branch, role],
  );
  const activeQuickCreate =
    availableQuickCreate.find((item) => item.id === quickCreateId) ?? availableQuickCreate[0];
  const operatorName = lockedContext?.userName ?? "Emmanuel K.";
  const operatorInitials = operatorName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (
      availableQuickCreate.length > 0 &&
      !availableQuickCreate.some((item) => item.id === quickCreateId)
    ) {
      setQuickCreateId(availableQuickCreate[0].id);
    }
  }, [availableQuickCreate, quickCreateId]);

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

  useEffect(() => {
    const onWorkflowAction = (event: Event) => {
      const label = (event as CustomEvent<{ label?: string }>).detail?.label?.trim();
      if (!label) return;
      runWorkflowAction(label);
    };
    window.addEventListener("seramet:workflow-action", onWorkflowAction);
    return () => window.removeEventListener("seramet:workflow-action", onWorkflowAction);
  });

  const openNotification = (item: AppNotification) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, read: true } : notification,
      ),
    );
    navigate({ to: item.to as never });
  };

  const markNotificationRead = (id: string) => {
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  };

  const muteCategory = (category: string) => {
    setMutedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const createRecord = () => {
    if (!activeQuickCreate) return;
    setCreatedRecords((current) =>
      [
        { id: `${activeQuickCreate.id}-${Date.now()}`, label: activeQuickCreate.label, branch },
        ...current,
      ].slice(0, 4),
    );
    setQuickCreateOpen(false);
    navigate({ to: activeQuickCreate.to as never });
  };

  const runWorkflowAction = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes("print")) {
      window.print();
      setWorkflowAction({ label, status: "Print dialog opened for the current page." });
      return;
    }
    if (normalized.includes("export") || normalized.includes("download")) {
      exportCurrentPage(label);
      return;
    }
    const route = routeForAction(label);
    if (route && route !== path) {
      navigate({ to: route as never });
      return;
    }
    setWorkflowAction({ label });
  };

  const exportCurrentPage = (label: string) => {
    const rows = Array.from(document.querySelectorAll("main table tr"))
      .map((row) =>
        Array.from(row.querySelectorAll("th,td")).map((cell) =>
          cleanCsvCell(cell.textContent ?? ""),
        ),
      )
      .filter((row) => row.some(Boolean));
    const csvRows =
      rows.length > 0
        ? rows
        : [
            ["Page", "Branch", "Role", "Generated"],
            [title ?? path, branch, role, new Date().toISOString()],
          ];
    const csv = csvRows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${path.replace(/^\//, "").replaceAll("/", "-") || "dashboard"}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setWorkflowAction({ label, status: "Export downloaded for the current filtered view." });
  };

  const completeWorkflowAction = () => {
    if (!workflowAction) return;
    setWorkflowHistory((current) =>
      [
        { id: `${workflowAction.label}-${Date.now()}`, label: workflowAction.label, branch, path },
        ...current,
      ].slice(0, 5),
    );
    setWorkflowAction(null);
  };

  const dispatchWorkflowAction = (label: string) => {
    window.dispatchEvent(new CustomEvent("seramet:workflow-action", { detail: { label } }));
  };

  const navContent = (isCollapsed = false, onNavigate?: () => void) => (
    <nav className="flex-1 overflow-y-auto px-2 py-3">
      {visibleNavGroups.map((g) => (
        <div key={g.group} className="mb-1">
          {g.group && !isCollapsed && (
            <div className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {g.group}
            </div>
          )}
          {g.items
            .filter((i, idx) => (isCollapsed ? idx === 0 : true))
            .map((item, idx, items) => {
              const active =
                item.to === path &&
                items.findIndex((candidate) => candidate.to === item.to) === idx;
              const Icon = item.icon;
              const content = (
                <span
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    isCollapsed && "justify-center px-0",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />}
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </span>
              );
              return item.to ? (
                <Link
                  key={item.label + item.to}
                  to={item.to}
                  title={item.label}
                  onClick={onNavigate}
                >
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
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Sheet open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
        <SheetContent className="w-full overflow-y-auto border-border bg-card p-0 sm:max-w-[420px]">
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <Plus className="h-4 w-4 text-primary" />
              Quick create
            </SheetTitle>
            <SheetDescription>
              {role} - {branch}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            {availableQuickCreate.length === 0 ? (
              <div className="rounded-lg bg-warning-soft p-3 text-[13px] font-semibold text-warning">
                This role has no quick-create actions.
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  {availableQuickCreate.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setQuickCreateId(item.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] font-semibold",
                          activeQuickCreate?.id === item.id
                            ? "border-primary bg-accent text-accent-foreground"
                            : "border-border hover:bg-secondary",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                {activeQuickCreate && (
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                      Required fields
                    </div>
                    <div className="mt-3 grid gap-2">
                      {activeQuickCreate.fields.map((field) => (
                        <label
                          key={field}
                          className="grid gap-1 text-[12px] font-semibold text-muted-foreground"
                        >
                          {field}
                          <input className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none" />
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
                      Created records inherit the active branch context and open the source module
                      immediately.
                    </div>
                  </div>
                )}
                {createdRecords.length > 0 && (
                  <div className="grid gap-2 text-[12px]">
                    {createdRecords.map((record) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2"
                      >
                        <span className="font-semibold">{record.label}</span>
                        <span className="text-muted-foreground">{record.branch}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2 border-t border-border pt-4">
                  <Btn onClick={() => setQuickCreateOpen(false)}>Cancel</Btn>
                  <Btn variant="primary" onClick={createRecord}>
                    Create
                  </Btn>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent className="w-full overflow-y-auto border-border bg-card p-0 sm:max-w-[420px]">
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <Sparkles className="h-4 w-4 text-primary" />
              Ask Seramet
            </SheetTitle>
            <SheetDescription>
              Contextual help for the page you are viewing, with actions you can open immediately.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2">
              <input
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                defaultValue="Explain the biggest risk on this page"
              />
              <button
                onClick={() => dispatchWorkflowAction("Ask Seramet")}
                className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <article className="rounded-lg border border-warning/30 bg-warning-soft p-3">
              <div className="text-[13px] font-semibold text-warning">Inventory attention</div>
              <p className="mt-1 text-[13px] leading-relaxed">
                Cooking Oil and Tomatoes are below PAR at {branch}. Seramet recommends generating
                one purchase order and checking the last two wastage entries before approval.
              </p>
            </article>
            <div className="grid gap-2 text-[13px]">
              {[
                "Create purchase recommendation",
                "Open variance report",
                "Create manager task",
              ].map((action) => (
                <button
                  key={action}
                  onClick={() => dispatchWorkflowAction(action)}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 font-semibold hover:bg-secondary"
                >
                  {action}
                  <span className="text-muted-foreground">Open</span>
                </button>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-[236px]",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Logo compact={collapsed} />
        </div>
        {navContent(collapsed)}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur md:gap-3 md:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-md hover:bg-secondary"
              title="Open navigation"
            >
              <Menu className="h-[18px] w-[18px] text-muted-foreground" />
            </button>
            <Logo compact />
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary md:flex md:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">Search orders, items, people...</span>
            <kbd className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold">
              Ctrl K
            </kbd>
          </button>

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {lockedContext ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left">
                <UserCog className="hidden h-4 w-4 text-muted-foreground sm:block" />
                <div className="min-w-0">
                  <div className="text-[11px] leading-tight text-muted-foreground">
                    {lockedContext.companyName}
                  </div>
                  <div className="truncate text-[13px] font-semibold leading-tight">
                    {lockedContext.branch}
                  </div>
                </div>
                <span className="hidden rounded-md bg-secondary px-2 py-1 text-[11px] font-semibold text-muted-foreground sm:inline-flex">
                  {lockedContext.role}
                </span>
              </div>
            ) : (
              <>
                <div className="hidden items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left sm:flex">
                  <UserCog className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[11px] leading-tight text-muted-foreground">
                      {currentUser.name}
                    </div>
                    <div className="truncate text-[13px] font-semibold leading-tight">{role}</div>
                  </div>
                </div>
                {canSwitchBranch ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex max-w-[132px] items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left hover:bg-secondary sm:max-w-none sm:px-2.5">
                      <div className="min-w-0">
                        <div className="text-[11px] leading-tight text-muted-foreground">
                          Mona Swahili
                        </div>
                        <div className="truncate text-[13px] font-semibold leading-tight">
                          {branch}
                        </div>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>General manager branch scope</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {branches.map((b) => (
                        <DropdownMenuItem key={b} onClick={() => setBranch(b)}>
                          {b}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <div className="flex max-w-[132px] items-center rounded-md border border-border px-2 py-1.5 text-left sm:max-w-none sm:px-2.5">
                    <div className="min-w-0">
                      <div className="text-[11px] leading-tight text-muted-foreground">
                        Mona Swahili
                      </div>
                      <div className="truncate text-[13px] font-semibold leading-tight">
                        {branch}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Create</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{role} actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableQuickCreate.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => {
                        setQuickCreateId(item.id);
                        setQuickCreateOpen(true);
                      }}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {item.label}
                    </DropdownMenuItem>
                  );
                })}
                {availableQuickCreate.length === 0 && (
                  <DropdownMenuItem disabled>No actions for this role</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => setAiOpen(true)}
              className="hidden h-9 w-9 place-items-center rounded-md hover:bg-secondary sm:grid"
              title="Seramet AI"
            >
              <Sparkles className="h-[18px] w-[18px] text-primary" />
            </button>
            <button
              onClick={toggleTheme}
              className="grid h-9 w-9 place-items-center rounded-md hover:bg-secondary"
              title="Toggle dark mode"
            >
              {theme === "dark" ? (
                <Sun className="h-[18px] w-[18px] text-muted-foreground" />
              ) : (
                <Moon className="h-[18px] w-[18px] text-muted-foreground" />
              )}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-secondary">
                <Bell className="h-[18px] w-[18px] text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[320px]">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
                  <button
                    onClick={() =>
                      setNotifications((current) =>
                        current.map((item) => ({ ...item, read: true })),
                      )
                    }
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Mark all read
                  </button>
                </div>
                <DropdownMenuSeparator />
                {visibleNotifications.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem
                      key={item.id}
                      className="items-start gap-2 py-2"
                      onSelect={(event) => event.preventDefault()}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          item.read ? "text-muted-foreground" : "text-primary",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold">{item.category}</span>
                        <span className="block text-[12px] text-muted-foreground">
                          {item.message}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {item.source}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-2">
                          <button
                            onClick={() => openNotification(item)}
                            className="font-semibold text-primary hover:underline"
                          >
                            Open
                          </button>
                          {!item.read && (
                            <button
                              onClick={() => markNotificationRead(item.id)}
                              className="font-semibold text-muted-foreground hover:text-foreground"
                            >
                              Mark read
                            </button>
                          )}
                          <button
                            onClick={() => muteCategory(item.category)}
                            className="font-semibold text-muted-foreground hover:text-foreground"
                          >
                            Mute {item.category}
                          </button>
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
                {visibleNotifications.length === 0 && (
                  <DropdownMenuItem disabled>No active notifications</DropdownMenuItem>
                )}
                {mutedCategories.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    {mutedCategories.map((category) => (
                      <DropdownMenuItem key={category} onClick={() => muteCategory(category)}>
                        Unmute {category}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => setAiOpen(true)}
              className="hidden h-9 w-9 place-items-center rounded-md hover:bg-secondary sm:grid"
              title="Help"
            >
              <HelpCircle className="h-[18px] w-[18px] text-muted-foreground" />
            </button>
            <div className="ml-1 hidden items-center gap-2 sm:flex">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
                {operatorInitials}
              </div>
              <div className="hidden leading-tight xl:block">
                <div className="text-[13px] font-semibold">{operatorName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {lockedContext?.role ?? role}
                </div>
              </div>
            </div>
          </div>
        </header>
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="flex w-[286px] flex-col border-border bg-card p-0">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <SheetTitle>
                <Logo />
              </SheetTitle>
              <SheetDescription>
                {role} - {branch}
              </SheetDescription>
            </SheetHeader>
            {navContent(false, () => setMobileNavOpen(false))}
          </SheetContent>
        </Sheet>

        <Dialog open={!!workflowAction} onOpenChange={(open) => !open && setWorkflowAction(null)}>
          <DialogContent className="max-w-[480px] border-border bg-card">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                {workflowAction?.label}
              </DialogTitle>
              <DialogDescription>
                {workflowAction?.status ??
                  `${title ?? "This page"} action for ${branch} as ${role}.`}
              </DialogDescription>
            </DialogHeader>
            {!workflowAction?.status && (
              <div className="space-y-3">
                {fieldsForAction(workflowAction?.label ?? "").map((field) => (
                  <label
                    key={field}
                    className="grid gap-1 text-[12px] font-semibold text-muted-foreground"
                  >
                    {field}
                    <input className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none" />
                  </label>
                ))}
                <div className="rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
                  This action is linked to the active page, role and branch scope, and is recorded
                  in this session.
                </div>
              </div>
            )}
            {workflowHistory.length > 0 && (
              <div className="grid gap-2 border-t border-border pt-3 text-[12px]">
                {workflowHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2"
                  >
                    <span className="font-semibold">{item.label}</span>
                    <span className="text-muted-foreground">{item.branch}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Btn onClick={() => setWorkflowAction(null)}>Close</Btn>
              {!workflowAction?.status && (
                <Btn variant="primary" onClick={completeWorkflowAction}>
                  Record action
                </Btn>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {bare ? (
          <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
        ) : (
          <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 md:px-6">
            {title && (
              <div className="mb-5 grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <h1 className="truncate text-[22px] font-bold tracking-tight">{title}</h1>
                  {subtitle && (
                    <div className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</div>
                  )}
                </div>
                {actions && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    {actions}
                  </div>
                )}
              </div>
            )}
            {children}
          </main>
        )}
      </div>
    </div>
  );
}

function cleanCsvCell(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function routeForAction(label: string) {
  const normalized = label.toLowerCase();
  const entries: [string, string][] = [
    ["open pos", "/pos"],
    ["attendance", "/attendance"],
    ["receiving", "/receiving"],
    ["schedule", "/schedule"],
    ["purchase order", "/purchase-orders"],
    ["requisition", "/requisitions"],
    ["supplier", "/suppliers"],
    ["expense", "/expenses"],
    ["task", "/tasks"],
    ["report", "/reports"],
    ["customer", "/customers"],
    ["inventory", "/inventory"],
    ["stock", "/inventory"],
    ["reservation", "/reservations"],
    ["invoice", "/invoices"],
    ["receipt", "/receipts"],
    ["refund", "/refunds"],
    ["return", "/returns"],
    ["website", "/marketing"],
    ["channel", "/marketing"],
    ["audit", "/audit-trail"],
  ];
  return entries.find(([key]) => normalized.includes(key))?.[1];
}

function fieldsForAction(label: string) {
  const normalized = label.toLowerCase();
  if (
    normalized.includes("approve") ||
    normalized.includes("reject") ||
    normalized.includes("review")
  ) {
    return ["Decision note", "Approval reference"];
  }
  if (
    normalized.includes("new") ||
    normalized.includes("add") ||
    normalized.includes("create") ||
    normalized.includes("log")
  ) {
    return ["Record name", "Reference", "Notes"];
  }
  if (normalized.includes("save") || normalized.includes("publish")) {
    return ["Change summary", "Approval note"];
  }
  return ["Reference", "Notes"];
}
