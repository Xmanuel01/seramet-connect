import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { Btn } from "@/components/app/ui";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customer 360 - Seramet" },
      {
        name: "description",
        content: "Customer profiles, loyalty tiers, spend history and complaint tracking.",
      },
      { property: "og:title", content: "Customer 360 - Seramet" },
      {
        property: "og:description",
        content: "Loyalty, spend history and service recovery in one profile.",
      },
    ],
  }),
  component: Customers,
});

function Customers() {
  return (
    <AppShell
      title="Customers"
      subtitle="Customer profiles, order history, loyalty and service activity"
      actions={<Btn variant="primary">Add customer</Btn>}
    >
      <EmptyState
        title="No customers yet"
        description="Customer profiles will appear after they are created or linked to an order."
      />
    </AppShell>
  );
}
