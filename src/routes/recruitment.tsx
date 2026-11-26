import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); goes to the Workforce overview.
export const Route = createFileRoute("/recruitment")({
  beforeLoad: () => {
    throw redirect({ to: "/people", replace: true });
  },
});
