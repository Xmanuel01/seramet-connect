import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh, pnl } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profit-loss")({
  head: () => ({
    meta: [
      { title: "Profit & Loss - Seramet" },
      {
        name: "description",
        content:
          "Professional financial statement with actual, budget and previous period comparison.",
      },
      { property: "og:title", content: "Profit & Loss - Seramet" },
      {
        property: "og:description",
        content: "Actual, budget and prior-year comparison for every branch.",
      },
    ],
  }),
  component: ProfitLoss,
});

function ProfitLoss() {
  return (
    <AppShell
      title="Profit & loss"
      subtitle="Actual vs budget - 1-12 August 2026 - all branches"
      actions={
        <>
          <Btn>Branch: All</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">Save view</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Revenue" value={4862400} money delta={7.6} />
        <Metric label="Gross margin" value={66.6} suffix="%" delta={1.2} />
        <Metric label="Operating profit" value={1053500} money delta={4.8} />
        <Metric label="Net profit" value={957300} money delta={4.2} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Statement"
          sub="Expandable account groups with budget and previous-period comparison"
          right={<Status>Draft</Status>}
        />
        <div className="grid gap-2 p-3 md:hidden">
          {pnl.map((row) => {
            const actual = Math.abs(row.value);
            const budget = Math.round(actual * (row.value > 0 ? 0.96 : 1.04));
            const variance = actual - budget;
            return (
              <article
                key={row.label}
                className={cn(
                  "rounded-lg border border-border bg-card p-3 shadow-card",
                  row.total && "bg-secondary/50",
                )}
              >
                <div
                  className={cn(
                    "text-[13px]",
                    row.indent && "pl-4 text-muted-foreground",
                    (row.bold || row.total) && "font-semibold",
                    row.strong && "text-[14px] font-extrabold",
                  )}
                >
                  {row.label}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Actual</span>
                    <span className="num font-semibold">{ksh(actual)}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Budget</span>
                    <span className="num font-semibold">{ksh(budget)}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Variance</span>
                    <span
                      className={cn(
                        "num font-semibold",
                        variance >= 0 ? "text-success" : "text-danger",
                      )}
                    >
                      {variance >= 0 ? "+" : "-"}
                      {ksh(Math.abs(variance))}
                    </span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Prev year</span>
                    <span className="num font-semibold">{ksh(Math.round(actual * 0.88))}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <TH>Account</TH>
                <TH className="text-right">Actual</TH>
                <TH className="text-right">Budget</TH>
                <TH className="text-right">Variance</TH>
                <TH className="text-right">Previous period</TH>
                <TH className="text-right">Previous year</TH>
              </tr>
            </thead>
            <tbody>
              {pnl.map((row) => {
                const actual = Math.abs(row.value);
                const budget = Math.round(actual * (row.value > 0 ? 0.96 : 1.04));
                const variance = actual - budget;
                return (
                  <tr key={row.label} className={cn(row.total && "bg-secondary/50")}>
                    <TD
                      className={cn(
                        row.indent && "pl-7 text-muted-foreground",
                        (row.bold || row.total) && "font-semibold",
                        row.strong && "text-[14px] font-extrabold",
                      )}
                    >
                      {row.label}
                    </TD>
                    <TD className="num text-right font-semibold">{ksh(actual)}</TD>
                    <TD className="num text-right text-muted-foreground">{ksh(budget)}</TD>
                    <TD
                      className={cn(
                        "num text-right font-semibold",
                        variance >= 0 ? "text-success" : "text-danger",
                      )}
                    >
                      {variance >= 0 ? "+" : "-"}
                      {ksh(Math.abs(variance))}
                    </TD>
                    <TD className="num text-right text-muted-foreground">
                      {ksh(Math.round(actual * 0.94))}
                    </TD>
                    <TD className="num text-right text-muted-foreground">
                      {ksh(Math.round(actual * 0.88))}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {[
          ["Westlands", "KSh 642,800", "20.4%", "Healthy"],
          ["Ngong Road", "KSh 314,500", "16.2%", "Attention"],
          ["Shared overhead", "KSh -186,200", "-", "Pending"],
        ].map(([name, profit, margin, status]) => (
          <Panel key={name} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[14px] font-semibold">{name}</div>
                <div className="num mt-1 text-[20px] font-bold">{profit}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">Net margin {margin}</div>
              </div>
              <Status>{status}</Status>
            </div>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
