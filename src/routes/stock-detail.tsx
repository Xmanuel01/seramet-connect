import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";

export const Route = createFileRoute("/stock-detail")({
  head: () => ({ meta: [{ title: "Stock Detail - Seramet" }] }),
  component: StockDetail,
});

function StockDetail() {
  return (
    <AppShell title="Stock detail" subtitle="Inventory balance, valuation and movement history">
      <EmptyState
        title="Select an inventory item"
        description="Open an item from Inventory to review its authoritative stock and movement history."
      />
    </AppShell>
  );
}
