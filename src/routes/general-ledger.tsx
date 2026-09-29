import { createFileRoute } from "@tanstack/react-router";
import { GeneralLedgerPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/general-ledger")({
  head: () => ({ meta: [{ title: "General Ledger - Seramet" }] }),
  component: GeneralLedgerPage,
});
