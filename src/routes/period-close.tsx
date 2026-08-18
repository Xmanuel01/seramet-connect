import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/period-close")({
  head: () => ({
    meta: [
      { title: "Period Close - Seramet" },
      {
        name: "description",
        content: "Day-end and month-end close checklist with fiscal period locking and sign-off trail.",
      },
      { property: "og:title", content: "Period Close - Seramet" },
      { property: "og:description", content: "Close the trading day and the accounting month with an auditable checklist." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PeriodClose,
});

const dayEnd = [
  ["Every open order settled or held with a reason", "Complete", "Cashier"],
  ["Cash drawers counted and declared", "Complete", "Cashier"],
  ["M-Pesa and card settlements matched", "Complete", "Accountant"],
  ["Wastage and breakage logged", "Complete", "Chef"],
  ["Daily sales journal posted", "Pending", "Accountant"],
];

const monthEnd = [
  ["Stock count posted and valued", "Complete", "Storekeeper"],
  ["COGS journal posted from inventory movement", "Pending", "Accountant"],
  ["Supplier bills matched to GRNs", "Pending", "Accountant"],
  ["Payroll posted and statutory deductions accrued", "Complete", "Accountant"],
  ["Bank reconciliation cleared", "Pending", "Accountant"],
  ["Depreciation charged", "Pending", "Accountant"],
  ["Accruals and prepayments recognised", "Pending", "Accountant"],
  ["Trial balance agreed and period locked", "Pending", "General Manager"],
];

const periods = [
  { period: "May 2026", status: "Approved", closedBy: "A. Mwangi", locked: "Yes" },
  { period: "Jun 2026", status: "Approved", closedBy: "A. Mwangi", locked: "Yes" },
  { period: "Jul 2026", status: "Approved", closedBy: "A. Mwangi", locked: "Yes" },
  { period: "Aug 2026", status: "Open", closedBy: "-", locked: "No" },
];

function Checklist({ title, sub, items }: { title: string; sub: string; items: string[][] }) {
  return (
    <Panel className="mt-4">
      <PanelHead
        title={title}
        sub={sub}
        right={<Status>{items.every((i) => i[1] === "Complete") ? "Complete" : "In progress"}</Status>}
      />
      <table className="w-full">
        <thead>
          <tr>
            <TH>Step</TH>
            <TH>Owner</TH>
            <TH>Status</TH>
          </tr>
        </thead>
        <tbody>
          {items.map(([step, status, owner]) => (
            <tr key={step} className="hover:bg-secondary/40">
              <TD className="font-semibold">{step}</TD>
              <TD className="text-muted-foreground">{owner}</TD>
              <TD>
                <Status>{status}</Status>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function PeriodClose() {
  const { branchLabel } = useAppContext();
  const outstanding = [...dayEnd, ...monthEnd].filter((i) => i[1] !== "Complete").length;
  return (
    <AppShell
      title="Period close"
      subtitle={`Day-end and month-end control  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Close trading day</Btn>
          <Btn variant="primary">Lock August 2026</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Current period" value="Aug 2026" />
        <Metric label="Outstanding steps" value={outstanding} invert />
        <Metric label="Unposted journals" value={2} invert />
        <Metric label="Last locked period" value="Jul 2026" />
      </div>
      <Checklist title="Day-end checklist" sub="Runs at close of every trading day" items={dayEnd} />
      <Checklist title="Month-end checklist" sub="Must be complete before the period can be locked" items={monthEnd} />
      <Panel className="mt-4">
        <PanelHead title="Fiscal periods" sub="Locked periods reject any new or edited posting" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Period</TH>
              <TH>Status</TH>
              <TH>Closed by</TH>
              <TH>Locked</TH>
            </tr>
          </thead>
          <tbody>
            {periods.map((row) => (
              <tr key={row.period} className="hover:bg-secondary/40">
                <TD className="font-semibold">{row.period}</TD>
                <TD>
                  <Status>{row.status}</Status>
                </TD>
                <TD className="text-muted-foreground">{row.closedBy}</TD>
                <TD className="text-muted-foreground">{row.locked}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
