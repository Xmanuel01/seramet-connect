import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type DeliveryTask = {
  id: string;
  order: string;
  channel: string;
  customer: string;
  rider: string;
  branch: string;
  value: number;
  status: string;
  eta: string;
};

export const Route = createFileRoute("/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery Tasks - Seramet" },
      {
        name: "description",
        content:
          "Single delivery engine for Uber Eats, Glovo, Bolt Food, website, WhatsApp and own rider orders.",
      },
      { property: "og:title", content: "Delivery Tasks - Seramet" },
      {
        property: "og:description",
        content: "Track delivery tasks, rider assignment and delivery status across all channels.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Delivery,
});

const rows: DeliveryTask[] = [
  {
    id: "DLT-1041",
    order: "ORD-2291",
    channel: "Own Delivery",
    customer: "Faith Njeri",
    rider: "Kevin M.",
    branch: "Westlands",
    value: 3450,
    status: "Out for delivery",
    eta: "12 min",
  },
  {
    id: "DLT-1042",
    order: "ORD-2293",
    channel: "Glovo",
    customer: "Glovo courier",
    rider: "Platform rider",
    branch: "Westlands",
    value: 2180,
    status: "Ready",
    eta: "Awaiting pickup",
  },
  {
    id: "DLT-1043",
    order: "ORD-2296",
    channel: "WhatsApp",
    customer: "Peter Kariuki",
    rider: "Unassigned",
    branch: "Ngong Road",
    value: 5120,
    status: "Pending",
    eta: "No rider available",
  },
  {
    id: "DLT-1044",
    order: "ORD-2298",
    channel: "Uber Eats",
    customer: "Uber courier",
    rider: "Platform rider",
    branch: "Ngong Road",
    value: 1890,
    status: "Completed",
    eta: "Delivered 13:20",
  },
  {
    id: "DLT-1045",
    order: "ORD-2301",
    channel: "Website",
    customer: "Mercy A.",
    rider: "Dennis K.",
    branch: "Westlands",
    value: 4260,
    status: "Picked up",
    eta: "8 min",
  },
];

const columns: EnterpriseColumn<DeliveryTask>[] = [
  { key: "id", label: "Task", sortable: true },
  { key: "order", label: "Order", sortable: true },
  { key: "channel", label: "Channel", sortable: true },
  { key: "customer", label: "Customer", sortable: true },
  { key: "rider", label: "Rider", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  {
    key: "value",
    label: "Order value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
  },
  { key: "eta", label: "ETA" },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

const lifecycle = [
  "Assigned",
  "Accepted",
  "Ready for pickup",
  "Picked up",
  "Out for delivery",
  "Delivered",
];

function Delivery() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const active = scopedRows.filter((row) => row.status !== "Completed");
  const unassigned = scopedRows.filter((row) => row.rider === "Unassigned");
  return (
    <AppShell
      title="Delivery"
      subtitle={`One delivery engine across all channels  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Dispatch settings</Btn>
          <Btn variant="primary">Assign rider</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Active deliveries" value={active.length} />
        <Metric label="Unassigned" value={unassigned.length} invert delta={unassigned.length} />
        <Metric
          label="Delivery value"
          value={scopedRows.reduce((sum, row) => sum + row.value, 0)}
          money
        />
        <Metric label="Avg delivery time" value="27" suffix=" min" />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Delivery tasks"
          sub="Channel, branch, rider and live delivery status"
          right={<Btn variant="ghost">Export</Btn>}
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Status: Active"]}
        />
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Delivery status lifecycle" sub="Declined, failed, returned and cancelled are exception paths" />
        <div className="flex flex-wrap items-center gap-2 px-4 py-4">
          {lifecycle.map((step, index) => (
            <span key={step} className="flex items-center gap-2">
              <Status>{step}</Status>
              {index < lifecycle.length - 1 && (
                <span className="text-muted-foreground">-&gt;</span>
              )}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {["Declined", "Failed delivery", "Returned", "Cancelled"].map((exception) => (
            <Status key={exception}>{exception}</Status>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
