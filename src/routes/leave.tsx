import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); goes to the Workforce overview.
export const Route = createFileRoute("/leave")({
  beforeLoad: () => {
    throw redirect({ to: "/people", replace: true });
  },
});
