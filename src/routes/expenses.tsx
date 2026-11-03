import { createFileRoute } from "@tanstack/react-router";
import { ExpensesPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/expenses")({
  head: () => ({ meta: [{ title: "Expenses - Seramet" }] }),
  component: ExpensesPage,
});
