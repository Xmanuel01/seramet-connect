import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { configuredTenantCurrency, formatBps, formatMinor, QualityStatus } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { Branch } from "@/platform/types";

export const Route = createFileRoute("/branches")({
  head: () => ({ meta: [{ title: "Branches - Seramet" }] }),
  component: Branches,
});

type BranchDraft = Pick<Branch, "name" | "code" | "address" | "phone" | "email">;

const emptyDraft: BranchDraft = { name: "", code: "", address: "", phone: "", email: "" };

function Branches() {
  const {
    activeTenantId,
    branchId,
    branchRecords,
    currentUser,
    isAllBranches,
    platformState,
    refreshConfiguration,
  } = useAppContext();
  const management = useManagementIntelligence();
  const repository = getConfigurationRepository();
  const tenantCurrency = configuredTenantCurrency(platformState.tenants, activeTenantId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BranchDraft>(emptyDraft);
  const [notice, setNotice] = useState("Branch configuration is saved to the active tenant.");

  const rows = useMemo(
    () =>
      branchRecords
        .filter((branch) => isAllBranches || branch.id === branchId)
        .map((branch) => {
          const control = management.controls.find((row) => row.branchId === branch.id);
          const ownerRow = management.owner?.branches.find(
            (row) => row.metric.branchId === branch.id,
          );
          const metric = ownerRow?.metric ?? control?.latest;
          const assignedUsers = platformState.users.filter(
            (user) =>
              user.tenantId === activeTenantId &&
              user.active &&
              user.assignedBranchIds.includes(branch.id),
          );
          return {
            ...branch,
            operator: assignedUsers[0]?.name ?? "Unassigned",
            sales: metric?.netSalesMinor ?? 0,
            currency: metric?.currency ?? tenantCurrency,
            orders: metric?.orderCount ?? 0,
            foodCostBps: metric?.foodCostBps ?? 0,
            staff: control?.staff.length ?? 0,
            state: ownerRow?.health?.status ?? control?.health?.status ?? "INSUFFICIENT DATA",
            quality: metric?.quality ?? "INSUFFICIENT_DATA",
          };
        }),
    [
      activeTenantId,
      branchId,
      branchRecords,
      isAllBranches,
      platformState.users,
      management.controls,
      management.owner?.branches,
      tenantCurrency,
    ],
  );

  const saveBranch = () => {
    const name = draft.name.trim();
    const code = draft.code.trim().toUpperCase();
    if (!name || !code) {
      setNotice("Branch name and code are required.");
      return;
    }
    const existing = editingId
      ? branchRecords.find((branch) => branch.id === editingId)
      : undefined;
    repository.upsertBranch(activeTenantId, {
      id: existing?.id ?? `branch-${slug(code)}-${Date.now().toString(36)}`,
      tenantId: activeTenantId,
      ...(existing?.brandId ? { brandId: existing.brandId } : {}),
      name,
      code,
      address: draft.address.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      active: true,
      metadata: existing?.metadata ?? { setupStatus: "INCOMPLETE" },
    });
    refreshConfiguration();
    setEditingId(null);
    setDraft(emptyDraft);
    setNotice(`${name} saved. Complete hardware and document setup before trading.`);
  };

  const editBranch = (branch: Branch) => {
    setEditingId(branch.id);
    setDraft({
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
    });
  };

  const archiveBranch = (branch: Branch) => {
    if (
      currentUser.assignedBranchIds.length === 1 &&
      currentUser.assignedBranchIds[0] === branch.id
    ) {
      setNotice("The operator's only assigned branch cannot be archived.");
      return;
    }
    repository.archiveBranch(activeTenantId, branch.id);
    refreshConfiguration();
    setNotice(`${branch.name} archived. Historical records remain unchanged.`);
  };

  return (
    <AppShell
      title="Branches"
      subtitle="Operational performance and configuration by location"
      actions={
        <Btn variant="primary" onClick={saveBranch}>
          {editingId ? "Save branch" : "Add branch"}
        </Btn>
      }
    >
      <Panel className="mb-4 p-4">
        <PanelHead
          title={editingId ? "Edit branch" : "Branch configuration"}
          sub="Every location is tenant-scoped and receives a permanent branch ID"
        />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {(
            [
              ["name", "Branch name"],
              ["code", "Code"],
              ["address", "Address"],
              ["phone", "Phone"],
              ["email", "Email"],
            ] as Array<[keyof BranchDraft, string]>
          ).map(([key, label]) => (
            <label key={key} className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              {label}
              <input
                value={draft[key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [key]: event.target.value }))
                }
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted-foreground">{notice}</p>
          {editingId && (
            <Btn
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft);
              }}
            >
              Cancel
            </Btn>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Branches" value={rows.length} />
        <Metric
          label="Net sales"
          value={formatMinor(
            rows.reduce((sum, row) => sum + row.sales, 0),
            rows[0]?.currency ?? tenantCurrency,
          )}
        />
        <Metric label="Employees" value={rows.reduce((sum, row) => sum + row.staff, 0)} />
        <Metric
          label="Needs attention"
          value={rows.filter((row) => row.state !== "HEALTHY").length}
          invert
        />
      </div>

      <Panel className="mt-4 overflow-x-auto">
        <PanelHead
          title="Configured locations"
          sub="Archiving preserves historical orders and reports"
        />
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <TH>Branch</TH>
              <TH>Code</TH>
              <TH>Primary operator</TH>
              <TH className="text-right">Orders</TH>
              <TH className="text-right">Net sales</TH>
              <TH className="text-right">Food cost</TH>
              <TH className="text-right">Staff</TH>
              <TH>Status</TH>
              <TH>Quality</TH>
              <TH>Actions</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <TD>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {item.address || "Address not configured"}
                  </div>
                </TD>
                <TD className="font-semibold">{item.code}</TD>
                <TD>{item.operator}</TD>
                <TD className="num text-right">{item.orders}</TD>
                <TD className="num text-right font-semibold">
                  {formatMinor(item.sales, item.currency)}
                </TD>
                <TD className="num text-right">{formatBps(item.foodCostBps)}</TD>
                <TD className="num text-right">{item.staff}</TD>
                <TD>
                  <Status>{item.state}</Status>
                </TD>
                <TD>
                  <QualityStatus quality={item.quality} />
                </TD>
                <TD>
                  <div className="flex gap-2">
                    <Btn onClick={() => editBranch(item)}>Edit</Btn>
                    <Btn onClick={() => archiveBranch(item)}>Archive</Btn>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
