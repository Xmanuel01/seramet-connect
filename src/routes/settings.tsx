import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { getRoutePermissionRoles, setRoutePermissionRoles } from "@/components/app/nav";
import { useAppContext, type AppRole } from "@/lib/app-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - Seramet" },
      {
        name: "description",
        content: "Company, branches, users, roles, POS, finance and integration configuration.",
      },
      { property: "og:title", content: "Settings - Seramet" },
      { property: "og:description", content: "Configure company, branches, roles and modules." },
    ],
  }),
  component: Settings,
});

const groups = [
  { g: "Company", items: ["Profile", "Branches", "Operating hours", "Currencies"] },
  { g: "Users and access", items: ["Users", "Roles", "Permissions", "Approval limits"] },
  { g: "POS and restaurant", items: ["Registers", "Tables", "Order types", "Receipt templates"] },
  { g: "Inventory", items: ["Units", "Categories", "Warehouses", "PAR rules"] },
  {
    g: "Procurement",
    items: ["PO numbering", "Supplier terms", "Receiving rules", "Approval routing"],
  },
  { g: "Finance", items: ["Chart of accounts", "Taxes", "Payment methods", "Payroll"] },
  { g: "CRM", items: ["Segments", "Loyalty tiers", "Coupons", "Complaint SLAs"] },
  { g: "Website and marketing", items: ["Website", "Social pages", "WhatsApp", "Campaigns"] },
  {
    g: "Platform",
    items: ["Integrations", "Notifications", "AI", "Appearance", "Audit", "System"],
  },
];

function Settings() {
  const { branches, roles, addBranch, removeBranch, addRole, removeRole } = useAppContext();
  const [active, setActive] = useState(groups[1]!.g);
  const [dashboardRoles, setDashboardRoles] = useState<AppRole[]>(() =>
    getRoutePermissionRoles("/"),
  );
  const [marketingRoles, setMarketingRoles] = useState<AppRole[]>(() =>
    getRoutePermissionRoles("/marketing"),
  );
  const [newBranch, setNewBranch] = useState("");
  const [newRole, setNewRole] = useState("");
  const [selectedSetting, setSelectedSetting] = useState("Approval limits");
  const current = groups.find((group) => group.g === active)!;

  const toggleRouteRole = (
    path: string,
    role: AppRole,
    currentRoles: AppRole[],
    setter: (roles: AppRole[]) => void,
  ) => {
    const next = currentRoles.includes(role)
      ? currentRoles.filter((item) => item !== role)
      : [...currentRoles, role];
    setter(next);
    setRoutePermissionRoles(path, next);
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Mona Swahili - 2 branches - 42 users"
      actions={
        <>
          <Btn>Audit log</Btn>
          <Btn variant="primary">Save changes</Btn>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="p-2">
          <nav className="space-y-1">
            {groups.map((group) => (
              <button
                key={group.g}
                onClick={() => setActive(group.g)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] font-semibold",
                  active === group.g
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <span>{group.g}</span>
                <span className="num text-[11px]">{group.items.length}</span>
              </button>
            ))}
          </nav>
        </Panel>

        <div className="grid gap-4">
          <Panel>
            <PanelHead
              title={current.g}
              sub="Configure related settings without exposing every option at once"
            />
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {current.items.map((item, index) => (
                <button
                  key={item}
                  onClick={() => setSelectedSetting(item)}
                  className="rounded-lg border border-border p-3 text-left hover:bg-secondary/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{item}</span>
                    <Status>
                      {index % 3 === 0 ? "Active" : index % 3 === 1 ? "Pending" : "Healthy"}
                    </Status>
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Manage {item.toLowerCase()} settings for Seramet roles, branches and module
                    behaviour.
                  </p>
                </button>
              ))}
            </div>
          </Panel>

          {active === "Users and access" && (
            <Panel>
              <PanelHead
                title="Page privileges"
                sub="Managers can decide which roles see sensitive pages"
              />
              <div className="p-4">
                <div className="mb-4 rounded-lg border border-border p-3">
                  <div className="text-[13px] font-bold">Roles</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roles.map((role) => (
                      <span
                        key={role}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-semibold"
                      >
                        {role}
                        {role !== "General Manager" && (
                          <button
                            onClick={() => removeRole(role)}
                            className="text-muted-foreground hover:text-danger"
                          >
                            Remove
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={newRole}
                      onChange={(event) => setNewRole(event.target.value)}
                      placeholder="Add role"
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
                    />
                    <Btn
                      onClick={() => {
                        addRole(newRole);
                        setNewRole("");
                      }}
                    >
                      Add role
                    </Btn>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr>
                        <th className="border-b border-border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          Page
                        </th>
                        {roles.map((role) => (
                          <th
                            key={role}
                            className="border-b border-border px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
                          >
                            {role}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          path: "/",
                          label: "Dashboard",
                          detail: "Net sales, profit, branch performance and management alerts.",
                          selected: dashboardRoles,
                          set: setDashboardRoles,
                        },
                        {
                          path: "/marketing",
                          label: "Website & Channels",
                          detail: "Restaurant website, social pages and WhatsApp management.",
                          selected: marketingRoles,
                          set: setMarketingRoles,
                        },
                      ].map((row) => (
                        <tr key={row.path}>
                          <td className="border-b border-border px-3 py-3">
                            <div className="font-semibold">{row.label}</div>
                            <div className="text-[12px] text-muted-foreground">{row.detail}</div>
                          </td>
                          {roles.map((role) => (
                            <td key={role} className="border-b border-border px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={row.selected.includes(role)}
                                onChange={() =>
                                  toggleRouteRole(row.path, role, row.selected, row.set)
                                }
                                className="h-4 w-4 accent-primary"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
                  Defaults keep dashboard access to managers only. Any enabled role sees the
                  matching navigation item after refresh.
                </div>
              </div>
            </Panel>
          )}

          {active === "Company" && (
            <Panel>
              <PanelHead
                title="Branches"
                sub="Add or remove locations without changing application code"
              />
              <div className="space-y-3 p-4">
                <div className="grid gap-2 md:grid-cols-2">
                  {branches.map((branch) => (
                    <div
                      key={branch}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    >
                      <span className="text-[13px] font-semibold">{branch}</span>
                      {branch !== "All Branches" && (
                        <button
                          onClick={() => removeBranch(branch)}
                          className="text-[12px] font-semibold text-muted-foreground hover:text-danger"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newBranch}
                    onChange={(event) => setNewBranch(event.target.value)}
                    placeholder="Add branch"
                    className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
                  />
                  <Btn
                    onClick={() => {
                      addBranch(newBranch);
                      setNewBranch("");
                    }}
                  >
                    Add branch
                  </Btn>
                </div>
              </div>
            </Panel>
          )}

          {active === "Website and marketing" && (
            <Panel>
              <PanelHead
                title="Website, social and WhatsApp"
                sub="For operators with Website and Marketing privileges"
              />
              <div className="grid gap-3 p-4 md:grid-cols-3">
                {[
                  ["Website menu", "Publish menu items, photos, prices and branch availability."],
                  [
                    "Social pages",
                    "Plan Instagram, Facebook and TikTok posts from approved offers.",
                  ],
                  [
                    "WhatsApp Business",
                    "Manage catalog links, quick replies and customer broadcasts.",
                  ],
                ].map(([title, detail]) => (
                  <button
                    key={title}
                    onClick={() => setSelectedSetting(title)}
                    className="rounded-lg border border-border p-3 text-left hover:bg-secondary/60"
                  >
                    <div className="text-[13px] font-semibold">{title}</div>
                    <p className="mt-2 text-[12px] text-muted-foreground">{detail}</p>
                    <Status>Configurable</Status>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHead
              title={`Selected setting: ${selectedSetting}`}
              sub="Sensitive finance and inventory changes require controlled approval"
            />
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-3">
                {[
                  ["Purchase order auto-approval", "KSh 10,000"],
                  ["Cash variance manager approval", "KSh 500"],
                  ["Refund supervisor approval", "KSh 2,000"],
                  ["Stock adjustment reason required", "Always"],
                ].map(([label, value]) => (
                  <label key={label} className="grid gap-1 text-[12px] font-semibold">
                    {label}
                    <input
                      className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
                      defaultValue={value}
                    />
                  </label>
                ))}
              </div>
              <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
                <div className="text-[13px] font-semibold text-warning">Security note</div>
                <p className="mt-1 text-[12px]">
                  High-risk actions such as refunds, payroll changes and stock adjustments should
                  require a reason and an immutable audit entry.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
