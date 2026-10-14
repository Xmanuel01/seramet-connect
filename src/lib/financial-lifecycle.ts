import type { TransactionState } from "@/lib/transaction-engine";
import { businessDateForTimestamp } from "@/lib/business-date";
import { parseMajorAmount, sumMinor } from "@/payments/money";

export type FinancialLifecycleLine = {
  account: string;
  debitMinor: number;
  creditMinor: number;
};

export type FinancialLifecycleProjection = {
  tenantId: string;
  branchId: string;
  businessDate: string;
  currency: string;
  calculatedAt: string;
  orderedMinor: number;
  invoicedMinor: number;
  settledMinor: number;
  collectedMinor: number;
  netRevenueMinor: number;
  taxMinor: number;
  refundsMinor: number;
  cashVarianceMinor: number;
  orderCount: number;
  invoiceCount: number;
  settledInvoiceCount: number;
  receiptCount: number;
  tenders: Array<{ method: string; amountMinor: number }>;
  journal: FinancialLifecycleLine[];
};

export type DayCloseReadinessIssue = {
  id: string;
  code:
    | "OPEN_ORDER"
    | "UNSETTLED_INVOICE"
    | "OPEN_CASH_DRAWER"
    | "PAYMENT_EXCEPTION"
    | "PENDING_REFUND"
    | "UNPOSTED_JOURNAL"
    | "UNBALANCED_JOURNAL"
    | "UNPOSTED_SETTLEMENT";
  severity: "CRITICAL" | "HIGH";
  sourceId: string;
  message: string;
};

type ProjectionScope = {
  tenantId: string;
  branchId: string;
  businessDate: string;
  currency: string;
  calculatedAt?: string;
  timeZone?: string;
  businessDayCutoffMinutes?: number;
};

const inactiveOrderStatuses = new Set(["DRAFT", "HELD", "CANCELLED", "REFUNDED"]);
const terminalOrderStatuses = new Set(["PAID", "CANCELLED", "REFUNDED"]);
const excludedInvoiceStatuses = new Set(["VOID", "MERGED", "SPLIT"]);
const settledInvoiceStatuses = new Set(["PAID", "PROVIDER_RECEIVABLE"]);

export function projectFinancialLifecycle(
  state: TransactionState,
  scope: ProjectionScope,
): FinancialLifecycleProjection {
  const matchesBranch = (value?: string) => value === scope.branchId;
  const matchesDate = (explicit: string | undefined, timestamp: string) =>
    (explicit ??
      businessDateForTimestamp(
        timestamp,
        scope.timeZone ?? "UTC",
        scope.businessDayCutoffMinutes ?? 0,
      )) === scope.businessDate;
  const orders = state.orders.filter(
    (order) =>
      matchesBranch(order.branchId) &&
      matchesDate(order.businessDate, order.createdAt) &&
      !inactiveOrderStatuses.has(order.status),
  );
  const invoices = state.bills.filter(
    (bill) =>
      matchesBranch(bill.branchId) &&
      matchesDate(bill.businessDate, bill.issuedAt) &&
      !excludedInvoiceStatuses.has(bill.status),
  );
  const settledInvoices = invoices.filter(
    (bill) =>
      settledInvoiceStatuses.has(bill.status) ||
      bill.paymentStatus === "PAID" ||
      bill.paymentStatus === "PROVIDER_RECEIVABLE",
  );
  const payments = state.payments.filter(
    (payment) =>
      matchesBranch(payment.branchId) && matchesDate(payment.businessDate, payment.timestamp),
  );
  const receipts = state.receipts.filter(
    (receipt) =>
      matchesBranch(receipt.branchId) && matchesDate(receipt.businessDate, receipt.issuedAt),
  );
  const completedRefunds = state.refunds.filter(
    (refund) =>
      matchesBranch(refund.branchId) &&
      refund.status === "COMPLETED" &&
      matchesDate(refund.businessDate, refund.completedAt ?? refund.createdAt),
  );
  const tenders = new Map<string, number>();
  for (const payment of payments) {
    tenders.set(
      payment.method,
      checkedAdd(tenders.get(payment.method) ?? 0, moneyMinor(payment.amount, scope.currency)),
    );
  }
  const legacyJournal = state.journalEntries.filter(
    (entry) =>
      matchesBranch(entry.branchId) &&
      entry.status === "POSTED" &&
      matchesDate(
        entry.businessDate,
        entry.postedAt ?? scope.calculatedAt ?? new Date().toISOString(),
      ),
  );
  const journal = new Map<string, FinancialLifecycleLine>();
  for (const entry of legacyJournal) {
    for (const line of entry.lines) {
      const current = journal.get(line.account) ?? {
        account: line.account,
        debitMinor: 0,
        creditMinor: 0,
      };
      current.debitMinor = checkedAdd(current.debitMinor, moneyMinor(line.debit, scope.currency));
      current.creditMinor = checkedAdd(
        current.creditMinor,
        moneyMinor(line.credit, scope.currency),
      );
      journal.set(line.account, current);
    }
  }
  for (const entry of state.paymentOperations?.journals ?? []) {
    if (
      entry.branchId !== scope.branchId ||
      entry.businessDate !== scope.businessDate ||
      entry.status !== "POSTED"
    ) {
      continue;
    }
    for (const line of entry.lines) {
      const current = journal.get(line.accountId) ?? {
        account: line.accountId,
        debitMinor: 0,
        creditMinor: 0,
      };
      current.debitMinor = checkedAdd(current.debitMinor, line.debitMinor);
      current.creditMinor = checkedAdd(current.creditMinor, line.creditMinor);
      journal.set(line.accountId, current);
    }
  }
  const drawers = (state.paymentOperations?.drawerSessions ?? []).filter(
    (drawer) =>
      matchesBranch(drawer.branchId) &&
      matchesDate(drawer.businessDate, drawer.closedAt ?? drawer.openedAt) &&
      drawer.varianceMinor !== undefined,
  );
  return {
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    businessDate: scope.businessDate,
    currency: scope.currency,
    calculatedAt: scope.calculatedAt ?? new Date().toISOString(),
    orderedMinor: sumMinor(orders.map((order) => moneyMinor(order.total, scope.currency))),
    invoicedMinor: sumMinor(invoices.map((bill) => moneyMinor(bill.total, scope.currency))),
    settledMinor: sumMinor(settledInvoices.map((bill) => moneyMinor(bill.total, scope.currency))),
    collectedMinor: sumMinor(payments.map((payment) => moneyMinor(payment.amount, scope.currency))),
    netRevenueMinor: sumMinor(
      settledInvoices.map((bill) => moneyMinor(bill.subtotal, scope.currency)),
    ),
    taxMinor: sumMinor(settledInvoices.map((bill) => moneyMinor(bill.tax, scope.currency))),
    refundsMinor: sumMinor(
      completedRefunds.map((refund) => moneyMinor(refund.amount, scope.currency)),
    ),
    cashVarianceMinor: sumMinor(drawers.map((drawer) => drawer.varianceMinor ?? 0)),
    orderCount: orders.length,
    invoiceCount: invoices.length,
    settledInvoiceCount: settledInvoices.length,
    receiptCount: receipts.length,
    tenders: Array.from(tenders, ([method, amountMinor]) => ({ method, amountMinor })).sort(
      (left, right) => left.method.localeCompare(right.method),
    ),
    journal: Array.from(journal.values()).sort((left, right) =>
      left.account.localeCompare(right.account),
    ),
  };
}

export function financialCloseReadiness(
  state: TransactionState,
  scope: Pick<
    ProjectionScope,
    "tenantId" | "branchId" | "businessDate" | "timeZone" | "businessDayCutoffMinutes"
  >,
): DayCloseReadinessIssue[] {
  const issues: DayCloseReadinessIssue[] = [];
  const matchesDate = (explicit: string | undefined, timestamp: string) =>
    (explicit ??
      businessDateForTimestamp(
        timestamp,
        scope.timeZone ?? "UTC",
        scope.businessDayCutoffMinutes ?? 0,
      )) === scope.businessDate;
  for (const order of state.orders) {
    if (
      order.branchId === scope.branchId &&
      matchesDate(order.businessDate, order.createdAt) &&
      !terminalOrderStatuses.has(order.status)
    ) {
      issues.push(issue("OPEN_ORDER", order.id, "Order remains open at day close"));
    }
  }
  for (const bill of state.bills) {
    if (
      bill.branchId === scope.branchId &&
      matchesDate(bill.businessDate, bill.issuedAt) &&
      !excludedInvoiceStatuses.has(bill.status) &&
      bill.paymentStatus !== "PAID" &&
      bill.paymentStatus !== "PROVIDER_RECEIVABLE"
    ) {
      issues.push(issue("UNSETTLED_INVOICE", bill.id, "Invoice is not fully settled"));
    }
  }
  const operations = state.paymentOperations;
  for (const drawer of operations?.drawerSessions ?? []) {
    if (
      drawer.branchId === scope.branchId &&
      matchesDate(drawer.businessDate, drawer.openedAt) &&
      drawer.status === "OPEN"
    ) {
      issues.push(issue("OPEN_CASH_DRAWER", drawer.id, "Cash drawer is still open"));
    }
  }
  for (const exception of operations?.exceptions ?? []) {
    if (
      (!exception.branchId || exception.branchId === scope.branchId) &&
      exception.severity === "CRITICAL" &&
      !["RESOLVED", "IGNORED"].includes(exception.status)
    ) {
      issues.push(issue("PAYMENT_EXCEPTION", exception.id, exception.detail));
    }
  }
  for (const refund of operations?.refunds ?? []) {
    if (
      refund.branchId === scope.branchId &&
      ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status)
    ) {
      issues.push(issue("PENDING_REFUND", refund.id, "Refund has not reached a final state"));
    }
  }
  for (const journal of operations?.journals ?? []) {
    if (journal.branchId !== scope.branchId || journal.businessDate !== scope.businessDate)
      continue;
    if (journal.status === "DRAFT") {
      issues.push(issue("UNPOSTED_JOURNAL", journal.id, "Journal remains unposted"));
    }
    const debit = sumMinor(journal.lines.map((line) => line.debitMinor));
    const credit = sumMinor(journal.lines.map((line) => line.creditMinor));
    if (debit !== credit) {
      issues.push(issue("UNBALANCED_JOURNAL", journal.id, "Journal debits and credits differ"));
    }
  }
  for (const settlement of operations?.settlementBatches ?? []) {
    const settlementBusinessDate = businessDateForTimestamp(
      settlement.settledAt ?? settlement.periodEnd,
      scope.timeZone ?? "UTC",
      scope.businessDayCutoffMinutes ?? 0,
    );
    if (
      (!settlement.branchId || settlement.branchId === scope.branchId) &&
      settlementBusinessDate <= scope.businessDate &&
      !["POSTED", "REVERSED"].includes(settlement.status)
    ) {
      issues.push(issue("UNPOSTED_SETTLEMENT", settlement.id, "Settlement is not posted"));
    }
  }
  return issues.sort((left, right) => left.id.localeCompare(right.id));
}

function issue(
  code: DayCloseReadinessIssue["code"],
  sourceId: string,
  message: string,
): DayCloseReadinessIssue {
  return {
    id: `${code}:${sourceId}`,
    code,
    severity: code === "PAYMENT_EXCEPTION" || code === "UNBALANCED_JOURNAL" ? "CRITICAL" : "HIGH",
    sourceId,
    message,
  };
}

function moneyMinor(amount: number, currency: string) {
  return parseMajorAmount(amount, currency);
}

function checkedAdd(left: number, right: number) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error("Financial projection exceeds safe precision");
  return value;
}
