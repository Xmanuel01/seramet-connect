import { emptyRecords } from "@/lib/empty-records";
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

const rows: NotificationLog[] = emptyRecords();

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
        <Metric label="Failed" value={failed.length} invert />
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
          <PanelHead
            title="Failure reasons"
            sub="Nothing is retried silently - each attempt is logged"
          />
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
