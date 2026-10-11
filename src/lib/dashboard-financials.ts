import {
  businessDateForTimestamp,
  businessDatePeriod,
  shiftBusinessDate,
} from "@/lib/business-date";
import { projectFinancialLifecycle } from "@/lib/financial-lifecycle";
import type { TransactionState } from "@/lib/transaction-engine";
import { majorFromMinor, parseMajorAmount, sumMinor } from "@/payments/money";
import type { Branch } from "@/platform/types";

type DashboardPeriod = "Today" | "Yesterday" | "Week" | "Month";

type DashboardFinancialsInput = {
  state: TransactionState;
  tenantId: string;
  branches: Branch[];
  period: DashboardPeriod;
  now: Date;
  currency: string;
  fallbackTimeZone: string;
  locale: string;
};

function branchContext(branch: Branch, fallbackTimeZone: string) {
  return {
    timeZone: branch.timezone ?? fallbackTimeZone,
    cutoffMinutes: Number(branch.metadata["businessDayCutoffMinutes"] ?? 0),
  };
}

function branchMatches(value: string | undefined, branch: Branch) {
  return value === branch.id || value === branch.name;
}

function localHour(timestamp: string, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(timestamp)),
  );
}

export function buildDashboardFinancials(input: DashboardFinancialsInput) {
  const branchReports = input.branches.map((branch) => {
    const context = branchContext(branch, input.fallbackTimeZone);
    const range = businessDatePeriod(
      input.period,
      input.now,
      context.timeZone,
      context.cutoffMinutes,
    );
    const inRange = (timestamp: string, explicit?: string) => {
      const businessDate =
        explicit ?? businessDateForTimestamp(timestamp, context.timeZone, context.cutoffMinutes);
      return businessDate >= range.from && businessDate <= range.to;
    };
    const projections = [];
    for (
      let businessDate = range.from;
      businessDate <= range.to;
      businessDate = shiftBusinessDate(businessDate, 1)
    ) {
      projections.push(
        projectFinancialLifecycle(input.state, {
          tenantId: input.tenantId,
          branchId: branch.id,
          businessDate,
          currency: input.currency,
          timeZone: context.timeZone,
          businessDayCutoffMinutes: context.cutoffMinutes,
        }),
      );
    }
    const orders = input.state.orders.filter(
      (order) =>
        branchMatches(order.branchId ?? order.branch, branch) &&
        inRange(order.createdAt, order.businessDate) &&
        !["DRAFT", "HELD", "CANCELLED", "REFUNDED"].includes(order.status),
    );
    const movements = input.state.stockMovements.filter(
      (movement) =>
        branchMatches(movement.branchId ?? movement.branch, branch) &&
        movement.type === "SALE_CONSUMPTION" &&
        inRange(movement.createdAt),
    );
    const costMinor = sumMinor(
      movements.map((movement) =>
        parseMajorAmount(Math.abs(movement.quantity) * movement.unitCost, input.currency),
      ),
    );
    const netRevenueMinor = sumMinor(projections.map((row) => row.netRevenueMinor));
    const collectedMinor = sumMinor(projections.map((row) => row.collectedMinor));
    const currentBusinessDate = businessDateForTimestamp(
      input.now,
      context.timeZone,
      context.cutoffMinutes,
    );

    return {
      branch,
      context,
      orders,
      movements,
      projections,
      costMinor,
      netRevenueMinor,
      collectedMinor,
      currentBusinessDate,
    };
  });

  const trend = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 6;
    const referenceDate = shiftBusinessDate(
      branchReports[0]?.currentBusinessDate ??
        businessDateForTimestamp(input.now, input.fallbackTimeZone, 0),
      offset,
    );
    const salesMinor = sumMinor(
      branchReports.map((report) => {
        const businessDate = shiftBusinessDate(report.currentBusinessDate, offset);
        return projectFinancialLifecycle(input.state, {
          tenantId: input.tenantId,
          branchId: report.branch.id,
          businessDate,
          currency: input.currency,
          timeZone: report.context.timeZone,
          businessDayCutoffMinutes: report.context.cutoffMinutes,
        }).netRevenueMinor;
      }),
    );
    const costMinor = sumMinor(
      branchReports.flatMap((report) => {
        const businessDate = shiftBusinessDate(report.currentBusinessDate, offset);
        return input.state.stockMovements
          .filter(
            (movement) =>
              branchMatches(movement.branchId ?? movement.branch, report.branch) &&
              movement.type === "SALE_CONSUMPTION" &&
              businessDateForTimestamp(
                movement.createdAt,
                report.context.timeZone,
                report.context.cutoffMinutes,
              ) === businessDate,
          )
          .map((movement) =>
            parseMajorAmount(Math.abs(movement.quantity) * movement.unitCost, input.currency),
          );
      }),
    );
    return {
      d: new Date(`${referenceDate}T12:00:00.000Z`).toLocaleDateString(input.locale, {
        weekday: "short",
        timeZone: "UTC",
      }),
      sales: majorFromMinor(salesMinor, input.currency),
      cost: majorFromMinor(costMinor, input.currency),
    };
  });

  const orderedByHour = Array.from({ length: 24 }, (_, hour) => ({
    h: `${String(hour).padStart(2, "0")}:00`,
    v: majorFromMinor(
      sumMinor(
        branchReports.flatMap((report) =>
          report.orders
            .filter((order) => localHour(order.createdAt, report.context.timeZone) === hour)
            .map((order) => parseMajorAmount(order.total, input.currency)),
        ),
      ),
      input.currency,
    ),
  })).filter((row) => row.v > 0);
  const channels = [
    ...new Set(branchReports.flatMap((report) => report.orders.map((order) => order.channel))),
  ].map((channel) => ({
    name: channel,
    value: majorFromMinor(
      sumMinor(
        branchReports.flatMap((report) =>
          report.orders
            .filter((order) => order.channel === channel)
            .map((order) => parseMajorAmount(order.total, input.currency)),
        ),
      ),
      input.currency,
    ),
  }));
  const branches = branchReports.map((report) => {
    const sales = majorFromMinor(report.netRevenueMinor, input.currency);
    const cost = majorFromMinor(report.costMinor, input.currency);
    const margin = sales > 0 ? ((sales - cost) / sales) * 100 : 0;
    return {
      branch: report.branch.name,
      sales,
      orders: report.orders.length,
      margin: Math.round(margin),
      foodCost: sales > 0 ? Math.round((cost / sales) * 100) : 0,
      status: sales === 0 ? "No activity" : margin >= 60 ? "Healthy" : "Attention",
    };
  });

  return {
    netSales: majorFromMinor(
      sumMinor(branchReports.map((report) => report.netRevenueMinor)),
      input.currency,
    ),
    cost: majorFromMinor(sumMinor(branchReports.map((report) => report.costMinor)), input.currency),
    collected: majorFromMinor(
      sumMinor(branchReports.map((report) => report.collectedMinor)),
      input.currency,
    ),
    orders: branchReports.flatMap((report) => report.orders),
    trend,
    hourly: orderedByHour,
    channels,
    branches,
  };
}
