import { createFileRoute } from "@tanstack/react-router";
import { PrimeCostPage } from "@/finance/AdvancedFinanceModules";

export const Route = createFileRoute("/prime-cost")({
  head: () => ({ meta: [{ title: "prime cost - Seramet" }] }),
  component: PrimeCostPage,
});
