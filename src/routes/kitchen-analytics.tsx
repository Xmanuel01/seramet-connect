import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";

export const Route = createFileRoute("/kitchen-analytics")({
  head: () => ({
    meta: [
      { title: "Kitchen Analytics — Seramet" },
      { name: "description", content: "Ticket times, station throughput, remakes and peak-hour kitchen pressure." },
      { property: "og:title", content: "Kitchen Analytics — Seramet" },
      { property: "og:description", content: "Ticket times, throughput and remake analysis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KitchenAnalytics,
});

const dishes = [
  { d: "Chicken Biryani", sold: 84, avg: "17.8 min", target: "18 min", remakes: 1, status: "Healthy" },
  { d: "Beef Dry Fry", sold: 62, avg: "24.1 min", target: "20 min", remakes: 3, status: "Attention" },
  { d: "Fish Curry", sold: 38, avg: "26.4 min", target: "22 min", remakes: 2, status: "Warning" },
  { d: "Bhajia", sold: 96, avg: "8.4 min", target: "9 min", remakes: 0, status: "Healthy" },
  { d: "Chips", sold: 112, avg: "7.2 min", target: "8 min", remakes: 1, status: "Healthy" },
];

const hours = [["11a", 34], ["12p", 68], ["1p", 92], ["2p", 74], ["6p", 58], ["7p", 88], ["8p", 96], ["9p", 61]] as const;

function KitchenAnalytics() {
  return (
    <AppShell title="Kitchen analytics" subtitle="Last 7 days · Westlands" actions={<Btn>Export</Btn>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Avg ticket time" value="14.2" suffix=" min" delta={18} invert />
        <Metric label="Tickets served" value={2148} delta={6.4} />
        <Metric label="Late tickets" value="9.1" suffix="%" delta={2.2} invert />
        <Metric label="Remakes" value={17} delta={-12} invert />
        <Metric label="Waste value" value={18400} money delta={4.1} invert />
        <Metric label="Peak throughput" value="96" suffix=" /hr" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead title="Dish performance" sub="Preparation time vs target" />
          <DataTable cols={["Dish", { l: "Sold", r: true }, { l: "Avg time", r: true }, { l: "Target", r: true }, { l: "Remakes", r: true }, "Status"]}>
            {dishes.map((d) => (
              <tr key={d.d} className="hover:bg-secondary/50">
                <TD className="font-semibold">{d.d}</TD>
                <TD className="num text-right">{d.sold}</TD>
                <TD className="num text-right">{d.avg}</TD>
                <TD className="num text-right text-muted-foreground">{d.target}</TD>
                <TD className="num text-right">{d.remakes}</TD>
                <TD><Status>{d.status}</Status></TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead title="Kitchen pressure by hour" sub="Tickets per hour" />
          <div className="flex h-56 items-end gap-2 p-4">
            {hours.map(([h, v]) => (
              <div key={h} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="w-full rounded-t-sm bg-primary/80" style={{ height: `${v}%` }} />
                <span className="text-[10px] text-muted-foreground">{h}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
