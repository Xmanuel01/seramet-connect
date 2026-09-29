import { createFileRoute } from "@tanstack/react-router";
import { BudgetsPage } from "@/finance/AdvancedFinanceModules";

export const Route = createFileRoute("/budgets")({
  head: () => ({ meta: [{ title: "budgets - Seramet" }] }),
  component: BudgetsPage,
});
