import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Statements; old links open the matching tab.
export const Route = createFileRoute("/balance-sheet")({
  beforeLoad: () => {
    throw redirect({ to: "/statements", search: { tab: "balance-sheet" }, replace: true });
  },
});
