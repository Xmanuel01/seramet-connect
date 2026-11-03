import { createFileRoute } from "@tanstack/react-router";
import { ReceivablesPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/receivables")({
  head: () => ({ meta: [{ title: "Receivables - Seramet" }] }),
  component: ReceivablesPage,
});
