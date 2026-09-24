import { createFileRoute } from "@tanstack/react-router";
import { InventoryLossPage } from "@/inventory/InventoryLossPage";

export const Route = createFileRoute("/breakages")({
  head: () => ({
    meta: [
      { title: "Inventory Breakages - Seramet" },
      {
        name: "description",
        content: "Approval-gated damaged inventory with authoritative stock and cost impact.",
      },
    ],
  }),
  component: Breakages,
});

function Breakages() {
  return <InventoryLossPage kind="breakage" />;
}
