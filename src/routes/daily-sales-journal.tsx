import { createFileRoute } from "@tanstack/react-router";
import { DailySalesJournalPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/daily-sales-journal")({
  head: () => ({ meta: [{ title: "Daily Sales Journal - Seramet" }] }),
  component: DailySalesJournalPage,
});
