import { createFileRoute, redirect } from "@tanstack/react-router";

// Not available yet; old links open the Finance overview.
export const Route = createFileRoute("/credit-notes")({
  beforeLoad: () => {
    throw redirect({ to: "/finance", replace: true });
  },
});
