import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Empty, Metric, Panel, PanelHead, Status } from "@/components/app/ui";

export const Route = createFileRoute("/design-system")({
  head: () => ({
    meta: [
      { title: "Seramet UI Kit" },
      { name: "description", content: "Colour tokens, typography, buttons, badges, metrics and states used across Seramet." },
      { property: "og:title", content: "Seramet UI Kit" },
      { property: "og:description", content: "The design tokens and components behind Seramet." },
    ],
  }),
  component: DS,
});

const tokens = ["background", "card", "primary", "accent", "secondary", "muted", "success", "warning", "danger", "info", "border", "foreground"];

function DS() {
  return (
    <AppShell title="Seramet UI kit" subtitle="Tokens and components shared by every module">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Colour tokens" />
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {tokens.map((t) => (
              <div key={t}>
                <div className="h-12 rounded-md border border-border" style={{ background: `var(--color-${t})` }} />
                <div className="mt-1 text-[11px] text-muted-foreground">{t}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Typography" />
          <div className="space-y-2 p-4">
            <div className="text-[28px] font-extrabold tracking-tight">Display · Seramet</div>
            <div className="text-[22px] font-bold tracking-tight">Page title</div>
            <div className="text-[14px] font-semibold">Section title</div>
            <p className="text-[13px] text-muted-foreground">Body text used across tables and panels.</p>
            <p className="num text-[20px] font-bold">KSh 2,486,420</p>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Buttons & badges" />
          <div className="flex flex-wrap gap-2 p-4">
            <Btn variant="primary">Primary</Btn>
            <Btn>Secondary</Btn>
            <Btn variant="ghost">Ghost</Btn>
            <Btn variant="danger">Destructive</Btn>
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {["Draft", "Paid", "Pending", "Approved", "Critical", "Low", "Completed", "Cancelled"].map((s) => (
              <Status key={s}>{s}</Status>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Metrics" />
          <div className="grid grid-cols-2 gap-3 p-4">
            <Metric label="Net sales" value={184420} money delta={8.4} />
            <Metric label="Food cost" value={33.4} suffix="%" delta={3.1} invert />
          </div>
        </Panel>
        <Panel className="p-4 lg:col-span-2">
          <Empty title="No purchase orders yet" body="Create your first PO to start tracking supplier purchases and receiving." action="Create purchase order" />
        </Panel>
      </div>
    </AppShell>
  );
}