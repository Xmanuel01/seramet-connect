import { createFileRoute } from "@tanstack/react-router";
import { BalanceSheetPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet - Seramet" }] }),
  component: BalanceSheetPage,
});
