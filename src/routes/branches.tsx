import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { configuredTenantCurrency, formatBps, formatMinor, QualityStatus } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/branches")({
  head: () => ({ meta: [{ title: "Branches - Seramet" }] }),
  component: Branches,
});

function Branches() {
  const { activeTenantId, branchId, branchRecords, isAllBranches, platformState } = useAppContext();
  const management = useManagementIntelligence();
  const tenantCurrency = configuredTenantCurrency(platformState.tenants, activeTenantId);

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

  return (
    <AppShell
      title="Branches"
      subtitle="Operational performance and configuration by location"
      actions={
        <Link
          to="/seramet-setup"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Manage branches
        </Link>
      }
    >
      <Panel className="mb-4 p-4">
        <PanelHead
          title="Authoritative branch configuration"
          sub="Create and configure locations in Setup Centre, where lifecycle, duplicate review, hierarchy and audit controls are enforced"
        />
        <p className="mt-3 max-w-3xl text-[12px] leading-5 text-muted-foreground">
          This page is an operational read model. Branch mutations are intentionally handled by the
          server-backed setup workflow and cannot fall back to browser persistence.
        </p>
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
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
