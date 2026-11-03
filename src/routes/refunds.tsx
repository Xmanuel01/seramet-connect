import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Payments → Refunds.
export const Route = createFileRoute("/refunds")({
  beforeLoad: () => {
    throw redirect({ to: "/payment-control", search: { tab: "refunds" }, replace: true });
  },
});
