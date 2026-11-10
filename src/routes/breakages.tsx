import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Losses & corrections; old links and bookmarks open the matching tab.
export const Route = createFileRoute("/breakages")({
  beforeLoad: () => {
    throw redirect({ to: "/stock-losses", search: { tab: "breakages" }, replace: true });
  },
});
