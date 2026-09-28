import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { TableManagementControls } from "@/components/app/TableManagementControls";
import { Btn, Chips, Panel, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";

export const Route = createFileRoute("/tables")({
  head: () => ({
    meta: [
      { title: "Table Management - Seramet" },
      {
        name: "description",
        content: "Visual restaurant floor plan with live table states, covers and open bills.",
      },
      { property: "og:title", content: "Table Management - Seramet" },
      {
        property: "og:description",
        content: "Live floor plan with table states, covers and open bills.",
      },
    ],
  }),
  component: Tables,
});

const stateStyle: Record<string, string> = {
  Available: "border-border bg-card",
  Unverified: "border-warning/30 bg-warning-soft",
  Occupied: "border-primary/40 bg-accent/50",
  Reserved: "border-info/30 bg-info-soft",
  "Needs Cleaning": "border-warning/30 bg-warning-soft",
  Unavailable: "border-border bg-secondary opacity-60",
};

function Tables() {
  const { branchId, branchLabel, platformState } = useAppContext();
  const { state: transactions, backendStatus } = useTransactionEngine();
  const serviceAreas = platformState.serviceAreas.filter(
    (serviceArea) => serviceArea.branchId === branchId && serviceArea.active,
  );
  const areaOptions = serviceAreas.map((serviceArea) => serviceArea.name);
  const [area, setArea] = useState("");
  const activeArea = area || areaOptions[0] || "Dining";
  const [tableStatus, setTableStatus] = useState("All");
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const [selectedTableNo, setSelectedTableNo] = useState<string | null>(null);
  const configuredTables = platformState.tables
    .filter((table) => table.branchId === branchId && table.active)
    .map((configuredTable) => {
      const openOrder = transactions.orders.find(
        (order) => order.branchId === branchId && order.table === configuredTable.code &&
          order.paymentStatus !== "PAID" && !["PAID", "CANCELLED", "REFUNDED"].includes(order.status),
      );
      const unpaidBill = openOrder
        ? transactions.bills.find((bill) => bill.orderIds.includes(openOrder.id) &&
          ["OPEN", "PARTIAL", "PENDING"].includes(bill.status))
        : undefined;
      const fresh = backendStatus === "synced";
      const configuredArea = serviceAreas.find(
        (serviceArea) => serviceArea.id === configuredTable.serviceAreaId,
      );
      return {
        no: configuredTable.code,
        area: configuredArea?.name ?? activeArea,
        seats: configuredTable.seats,
        state: fresh ? (openOrder ? "Occupied" : "Available") : "Unverified",
        guests: fresh && openOrder ? Number(openOrder.customer.match(/(\\d+)\\s+guest/i)?.[1] ?? 0) : undefined,
        waiter: fresh && openOrder ? (openOrder.waiter ?? openOrder.cashier) : undefined,
        amount: fresh && openOrder ? (unpaidBill ? Math.max(0, unpaidBill.total - unpaidBill.paid) : openOrder.total) : undefined,
        mins: fresh && openOrder ? Math.max(0, Math.floor((Date.now() - Date.parse(openOrder.createdAt)) / 60_000)) : undefined,
      };
    });
  const visibleTables = configuredTables
    .filter((table) => table.area === activeArea)
    .filter((table) => tableStatus === "All" || table.state === tableStatus);
  const occupied = visibleTables.filter((table) => table.state === "Occupied");
  const selectedTable =
    visibleTables.find((table) => table.no === selectedTableNo) ?? visibleTables[0];

  return (
    <AppShell
      title="Table management"
      subtitle={`${branchLabel} - ${configuredTables.length} tables - ${configuredTables.length ? Math.round((configuredTables.filter((table) => table.state === "Occupied").length / configuredTables.length) * 100) : 0}% occupancy`}
      actions={
        <Btn variant="primary" onClick={() => (window.location.href = "/reservations")}>
          New reservation
        </Btn>
      }
    >
      <TableManagementControls />
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
                {
                  label: "Period",
                  value: formatFilterDate(periodDate),
                  dateValue: periodDate,
                  onDateChange: setPeriodDate,
                  onClear: () => setPeriodDate(""),
                },
              ]}
              onClear={() => {
                setArea("");
                setTableStatus("All");
                setPeriodDate("");
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
                {table.state === "Occupied" && (
                  <dl className="mt-2.5 space-y-1 text-[12px]">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Guests</dt>
                      <dd className="num font-semibold">{table.guests}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Waiter</dt>
                      <dd className="font-semibold">{table.waiter}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Bill</dt>
                      <dd className="num font-semibold">{ksh(table.amount!)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Seated</dt>
                      <dd className="num font-semibold">{table.mins} min</dd>
                    </div>
                  </dl>
                )}
                {table.state === "Reserved" && (
                  <p className="mt-2.5 text-[12px] text-muted-foreground">
                    {table.guests} guests - {table.waiter} - 7:30 PM
                  </p>
                )}
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="p-4">
          <h2 className="text-[14px] font-semibold">
            {selectedTable ? `Table ${selectedTable.no}` : "Open bills"}
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
                <div className="flex justify-between">
                  <span>Guests</span>
                  <span className="num font-semibold text-foreground">
                    {selectedTable.guests ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Current bill</span>
                  <span className="num font-semibold text-foreground">
                    {selectedTable.amount ? ksh(selectedTable.amount) : "-"}
                  </span>
                </div>
              </div>
            </div>
          )}
          <h3 className="mt-4 text-[13px] font-semibold">Open bills</h3>
          <ul className="mt-3 divide-y divide-border">
            {occupied.map((table) => (
              <li key={table.no} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">Table {table.no}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {table.waiter} - {table.mins} min
                  </div>
                </div>
                <span className="num text-[13px] font-bold">{ksh(table.amount!)}</span>
              </li>
            ))}
          </ul>
          {occupied.length === 0 && (
            <div className="mt-3 rounded-lg bg-secondary/60 p-3 text-[12px] text-muted-foreground">
              No open table bills for this branch.
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
