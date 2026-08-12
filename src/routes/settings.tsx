import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Panel, PanelHead } from "@/components/app/ui";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Seramet" },
      { name: "description", content: "Company, branches, users, roles, POS, finance and integration configuration." },
      { property: "og:title", content: "Settings — Seramet" },
      { property: "og:description", content: "Configure company, branches, roles and modules." },
    ],
  }),
  component: Settings,
});

const groups = [
  { g: "Organisation", items: ["Company", "Branches", "Users", "Roles & permissions"] },
  { g: "Operations", items: ["POS", "Restaurant", "Inventory", "Procurement"] },
  { g: "Money", items: ["Finance", "Payments", "Taxes", "Payroll"] },
  { g: "Platform", items: ["Integrations", "Notifications", "AI", "Appearance", "Audit"] },
];

function Settings() {
  return (
    <AppShell title="Settings" subtitle="Mona Swahili · 2 branches · 42 users">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <Panel key={g.g}>
            <PanelHead title={g.g} />
            <ul className="divide-y divide-border">
              {g.items.map((i) => (
                <li key={i} className="px-4 py-2.5 text-[13px] hover:bg-secondary/50">{i}</li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}