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

const sections = [
  {
    station: "Hot line",
    tasks: [
      {
        t: "Marinate chicken",
        target: "18 kg",
        done: "18 kg",
        who: "Musa K.",
        status: "Completed",
      },
      {
        t: "Par-cook biryani rice",
        target: "40 portions",
        done: "26 portions",
        who: "Peter K.",
        status: "Preparing",
      },
      { t: "Beef stew base", target: "20 L", done: "0 L", who: "Unassigned", status: "Pending" },
    ],
  },
  {
    station: "Cold & sides",
    tasks: [
      { t: "Kachumbari", target: "8 kg", done: "8 kg", who: "Faith N.", status: "Completed" },
      { t: "Bhajia batter", target: "15 kg", done: "6 kg", who: "Faith N.", status: "Preparing" },
    ],
  },
  {
    station: "Beverages",
    tasks: [
      {
        t: "Passion concentrate",
        target: "30 L",
        done: "27 L",
        who: "Amina W.",
        status: "Attention",
      },
      { t: "Lime syrup", target: "10 L", done: "10 L", who: "Amina W.", status: "Completed" },
    ],
  },
];

function Prep() {
  return (
    <AppShell
      title="Prep list"
      subtitle="Thursday, 13 August  -  generated from forecast demand"
      actions={
        <>
          <Btn>Print</Btn>
          <Btn variant="primary">Regenerate</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Tasks today" value={18} />
        <Metric label="Completed" value={11} />
        <Metric label="In progress" value={4} />
        <Metric label="Prep completion" value="61" suffix="%" delta={5} />
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
