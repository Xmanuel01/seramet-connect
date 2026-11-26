import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); work waiting for a manager is on Approvals.
export const Route = createFileRoute("/tasks")({
  beforeLoad: () => {
    throw redirect({ to: "/approvals", replace: true });
  },
});
