import type { BillingRecord, TransactionState } from "@/lib/transaction-engine";

export type BranchMatcher = (branchIdOrName?: string) => boolean;

export type SettledSalesSummary = {
  bills: BillingRecord[];
  grossSales: number;
  netSales: number;
  taxCollected: number;
  settledInvoices: number;
  revenueByCategory: Array<{ category: string; revenue: number }>;
};

const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const isSettledRevenue = (bill: BillingRecord) =>
  bill.paymentStatus === "PAID" || bill.paymentStatus === "PROVIDER_RECEIVABLE";

export function currentMonthSettledSales(
  state: TransactionState,
  matchesBranch: BranchMatcher,
  now = new Date(),
): SettledSalesSummary {
  const period = monthKey(now);
  const bills = state.bills.filter(
    (bill) =>
      matchesBranch(bill.branchId ?? bill.branch) &&
      (bill.businessDate ?? bill.issuedAt.slice(0, 10)).slice(0, 7) === period &&
      !["VOID", "MERGED", "SPLIT"].includes(bill.status) &&
      isSettledRevenue(bill),
  );

  const grossSales = bills.reduce((sum, bill) => sum + bill.total, 0);
  const netSales = bills.reduce((sum, bill) => sum + bill.subtotal, 0);
  const taxCollected = bills.reduce((sum, bill) => sum + bill.tax, 0);

  const categoryRevenue = new Map<string, number>();
  for (const bill of bills) {
    for (const line of bill.lines) {
      const category = line.category?.trim() || "Uncategorised";
      categoryRevenue.set(
        category,
        (categoryRevenue.get(category) ?? 0) + line.quantity * line.unitPrice,
      );
    }
  }

  return {
    bills,
    grossSales,
    netSales,
    taxCollected,
    settledInvoices: bills.length,
    revenueByCategory: Array.from(categoryRevenue, ([category, revenue]) => ({
      category,
      revenue,
    })).sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category)),
  };
}

export function currentMonthJournalStatus(
  state: TransactionState,
  matchesBranch: BranchMatcher,
  now = new Date(),
) {
  const period = monthKey(now);
  const journals = state.journalEntries.filter(
    (entry) =>
      matchesBranch(entry.branchId ?? entry.branch) &&
      (!entry.postedAt ||
        (entry.businessDate ?? entry.postedAt.slice(0, 10)).slice(0, 7) === period),
  );
  const posted = journals.filter((entry) => entry.status === "POSTED");
  const debit = posted.reduce(
    (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + line.debit, 0),
    0,
  );
  const credit = posted.reduce(
    (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + line.credit, 0),
    0,
  );
  return {
    posted,
    outOfBalance: Math.abs(debit - credit),
    unpostedVouchers: journals.filter((entry) => entry.status === "DRAFT").length,
  };
}
