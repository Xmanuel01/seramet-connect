import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into the Finance overview.
export const Route = createFileRoute("/accounting")({
  beforeLoad: () => {
    throw redirect({ to: "/finance", replace: true });
  },
});
