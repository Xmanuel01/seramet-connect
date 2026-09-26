import { createFileRoute } from "@tanstack/react-router";
import { PayablesPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/payables")({
  head: () => ({ meta: [{ title: "Accounts Payable - Seramet" }] }),
  component: PayablesPage,
});
