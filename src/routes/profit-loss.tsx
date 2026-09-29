import { createFileRoute } from "@tanstack/react-router";
import { IncomeStatementPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/profit-loss")({
  head: () => ({ meta: [{ title: "Posted Profit and Loss - Seramet" }] }),
  component: IncomeStatementPage,
});
