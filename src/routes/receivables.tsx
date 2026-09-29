import { createFileRoute } from "@tanstack/react-router";
import { ReceivablesPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/receivables")({
  head: () => ({ meta: [{ title: "Accounts Receivable - Seramet" }] }),
  component: ReceivablesPage,
});
