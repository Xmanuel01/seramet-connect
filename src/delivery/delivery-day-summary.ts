import type { TransactionState } from "@/lib/transaction-engine";
import { businessDateForTimestamp } from "@/lib/business-date";
import { allocateInvoiceMinor, verifyInvoiceComponents } from "@/payments/invoice-components";
import { sumMinor } from "@/payments/money";

export type DeliveryDaySummary = {
  chargedMinor: number;
  riderPayableMinor: number;
  businessRevenueMinor: number;
  riders: {
    riderId?: string;
    name: string;
    chargedMinor: number;
    payableMinor: number;
    invoiceIds: string[];
  }[];
  unclassifiedInvoiceIds: string[];
};

/** Invoice components, not menu names or order totals, are the fee accounting authority. */
export function deliveryDaySummary(
  state: TransactionState,
  scope: {
    tenantId: string;
    branchId: string;
    businessDate: string;
    timeZone: string;
    cutoffMinutes: number;
    currency: string;
  },
): DeliveryDaySummary {
  const summary: DeliveryDaySummary = {
    chargedMinor: 0,
    riderPayableMinor: 0,
    businessRevenueMinor: 0,
    riders: [],
    unclassifiedInvoiceIds: [],
  };
  const scopedOrders = new Map(
    state.orders
      .filter(
        (order) =>
          (order.tenantId ?? state.tenantId) === scope.tenantId &&
          order.branchId === scope.branchId,
      )
      .map((order) => [order.id, order]),
  );
  const riderIdentity = (
    order: TransactionState["orders"][number],
  ): { name: string; riderId?: string } => {
    const name = order.delivery?.rider?.trim() || "Unassigned";
    const recorded = state.paymentOperations?.custodyObligations.find(
      (obligation) =>
        obligation.tenantId === scope.tenantId &&
        obligation.branchId === scope.branchId &&
        obligation.orderId === order.id &&
        obligation.riderName === name,
    );
    if (recorded?.riderId) return { name, riderId: recorded.riderId };
    const matches = state.employees.filter(
      (employee) =>
        employee.tenantId === scope.tenantId &&
        (employee.branchId === scope.branchId ||
          (!employee.branchId && employee.branch === order.branch)) &&
        employee.role === "Rider" &&
        employee.name === name,
    );
    if (matches.length === 1) return { name, riderId: matches[0]!.id };
    return { name: matches.length > 1 ? `${name} (identity unresolved)` : name };
  };
  for (const bill of state.bills) {
    if (
      (bill.tenantId ?? state.tenantId) !== scope.tenantId ||
      bill.branchId !== scope.branchId ||
      ["VOID", "MERGED", "SPLIT", "DRAFT_BILL"].includes(bill.status) ||
      (bill.businessDate ??
        businessDateForTimestamp(bill.issuedAt, scope.timeZone, scope.cutoffMinutes)) !==
        scope.businessDate
    )
      continue;
    const orders = bill.orderIds.flatMap((id) =>
      scopedOrders.has(id) ? [scopedOrders.get(id)!] : [],
    );
    if (!bill.financialComponents) {
      if (orders.some((order) => order.delivery?.charge))
        summary.unclassifiedInvoiceIds.push(bill.id);
      continue;
    }
    const components = verifyInvoiceComponents(bill.financialComponents, bill, scope.currency);
    const charged = components.deliveryChargeMinor ?? 0;
    const payable = components.deliveryPayableMinor ?? 0;
    if (!charged) continue;
    summary.chargedMinor = sumMinor([summary.chargedMinor, charged]);
    summary.riderPayableMinor = sumMinor([summary.riderPayableMinor, payable]);
    summary.businessRevenueMinor = sumMinor([summary.businessRevenueMinor, charged - payable]);
    const feeOrders = orders.filter((order) => (order.delivery?.charge?.amountMinor ?? 0) > 0);
    const candidates: { name: string; riderId?: string; weight: number; payableWeight: number }[] =
      feeOrders.length
        ? feeOrders.map((order) => ({
            ...riderIdentity(order),
            weight: order.delivery!.charge!.amountMinor,
            payableWeight:
              order.delivery!.charge!.beneficiary === "RIDER"
                ? order.delivery!.charge!.amountMinor
                : 0,
          }))
        : [{ name: "Unassigned", weight: charged, payableWeight: payable }];
    const charges = allocateInvoiceMinor(
      charged,
      candidates.map((row) => row.weight),
    );
    // A mixed merged invoice must never assign business-owned fees to a rider.
    const payableWeights = candidates.map((row) => row.payableWeight);
    const payables =
      sumMinor(payableWeights) > 0
        ? allocateInvoiceMinor(payable, payableWeights)
        : candidates.map(() => 0);
    if (payable > 0 && sumMinor(payableWeights) === 0) {
      candidates.push({ name: "Unassigned", weight: 0, payableWeight: payable });
      charges.push(0);
      payables.push(payable);
    }
    candidates.forEach((candidate, index) => {
      const row = summary.riders.find((entry) =>
        candidate.riderId
          ? entry.riderId === candidate.riderId
          : !entry.riderId && entry.name === candidate.name,
      ) ?? {
        ...(candidate.riderId ? { riderId: candidate.riderId } : {}),
        name: candidate.name,
        chargedMinor: 0,
        payableMinor: 0,
        invoiceIds: [],
      };
      if (!summary.riders.includes(row)) summary.riders.push(row);
      row.chargedMinor = sumMinor([row.chargedMinor, charges[index]!]);
      row.payableMinor = sumMinor([row.payableMinor, payables[index]!]);
      if (!row.invoiceIds.includes(bill.id)) row.invoiceIds.push(bill.id);
    });
  }
  summary.riders.sort((a, b) => a.name.localeCompare(b.name));
  return summary;
}
