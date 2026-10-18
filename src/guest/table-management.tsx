import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AddTableDialog } from "@/components/app/AddTableDialog";
import { DiningAreaDialog } from "@/components/app/DiningAreaDialog";
import { EditTableDialog } from "@/components/app/EditTableDialog";
import { Chips, Panel, Status } from "@/components/app/ui";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/lib/app-context";

const stateStyle: Record<string, string> = {
  Available: "border-border bg-card",
  Occupied: "border-primary/40 bg-accent/50",
  Reserved: "border-info/30 bg-info-soft",
  "Needs Cleaning": "border-warning/30 bg-warning-soft",
  Unavailable: "border-border bg-secondary opacity-60",
  Unknown: "border-border bg-secondary",
};

export function TableManagement({
  statuses,
  onChanged,
}: {
  statuses: readonly { id: string; status: string }[] | undefined;
  onChanged: () => void;
}) {
  const { branchId, branchLabel, platformState } = useAppContext();
  const serviceAreas = platformState.serviceAreas.filter(
    (serviceArea) => serviceArea.branchId === branchId && serviceArea.active,
  );
  const areaOptions = serviceAreas.map((serviceArea) => serviceArea.name);
  const [area, setArea] = useState("");
  const activeArea = area || areaOptions[0] || "Dining";
  const [tableStatus, setTableStatus] = useState("All");
  const [selectedTableNo, setSelectedTableNo] = useState<string | null>(null);
  const configuredTables = platformState.tables
    .filter((table) => table.branchId === branchId && table.active)
    .map((configuredTable) => {
      const configuredArea = serviceAreas.find(
        (serviceArea) => serviceArea.id === configuredTable.serviceAreaId,
      );
      const liveStatus = statuses?.find((table) => table.id === configuredTable.id)?.status;
      return {
        id: configuredTable.id,
        serviceAreaId: configuredTable.serviceAreaId ?? null,
        no: configuredTable.code,
        area: configuredArea?.name ?? activeArea,
        seats: configuredTable.seats,
        state:
          liveStatus === "AVAILABLE"
            ? "Available"
            : liveStatus === "RESERVED"
              ? "Reserved"
              : ["OCCUPIED", "PAYMENT_PENDING"].includes(liveStatus ?? "")
                ? "Occupied"
                : "Unknown",
      };
    });
  const visibleTables = configuredTables
    .filter((table) => table.area === activeArea)
    .filter((table) => tableStatus === "All" || table.state === tableStatus);
  const occupied = visibleTables.filter((table) => table.state === "Occupied");
  const selectedTable =
    visibleTables.find((table) => table.no === selectedTableNo) ?? visibleTables[0];

  return (
    <section className="mt-4 space-y-4" aria-label="Table management">
      <div className="flex flex-wrap items-center gap-2">
        <DiningAreaDialog
          branchLabel={branchLabel}
          onCreated={(name) => {
            setArea(name);
            onChanged();
          }}
        />
        <AddTableDialog
          branchLabel={branchLabel}
          existingCount={configuredTables.length}
          areas={serviceAreas.map((area) => ({ id: area.id, name: area.name }))}
          onCreated={(code, serviceAreaId) => {
            setSelectedTableNo(code);
            const newArea = serviceAreas.find((item) => item.id === serviceAreaId)?.name;
            if (newArea) setArea(newArea);
            onChanged();
          }}
        />
        <Link
          to="/reservations"
          className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-semibold"
        >
          Reservations
        </Link>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="p-4">
          <div className="mb-4">
            <Chips
              items={[
                { label: "Scope", value: branchLabel },
                {
                  label: "Area",
                  value: activeArea,
                  options: areaOptions,
                  selectedOption: activeArea,
                  onOptionChange: setArea,
                  onClear: () => setArea(""),
                },
                {
                  label: "Status",
                  value: tableStatus,
                  options: ["All", ...Object.keys(stateStyle)],
                  selectedOption: tableStatus,
                  onOptionChange: setTableStatus,
                  onClear: () => setTableStatus("All"),
                },
              ]}
              onClear={() => {
                setArea("");
                setTableStatus("All");
              }}
            />
          </div>
          <div className="mb-4 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
            {Object.keys(stateStyle).map((state) => (
              <span key={state} className="inline-flex items-center gap-1.5">
                <span className={cn("h-3 w-3 rounded border", stateStyle[state])} /> {state}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibleTables.map((table) => (
              <button
                key={table.no}
                onClick={() => setSelectedTableNo(table.no)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-transform hover:-translate-y-0.5",
                  stateStyle[table.state],
                  selectedTable?.no === table.no && "ring-2 ring-primary/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-extrabold">Table {table.no}</span>
                  <span className="text-[11px] text-muted-foreground">{table.seats} seats</span>
                </div>
                <div className="mt-2">
                  <Status>{table.state}</Status>
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="p-4">
          <h2 className="text-[14px] font-semibold">
            {selectedTable ? `Table ${selectedTable.no}` : "Table details"}
          </h2>
          {selectedTable && (
            <div className="mt-3 rounded-lg border border-border p-3 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{selectedTable.area}</span>
                <Status>{selectedTable.state}</Status>
              </div>
              <div className="mt-2 grid gap-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Seats</span>
                  <span className="num font-semibold text-foreground">{selectedTable.seats}</span>
                </div>
              </div>
            </div>
          )}
          {selectedTable && (
            <div className="mt-3">
              <EditTableDialog
                key={selectedTable.id}
                table={{
                  id: selectedTable.id,
                  code: selectedTable.no,
                  seats: selectedTable.seats,
                  serviceAreaId: selectedTable.serviceAreaId,
                }}
                areas={serviceAreas.map((item) => ({ id: item.id, name: item.name }))}
                onSaved={(name) => {
                  if (name) setArea(name);
                  onChanged();
                }}
              />
            </div>
          )}
          <h3 className="mt-4 text-[13px] font-semibold">Occupied tables</h3>
          <ul className="mt-3 divide-y divide-border">
            {occupied.map((table) => (
              <li key={table.no} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">Table {table.no}</div>
                  <div className="text-[11px] text-muted-foreground">{table.seats} seats</div>
                </div>
                <Status>{table.state}</Status>
              </li>
            ))}
          </ul>
          {occupied.length === 0 && (
            <div className="mt-3 rounded-lg bg-secondary/60 p-3 text-[12px] text-muted-foreground">
              {statuses
                ? "No occupied tables for this branch."
                : "Live table status is unavailable."}
            </div>
          )}
        </Panel>
      </div>
    </section>
  );
}
