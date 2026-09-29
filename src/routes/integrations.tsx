import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations - Seramet" },
      {
        name: "description",
        content:
          "Replaceable provider adapters for payments, banking, messaging, delivery marketplaces and fiscal compliance.",
      },
      { property: "og:title", content: "Integrations - Seramet" },
      {
        property: "og:description",
        content: "Manage payment, messaging, delivery and tax provider adapters from one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Integrations,
});

type Adapter = { name: string; category: string; status: string; note: string };

const adapters: Adapter[] = [
  { name: "M-Pesa", category: "Payments", status: "Pending", note: "Manual till and QR modelled; live Daraja credentials required" },
  { name: "Card acquirer", category: "Payments", status: "Pending", note: "Terminal settlement import not yet connected" },
  { name: "Bank feed", category: "Banking", status: "Pending", note: "Statement import drives reconciliation matching" },
  { name: "TendePay", category: "Payments", status: "Pending", note: "Sandbox adapter shape only - no live credentials" },
  { name: "WhatsApp Cloud", category: "Messaging", status: "Available", note: "Invoice and rider dispatch messages" },
  { name: "Email (SMTP)", category: "Messaging", status: "Available", note: "Statements, invoices and reports" },
  { name: "SMS gateway", category: "Messaging", status: "Available", note: "Fallback for rider and customer alerts" },
  { name: "Uber Eats", category: "Delivery", status: "Pending", note: "Order ingestion into the single delivery engine" },
  { name: "Glovo", category: "Delivery", status: "Pending", note: "Order ingestion into the single delivery engine" },
  { name: "Bolt Food", category: "Delivery", status: "Pending", note: "Order ingestion into the single delivery engine" },
  { name: "Tax / fiscal", category: "Compliance", status: "Pending", note: "Fiscal receipt signing rules to be confirmed" },
];

const categories = ["Payments", "Banking", "Messaging", "Delivery", "Compliance"];

function Integrations() {
  return (
    <AppShell
      title="Integrations"
      subtitle="Replaceable provider adapters - no business logic is hard-coded to one provider"
      actions={
        <>
          <Btn>Adapter docs</Btn>
          <Btn variant="primary">Add provider</Btn>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {categories.map((category) => (
          <Panel key={category}>
            <PanelHead
              title={category}
              sub={`${adapters.filter((a) => a.category === category).length} adapter(s)`}
            />
            <ul className="divide-y divide-border">
              {adapters
                .filter((adapter) => adapter.category === category)
                .map((adapter) => (
                  <li key={adapter.name} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold">{adapter.name}</span>
                      <Status>{adapter.status}</Status>
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">{adapter.note}</p>
                  </li>
                ))}
            </ul>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
