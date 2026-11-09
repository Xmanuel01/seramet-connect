import { createFileRoute, redirect } from "@tanstack/react-router";

// Website and social channels aren't built yet; Marketing starts at Campaigns.
export const Route = createFileRoute("/marketing")({
  beforeLoad: () => {
    throw redirect({ to: "/campaigns", replace: true });
  },
});
