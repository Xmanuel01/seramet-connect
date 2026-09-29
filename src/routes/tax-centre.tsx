import { createFileRoute } from "@tanstack/react-router";
import { TaxCentrePage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/tax-centre")({
  head: () => ({ meta: [{ title: "Tax Control - Seramet" }] }),
  component: TaxCentrePage,
});
