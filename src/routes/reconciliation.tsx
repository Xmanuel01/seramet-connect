import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Payments → Bank & reconciliation.
export const Route = createFileRoute("/reconciliation")({
  beforeLoad: () => {
    throw redirect({ to: "/payment-control", search: { tab: "bank" }, replace: true });
  },
});
