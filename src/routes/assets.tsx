import { createFileRoute } from "@tanstack/react-router";
import { AssetsPage } from "@/finance/AdvancedFinanceModules";

export const Route = createFileRoute("/assets")({
  head: () => ({ meta: [{ title: "assets - Seramet" }] }),
  component: AssetsPage,
});
