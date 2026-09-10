import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";

export const Route = createFileRoute("/prep")({
  head: () => ({
    meta: [
      { title: "Prep List - Seramet" },
      {
        name: "description",
        content: "Daily kitchen prep list driven by forecast demand and current par stock.",
      },
      { property: "og:title", content: "Prep List - Seramet" },
      {
        property: "og:description",
        content: "Forecast-driven prep tasks for the kitchen brigade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Prep,
});

type PrepSection = {
  station: string;
  tasks: Array<{
    t: string;
    done: number;
    target: number;
    who: string;
    status: string;
  }>;
};

const sections = emptyRecords<PrepSection>();

function Prep() {
  return (
    <AppShell
      title="Prep list"
      subtitle="Production prep tasks generated from approved demand forecasts"
      actions={
        <>
          <Btn>Print</Btn>
          <Btn variant="primary">Regenerate</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Tasks today" value={0} />
        <Metric label="Completed" value={0} />
        <Metric label="In progress" value={0} />
        <Metric label="Prep completion" value="0" suffix="%" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {sections.map((s) => (
          <Panel key={s.station}>
            <PanelHead title={s.station} sub={`${s.tasks.length} tasks`} />
            <ul className="divide-y divide-border">
              {s.tasks.map((t) => (
                <li key={t.t} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">{t.t}</div>
                      <div className="num text-[12px] text-muted-foreground">
                        {t.done} of {t.target} - {t.who}
                      </div>
                    </div>
                    <Status>{t.status}</Status>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
