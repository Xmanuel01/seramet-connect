import { createFileRoute, redirect } from "@tanstack/react-router";

// The daily sales journal is the ledger filtered to sales.
export const Route = createFileRoute("/daily-sales-journal")({
  beforeLoad: () => {
    throw redirect({ to: "/general-ledger", search: { source: "sales" }, replace: true });
  },
});
