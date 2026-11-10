import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { cn } from "@/lib/utils";
import { BreakagesPanel } from "@/inventory/losses/BreakagesPanel";
import { CorrectionsPanel } from "@/inventory/losses/CorrectionsPanel";
import { WastagePanel } from "@/inventory/losses/WastagePanel";

type Tab = "wastage" | "breakages" | "corrections";
const tabs: { id: Tab; label: string }[] = [
  { id: "wastage", label: "Wastage" },
  { id: "breakages", label: "Breakages" },
  { id: "corrections", label: "Corrections" },
];

export const Route = createFileRoute("/stock-losses")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: tabs.some((tab) => tab.id === search.tab) ? (search.tab as Tab) : undefined,
  }),
  head: () => ({ meta: [{ title: "Losses & Corrections - Seramet" }] }),
  component: StockLosses,
});

/**
 * Everything that takes stock out or corrects it, recorded the same way: someone logs it and
 * a manager approves it before stock changes. Each tab shows only to people allowed to use it.
 */
function StockLosses() {
  const { branchLabel, hasPermission } = useAppContext();
  const navigate = useNavigate({ from: "/stock-losses" });
  const allowed = tabs.filter((tab) =>
    tab.id === "corrections"
      ? hasPermission(permissions.inventoryAdjust)
      : hasPermission(permissions.wasteRecord),
  );
  const requested = Route.useSearch().tab;
  const active = allowed.find((tab) => tab.id === requested) ?? allowed[0];

  return (
    <AppShell title="Losses & corrections" subtitle={branchLabel}>
      {active ? (
        <>
          <div
            role="tablist"
            aria-label="Type"
            className="mb-4 flex flex-wrap items-center gap-1 border-b border-border"
          >
            {allowed.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={tab.id === active.id}
                onClick={() => void navigate({ search: { tab: tab.id }, replace: true })}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
                  tab.id === active.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {active.id === "wastage" && <WastagePanel />}
          {active.id === "breakages" && <BreakagesPanel />}
          {active.id === "corrections" && <CorrectionsPanel />}
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Ask the owner to give your role access to stock losses.
        </p>
      )}
    </AppShell>
  );
}
