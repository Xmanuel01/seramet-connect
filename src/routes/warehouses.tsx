import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/warehouses")({
  head: () => ({
    meta: [
      { title: "Warehouses - Seramet" },
      {
        name: "description",
        content: "Authoritative branch warehouse configuration with archive safety controls.",
      },
    ],
  }),
  component: Warehouses,
});

function Warehouses() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const operations = useInventoryOperations(authoritative);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo(
    () =>
      operations.control.data.flatMap((branch) =>
        branch.warehouses.map((warehouse) => ({ ...warehouse, branchId: branch.branchId })),
      ),
    [operations.control.data],
  );
  const totalValue = rows.reduce((sum, row) => sum + Number(row.stock_value_minor ?? 0), 0);

  const archive = async (id: string, name: string) => {
    const reason = window.prompt(
      `Archive ${name}? Enter the reason. This is blocked if stock or active workflows still reference the location.`,
      "",
    );
    if (!reason?.trim()) return;
    try {
      await operations.command(
        `/api/seramet/inventory/warehouses/${encodeURIComponent(id)}/archive`,
        { reason: reason.trim() },
      );
      setNotice(`${name} archived.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Warehouse could not be archived");
    }
  };

  return (
    <AppShell
      title="Warehouses & stores"
      subtitle={`${branchLabel} - authoritative inventory storage locations`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || operations.control.status !== "ready"}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close form" : "New location"}
        </Btn>
      }
    >
      {(notice || operations.error || operations.control.error) && (
        <Notice>{notice || operations.error || operations.control.error}</Notice>
      )}

      {showForm && (
        <WarehouseForm
          branches={operations.control.data}
          busy={operations.control.status === "loading"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (body) => {
            try {
              await operations.command("/api/seramet/inventory/warehouses", body);
              setNotice("Warehouse created.");
              setShowForm(false);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Warehouse could not be created");
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Storage locations" value={rows.length} />
        <Metric label="Main stores" value={rows.filter((row) => row.location_type === "MAIN").length} />
        <Metric label="Stocked locations" value={rows.filter((row) => Number(row.stocked_item_count ?? 0) > 0).length} />
        <Metric label="Stock value" value={totalValue / 100} money />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Locations"
          sub="Archive is blocked while stock, active counts/transfers or item defaults still reference a location"
        />
        <DataTable
          cols={[
            "Location",
            "Code",
            "Branch",
            "Type",
            { l: "Stocked items", r: true },
            { l: "Stock value", r: true },
            "Status",
            "Action",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-secondary/50">
              <TD className="font-semibold">{row.name}</TD>
              <TD className="num">{row.code}</TD>
              <TD className="text-muted-foreground">{row.branchId}</TD>
              <TD>{row.location_type}</TD>
              <TD className="num text-right">{Number(row.stocked_item_count ?? 0)}</TD>
              <TD className="num text-right font-semibold">{ksh(Number(row.stock_value_minor ?? 0) / 100)}</TD>
              <TD><Status>{Number(row.active) === 1 ? "Active" : "Archived"}</Status></TD>
              <TD>
                {Number(row.active) === 1 ? (
                  <button
                    type="button"
                    onClick={() => void archive(row.id, row.name)}
                    className="text-[12px] font-semibold text-danger hover:underline"
                  >
                    Archive
                  </button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Final</span>
                )}
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}

function WarehouseForm({
  branches,
  busy,
  onCancel,
  onSubmit,
}: {
  branches: ReturnType<typeof useInventoryOperations>["control"]["data"];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.branchId ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [locationType, setLocationType] = useState<
    "MAIN" | "KITCHEN" | "BAR" | "COLD" | "TRANSIT" | "OTHER"
  >("MAIN");

  return (
    <Panel className="mb-4">
      <PanelHead title="Create storage location" sub="Locations are branch-scoped and used by stock, counts and transfers" />
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <Field label="Branch">
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={inputClass}>
            {branches.map((row) => <option key={row.branchId} value={row.branchId}>{row.branchId}</option>)}
          </select>
        </Field>
        <Field label="Location name">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!code) setCode(slugCode(next));
            }}
            placeholder="Main Store"
          />
        </Field>
        <Field label="Code">
          <input className={inputClass} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="MAIN" />
        </Field>
        <Field label="Type">
          <select value={locationType} onChange={(event) => setLocationType(event.target.value as typeof locationType)} className={inputClass}>
            {(["MAIN", "KITCHEN", "BAR", "COLD", "TRANSIT", "OTHER"] as const).map((type) => <option key={type}>{type}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={busy || !branchId || !name.trim() || !code.trim()}
          onClick={() => void onSubmit({ branchId, name: name.trim(), code: code.trim().toUpperCase(), locationType })}
        >
          Create location
        </Btn>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">{label}{children}</label>;
}
function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{children}</div>;
}
function slugCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
const inputClass = "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
