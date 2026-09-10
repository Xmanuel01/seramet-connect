import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";

export const Route = createFileRoute("/returns")({
  head: () => ({
    meta: [
      { title: "Returns - Seramet" },
      {
        name: "description",
        content: "Track returned items, reasons, stock impact and manager authorisation.",
      },
      { property: "og:title", content: "Returns - Seramet" },
      { property: "og:description", content: "Returned items with reason codes and stock impact." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Returns,
});

const rows = emptyRecords();

function Returns() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const { branchLabel, matchesBranch } = useAppContext();
  const visibleRows = rows
    .filter((row) => matchesBranch(row.branch))
    .filter((row) => statusFilter === "All" || row.status === statusFilter)
    .filter((row) => !periodDate || row.date === periodDate);
  const returnValue = visibleRows.reduce((sum, row) => sum + row.value, 0);
  const awaiting = visibleRows.filter((row) => row.status === "Pending").length;

  return (
    <AppShell
      title="Returns"
      subtitle={`Item-level returns and stock impact - ${branchLabel}`}
      actions={
        <>
          <Btn>Export</Btn>
          <Btn variant="primary">Log return</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Returns" value={visibleRows.length} invert />
        <Metric label="Return value" value={returnValue} money invert />
        <Metric
          label="Restocked"
          value={`${visibleRows.filter((row) => row.restock === "Yes").length}/${visibleRows.length || 0}`}
        />
        <Metric label="Awaiting approval" value={awaiting} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Return register" sub="Reason codes drive kitchen quality reporting" />
        <div className="border-b border-border px-4 py-3">
          <Chips
            items={[
              { label: "Scope", value: branchLabel },
              {
                label: "Status",
                value: statusFilter,
                options: ["All", "Approved", "Pending", "Rejected"],
                selectedOption: statusFilter,
                onOptionChange: setStatusFilter,
                onClear: () => setStatusFilter("All"),
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
              setStatusFilter("All");
              setPeriodDate("");
            }}
          />
        </div>
        <DataTable
          cols={[
            "Return",
            "Date",
            "Order",
            "Item",
            "Reason",
            "Branch",
            "Logged by",
            { l: "Value", r: true },
            "Restocked",
            "Status",
          ]}
        >
          {visibleRows.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD className="text-muted-foreground">{formatFilterDate(r.date)}</TD>
              <TD className="num text-muted-foreground">{r.order}</TD>
              <TD>{r.item}</TD>
              <TD className="text-muted-foreground">{r.reason}</TD>
              <TD className="text-muted-foreground">{r.branch}</TD>
              <TD>{r.by}</TD>
              <TD className="num text-right font-semibold">{ksh(r.value)}</TD>
              <TD>{r.restock}</TD>
              <TD>
                <Status>{r.status}</Status>
              </TD>
            </tr>
          ))}
          {visibleRows.length === 0 && (
            <tr>
              <TD className="text-muted-foreground" colSpan={10}>
                No returns match the selected filters.
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
