import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Statements; old links open the matching tab.
export const Route = createFileRoute("/profit-loss")({
  beforeLoad: () => {
    throw redirect({ to: "/statements", search: { tab: "profit-loss" }, replace: true });
  },
});
