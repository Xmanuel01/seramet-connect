import { createFileRoute } from "@tanstack/react-router";
import { CashFlowPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/cash-flow")({
  head: () => ({ meta: [{ title: "Cash Flow - Seramet" }] }),
  component: CashFlowPage,
});
