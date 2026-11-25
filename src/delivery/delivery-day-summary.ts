import type { TransactionState } from "@/lib/transaction-engine";
import { businessDateForTimestamp } from "@/lib/business-date";
import { verifyInvoiceComponents } from "@/payments/invoice-components";
import { sumMinor } from "@/payments/money";
import { invoiceDeliveryAllocations } from "./invoice-delivery-allocations";

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
  const scopedBills = state.bills.filter(
    (bill) =>
      (bill.tenantId ?? state.tenantId) === scope.tenantId && bill.branchId === scope.branchId,
  );
  const allocationsFor = invoiceDeliveryAllocations(scopedBills, scopedOrders, scope.currency);
  for (const bill of scopedBills) {
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
    const allocations = allocationsFor(bill);
    if (!allocations) summary.unclassifiedInvoiceIds.push(bill.id);
    (
      allocations ?? [
        { orderId: undefined, payableMinor: payable, businessMinor: charged - payable },
      ]
    ).forEach((allocation) => {
      const order = allocation.orderId ? scopedOrders.get(allocation.orderId) : undefined;
      const candidate = order ? riderIdentity(order) : { name: "Unassigned", riderId: undefined };
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
      row.chargedMinor = sumMinor([
        row.chargedMinor,
        allocation.payableMinor,
        allocation.businessMinor,
      ]);
      row.payableMinor = sumMinor([row.payableMinor, allocation.payableMinor]);
      if (!row.invoiceIds.includes(bill.id)) row.invoiceIds.push(bill.id);
    });
  }
  summary.riders.sort((a, b) => a.name.localeCompare(b.name));
  return summary;
}
