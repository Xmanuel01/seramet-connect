import { createFileRoute } from "@tanstack/react-router";
import { DepreciationPage } from "@/finance/AdvancedFinanceModules";

export const Route = createFileRoute("/depreciation")({
  head: () => ({ meta: [{ title: "depreciation - Seramet" }] }),
  component: DepreciationPage,
});
