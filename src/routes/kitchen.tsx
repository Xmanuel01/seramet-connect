import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { tickets } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/kitchen")({
  head: () => ({
    meta: [
      { title: "Kitchen Display — Seramet" },
      { name: "description", content: "Full-screen kitchen display with ticket ageing, prep queues and one-tap status." },
      { property: "og:title", content: "Kitchen Display — Seramet" },
      { property: "og:description", content: "Ticket ageing, prep queues and one-tap status for the line." },
    ],
  }),
  component: KDS,
});

const cols = ["NEW", "PREPARING", "READY"] as const;

function urgency(m: number) {
  if (m >= 20) return "border-danger/50 bg-danger-soft";
  if (m >= 12) return "border-warning/50 bg-warning-soft";
  return "border-border bg-card";
}

function KDS() {
  return (
    <AppShell bare>
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div>
          <h1 className="text-[16px] font-extrabold tracking-tight">Kitchen Display</h1>
          <p className="text-[12px] text-muted-foreground">Westlands hot line · 6 active tickets · avg 14.2 min</p>
        </div>
        <div className="flex items-center gap-4 text-[12px] font-semibold">
          <span className="text-success">2 on time</span>
          <span className="text-warning">2 approaching</span>
          <span className="text-danger">2 late</span>
        </div>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-3">
        {cols.map((c) => (
          <div key={c} className="rounded-xl bg-secondary/50 p-2">
            <div className="flex items-center justify-between px-2 py-2">
              <h2 className="text-[12px] font-bold uppercase tracking-[0.12em]">{c}</h2>
              <span className="num rounded bg-card px-1.5 text-[12px] font-bold">
                {tickets.filter((t) => t.state === c).length}
              </span>
            </div>
            <div className="space-y-2">
              {tickets
                .filter((t) => t.state === c)
                .map((t) => (
                  <article key={t.id} className={cn("rounded-lg border p-3", urgency(t.mins))}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[15px] font-extrabold">TABLE {t.table}</span>
                      <span className="num text-[13px] font-bold">#{t.id}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                      <span>{t.time}</span>
                      <span className="num font-bold text-foreground">{t.mins} MIN</span>
                    </div>
                    <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5 text-[14px] font-semibold">
                      {t.items.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                    {t.note && (
                      <p className="mt-2 rounded bg-card px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-danger">
                        {t.note}
                      </p>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button className="h-10 rounded-md border border-border bg-card text-[13px] font-semibold">
                        {c === "NEW" ? "Accept" : c === "PREPARING" ? "Recall" : "Recall"}
                      </button>
                      <button className="h-10 rounded-md bg-primary text-[13px] font-semibold text-primary-foreground">
                        {c === "NEW" ? "Start" : c === "PREPARING" ? "Ready" : "Served"}
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}