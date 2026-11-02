import { createFileRoute } from "@tanstack/react-router";
import { GeneralLedgerPage } from "@/finance/FinancialReports";

export const Route = createFileRoute("/general-ledger")({
  validateSearch: (search: Record<string, unknown>): { account?: string; source?: "sales" } => ({
    ...(typeof search["account"] === "string" && search["account"]
      ? { account: search["account"] }
      : {}),
    ...(search["source"] === "sales" ? { source: "sales" as const } : {}),
  }),
  head: () => ({ meta: [{ title: "General Ledger - Seramet" }] }),
  component: GeneralLedger,
});

function GeneralLedger() {
  const { account, source } = Route.useSearch();
  return <GeneralLedgerPage {...(account ? { account } : {})} {...(source ? { source } : {})} />;
}
