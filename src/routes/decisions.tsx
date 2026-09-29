import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, Status } from "@/components/app/ui";
import { decisions, ksh } from "@/data/mock";

export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "Pending Decisions - Seramet" },
      {
        name: "description",
        content: "Management decision queue for approvals, risk review and operational exceptions.",
      },
    ],
  }),
  component: Decisions,
});

function Decisions() {
  const total = decisions.reduce((sum, decision) => sum + decision.value, 0);
  return (
    <AppShell
      title="Pending decisions"
      subtitle="Management queue for value, risk and exception review"
      actions={
        <>
          <Btn>Rules</Btn>
          <Btn variant="primary">Approve safe items</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Pending" value={decisions.length} invert />
        <Metric label="Value at stake" value={total} money invert />
        <Metric label="Critical" value={2} invert />
        <Metric label="Avg age" value="48" suffix=" min" />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {decisions.map((decision) => (
          <Panel key={decision.title} className="p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold leading-snug">{decision.title}</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">{decision.ctx}</p>
              </div>
              <span className="num shrink-0 text-[16px] font-bold">{ksh(decision.value)}</span>
            </div>
            <p className="mt-3 rounded-md bg-secondary/60 px-3 py-2 text-[12px]">
              {decision.reason}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{decision.by}</span>
              <span>-</span>
              <span>{decision.time}</span>
              <Status className="ml-auto">Pending</Status>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Btn variant="primary">Approve</Btn>
              <Btn>Review</Btn>
              <Btn variant="danger">Reject</Btn>
            </div>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
