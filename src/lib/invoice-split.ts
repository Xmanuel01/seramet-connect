import { majorFromMinor, parseMajorAmount, sumMinor } from "@/payments/money";

export function invoiceDisplayName(id: string) {
  return `INV-${id.replace(/^(?:BILL|INV)-/i, "")}`;
}

export function invoiceSplitAmounts(
  total: number,
  currency: string,
  rows: readonly { label: string; amount: string }[],
) {
  if (rows.length < 2) throw new Error("Enter at least two allocations.");
  const amounts = rows.map((row) => parseMajorAmount(row.amount, currency));
  if (amounts.some((amount) => amount <= 0))
    throw new Error("Every amount must be greater than zero.");
  const allocatedMinor = sumMinor(amounts);
  const totalMinor = parseMajorAmount(total, currency);
  return {
    allocatedMinor,
    remainingMinor: totalMinor - allocatedMinor,
    splits: rows.map((row, index) => ({
      label: row.label.trim() || `Person ${index + 1}`,
      amount: majorFromMinor(amounts[index]!, currency),
    })),
  };
}
