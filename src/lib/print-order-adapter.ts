import type {
  BillingRecord,
  PaymentRecord,
  ReceiptRecord,
  TransactionOrder,
  TransactionState,
} from "@/lib/transaction-engine";
import type { OrderForPrint, ProductionStation } from "@/lib/seramet-print-service";
import { LOCAL_PILOT_TENANT_ID } from "@/platform/pilot-defaults";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

function productionStation(value?: string): ProductionStation {
  const allowed: ProductionStation[] = [
    "MAIN KITCHEN",
    "GRILL",
    "BAR",
    "DESSERT",
    "DISPATCH",
    "NONE",
  ];
  return allowed.includes(value as ProductionStation)
    ? (value as ProductionStation)
    : "MAIN KITCHEN";
}

function orderTypeFromBilling(row: BillingRecord, orders: TransactionOrder[] = []) {
  const repository = getConfigurationRepository();
  const tenantId = row.tenantId ?? LOCAL_PILOT_TENANT_ID;
  const order = orders.find((candidate) => row.orderIds.includes(candidate.id));
  const channels = repository.listOrderChannels(tenantId, false);
  const configured = order
    ? channels.find(
        (channel) =>
          channel.id === order.channel ||
          channel.code === order.channel ||
          channel.displayName === order.channel,
      )
    : channels.find((channel) =>
        row.table ? channel.channelType === "DINE_IN" : channel.channelType === "TAKEAWAY",
      );
  return configured?.displayName ?? "Configured channel";
}

export function billingRecordToPrintOrder(
  row: BillingRecord,
  payments: PaymentRecord[],
  orders: TransactionOrder[] = [],
): OrderForPrint {
  const invoicePayments = payments.filter((payment) => payment.invoiceId === row.id);
  const operator = invoicePayments[0]?.cashier ?? "Branch Operator";
  return {
    orderId: row.orderIds[0] ?? row.id,
    branch: row.branch,
    terminalId:
      invoicePayments[0]?.terminal ??
      `${row.branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-POS-01`,
    ...(row.table ? { table: row.table } : {}),
    orderType: orderTypeFromBilling(row, orders),
    requestedBy: operator,
    cashier: operator,
    waiter: operator,
    createdAt: row.issuedAt,
    customer: row.customer,
    ...(row.paymentStatus === "PAID" ? { receiptNumber: row.id.replace(/^INV/i, "RCP") } : {}),
    invoiceNumber: row.id,
    ...(invoicePayments[0]
      ? {
          paymentMethod: invoicePayments[0].method.replaceAll("_", " "),
          paymentReference: invoicePayments[0].reference,
        }
      : {}),
    paymentBreakdown: invoicePayments.map((payment) => ({
      method: payment.method.replaceAll("_", " "),
      amount: payment.amount,
      reference: payment.reference,
    })),
    lines: row.lines.map((line) => ({
      id: line.id,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      productionStation: productionStation(line.productionStation),
      ...(line.itemNote ? { itemNote: line.itemNote } : {}),
    })),
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    paid: row.paid,
  };
}

export function receiptRecordToPrintOrder(
  receipt: ReceiptRecord,
  state: TransactionState,
): OrderForPrint | null {
  const bill = state.bills.find((item) => item.id === receipt.invoiceId);
  const order = state.orders.find((item) => item.id === receipt.orderId);
  const sourceLines = bill?.lines ?? order?.lines ?? [];
  if (sourceLines.length === 0) return null;

  const subtotal = bill?.subtotal ?? order?.subtotal ?? receipt.total;
  const tax = bill?.tax ?? order?.tax ?? Math.max(0, receipt.total - subtotal);
  const customer = receipt.customer || bill?.customer || order?.customer || "Walk-in Customer";
  const orderType = order
    ? orderTypeFromBilling(
        bill ?? {
          id: receipt.invoiceId,
          ...(receipt.tenantId ? { tenantId: receipt.tenantId } : {}),
          ...(receipt.branchId ? { branchId: receipt.branchId } : {}),
          orderIds: [order.id],
          branch: receipt.branch,
          customer,
          issuedAt: receipt.issuedAt,
          dueAt: receipt.issuedAt,
          status: "PAID",
          paymentStatus: "PAID",
          subtotal,
          tax,
          total: receipt.total,
          paid: receipt.total,
          lines: order.lines,
        },
        [order],
      )
    : bill
      ? orderTypeFromBilling(bill, state.orders)
      : "Configured channel";
  const table = bill?.table ?? order?.table;

  return {
    orderId: receipt.orderId,
    branch: receipt.branch,
    terminalId:
      state.payments.find((payment) => payment.invoiceId === receipt.invoiceId)?.terminal ??
      `${receipt.branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-POS-01`,
    ...(table ? { table } : {}),
    orderType,
    requestedBy: receipt.cashier,
    cashier: receipt.cashier,
    waiter: order?.waiter ?? receipt.cashier,
    createdAt: receipt.issuedAt,
    customer,
    ...(order?.kitchenNote ? { kitchenNote: order.kitchenNote } : {}),
    receiptNumber: receipt.id,
    invoiceNumber: receipt.invoiceId,
    ...(receipt.paymentBreakdown[0]
      ? {
          paymentMethod: receipt.paymentBreakdown[0].method.replaceAll("_", " "),
          paymentReference: receipt.paymentBreakdown[0].reference,
        }
      : {}),
    paymentBreakdown: receipt.paymentBreakdown.map((payment) => ({
      method: payment.method.replaceAll("_", " "),
      amount: payment.amount,
      reference: payment.reference,
    })),
    lines: sourceLines.map((line) => ({
      id: line.id,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      productionStation: productionStation(line.productionStation),
      ...(line.itemNote ? { itemNote: line.itemNote } : {}),
    })),
    subtotal,
    tax,
    total: receipt.total,
    paid: receipt.paidAmount,
    change: receipt.change,
  };
}
