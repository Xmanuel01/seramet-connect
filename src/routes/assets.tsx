import { createFileRoute, redirect } from "@tanstack/react-router";

// Not available yet; old links open the Finance overview.
export const Route = createFileRoute("/assets")({
  beforeLoad: () => {
    throw redirect({ to: "/finance", replace: true });
  },
});
