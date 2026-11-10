import { createFileRoute, redirect } from "@tanstack/react-router";

// Now the Performance tab of Suppliers; old links and bookmarks open it there.
export const Route = createFileRoute("/supplier-performance")({
  beforeLoad: () => {
    throw redirect({ to: "/suppliers", search: { view: "performance" }, replace: true });
  },
});
