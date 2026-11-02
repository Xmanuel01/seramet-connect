import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Statements; old links open the matching tab.
export const Route = createFileRoute("/trial-balance")({
  beforeLoad: () => {
    throw redirect({ to: "/statements", search: { tab: "trial-balance" }, replace: true });
  },
});
