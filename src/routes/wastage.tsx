import { createFileRoute } from "@tanstack/react-router";
import { InventoryLossPage } from "@/inventory/InventoryLossPage";

export const Route = createFileRoute("/wastage")({
  head: () => ({
    meta: [
      { title: "Inventory Wastage - Seramet" },
      {
        name: "description",
        content: "Approval-gated food and inventory wastage with authoritative cost impact.",
      },
    ],
  }),
  component: Wastage,
});

function Wastage() {
  return <InventoryLossPage kind="wastage" />;
}
