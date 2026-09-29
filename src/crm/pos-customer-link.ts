import type { OrderDraft, TransactionOrder } from "@/lib/transaction-engine";

export type PosCustomerIdentity = {
  id: string;
  customerCode: string;
  displayName: string;
};

export type PosCustomerSelection = {
  tenantId: string;
  branchId: string;
  orderId: string | null;
  customer: PosCustomerIdentity | null;
};

export function resolvePosCustomer(
  scope: { tenantId: string; branchId: string },
  order: Pick<TransactionOrder, "id" | "customer" | "customerId" | "customerCode"> | null,
  selection: PosCustomerSelection | null,
): PosCustomerIdentity | null {
  if (
    selection?.tenantId === scope.tenantId &&
    selection.branchId === scope.branchId &&
    selection.orderId === (order?.id ?? null)
  ) {
    return selection.customer;
  }
  return order?.customerId
    ? {
        id: order.customerId,
        customerCode: order.customerCode ?? "",
        displayName: order.customer,
      }
    : null;
}

export function linkedOrderCustomer(
  customer: PosCustomerIdentity | null,
  fallbackName: string,
): Pick<OrderDraft, "customer" | "customerId" | "customerCode"> {
  return customer
    ? {
        customer: customer.displayName,
        customerId: customer.id,
        customerCode: customer.customerCode,
      }
    : { customer: fallbackName };
}
