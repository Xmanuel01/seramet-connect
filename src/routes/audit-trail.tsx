import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); the audit log and its export are on Enterprise.
export const Route = createFileRoute("/audit-trail")({
  beforeLoad: () => {
    throw redirect({ to: "/enterprise", replace: true });
  },
});
