import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Segmented, Status, TD, TH } from "@/components/app/ui";
import { decisions, ksh } from "@/data/mock";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Approval Centre — Seramet" },
      { name: "description", content: "One queue for purchase orders, refunds, variances, overtime and price changes." },
      { property: "og:title", content: "Approval Centre — Seramet" },
      { property: "og:description", content: "A single decision queue for managers and directors." },
    ],
  }),
  component: Approvals,
});

const audit = [
  { t: "12:41", u: "Joan A.", act: "Refund requested", mod: "Sales", rec: "#1798", old: "Paid", now: "Refund pending" },
  { t: "12:18", u: "Kelvin M.", act: "PO submitted", mod: "Procurement", rec: "PO-2026-0182", old: "Draft", now: "Awaiting approval" },
  { t: "11:52", u: "Amina W.", act: "Cash variance logged", mod: "Finance", rec: "Till 2", old: "—", now: "KSh 850 short" },
  { t: "10:07", u: "Chef Musa", act: "Waste entry", mod: "Inventory", rec: "WST-0442", old: "—", now: "2.4 kg beef" },
];

function Approvals() {
  const [tab, setTab] = useState("All");
  return (
    <AppShell
      title="Approval centre"
      subtitle="4 decisions pending · KSh 69,750 total value"
      actions={<><Segmented options={["All", "Finance", "Inventory", "Procurement", "HR"]} value={tab} onChange={setTab} /><Btn variant="primary">Approve all safe</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Pending" value={4} />
        <Metric label="Value at stake" value={69750} money />
        <Metric label="Approved today" value={11} delta={22} />
        <Metric label="Oldest request" value="2 hr" />
      </div>

      <div className="mt-4">
        <Chips items={["Branch: All", "Requester: Any", "Age: < 24h"]} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {decisions.map((d) => (
          <Panel key={d.title} className="p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold leading-snug">{d.title}</h3>
                <p className="text-[12px] text-muted-foreground">{d.ctx}</p>
              </div>
              <span className="num shrink-0 text-[16px] font-bold">{ksh(d.value)}</span>
            </div>
            <p className="mt-2.5 rounded-md bg-secondary/60 px-3 py-2 text-[12px]">{d.reason}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{d.by}</span><span>·</span><span>{d.time}</span>
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

      <Panel className="mt-4">
        <PanelHead title="Audit trail" sub="Immutable record of every change" right={<Btn>Export</Btn>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead><tr><TH>Time</TH><TH>User</TH><TH>Action</TH><TH>Module</TH><TH>Record</TH><TH>Old value</TH><TH>New value</TH></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.t} className="hover:bg-secondary/50">
                  <TD className="num text-muted-foreground">{a.t}</TD>
                  <TD className="font-medium">{a.u}</TD>
                  <TD>{a.act}</TD>
                  <TD className="text-muted-foreground">{a.mod}</TD>
                  <TD className="num">{a.rec}</TD>
                  <TD className="text-muted-foreground">{a.old}</TD>
                  <TD className="font-medium">{a.now}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}