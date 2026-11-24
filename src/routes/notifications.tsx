import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); items needing attention are on Approvals.
export const Route = createFileRoute("/notifications")({
  beforeLoad: () => {
    throw redirect({ to: "/approvals", replace: true });
  },
});
