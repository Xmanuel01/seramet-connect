import { createFileRoute, redirect } from "@tanstack/react-router";

// Never built (it showed no data); refunds are handled under Payments → Refunds.
export const Route = createFileRoute("/returns")({
  beforeLoad: () => {
    throw redirect({ to: "/payment-control", search: { tab: "refunds" }, replace: true });
  },
});
