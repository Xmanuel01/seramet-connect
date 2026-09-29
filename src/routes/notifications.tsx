import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type NotificationLog = {
  id: string;
  channel: string;
  recipient: string;
  provider: string;
  messageType: string;
  created: string;
  delivered: string;
  retries: number;
  externalId: string;
  branch: string;
  status: string;
  failureReason: string;
};

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notification Log - Seramet" },
      {
        name: "description",
        content:
          "Every email, WhatsApp and SMS message with provider, delivery state, retries and failure reason.",
      },
      { property: "og:title", content: "Notification Log - Seramet" },
      {
        property: "og:description",
        content: "Auditable delivery log for all outbound customer and staff messaging.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Notifications,
});

const rows: NotificationLog[] = [
  {
    id: "NTF-9001",
    channel: "WhatsApp",
    recipient: "+254712xxxx45",
    provider: "WhatsApp Cloud",
    messageType: "Invoice",
    created: "13:02",
    delivered: "13:02",
    retries: 0,
    externalId: "wamid.884",
    branch: "Westlands",
    status: "Delivered",
    failureReason: "-",
  },
  {
    id: "NTF-9002",
    channel: "Email",
    recipient: "accounts@kilimo.co.ke",
    provider: "SMTP relay",
    messageType: "Statement",
    created: "12:41",
    delivered: "12:41",
    retries: 0,
    externalId: "msg-2201",
    branch: "Westlands",
    status: "Sent",
    failureReason: "-",
  },
  {
    id: "NTF-9003",
    channel: "SMS",
    recipient: "+254733xxxx10",
    provider: "Africa's Talking",
    messageType: "Rider dispatch",
    created: "12:18",
    delivered: "-",
    retries: 2,
    externalId: "-",
    branch: "Ngong Road",
    status: "Failed",
    failureReason: "Insufficient provider credit",
  },
  {
    id: "NTF-9004",
    channel: "Email",
    recipient: "supplier@freshgrocers.co.ke",
    provider: "SMTP relay",
    messageType: "Purchase order",
    created: "11:55",
    delivered: "-",
    retries: 1,
    externalId: "msg-2198",
    branch: "Ngong Road",
    status: "Pending",
    failureReason: "Awaiting provider callback",
  },
];

const columns: EnterpriseColumn<NotificationLog>[] = [
  { key: "id", label: "Log", sortable: true },
  { key: "channel", label: "Channel", sortable: true },
  { key: "recipient", label: "Recipient" },
  { key: "provider", label: "Provider", sortable: true },
  { key: "messageType", label: "Type", sortable: true },
  { key: "created", label: "Created" },
  { key: "delivered", label: "Delivered" },
  { key: "retries", label: "Retries", align: "right", sortable: true },
  { key: "externalId", label: "External ID" },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Notifications() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const failed = scopedRows.filter((row) => row.status === "Failed");
  return (
    <AppShell
      title="Notifications"
      subtitle={`Outbound message log across email, WhatsApp and SMS  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Provider settings</Btn>
          <Btn variant="primary">Retry failed</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Messages today" value={scopedRows.length} />
        <Metric
          label="Delivered"
          value={scopedRows.filter((row) => row.status === "Delivered").length}
        />
        <Metric label="Failed" value={failed.length} invert delta={failed.length} />
        <Metric
          label="Retries"
          value={scopedRows.reduce((sum, row) => sum + row.retries, 0)}
          invert
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Notification log"
          sub="Channel, provider, delivery state, retry count and external ID"
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Period: Today"]}
        />
      </Panel>
      {failed.length > 0 && (
        <Panel className="mt-4">
          <PanelHead title="Failure reasons" sub="Nothing is retried silently - each attempt is logged" />
          <ul className="space-y-2 px-4 py-4 text-[13px]">
            {failed.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {row.id} - {row.channel} to {row.recipient}
                </span>
                <span className="font-medium">{row.failureReason}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AppShell>
  );
}
