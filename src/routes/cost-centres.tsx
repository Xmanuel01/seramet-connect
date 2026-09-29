import { createFileRoute } from "@tanstack/react-router";
import { CostCentresPage } from "@/finance/AdvancedFinanceModules";

export const Route = createFileRoute("/cost-centres")({
  head: () => ({ meta: [{ title: "cost centres - Seramet" }] }),
  component: CostCentresPage,
});
