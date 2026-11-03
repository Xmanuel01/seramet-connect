import { createFileRoute } from "@tanstack/react-router";
import { isStatementTab, StatementsPage, type StatementTab } from "@/finance/StatementsPage";

export const Route = createFileRoute("/statements")({
  validateSearch: (search: Record<string, unknown>): { tab: StatementTab } => ({
    tab: isStatementTab(search["tab"]) ? search["tab"] : "profit-loss",
  }),
  head: () => ({ meta: [{ title: "Statements - Seramet" }] }),
  component: Statements,
});

function Statements() {
  const { tab } = Route.useSearch();
  return <StatementsPage tab={tab} />;
}
