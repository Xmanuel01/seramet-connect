import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, Segmented, Status } from "@/components/app/ui";
import { ksh, tables } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tables")({
  head: () => ({
    meta: [
      { title: "Table Management — Seramet" },
      { name: "description", content: "Visual restaurant floor plan with live table states, covers and open bills." },
      { property: "og:title", content: "Table Management — Seramet" },
      { property: "og:description", content: "Live floor plan with table states, covers and open bills." },
    ],
  }),
  component: Tables,
});

const areas = ["Main Dining", "Terrace", "Private Room"];

const stateStyle: Record<string, string> = {
  Available: "border-border bg-card",
  Occupied: "border-primary/40 bg-accent/50",
  Reserved: "border-info/30 bg-info-soft",
  "Needs Cleaning": "border-warning/30 bg-warning-soft",
  Unavailable: "border-border bg-secondary opacity-60",
};

function Tables() {
  const [area, setArea] = useState("Main Dining");
  const occupied = tables.filter((t) => t.state === "Occupied");
  return (
    <AppShell
      title="Table management"
      subtitle="Westlands · 12 tables · 46% occupancy"
      actions={
        <>
          <Segmented options={areas} value={area} onChange={setArea} />
          <Btn variant="primary">New reservation</Btn>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="p-4">
          <div className="mb-4 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
            {Object.keys(stateStyle).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn("h-3 w-3 rounded border", stateStyle[s])} /> {s}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tables
              .filter((t) => t.area === area)
              .map((t) => (
                <button
                  key={t.no}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-transform hover:-translate-y-0.5",
                    stateStyle[t.state],
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-extrabold">Table {t.no}</span>
                    <span className="text-[11px] text-muted-foreground">{t.seats} seats</span>
                  </div>
                  <div className="mt-2">
                    <Status>{t.state}</Status>
                  </div>
                  {t.state === "Occupied" && (
                    <dl className="mt-2.5 space-y-1 text-[12px]">
                      <div className="flex justify-between"><dt className="text-muted-foreground">Guests</dt><dd className="num font-semibold">{t.guests}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted-foreground">Waiter</dt><dd className="font-semibold">{t.waiter}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted-foreground">Bill</dt><dd className="num font-semibold">{ksh(t.amount!)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted-foreground">Seated</dt><dd className="num font-semibold">{t.mins} min</dd></div>
                    </dl>
                  )}
                  {t.state === "Reserved" && (
                    <p className="mt-2.5 text-[12px] text-muted-foreground">{t.guests} guests · {t.waiter} · 7:30 PM</p>
                  )}
                </button>
              ))}
          </div>
        </Panel>

        <Panel className="p-4">
          <h2 className="text-[14px] font-semibold">Open bills</h2>
          <ul className="mt-3 divide-y divide-border">
            {occupied.map((t) => (
              <li key={t.no} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">Table {t.no}</div>
                  <div className="text-[11px] text-muted-foreground">{t.waiter} · {t.mins} min</div>
                </div>
                <span className="num text-[13px] font-bold">{ksh(t.amount!)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg bg-secondary/60 p-3 text-[12px] text-muted-foreground">
            Average table turn today is <span className="num font-semibold text-foreground">54 min</span>, 9 minutes slower than last Wednesday.
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}