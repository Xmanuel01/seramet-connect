import { useEffect, useMemo, useState } from "react";
import { DailyClosingPanel } from "./DailyClosingPanel";
import { DataTable } from "./Tabs";
import { TD, Status } from "./ui";
import { useAppContext } from "@/lib/app-context";
import { businessDateForTimestamp } from "@/lib/business-date";
import { marketplaceDaySummary } from "@/payments/marketplace-day-summary";
import { majorFromMinor } from "@/payments/money";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { formatMoney } from "@/lib/currency";
import { permissions } from "@/platform/permissions";
import type { IntegrationConnection } from "@/platform/types";
import type { useTransactionEngine } from "@/hooks/use-transaction-engine";

export function MarketplaceClosing({
  engine,
  connections,
}: {
  engine: ReturnType<typeof useTransactionEngine>;
  connections: IntegrationConnection[];
}) {
  const { activeTenantId, branchId, timeZone, hasPermission, currency } = useAppContext();
  const branch = getConfigurationRepository().getBranch(activeTenantId, branchId);
  const cutoff = Number(branch?.metadata["businessDayCutoffMinutes"] ?? 0);
  const [selectedDate, setDate] = useState("");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setDate(""), [activeTenantId, branchId]);
  const date = selectedDate || businessDateForTimestamp(now, timeZone, cutoff);
  const closedDay = engine.state.paymentOperations?.dayCloses.find(
    (day) =>
      day.tenantId === activeTenantId &&
      day.branchId === branchId &&
      day.businessDate === date &&
      day.status === "CLOSED",
  );
  const summary = useMemo(
    () =>
      engine.state.tenantId === activeTenantId
        ? (closedDay?.snapshot?.dailyReport?.marketplace ??
          marketplaceDaySummary(engine.state, {
            tenantId: activeTenantId,
            branchId,
            businessDate: date,
            timeZone,
            cutoffMinutes: cutoff,
            currency,
          }))
        : [],
    [engine.state, activeTenantId, branchId, date, timeZone, cutoff, currency, closedDay],
  );
  const batches = (engine.state.paymentOperations?.settlementBatches ?? []).filter(
    (batch) =>
      batch.tenantId === activeTenantId &&
      batch.branchId === branchId &&
      batch.status !== "REVERSED" &&
      batch.periodStart.slice(0, 10) <= date &&
      batch.periodEnd.slice(0, 10) >= date,
  );
  const money = (minor: number, currency: string) =>
    formatMoney(majorFromMinor(minor, currency), currency);
  return (
    <section className="mt-4 space-y-6">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h2 className="text-lg font-semibold">Marketplace closing</h2>
        <input
          aria-label="Closing date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-10 rounded-md border border-border bg-card px-3"
        />
      </div>
      <Status>
        {closedDay?.snapshot?.dailyReport?.marketplace ? "Closed-day snapshot" : "Current balances"}
      </Status>
      <div className="overflow-x-auto">
        <DataTable
          cols={[
            "Marketplace",
            "Orders",
            "Gross",
            "Settled balance",
            "Outstanding",
            "Total carried forward",
            "Recorded deductions",
            "Unfinished orders",
          ]}
        >
          {summary.map((row) => (
            <tr key={row.connectionId + row.currency}>
              <TD>
                {connections.find((item) => item.id === row.connectionId)?.displayName ??
                  row.providerId}
              </TD>
              <TD>{row.received}</TD>
              <TD>{money(row.grossMinor, row.currency)}</TD>
              <TD>{money(row.settledMinor, row.currency)}</TD>
              <TD>{money(row.outstandingMinor, row.currency)}</TD>
              <TD>{money(row.carriedOutstandingMinor, row.currency)}</TD>
              <TD>{money(row.feesMinor, row.currency)}</TD>
              <TD>{row.openOrderIds.length}</TD>
            </tr>
          ))}
          {!summary.length && (
            <tr>
              <TD colSpan={8}>No marketplace activity for this date.</TD>
            </tr>
          )}
        </DataTable>
      </div>
      <h3 className="font-semibold">Payout statements covering this date</h3>
      <div className="overflow-x-auto">
        <DataTable
          cols={[
            "Marketplace",
            "Period",
            "Sales",
            "Promotions",
            "Refunds",
            "Commission / fees",
            "Restaurant collections",
            "Expected payout",
            "Reported payout",
            "Difference",
            "Bank match",
          ]}
        >
          {batches.map((batch) => (
            <tr key={batch.id}>
              <TD>
                {connections.find((item) => item.id === batch.connectionId)?.displayName ??
                  batch.connectionId}
              </TD>
              <TD>
                {batch.periodStart.slice(0, 10)} - {batch.periodEnd.slice(0, 10)}
              </TD>
              <TD>{money(batch.grossSalesMinor, batch.currency)}</TD>
              <TD>{money(batch.promotionsMinor, batch.currency)}</TD>
              <TD>{money(batch.refundsMinor, batch.currency)}</TD>
              <TD>{money(batch.commissionsMinor + batch.serviceFeesMinor, batch.currency)}</TD>
              <TD>{money(batch.merchantCollectionsMinor ?? 0, batch.currency)}</TD>
              <TD>{money(batch.netExpectedMinor, batch.currency)}</TD>
              <TD>{money(batch.netSettledMinor, batch.currency)}</TD>
              <TD>{money(batch.netSettledMinor - batch.netExpectedMinor, batch.currency)}</TD>
              <TD>
                <Status>{batch.bankTransactionId ? "Linked" : "Not matched"}</Status>
              </TD>
            </tr>
          ))}
          {!batches.length && (
            <tr>
              <TD colSpan={11}>No payout statement imported for this period.</TD>
            </tr>
          )}
        </DataTable>
      </div>
      <a href="/payments" className="inline-block text-primary">
        Review payments and payout exceptions
      </a>
      {hasPermission(permissions.financeManage) && (
        <DailyClosingPanel
          engine={engine}
          selectedBusinessDate={date}
          onBusinessDateChange={setDate}
        />
      )}
    </section>
  );
}
