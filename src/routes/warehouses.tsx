import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useAppContext } from "@/lib/app-context";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { Warehouse } from "@/platform/types";

export const Route = createFileRoute("/warehouses")({
  head: () => ({
    meta: [
      { title: "Warehouses - Seramet" },
      { name: "description", content: "Tenant and branch-scoped warehouse configuration." },
    ],
  }),
  component: Warehouses,
});

type WarehouseDraft = Pick<Warehouse, "name" | "code" | "type" | "branchId">;

function Warehouses() {
  const {
    activeTenantId,
    branchId,
    branchLabel,
    branchRecords,
    isAllBranches,
    platformState,
    refreshConfiguration,
  } = useAppContext();
  const repository = getConfigurationRepository();
  const visibleBranches = branchRecords.filter((branch) => isAllBranches || branch.id === branchId);
  const [draft, setDraft] = useState<WarehouseDraft>({
    name: "",
    code: "",
    type: "MAIN",
    branchId: visibleBranches[0]?.id ?? branchId,
  });
  const [notice, setNotice] = useState("Storage locations are linked to a configured branch ID.");
  const warehouses = platformState.warehouses.filter(
    (warehouse) =>
      warehouse.tenantId === activeTenantId &&
      warehouse.active &&
      (isAllBranches || warehouse.branchId === branchId),
  );
  const branchNames = new Map(branchRecords.map((branch) => [branch.id, branch.name]));

  const saveWarehouse = () => {
    const name = draft.name.trim();
    const code = draft.code.trim().toUpperCase();
    if (!name || !code || !draft.branchId) {
      setNotice("Location name, code and branch are required.");
      return;
    }
    repository.upsertWarehouse(activeTenantId, {
      id: `warehouse-${slug(code)}-${Date.now().toString(36)}`,
      tenantId: activeTenantId,
      branchId: draft.branchId,
      name,
      code,
      type: draft.type,
      active: true,
    });
    refreshConfiguration();
    setDraft((current) => ({ ...current, name: "", code: "" }));
    setNotice(`${name} added.`);
  };

  const archiveWarehouse = (warehouse: Warehouse) => {
    repository.archiveWarehouse(activeTenantId, warehouse.id);
    refreshConfiguration();
    setNotice(`${warehouse.name} archived. Existing stock history remains linked to its ID.`);
  };

  return (
    <AppShell
      title="Warehouses & stores"
      subtitle={`${warehouses.length} storage locations - ${branchLabel}`}
      actions={
        <Btn variant="primary" onClick={saveWarehouse}>
          New location
        </Btn>
      }
    >
      <Panel className="p-4">
        <PanelHead
          title="Location configuration"
          sub="Create main, kitchen, bar, cold and transit stores"
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Location name"
            value={draft.name}
            onChange={(name) => setDraft((current) => ({ ...current, name }))}
          />
          <Field
            label="Code"
            value={draft.code}
            onChange={(code) => setDraft((current) => ({ ...current, code }))}
          />
          <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
            Branch
            <select
              value={draft.branchId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, branchId: event.target.value }))
              }
              className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
            >
              {visibleBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
            Type
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  type: event.target.value as Warehouse["type"],
                }))
              }
              className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
            >
              {(["MAIN", "KITCHEN", "BAR", "COLD", "TRANSIT", "OTHER"] as const).map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">{notice}</p>
      </Panel>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Storage locations" value={warehouses.length} />
        <Metric
          label="Main stores"
          value={warehouses.filter((row) => row.type === "MAIN").length}
        />
        <Metric
          label="Production stores"
          value={warehouses.filter((row) => ["KITCHEN", "BAR"].includes(row.type)).length}
        />
        <Metric
          label="Configured branches"
          value={new Set(warehouses.map((row) => row.branchId)).size}
        />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Locations"
          sub="Configuration records are used by inventory, transfers and counts"
        />
        <DataTable cols={["Location", "Code", "Branch", "Type", "Status", "Actions"]}>
          {warehouses.map((warehouse) => (
            <tr key={warehouse.id} className="hover:bg-secondary/50">
              <TD className="font-semibold">{warehouse.name}</TD>
              <TD>{warehouse.code}</TD>
              <TD>{branchNames.get(warehouse.branchId) ?? "Unknown branch"}</TD>
              <TD>{warehouse.type}</TD>
              <TD>
                <Status>Active</Status>
              </TD>
              <TD>
                <Btn onClick={() => archiveWarehouse(warehouse)}>Archive</Btn>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
