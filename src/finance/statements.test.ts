import { describe, expect, it } from "vitest";
import { balanceSheet, previousPeriod, profitAndLoss } from "./StatementsPage";
import type { FinanceStatement, FinancialAccountRow } from "./use-finance-report";

function account(
  code: string,
  type: string,
  period: { debit?: number; credit?: number } = {},
  closing = 0,
  currency = "KES",
): FinancialAccountRow {
  return {
    accountId: code,
    code,
    name: code,
    type,
    currency,
    openingDebitMinor: 0,
    openingCreditMinor: 0,
    periodDebitMinor: period.debit ?? 0,
    periodCreditMinor: period.credit ?? 0,
    debitMinor: 0,
    creditMinor: 0,
    closingSignedMinor: closing,
  };
}

function statement(lines: FinancialAccountRow[]): FinanceStatement {
  return {
    scope: { from: "2026-11-01", to: "2026-11-30", branchIds: ["b"], currency: "KES" },
    quality: "RECONCILED",
    issues: [],
    lines,
    trial: { periodDebitMinor: 0, periodCreditMinor: 0, balanced: true },
    balanceSheet: {
      assetsMinor: 0,
      liabilitiesMinor: 0,
      equityMinor: 0,
      unclosedEarningsMinor: 0,
      differenceMinor: 0,
    },
    incomeStatement: { incomeMinor: 0, expenseMinor: 0, netResultMinor: 0 },
    cashMovement: null,
  };
}

describe("previous period", () => {
  it("is the same length, ending the day before", () => {
    expect(previousPeriod("2026-11-01", "2026-11-30")).toEqual({
      from: "2026-10-02",
      to: "2026-10-31",
    });
    expect(previousPeriod("2026-11-02", "2026-11-02")).toEqual({
      from: "2026-11-01",
      to: "2026-11-01",
    });
    expect(previousPeriod("2026-03-01", "2026-03-07")).toEqual({
      from: "2026-02-22",
      to: "2026-02-28",
    });
  });

  it("has none while the range is incomplete or reversed", () => {
    expect(previousPeriod("", "2026-11-30")).toBeNull();
    expect(previousPeriod("2026-11-30", "2026-11-01")).toBeNull();
  });
});

describe("profit and loss", () => {
  it("groups income, cost of sales and expenses with natural signs", () => {
    const pnl = profitAndLoss(
      statement([
        account("4000", "INCOME", { credit: 100_000, debit: 2_000 }),
        account("4100", "REVENUE", { credit: 20_000 }),
        account("5000", "COGS", { debit: 40_000 }),
        account("6000", "EXPENSE", { debit: 30_000, credit: 1_000 }),
        account("6100", "EXPENSE", {}),
        account("1000", "ASSET", { debit: 99_000 }),
        account("4900", "INCOME", { credit: 50_000 }, 0, "USD"),
      ]),
    );
    expect(pnl.totals).toEqual({
      income: 118_000,
      costOfSales: 40_000,
      grossProfit: 78_000,
      expenses: 29_000,
      netResult: 49_000,
    });
    // Accounts with nothing in the period, other currencies and balance sheet accounts stay out.
    expect(pnl.expenses.map((line) => line.account.code)).toEqual(["6000"]);
    expect(pnl.income.map((line) => line.account.code)).toEqual(["4000", "4100"]);
  });
});

describe("balance sheet", () => {
  it("shows liabilities and equity as positive balances", () => {
    const sheet = balanceSheet(
      statement([
        account("1000", "ASSET", {}, 150_000),
        account("1010", "CASH", {}, 20_000),
        account("1020", "BANK", {}, 30_000),
        account("2000", "LIABILITY", {}, -110_000),
        account("3000", "EQUITY", {}, -90_000),
        account("1100", "ASSET", {}, 0),
      ]),
    );
    // Cash and bank are assets, as in the server's balance sheet totals.
    expect(sheet.assets.map((line) => line.account.code)).toEqual(["1000", "1010", "1020"]);
    expect(sheet.assets.map((line) => line.amount)).toEqual([150_000, 20_000, 30_000]);
    expect(sheet.liabilities.map((line) => line.amount)).toEqual([110_000]);
    expect(sheet.equity.map((line) => line.amount)).toEqual([90_000]);
  });
});
