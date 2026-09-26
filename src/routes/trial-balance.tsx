import { createFileRoute } from "@tanstack/react-router";
import { TrialBalancePage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/trial-balance")({
  head: () => ({ meta: [{ title: "Trial Balance - Seramet" }] }),
  component: TrialBalancePage,
});
