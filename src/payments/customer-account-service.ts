import { assertSameCurrency, sumMinor } from "@/payments/money";
import type { PaymentOperationsState } from "@/payments/types";

export type CustomerStatement = {
  customerAccountId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  entries: PaymentOperationsState["customerAccountEntries"];
  closingBalanceMinor: number;
};

export function buildCustomerStatement(
  operations: PaymentOperationsState,
  input: {
    tenantId: string;
    customerAccountId: string;
    periodStart: string;
    periodEnd: string;
  },
): CustomerStatement {
  const account = operations.customerAccounts.find(
    (candidate) =>
      candidate.id === input.customerAccountId && candidate.tenantId === input.tenantId,
  );
  if (!account) throw new Error("Tenant-scoped customer account was not found");
  const periodStart = Date.parse(input.periodStart);
  const periodEnd = Date.parse(input.periodEnd);
  if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodStart > periodEnd) {
    throw new Error("Invalid customer statement period");
  }
  const entryTypeOrder = {
    INVOICE: 0,
    ADJUSTMENT: 1,
    CREDIT_NOTE: 2,
    PAYMENT: 3,
  } as const;
  const allEntries = operations.customerAccountEntries
    .filter((entry) => entry.tenantId === input.tenantId && entry.customerAccountId === account.id)
    .sort((left, right) => {
      const occurredAtDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
      if (occurredAtDifference !== 0) return occurredAtDifference;
      const typeDifference = entryTypeOrder[left.type] - entryTypeOrder[right.type];
      if (typeDifference !== 0) return typeDifference;
      return left.id.localeCompare(right.id);
    });
  allEntries.forEach((entry) => assertSameCurrency(account.currency, entry.currency));
  const openingBalanceMinor = sumMinor(
    allEntries
      .filter((entry) => Date.parse(entry.occurredAt) < periodStart)
      .map((entry) => entry.amountMinor),
  );
  const entries = allEntries.filter((entry) => {
    const occurredAt = Date.parse(entry.occurredAt);
    return occurredAt >= periodStart && occurredAt <= periodEnd;
  });
  const closingBalanceMinor =
    openingBalanceMinor + sumMinor(entries.map((entry) => entry.amountMinor));
  return {
    customerAccountId: account.id,
    currency: account.currency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    openingBalanceMinor,
    entries,
    closingBalanceMinor,
  };
}
