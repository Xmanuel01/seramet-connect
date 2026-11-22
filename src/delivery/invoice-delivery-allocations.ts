import type { BillingRecord, TransactionOrder } from "@/lib/transaction-engine";
import { allocateInvoiceMinor, verifyInvoiceComponents } from "@/payments/invoice-components";
import { sumMinor } from "@/payments/money";

type Allocation = { orderId?: string; payableMinor: number; businessMinor: number };

/** Replay invoice lineage without attributing a split child from full order amounts. */
export function invoiceDeliveryAllocations(
  bills: BillingRecord[],
  orders: Map<string, TransactionOrder>,
  currency: string,
) {
  const byId = new Map(bills.map((bill) => [bill.id, bill]));
  const cache = new Map<string, Allocation[] | undefined>();
  const totals = (bill: BillingRecord) => {
    if (!bill.financialComponents) return undefined;
    const parts = verifyInvoiceComponents(bill.financialComponents, bill, currency);
    const payableMinor = parts.deliveryPayableMinor ?? 0;
    return { payableMinor, businessMinor: (parts.deliveryChargeMinor ?? 0) - payableMinor };
  };
  const allocate = (amount: number, weights: number[]) =>
    sumMinor(weights) > 0 ? allocateInvoiceMinor(amount, weights) : weights.map(() => 0);

  const resolve = (bill: BillingRecord, depth = 0): Allocation[] | undefined => {
    if (cache.has(bill.id)) return cache.get(bill.id);
    // The unresolved entry also stops corrupt historical links from recursing forever.
    cache.set(bill.id, undefined);
    const target = totals(bill);
    if (!target || depth > 100) return undefined;
    if (target.payableMinor === 0 && target.businessMinor === 0) {
      cache.set(bill.id, []);
      return [];
    }
    if (bill.splitFromBillId) {
      const parent = byId.get(bill.splitFromBillId);
      const parentParts = parent && resolve(parent, depth + 1);
      if (!parentParts) return undefined;
      const siblings = bills
        .filter((child) => child.splitFromBillId === parent!.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      const childTotals = siblings.map(totals);
      if (childTotals.some((child) => !child)) return undefined;
      for (const field of ["payableMinor", "businessMinor"] as const)
        if (
          sumMinor(childTotals.map((child) => child![field])) !==
          sumMinor(parentParts.map((part) => part[field]))
        )
          return undefined;
      const remaining = parentParts.map((part) => ({ ...part }));
      // Consume remaining minor units so sibling rounding is conserved for every rider.
      siblings.forEach((sibling, index) => {
        const payables = allocate(
          childTotals[index]!.payableMinor,
          remaining.map((part) => part.payableMinor),
        );
        const business = allocate(
          childTotals[index]!.businessMinor,
          remaining.map((part) => part.businessMinor),
        );
        cache.set(
          sibling.id,
          remaining.map((part, partIndex) => {
            part.payableMinor -= payables[partIndex]!;
            part.businessMinor -= business[partIndex]!;
            return {
              orderId: part.orderId,
              payableMinor: payables[partIndex]!,
              businessMinor: business[partIndex]!,
            };
          }),
        );
      });
      return cache.get(bill.id);
    }
    if (bill.sourceBillIds?.length) {
      if (new Set(bill.sourceBillIds).size !== bill.sourceBillIds.length) return undefined;
      const sources = bill.sourceBillIds.map((id) => byId.get(id));
      if (sources.some((source) => !source)) return undefined;
      const parts = sources.map((source) => resolve(source!, depth + 1));
      if (parts.some((part) => !part)) return undefined;
      const merged = new Map<string | undefined, Allocation>();
      for (const part of parts.flatMap((part) => part!)) {
        const current = merged.get(part.orderId) ?? {
          orderId: part.orderId,
          payableMinor: 0,
          businessMinor: 0,
        };
        current.payableMinor = sumMinor([current.payableMinor, part.payableMinor]);
        current.businessMinor = sumMinor([current.businessMinor, part.businessMinor]);
        merged.set(part.orderId, current);
      }
      const result = [...merged.values()];
      if (
        sumMinor(result.map((part) => part.payableMinor)) !== target.payableMinor ||
        sumMinor(result.map((part) => part.businessMinor)) !== target.businessMinor
      )
        return undefined;
      cache.set(bill.id, result);
      return result;
    }
    const candidates = [...new Set(bill.orderIds)].flatMap((id) => {
      const charge = orders.get(id)?.delivery?.charge;
      return charge && charge.amountMinor > 0
        ? [
            {
              orderId: id,
              payableMinor: charge.beneficiary === "RIDER" ? charge.amountMinor : 0,
              businessMinor: charge.beneficiary === "BUSINESS" ? charge.amountMinor : 0,
            },
          ]
        : [];
    });
    if (
      !candidates.length ||
      (target.payableMinor > 0 && !sumMinor(candidates.map((part) => part.payableMinor))) ||
      (target.businessMinor > 0 && !sumMinor(candidates.map((part) => part.businessMinor)))
    )
      return undefined;
    const payables = allocate(
      target.payableMinor,
      candidates.map((part) => part.payableMinor),
    );
    const business = allocate(
      target.businessMinor,
      candidates.map((part) => part.businessMinor),
    );
    const result = candidates.map((part, index) => ({
      orderId: part.orderId,
      payableMinor: payables[index]!,
      businessMinor: business[index]!,
    }));
    cache.set(bill.id, result);
    return result;
  };
  return resolve;
}
