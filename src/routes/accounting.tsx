import { createFileRoute } from "@tanstack/react-router";
import { AccountingHubPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/accounting")({
  head: () => ({ meta: [{ title: "Accounting Hub - Seramet" }] }),
  component: AccountingHubPage,
});
