import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Eye, FileClock, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/audit-trail")({
  head: () => ({
    meta: [
      { title: "Audit Trail - Seramet" },
      {
        name: "description",
        content: "Complete enterprise audit log for actions, approvals and record changes.",
      },
      { property: "og:title", content: "Audit Trail - Seramet" },
      {
        property: "og:description",
        content: "Dedicated audit log with source records and before-after detail.",
      },
    ],
  }),
  component: AuditTrail,
});

type AuditEvent = {
  id: string;
  time: string;
  actor: string;
  role: string;
  branch: string;
  module: string;
  action: string;
  record: string;
  risk: "Low" | "Attention" | "Critical" | "Approved";
  ip: string;
  before: string;
  after: string;
};
type AuditRow = AuditEvent & { open: string };

const events: AuditEvent[] = emptyRecords();

const columns: EnterpriseColumn<AuditRow>[] = [
  { key: "id", label: "Event ID", sortable: true },
  { key: "time", label: "Time", sortable: true },
  { key: "actor", label: "Actor", sortable: true },
  { key: "module", label: "Module", sortable: true },
  { key: "action", label: "Action" },
  { key: "record", label: "Source record", sortable: true },
  { key: "risk", label: "Risk", sortable: true },
  { key: "ip", label: "IP / device" },
];

function AuditTrail() {
  const { branch, matchesBranch } = useAppContext();
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const rows = useMemo(
    () =>
      events
        .filter((event) => matchesBranch(event.branch))
        .map((event) => ({ ...event, open: "" })),
    [matchesBranch],
  );
  const critical = rows.filter((event) => event.risk === "Critical").length;
  const approvals = rows.filter((event) => event.risk === "Approved").length;

  return (
    <AppShell
      title="Audit trail"
      subtitle={`Complete record of changes, approvals and source actions - ${branch}`}
      actions={
        <>
          <Btn>
            <FileClock className="h-4 w-4" /> Export log
          </Btn>
          <Btn variant="primary">
            <ShieldCheck className="h-4 w-4" /> Lock period
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Events in scope" value={rows.length} />
        <Metric label="Critical events" value={critical} invert />
        <Metric label="Approvals logged" value={approvals} />
        <Metric label="Retention" value="Not configured" />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Enterprise audit log"
          sub="Sortable, searchable and branch-aware event history"
          right={<Status>Active</Status>}
        />
        <EnterpriseTable
          rows={rows}
          columns={[
            ...columns,
            {
              key: "open",
              label: "Open",
              render: (row) => (
                <button
                  onClick={() => setSelected(row)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-semibold hover:bg-secondary"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Detail
                </button>
              ),
            },
          ]}
          savedViews={["All events", "Critical", "Approvals"]}
          filters={["Branch scoped", "Source linked", "Immutable log"]}
          pageSize={5}
          renderExpanded={(row) => (
            <div className="grid gap-3 text-[12px] md:grid-cols-2">
              <div>
                <div className="font-semibold">Before</div>
                <div className="mt-1 rounded-md bg-card px-3 py-2 text-muted-foreground">
                  {row.before}
                </div>
              </div>
              <div>
                <div className="font-semibold">After</div>
                <div className="mt-1 rounded-md bg-card px-3 py-2 text-muted-foreground">
                  {row.after}
                </div>
              </div>
            </div>
          )}
        />
      </Panel>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto border-border bg-card p-0 sm:max-w-[460px]">
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle>{selected?.id}</SheetTitle>
            <SheetDescription>
              {selected?.record} - {selected?.module}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2">
                <span className="text-[12px] font-semibold text-muted-foreground">Risk</span>
                <Status>{selected.risk}</Status>
              </div>
              {[
                ["Time", selected.time],
                ["Actor", `${selected.actor} - ${selected.role}`],
                ["Branch", selected.branch],
                ["Action", selected.action],
                ["Source", selected.record],
                ["IP / Device", selected.ip],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border px-3 py-2 text-[13px]">
                  <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-1 font-semibold">{value}</div>
                </div>
              ))}
              <div className="grid gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[12px] font-semibold">Before</div>
                  <p className="mt-1 text-[13px] text-muted-foreground">{selected.before}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[12px] font-semibold">After</div>
                  <p className="mt-1 text-[13px] text-muted-foreground">{selected.after}</p>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
