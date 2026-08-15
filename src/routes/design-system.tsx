import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import {
  Btn,
  Empty,
  Metric,
  Panel,
  PanelHead,
  Segmented,
  Status,
  TD,
  TH,
} from "@/components/app/ui";
import { SearchInput } from "@/components/app/Tabs";

export const Route = createFileRoute("/design-system")({
  head: () => ({
    meta: [
      { title: "Seramet UI Kit" },
      {
        name: "description",
        content:
          "Colour tokens, typography, buttons, badges, metrics and states used across Seramet.",
      },
      { property: "og:title", content: "Seramet UI Kit" },
      { property: "og:description", content: "The design tokens and components behind Seramet." },
    ],
  }),
  component: DS,
});

const tokens = [
  "background",
  "card",
  "primary",
  "accent",
  "secondary",
  "muted",
  "success",
  "warning",
  "danger",
  "info",
  "border",
  "foreground",
];

function DS() {
  return (
    <AppShell title="Seramet UI kit" subtitle="Tokens and components shared by every module">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Colour tokens" />
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
            {tokens.map((t) => (
              <div key={t}>
                <div
                  className="h-12 rounded-md border border-border"
                  style={{ background: `var(--color-${t})` }}
                />
                <div className="mt-1 text-[11px] text-muted-foreground">{t}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Typography" />
          <div className="space-y-2 p-4">
            <div className="text-[28px] font-extrabold tracking-tight">Display - Seramet</div>
            <div className="text-[22px] font-bold tracking-tight">Page title</div>
            <div className="text-[14px] font-semibold">Section title</div>
            <p className="text-[13px] text-muted-foreground">
              Body text used across tables and panels.
            </p>
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
            {[
              "Draft",
              "Paid",
              "Pending",
              "Approved",
              "Critical",
              "Low",
              "Completed",
              "Cancelled",
            ].map((s) => (
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
        <Panel>
          <PanelHead title="Form controls" sub="Inputs, search, options and binary states" />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Item name
              <input
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
                defaultValue="Beef Boneless"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Branch
              <select className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40">
                <option>Westlands</option>
                <option>Ngong Road</option>
              </select>
            </label>
            <SearchInput placeholder="Search records..." />
            <Segmented options={["Light", "Dark", "System"]} value="Light" onChange={() => {}} />
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                defaultChecked
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              Require manager approval
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="radio"
                defaultChecked
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              Use current branch
            </label>
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title="Enterprise table"
            sub="Sticky header, compact rows, status and actions"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr>
                  <TH>Record</TH>
                  <TH>Owner</TH>
                  <TH className="text-right">Value</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </thead>
              <tbody>
                {[
                  ["PO-2026-0182", "Kelvin M.", "KSh 58,400", "Pending"],
                  ["Till variance", "Amina W.", "KSh 850", "Critical"],
                  ["Stock count", "Kelvin M.", "KSh -18,400", "Attention"],
                ].map(([record, owner, value, status]) => (
                  <tr key={record} className="hover:bg-secondary/50">
                    <TD className="font-semibold">{record}</TD>
                    <TD className="text-muted-foreground">{owner}</TD>
                    <TD className="num text-right font-semibold">{value}</TD>
                    <TD>
                      <Status>{status}</Status>
                    </TD>
                    <TD className="text-right text-muted-foreground">...</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Modal and drawer states" sub="Shared interaction language" />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="text-[13px] font-semibold">Approval drawer</div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Context, reason, impact, timeline and approve/reject actions.
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[13px] font-semibold">Payment modal</div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Total due, method selection, split payment and receipt options.
              </p>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Loading state" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-1/3 animate-pulse rounded bg-primary/10" />
            <div className="h-9 animate-pulse rounded bg-primary/10" />
            <div className="h-9 animate-pulse rounded bg-primary/10" />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Error state" />
          <div className="p-4">
            <div className="rounded-lg border border-danger/30 bg-danger-soft p-3">
              <div className="text-[13px] font-semibold text-danger">
                Payment could not be confirmed.
              </div>
              <p className="mt-1 text-[12px]">
                The order has not been marked paid. Retry or choose another method.
              </p>
              <div className="mt-3 flex gap-2">
                <Btn variant="primary">Retry payment</Btn>
                <Btn>Choose another method</Btn>
              </div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4 lg:col-span-2">
          <Empty
            title="No purchase orders yet"
            body="Create your first PO to start tracking supplier purchases and receiving."
            action="Create purchase order"
          />
        </Panel>
      </div>
    </AppShell>
  );
}
