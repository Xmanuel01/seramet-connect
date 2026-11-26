import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); approvals waiting for a decision are on Approvals.
export const Route = createFileRoute("/decisions")({
  beforeLoad: () => {
    throw redirect({ to: "/approvals", replace: true });
  },
});
