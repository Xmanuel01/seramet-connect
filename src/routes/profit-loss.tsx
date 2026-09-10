import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { emptyRecords } from "@/lib/empty-records";
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
  const pnl = emptyRecords<{
    label: string;
    value: number;
    budget?: number;
    previousPeriod?: number;
    previousYear?: number;
    indent?: boolean;
    bold?: boolean;
    total?: boolean;
    strong?: boolean;
  }>();
  return (
    <AppShell
      title="Profit & loss"
      subtitle="Posted actuals and configured budget comparison"
      actions={
        <>
          <Btn>Branch: All</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">Save view</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Revenue" value="Not available" />
        <Metric label="Gross margin" value="Not available" />
        <Metric label="Operating profit" value="Not available" />
        <Metric label="Net profit" value="Not available" />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Statement"
          sub="Expandable account groups with budget and previous-period comparison"
          right={<Status>Draft</Status>}
        />
        {pnl.length === 0 && (
          <EmptyState
            title="No posted financial activity"
            description="The statement will populate from posted journals after pilot transactions begin."
          />
        )}
        <div className="grid gap-2 p-3 md:hidden">
          {pnl.map((row) => {
            const actual = Math.abs(row.value);
            const variance = row.budget === undefined ? undefined : actual - row.budget;
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
                    <span className="num font-semibold">
                      {row.budget === undefined ? "-" : ksh(row.budget)}
                    </span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Variance</span>
                    <span
                      className={cn(
                        "num font-semibold",
                        variance !== undefined && (variance >= 0 ? "text-success" : "text-danger"),
                      )}
                    >
                      {variance === undefined
                        ? "-"
                        : `${variance >= 0 ? "+" : "-"}${ksh(Math.abs(variance))}`}
                    </span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Prev year</span>
                    <span className="num font-semibold">
                      {row.previousYear === undefined ? "-" : ksh(row.previousYear)}
                    </span>
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
                const variance = row.budget === undefined ? undefined : actual - row.budget;
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
                    <TD className="num text-right text-muted-foreground">
                      {row.budget === undefined ? "-" : ksh(row.budget)}
                    </TD>
                    <TD
                      className={cn(
                        "num text-right font-semibold",
                        variance !== undefined && (variance >= 0 ? "text-success" : "text-danger"),
                      )}
                    >
                      {variance === undefined
                        ? "-"
                        : `${variance >= 0 ? "+" : "-"}${ksh(Math.abs(variance))}`}
                    </TD>
                    <TD className="num text-right text-muted-foreground">
                      {row.previousPeriod === undefined ? "-" : ksh(row.previousPeriod)}
                    </TD>
                    <TD className="num text-right text-muted-foreground">
                      {row.previousYear === undefined ? "-" : ksh(row.previousYear)}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
