import { createFileRoute, redirect } from "@tanstack/react-router";

// Now a view of Items; old links and bookmarks open it there.
export const Route = createFileRoute("/par")({
  beforeLoad: () => {
    throw redirect({ to: "/inventory-items", search: { view: "reorder" }, replace: true });
  },
});
