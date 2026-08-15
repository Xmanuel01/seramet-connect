import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useAppContext } from "@/lib/app-context";
import { SerametPrintService } from "@/lib/seramet-print-service";

export const Route = createFileRoute("/kitchen-analytics")({
  head: () => ({
    meta: [
      { title: "Kitchen Analytics - Seramet" },
      {
        name: "description",
        content: "Ticket times, station throughput, remakes and peak-hour kitchen pressure.",
      },
      { property: "og:title", content: "Kitchen Analytics - Seramet" },
      { property: "og:description", content: "Ticket times, throughput and remake analysis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KitchenAnalytics,
});

const dishes = [
  { d: "Chicken Biryani", sold: 84, avg: 17.8, target: "18 min", remakes: 1, status: "Healthy" },
  { d: "Beef Dry Fry", sold: 62, avg: 24.1, target: "20 min", remakes: 3, status: "Attention" },
  { d: "Fish Curry", sold: 38, avg: 26.4, target: "22 min", remakes: 2, status: "Warning" },
  { d: "Bhajia", sold: 96, avg: 8.4, target: "9 min", remakes: 0, status: "Healthy" },
  { d: "Chips", sold: 112, avg: 7.2, target: "8 min", remakes: 1, status: "Healthy" },
];

const hours = [
  ["11a", 34],
  ["12p", 68],
  ["1p", 92],
  ["2p", 74],
  ["6p", 58],
  ["7p", 88],
  ["8p", 96],
  ["9p", 61],
] as const;

function KitchenAnalytics() {
  const { branch, branchLabel } = useAppContext();
  const profile = SerametPrintService.getBranchHardwareProfile(branch);
  const adjustment = SerametPrintService.getKitchenAnalyticsAdjustment(profile);
  const avgTicket = (14.2 * adjustment.ticketTimeMultiplier).toFixed(1);
  const lateTickets = (9.1 * adjustment.lateTicketMultiplier).toFixed(1);
  const confidenceTone =
    adjustment.confidence === "High"
      ? "Healthy"
      : adjustment.confidence === "Medium"
        ? "Warning"
        : "Attention";
  const adjustedDishes = dishes.map((dish) => ({
    ...dish,
    avgLabel: `${(dish.avg * adjustment.ticketTimeMultiplier).toFixed(1)} min`,
    status: adjustment.confidence === "Low" ? "Warning" : dish.status,
  }));
  const adjustedHours = hours.map(
    ([hour, value]) =>
      [hour, Math.min(100, Math.round(value * adjustment.lateTicketMultiplier))] as const,
  );

  return (
    <AppShell
      title="Kitchen analytics"
      subtitle={`Last 7 days - ${branchLabel} - ${adjustment.label}`}
      actions={<Btn>Export</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Avg ticket time" value={avgTicket} suffix=" min" delta={18} invert />
        <Metric label="Tickets served" value={2148} delta={6.4} />
        <Metric label="Late tickets" value={lateTickets} suffix="%" delta={2.2} invert />
        <Metric label="Remakes" value={17} delta={-12} invert />
        <Metric label="Waste value" value={18400} money delta={4.1} invert />
        <Metric label="Confidence" value={adjustment.confidence} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Dish performance"
            sub={`Preparation time adjusted by ${adjustment.captureMethod.toLowerCase()}`}
            right={<Status>{confidenceTone}</Status>}
          />
          <DataTable
            cols={[
              "Dish",
              { l: "Sold", r: true },
              { l: "Avg time", r: true },
              { l: "Target", r: true },
              { l: "Remakes", r: true },
              "Status",
            ]}
          >
            {adjustedDishes.map((dish) => (
              <tr key={dish.d} className="hover:bg-secondary/50">
                <TD className="font-semibold">{dish.d}</TD>
                <TD className="num text-right">{dish.sold}</TD>
                <TD className="num text-right">{dish.avgLabel}</TD>
                <TD className="num text-right text-muted-foreground">{dish.target}</TD>
                <TD className="num text-right">{dish.remakes}</TD>
                <TD>
                  <Status>{dish.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title="Kitchen pressure by hour"
            sub={`${adjustment.remakeVisibility} remake visibility`}
          />
          <div className="flex h-56 items-end gap-2 p-4">
            {adjustedHours.map(([hour, value]) => (
              <div key={hour} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  className="w-full rounded-t-sm bg-primary/80"
                  style={{ height: `${value}%` }}
                />
                <span className="text-[10px] text-muted-foreground">{hour}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Hardware-mode adjustment"
          sub={`${profile.branch} uses ${profile.kitchenMode.replaceAll("_", " ")}`}
          right={<Status>{adjustment.confidence}</Status>}
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Capture method
            </div>
            <div className="mt-1 text-[14px] font-semibold">{adjustment.captureMethod}</div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Timing multiplier
            </div>
            <div className="num mt-1 text-[14px] font-semibold">
              {adjustment.ticketTimeMultiplier.toFixed(2)}x
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Late-ticket multiplier
            </div>
            <div className="num mt-1 text-[14px] font-semibold">
              {adjustment.lateTicketMultiplier.toFixed(2)}x
            </div>
          </div>
          {adjustment.notes.map((note) => (
            <div
              key={note}
              className="rounded-lg border border-border bg-card p-3 text-[13px] text-muted-foreground"
            >
              {note}
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
