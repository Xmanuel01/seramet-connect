import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Statements; old links open the matching tab.
export const Route = createFileRoute("/cash-flow")({
  beforeLoad: () => {
    throw redirect({ to: "/statements", search: { tab: "cash-flow" }, replace: true });
  },
});
