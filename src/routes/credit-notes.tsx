import { createFileRoute } from "@tanstack/react-router";
import { CreditNotesPage } from "@/finance/AdvancedFinanceModules";

export const Route = createFileRoute("/credit-notes")({
  head: () => ({ meta: [{ title: "credit notes - Seramet" }] }),
  component: CreditNotesPage,
});
