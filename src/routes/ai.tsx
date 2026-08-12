import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Send } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "Seramet AI — Ask your business" },
      { name: "description", content: "Ask questions about sales, cost, stock and staff and get answers with charts and actions." },
      { property: "og:title", content: "Seramet AI" },
      { property: "og:description", content: "Answers with metrics, tables and recommended actions." },
    ],
  }),
  component: AI,
});

const suggestions = [
  "Why did sales fall yesterday?",
  "Which products will run out this week?",
  "Compare Westlands and Ngong Road.",
  "Which dishes have the lowest margin?",
  "Summarise today's operations.",
  "Find unusual stock usage.",
];

const drivers = [
  { name: "Beef Boneless", impact: 8430, why: "Supplier price +12%, portion variance 6%" },
  { name: "Cooking Oil", impact: 3200, why: "Usage up 18% with no sales increase" },
  { name: "Waste entries", impact: 2840, why: "9 waste entries logged in the last 3 days" },
];

function AI() {
  return (
    <AppShell title="Ask Seramet" subtitle="Grounded in your live sales, stock, payroll and supplier data">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4">
          <Panel className="p-4">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <input
                defaultValue="Why did food cost increase this week?"
                className="w-full bg-transparent text-[14px] outline-none"
              />
              <button className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} className="rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Food cost alert" sub="Answer generated from 7 days of sales, stock movement and supplier bills" />
            <div className="space-y-4 p-4">
              <p className="text-[14px] leading-relaxed">
                Food cost increased from <strong className="num">31.2%</strong> to <strong className="num">36.4%</strong> at
                Westlands over the last 7 days. Three drivers explain 94% of the change.
              </p>
              <table className="w-full">
                <thead><tr><TH>Driver</TH><TH className="text-right">Impact</TH><TH>Explanation</TH></tr></thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.name}>
                      <TD className="font-semibold">{d.name}</TD>
                      <TD className="num text-right font-semibold text-danger">+{ksh(d.impact)}</TD>
                      <TD className="text-muted-foreground">{d.why}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
                <div className="text-[13px] font-semibold text-warning">Suggested actions</div>
                <ul className="mt-1.5 list-inside list-disc space-y-1 text-[13px]">
                  <li>Review beef portioning against the Chicken Biryani and Beef Dry Fry recipes</li>
                  <li>Confirm the 12% price increase from Main Meat Supplier is contractual</li>
                  <li>Audit the 9 waste entries logged by the evening kitchen shift</li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn variant="primary">View analysis</Btn>
                <Btn>Create task</Btn>
                <Btn>Generate report</Btn>
              </div>
            </div>
          </Panel>
        </div>

        <Panel className="p-4">
          <h2 className="text-[14px] font-semibold">Recent threads</h2>
          <ul className="mt-3 space-y-2 text-[13px]">
            {["Stock at risk this week", "Overtime by branch", "Slowest kitchen hours", "Loyalty impact on AOV"].map((t) => (
              <li key={t} className="rounded-md border border-border px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg bg-accent/60 p-3 text-[12px] text-accent-foreground">
            Seramet AI can be opened from any page as a side drawer, so you never lose your place.
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}