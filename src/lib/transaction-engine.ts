import { products } from "@/data/mock";

export type OrderStatus =
  | "DRAFT"
  | "HELD"
  | "OPEN"
  | "SENT_TO_KITCHEN"
  | "IN_PROGRESS"
  | "READY"
  | "SERVED"
  | "BILL_REQUESTED"
  | "AWAITING_PAYMENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CANCELLED"
  | "REFUNDED";

export type InvoiceStatus =
  "DRAFT_BILL" | "OPEN" | "PARTIAL" | "PAID" | "PENDING" | "VOID" | "MERGED" | "SPLIT";
export type PaymentIntentStatus =
  | "CREATED"
  | "PENDING"
  | "AWAITING_CUSTOMER"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";
export type PaymentMethod =
  | "MPESA_TILL_MANUAL"
  | "MPESA_QR"
  | "MPESA_PROMPT"
  | "CASH"
  | "CARD"
  | "BANK_TRANSFER"
  | "CUSTOMER_CREDIT"
  | "PAYMENT_LINK";
export type ReconciliationStatus =
  | "UNMATCHED"
  | "SUGGESTED"
  | "MATCHED"
  | "PARTIALLY_MATCHED"
  | "RECONCILED"
  | "DUPLICATE"
  | "IGNORED"
  | "ERROR";
export type ExternalDirection = "INBOUND" | "OUTBOUND";
export type JournalEntryStatus = "DRAFT" | "POSTED" | "REVERSED";

export type TransactionLine = {
  id: string;
  productId?: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  productionStation?: string;
  sourceOrderId?: string;
  itemNote?: string;
};

export type TransactionOrder = {
  id: string;
  branch: string;
  table?: string;
  customer: string;
  channel: "Dine-In" | "Take Away" | "Delivery" | "Online" | "Uber Eats" | "Bolt Food" | "Glovo";
  cashier: string;
  waiter?: string;
  kitchenNote?: string;
  status: OrderStatus;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  createdAt: string;
  updatedAt: string;
  lines: TransactionLine[];
  subtotal: number;
  tax: number;
  total: number;
  cancellation?: {
    reason: string;
    user: string;
    timestamp: string;
    affectedItems: string[];
  };
};

export type BillingRecord = {
  id: string;
  orderIds: string[];
  sourceBillIds?: string[];
  splitFromBillId?: string;
  splitMethod?: "ITEM" | "QUANTITY" | "GUEST" | "EQUAL" | "CUSTOM";
  branch: string;
  customer: string;
  table?: string;
  status: InvoiceStatus;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  issuedAt: string;
  dueAt: string;
  lines: TransactionLine[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
};

export type PaymentIntent = {
  id: string;
  orderId: string;
  invoiceId: string;
  branch: string;
  amount: number;
  currency: "KES";
  method: PaymentMethod;
  provider: string;
  tillOrAccount?: string;
  customerPhone?: string;
  createdBy: string;
  createdAt: string;
  status: PaymentIntentStatus;
  expiresAt: string;
  externalReference?: string;
  idempotencyKey: string;
};

export type PaymentRecord = {
  id: string;
  invoiceId: string;
  orderId: string;
  branch: string;
  method: PaymentMethod;
  provider: string;
  amount: number;
  currency: "KES";
  reference: string;
  externalTransactionId?: string;
  cashier: string;
  terminal: string;
  timestamp: string;
  reconciliationStatus: ReconciliationStatus;
  settlementStatus: "PENDING" | "SETTLED" | "FAILED" | "NOT_REQUIRED";
  card?: {
    terminalReference: string;
    acquirer: string;
    authorizationCode: string;
    batch: string;
  };
  bank?: {
    bankAccount: string;
    transactionId: string;
    valueDate: string;
    sender: string;
    matchingStatus: ReconciliationStatus;
  };
  cash?: {
    received: number;
    change: number;
    drawerId: string;
  };
};

export type ReceiptRecord = {
  id: string;
  orderId: string;
  invoiceId: string;
  branch: string;
  cashier: string;
  customer: string;
  issuedAt: string;
  total: number;
  paidAmount: number;
  change: number;
  paymentBreakdown: { method: PaymentMethod; amount: number; reference: string }[];
  reprints: { requestedBy: string; reason: string; timestamp: string }[];
};

export type ExternalTransaction = {
  id: string;
  provider: string;
  sourceAccount: string;
  destination: string;
  branch?: string;
  amount: number;
  direction: ExternalDirection;
  currency: "KES";
  reference: string;
  timestamp: string;
  description: string;
  providerMetadata: Record<string, string>;
  importedAt: string;
  reconciliationStatus: ReconciliationStatus;
};

export type ReconciliationMatch = {
  id: string;
  externalTransactionId: string;
  internalTransactionId: string;
  internalType:
    | "Payment"
    | "Invoice"
    | "Expense"
    | "Supplier Payment"
    | "Payroll Payment"
    | "Bank Transfer"
    | "Cash Deposit"
    | "Utility Bill"
    | "Customer Payment";
  matchType: "EXACT_REFERENCE" | "REFERENCE_AMOUNT" | "AMOUNT_TIME_BRANCH" | "MANUAL";
  amount: number;
  confidence: number;
  matchedBy: string;
  matchedAt: string;
  status: "SUGGESTED" | "APPROVED" | "REJECTED";
  notes?: string;
};

export type JournalEntry = {
  id: string;
  sourceType: "Invoice" | "Payment" | "Receipt" | "Refund" | "Expense" | "Reconciliation";
  sourceId: string;
  branch: string;
  status: JournalEntryStatus;
  postedAt?: string;
  lines: { account: string; debit: number; credit: number; costCentre: string; taxCode?: string }[];
};

export type CashDrawer = {
  id: string;
  branch: string;
  cashier: string;
  openedAt: string;
  closedAt?: string;
  openingCash: number;
  cashSales: number;
  cashIn: number;
  cashRefunds: number;
  cashOut: number;
  expectedDrawer: number;
  physicalCount?: number;
  variance?: number;
  status: "OPEN" | "SUBMITTED" | "APPROVED" | "VARIANCE_REVIEW";
  supervisor?: string;
};

export type RefundRecord = {
  id: string;
  orderId: string;
  invoiceId: string;
  receiptId?: string;
  branch: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  requestedBy: string;
  approvedBy?: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "COMPLETED";
  createdAt: string;
  completedAt?: string;
};

export type AuditEvent = {
  id: string;
  time: string;
  actor: string;
  role: string;
  branch: string;
  module: string;
  action: string;
  record: string;
  before: string;
  after: string;
};

export type TransactionState = {
  orders: TransactionOrder[];
  bills: BillingRecord[];
  paymentIntents: PaymentIntent[];
  payments: PaymentRecord[];
  receipts: ReceiptRecord[];
  externalTransactions: ExternalTransaction[];
  reconciliationMatches: ReconciliationMatch[];
  journalEntries: JournalEntry[];
  cashDrawers: CashDrawer[];
  refunds: RefundRecord[];
  auditEvents: AuditEvent[];
};

export type OrderDraft = {
  branch: string;
  table?: string;
  customer: string;
  channel: TransactionOrder["channel"];
  cashier: string;
  waiter?: string;
  kitchenNote?: string;
  lines: TransactionLine[];
};

const storageKey = "seramet.transaction-engine.v1";
const taxRate = 0.16;
const branchTillNumbers: Record<string, string> = {
  Westlands: "123456",
  "Ngong Road": "654321",
};

function now() {
  return "2026-08-14T12:46:00+03:00";
}

function addMinutes(iso: string, minutes: number) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function money(n: number) {
  return Math.round(n);
}

function id(prefix: string, state: TransactionState, collection: keyof TransactionState) {
  const count = (state[collection] as unknown[]).length + 1;
  return `${prefix}-${String(count).padStart(5, "0")}`;
}

function totals(lines: TransactionLine[]) {
  const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const tax = money(subtotal * taxRate);
  return { subtotal, tax, total: subtotal + tax };
}

function audit(state: TransactionState, event: Omit<AuditEvent, "id" | "time">) {
  state.auditEvents = [
    {
      id: id("AUD", state, "auditEvents"),
      time: now(),
      ...event,
    },
    ...state.auditEvents,
  ];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function seedLine(productIndex: number, quantity: number): TransactionLine {
  const product = products[productIndex]!;
  return {
    id: `${product.id}-line`,
    productId: product.id,
    name: product.name,
    category: product.category,
    quantity,
    unitPrice: product.branchPrices?.Westlands ?? product.price,
    productionStation: product.productionStation ?? "NONE",
  };
}

export function createInitialTransactionState(): TransactionState {
  const orderA = TransactionEngine.createOrder(
    emptyState(),
    {
      branch: "Westlands",
      table: "08",
      customer: "Table 08",
      channel: "Dine-In",
      cashier: "Amina W.",
      waiter: "Joan A.",
      lines: [seedLine(0, 2), seedLine(5, 1)],
    },
    "OPEN",
  );
  let state = TransactionEngine.sendToKitchen(orderA, orderA.orders[0]!.id, "Amina W.");
  state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Amina W.");
  state = TransactionEngine.createPaymentIntent(state, state.bills[0]!.id, {
    amount: 3000,
    method: "MPESA_TILL_MANUAL",
    provider: "M-Pesa Till",
    createdBy: "Amina W.",
  }).state;
  state = TransactionEngine.recordManualTillPayment(state, state.bills[0]!.id, {
    amount: 3000,
    reference: "QH82ABC123",
    cashier: "Amina W.",
    terminal: "WEST-POS-01",
  });
  state = TransactionEngine.recordCashPayment(state, state.bills[0]!.id, {
    received: 1200,
    cashier: "Amina W.",
    terminal: "WEST-POS-01",
  });

  state = TransactionEngine.holdOrder(state, {
    branch: "Westlands",
    table: "12",
    customer: "Table 12",
    channel: "Dine-In",
    cashier: "Cecilia W.",
    waiter: "Cecilia W.",
    lines: [seedLine(2, 1), seedLine(7, 2)],
  });

  const orderBState = TransactionEngine.createOrder(
    state,
    {
      branch: "Ngong Road",
      customer: "Kelvin Otieno",
      channel: "Delivery",
      cashier: "System",
      lines: [seedLine(1, 1), seedLine(9, 2)],
    },
    "SENT_TO_KITCHEN",
  );
  state = TransactionEngine.createOpenBill(orderBState, orderBState.orders[0]!.id);

  state.externalTransactions.push({
    id: "EXT-00001",
    provider: "TendePay",
    sourceAccount: "KPLC Paybill",
    destination: "Mona Swahili Operating",
    branch: "Westlands",
    amount: 18400,
    direction: "OUTBOUND",
    currency: "KES",
    reference: "KPLC-AUG-18400",
    timestamp: "2026-08-14T08:10:00+03:00",
    description: "KPLC electricity payment",
    providerMetadata: { category: "Utilities" },
    importedAt: now(),
    reconciliationStatus: "SUGGESTED",
  });

  state.cashDrawers.push({
    id: "CDR-00001",
    branch: "Westlands",
    cashier: "Amina W.",
    openedAt: "2026-08-14T08:00:00+03:00",
    openingCash: 5000,
    cashSales: 1200,
    cashIn: 0,
    cashRefunds: 0,
    cashOut: 0,
    expectedDrawer: 6200,
    status: "OPEN",
  });

  return state;
}

function emptyState(): TransactionState {
  return {
    orders: [],
    bills: [],
    paymentIntents: [],
    payments: [],
    receipts: [],
    externalTransactions: [],
    reconciliationMatches: [],
    journalEntries: [],
    cashDrawers: [],
    refunds: [],
    auditEvents: [],
  };
}

export const TransactionEngine = {
  storageKey,

  load(): TransactionState {
    if (typeof window === "undefined") return createInitialTransactionState();
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      const initial = createInitialTransactionState();
      this.save(initial);
      return initial;
    }
    try {
      return JSON.parse(raw) as TransactionState;
    } catch {
      const initial = createInitialTransactionState();
      this.save(initial);
      return initial;
    }
  },

  save(state: TransactionState) {
    if (typeof window !== "undefined")
      window.localStorage.setItem(storageKey, JSON.stringify(state));
  },

  reset() {
    const state = createInitialTransactionState();
    this.save(state);
    return state;
  },

  createOrder(state: TransactionState, draft: OrderDraft, status: OrderStatus = "OPEN") {
    const next = clone(state);
    const total = totals(draft.lines);
    const order: TransactionOrder = {
      id: id("ORD", next, "orders"),
      ...draft,
      status,
      paymentStatus: "UNPAID",
      createdAt: now(),
      updatedAt: now(),
      ...total,
    };
    next.orders.unshift(order);
    audit(next, {
      actor: draft.cashier,
      role: "Cashier",
      branch: draft.branch,
      module: "Orders",
      action: `Created ${status.toLowerCase()} order`,
      record: order.id,
      before: "No order",
      after: `${order.status} ${order.total}`,
    });
    return next;
  },

  holdOrder(state: TransactionState, draft: OrderDraft) {
    return this.createOrder(state, draft, "HELD");
  },

  releaseHeldOrder(state: TransactionState, orderId: string, user: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status !== "HELD") return next;
    order.status = "OPEN";
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Released held order",
      record: order.id,
      before: "HELD",
      after: "OPEN",
    });
    return next;
  },

  sendToKitchen(state: TransactionState, orderId: string, user: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status === "CANCELLED" || order.status === "PAID") return next;
    const before = order.status;
    order.status = "SENT_TO_KITCHEN";
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Sent order to kitchen",
      record: order.id,
      before,
      after: "SENT_TO_KITCHEN with KOT routing",
    });
    return next;
  },

  createOpenBill(state: TransactionState, orderId: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) return next;
    if (next.bills.some((bill) => bill.orderIds.includes(orderId) && bill.status !== "VOID"))
      return next;
    const bill: BillingRecord = {
      id: id("BILL", next, "bills"),
      orderIds: [order.id],
      branch: order.branch,
      customer: order.customer,
      table: order.table,
      status: "OPEN",
      paymentStatus: "UNPAID",
      issuedAt: now(),
      dueAt: addMinutes(now(), 120),
      lines: order.lines.map((line) => ({ ...line, sourceOrderId: order.id })),
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
      paid: 0,
    };
    next.bills.unshift(bill);
    audit(next, {
      actor: order.cashier,
      role: "Cashier",
      branch: order.branch,
      module: "Invoices",
      action: "Created open bill",
      record: bill.id,
      before: "No bill",
      after: `OPEN ${bill.total}`,
    });
    return next;
  },

  updateOrderDraft(state: TransactionState, orderId: string, draft: OrderDraft, user: string) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status === "PAID" || order.status === "CANCELLED") return next;
    const before = `${order.lines.length} lines, ${order.total}`;
    const total = totals(draft.lines);
    order.branch = draft.branch;
    order.table = draft.table;
    order.customer = draft.customer;
    order.channel = draft.channel;
    order.cashier = draft.cashier;
    order.waiter = draft.waiter;
    order.kitchenNote = draft.kitchenNote;
    order.lines = draft.lines;
    order.subtotal = total.subtotal;
    order.tax = total.tax;
    order.total = total.total;
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Updated active order",
      record: order.id,
      before,
      after: `${order.lines.length} lines, ${order.total}`,
    });
    return next;
  },

  requestBill(state: TransactionState, orderId: string, user: string) {
    let next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status !== "SENT_TO_KITCHEN") return next;
    const before = order.status;
    order.status = "BILL_REQUESTED";
    order.updatedAt = now();
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: order.branch,
      module: "Orders",
      action: "Requested customer bill",
      record: order.id,
      before,
      after: "BILL_REQUESTED - moved to invoices",
    });
    next = this.createOpenBill(next, orderId);
    return next;
  },

  createPaymentIntent(
    state: TransactionState,
    invoiceId: string,
    input: {
      amount: number;
      method: PaymentMethod;
      provider: string;
      createdBy: string;
      customerPhone?: string;
    },
  ) {
    const next = clone(state);
    const invoice = next.bills.find((bill) => bill.id === invoiceId);
    if (!invoice) return { state: next, intent: undefined };
    const methodStatus: Record<PaymentMethod, PaymentIntentStatus> = {
      MPESA_TILL_MANUAL: "PENDING",
      MPESA_QR: "PENDING",
      MPESA_PROMPT: "AWAITING_CUSTOMER",
      CASH: "CREATED",
      CARD: "PROCESSING",
      BANK_TRANSFER: "PENDING",
      CUSTOMER_CREDIT: "PENDING",
      PAYMENT_LINK: "PENDING",
    };
    const intent: PaymentIntent = {
      id: id("PI", next, "paymentIntents"),
      orderId: invoice.orderIds[0]!,
      invoiceId,
      branch: invoice.branch,
      amount: money(input.amount),
      currency: "KES",
      method: input.method,
      provider: input.provider,
      tillOrAccount: branchTillNumbers[invoice.branch],
      customerPhone: input.customerPhone,
      createdBy: input.createdBy,
      createdAt: now(),
      status: methodStatus[input.method],
      expiresAt: addMinutes(now(), 15),
      idempotencyKey: `${invoiceId}:${input.method}:${money(input.amount)}:${input.customerPhone ?? "none"}`,
    };
    next.paymentIntents.unshift(intent);
    audit(next, {
      actor: input.createdBy,
      role: "Cashier",
      branch: invoice.branch,
      module: "Payments",
      action: "Created payment intent",
      record: intent.id,
      before: "No intent",
      after: `${intent.method} ${intent.status}`,
    });
    return { state: next, intent };
  },

  confirmPaymentIntent(
    state: TransactionState,
    intentId: string,
    externalReference: string,
    cashier = "Provider Callback",
  ) {
    const next = clone(state);
    const intent = next.paymentIntents.find((item) => item.id === intentId);
    if (!intent || intent.status === "SUCCEEDED") return next;
    intent.status = "SUCCEEDED";
    intent.externalReference = externalReference;
    return this.applyPayment(next, intent.invoiceId, {
      amount: intent.amount,
      method: intent.method,
      provider: intent.provider,
      reference: externalReference,
      cashier,
      terminal: "PROVIDER",
      reconciliationStatus: "MATCHED",
      settlementStatus: intent.method === "CASH" ? "NOT_REQUIRED" : "PENDING",
      externalTransactionId: `EXT-${externalReference}`,
    });
  },

  recordManualTillPayment(
    state: TransactionState,
    invoiceId: string,
    input: { amount: number; reference: string; cashier: string; terminal: string },
  ) {
    return this.applyPayment(state, invoiceId, {
      amount: input.amount,
      method: "MPESA_TILL_MANUAL",
      provider: "M-Pesa Till",
      reference: input.reference,
      cashier: input.cashier,
      terminal: input.terminal,
      reconciliationStatus: "SUGGESTED",
      settlementStatus: "PENDING",
    });
  },

  recordCashPayment(
    state: TransactionState,
    invoiceId: string,
    input: { received: number; cashier: string; terminal: string },
  ) {
    const bill = state.bills.find((item) => item.id === invoiceId);
    const due = Math.max(0, (bill?.total ?? 0) - (bill?.paid ?? 0));
    const amount = Math.min(input.received, due);
    return this.applyPayment(state, invoiceId, {
      amount,
      method: "CASH",
      provider: "Cash Drawer",
      reference: `CASH-${invoiceId}-${state.payments.length + 1}`,
      cashier: input.cashier,
      terminal: input.terminal,
      reconciliationStatus: "RECONCILED",
      settlementStatus: "NOT_REQUIRED",
      cash: {
        received: input.received,
        change: Math.max(0, input.received - amount),
        drawerId: "CDR-00001",
      },
    });
  },

  recordCardPayment(
    state: TransactionState,
    invoiceId: string,
    input: {
      amount: number;
      reference: string;
      cashier: string;
      terminal: string;
      acquirer: string;
      batch: string;
    },
  ) {
    return this.applyPayment(state, invoiceId, {
      amount: input.amount,
      method: "CARD",
      provider: input.acquirer,
      reference: input.reference,
      cashier: input.cashier,
      terminal: input.terminal,
      reconciliationStatus: "SUGGESTED",
      settlementStatus: "PENDING",
      card: {
        terminalReference: input.terminal,
        acquirer: input.acquirer,
        authorizationCode: input.reference,
        batch: input.batch,
      },
    });
  },

  recordBankPayment(
    state: TransactionState,
    invoiceId: string,
    input: {
      amount: number;
      reference: string;
      cashier: string;
      bankAccount: string;
      sender: string;
    },
  ) {
    return this.applyPayment(state, invoiceId, {
      amount: input.amount,
      method: "BANK_TRANSFER",
      provider: "Bank Transfer",
      reference: input.reference,
      cashier: input.cashier,
      terminal: "BANK",
      reconciliationStatus: "SUGGESTED",
      settlementStatus: "PENDING",
      bank: {
        bankAccount: input.bankAccount,
        transactionId: input.reference,
        valueDate: now().slice(0, 10),
        sender: input.sender,
        matchingStatus: "SUGGESTED",
      },
    });
  },

  applyPayment(
    state: TransactionState,
    invoiceId: string,
    input: Omit<
      PaymentRecord,
      "id" | "invoiceId" | "orderId" | "branch" | "currency" | "timestamp"
    >,
  ) {
    const next = clone(state);
    const bill = next.bills.find((item) => item.id === invoiceId);
    if (!bill || bill.status === "VOID" || bill.status === "MERGED") return next;
    if (
      next.payments.some(
        (payment) => payment.reference === input.reference && payment.invoiceId === invoiceId,
      )
    )
      return next;
    const order = next.orders.find((item) => item.id === bill.orderIds[0]);
    const payment: PaymentRecord = {
      id: id("PAY", next, "payments"),
      invoiceId,
      orderId: bill.orderIds[0]!,
      branch: bill.branch,
      currency: "KES",
      timestamp: now(),
      ...input,
    };
    next.payments.unshift(payment);
    bill.paid = money(bill.paid + input.amount);
    bill.paymentStatus = bill.paid >= bill.total ? "PAID" : "PARTIAL";
    bill.status = bill.paid >= bill.total ? "PAID" : "PARTIAL";
    if (order) {
      order.paymentStatus = bill.paymentStatus;
      order.status = bill.paid >= bill.total ? "PAID" : "PARTIALLY_PAID";
      order.updatedAt = now();
    }
    next.journalEntries.unshift(createPaymentJournal(next, bill, payment));
    if (
      bill.paid >= bill.total &&
      !next.receipts.some((receipt) => receipt.invoiceId === bill.id)
    ) {
      next.receipts.unshift(
        createReceipt(
          next,
          bill,
          next.payments.filter((item) => item.invoiceId === bill.id),
        ),
      );
    }
    audit(next, {
      actor: input.cashier,
      role: "Cashier",
      branch: bill.branch,
      module: "Payments",
      action: "Recorded payment",
      record: payment.id,
      before: `${bill.total - bill.paid + input.amount} due`,
      after: `${bill.total - bill.paid} due`,
    });
    return next;
  },

  mergeBills(state: TransactionState, billIds: string[], user: string, reason: string) {
    const next = clone(state);
    const bills = next.bills.filter((bill) => billIds.includes(bill.id));
    if (
      bills.length < 2 ||
      bills.some((bill) => bill.paymentStatus !== "UNPAID" || bill.status !== "OPEN")
    )
      return next;
    const allLines = bills.flatMap((bill) => bill.lines);
    const total = totals(allLines);
    const merged: BillingRecord = {
      id: id("BILL", next, "bills"),
      sourceBillIds: billIds,
      orderIds: bills.flatMap((bill) => bill.orderIds),
      branch: bills[0]!.branch,
      customer: "Merged bill",
      table: bills[0]!.table,
      status: "OPEN",
      paymentStatus: "UNPAID",
      issuedAt: now(),
      dueAt: addMinutes(now(), 120),
      lines: allLines,
      paid: 0,
      ...total,
    };
    bills.forEach((bill) => {
      bill.status = "MERGED";
    });
    next.bills.unshift(merged);
    audit(next, {
      actor: user,
      role: "Branch Manager",
      branch: merged.branch,
      module: "Invoices",
      action: "Merged open bills",
      record: merged.id,
      before: billIds.join(", "),
      after: `${merged.id} ${reason}`,
    });
    return next;
  },

  splitBill(
    state: TransactionState,
    billId: string,
    splits: { label: string; amount: number }[],
    user: string,
  ) {
    const next = clone(state);
    const bill = next.bills.find((item) => item.id === billId);
    if (!bill || bill.paymentStatus !== "UNPAID" || bill.status !== "OPEN") return next;
    const splitTotal = money(splits.reduce((sum, split) => sum + split.amount, 0));
    if (splitTotal !== bill.total) return next;
    bill.status = "SPLIT";
    splits.forEach((split) => {
      const ratio = split.amount / bill.total;
      next.bills.unshift({
        ...bill,
        id: id("BILL", next, "bills"),
        splitFromBillId: bill.id,
        splitMethod: "CUSTOM",
        customer: split.label,
        status: "OPEN",
        subtotal: money(bill.subtotal * ratio),
        tax: money(bill.tax * ratio),
        total: split.amount,
        paid: 0,
        paymentStatus: "UNPAID",
      });
    });
    audit(next, {
      actor: user,
      role: "Cashier",
      branch: bill.branch,
      module: "Invoices",
      action: "Split bill",
      record: bill.id,
      before: `${bill.total}`,
      after: splits.map((split) => `${split.label}:${split.amount}`).join(", "),
    });
    return next;
  },

  cancelOrder(
    state: TransactionState,
    orderId: string,
    input: { user: string; reason: string; affectedItems: string[] },
  ) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (!order || order.status === "PAID") return next;
    const before = order.status;
    order.status = "CANCELLED";
    order.cancellation = { ...input, timestamp: now() };
    order.updatedAt = now();
    audit(next, {
      actor: input.user,
      role: "Branch Manager",
      branch: order.branch,
      module: "Orders",
      action: "Cancelled order",
      record: order.id,
      before,
      after: input.reason,
    });
    return next;
  },

  requestRefund(state: TransactionState, input: Omit<RefundRecord, "id" | "status" | "createdAt">) {
    const next = clone(state);
    const refund: RefundRecord = {
      id: id("RF", next, "refunds"),
      status: "REQUESTED",
      createdAt: now(),
      ...input,
    };
    next.refunds.unshift(refund);
    audit(next, {
      actor: input.requestedBy,
      role: "Cashier",
      branch: input.branch,
      module: "Refunds",
      action: "Requested refund",
      record: refund.id,
      before: "No refund",
      after: input.reason,
    });
    return next;
  },

  approveRefund(state: TransactionState, refundId: string, approvedBy: string) {
    const next = clone(state);
    const refund = next.refunds.find((item) => item.id === refundId);
    if (!refund || refund.status !== "REQUESTED") return next;
    refund.status = "APPROVED";
    refund.approvedBy = approvedBy;
    audit(next, {
      actor: approvedBy,
      role: "Branch Manager",
      branch: refund.branch,
      module: "Refunds",
      action: "Approved refund",
      record: refund.id,
      before: "REQUESTED",
      after: "APPROVED",
    });
    return next;
  },

  importExternalTransaction(
    state: TransactionState,
    input: Omit<ExternalTransaction, "id" | "importedAt" | "reconciliationStatus">,
  ) {
    const next = clone(state);
    if (
      next.externalTransactions.some(
        (transaction) =>
          transaction.provider === input.provider && transaction.reference === input.reference,
      )
    ) {
      next.externalTransactions.unshift({
        ...input,
        id: id("EXT", next, "externalTransactions"),
        importedAt: now(),
        reconciliationStatus: "DUPLICATE",
      });
      return next;
    }
    const external: ExternalTransaction = {
      ...input,
      id: id("EXT", next, "externalTransactions"),
      importedAt: now(),
      reconciliationStatus: "UNMATCHED",
    };
    next.externalTransactions.unshift(external);
    return this.suggestReconciliation(next, external.id);
  },

  suggestReconciliation(state: TransactionState, externalTransactionId: string) {
    const next = clone(state);
    const external = next.externalTransactions.find(
      (transaction) => transaction.id === externalTransactionId,
    );
    if (!external) return next;
    const candidates = next.payments
      .map((payment) => {
        let confidence = 0;
        if (payment.reference === external.reference) confidence += 70;
        if (payment.amount === external.amount) confidence += 15;
        if (payment.branch === external.branch) confidence += 10;
        if (payment.method.includes("MPESA") && external.provider.toLowerCase().includes("mpesa"))
          confidence += 5;
        return { payment, confidence };
      })
      .filter((candidate) => candidate.confidence >= 75)
      .sort((a, b) => b.confidence - a.confidence);
    const candidate = candidates[0];
    if (!candidate) return next;
    external.reconciliationStatus = candidate.confidence >= 95 ? "MATCHED" : "SUGGESTED";
    next.reconciliationMatches.unshift({
      id: id("REC", next, "reconciliationMatches"),
      externalTransactionId: external.id,
      internalTransactionId: candidate.payment.id,
      internalType: "Payment",
      matchType:
        candidate.payment.reference === external.reference
          ? "EXACT_REFERENCE"
          : "AMOUNT_TIME_BRANCH",
      amount: Math.min(candidate.payment.amount, external.amount),
      confidence: candidate.confidence,
      matchedBy: "System",
      matchedAt: now(),
      status: candidate.confidence >= 95 ? "APPROVED" : "SUGGESTED",
      notes: "Matched using reference, amount, branch and provider signals.",
    });
    if (candidate.confidence >= 95) {
      candidate.payment.reconciliationStatus = "RECONCILED";
      external.reconciliationStatus = "RECONCILED";
    }
    return next;
  },

  manuallyReconcile(
    state: TransactionState,
    externalTransactionId: string,
    paymentId: string,
    user: string,
    notes: string,
  ) {
    const next = clone(state);
    const external = next.externalTransactions.find(
      (transaction) => transaction.id === externalTransactionId,
    );
    const payment = next.payments.find((item) => item.id === paymentId);
    if (!external || !payment) return next;
    external.reconciliationStatus = "RECONCILED";
    payment.reconciliationStatus = "RECONCILED";
    next.reconciliationMatches.unshift({
      id: id("REC", next, "reconciliationMatches"),
      externalTransactionId,
      internalTransactionId: paymentId,
      internalType: "Payment",
      matchType: "MANUAL",
      amount: Math.min(payment.amount, external.amount),
      confidence: 100,
      matchedBy: user,
      matchedAt: now(),
      status: "APPROVED",
      notes,
    });
    audit(next, {
      actor: user,
      role: "Accountant",
      branch: payment.branch,
      module: "Reconciliation",
      action: "Manually reconciled payment",
      record: paymentId,
      before: externalTransactionId,
      after: notes,
    });
    return next;
  },

  closeCashDrawer(
    state: TransactionState,
    drawerId: string,
    physicalCount: number,
    supervisor: string,
  ) {
    const next = clone(state);
    const drawer = next.cashDrawers.find((item) => item.id === drawerId);
    if (!drawer) return next;
    drawer.physicalCount = physicalCount;
    drawer.variance = money(physicalCount - drawer.expectedDrawer);
    drawer.closedAt = now();
    drawer.supervisor = supervisor;
    drawer.status = drawer.variance === 0 ? "APPROVED" : "VARIANCE_REVIEW";
    audit(next, {
      actor: supervisor,
      role: "Branch Manager",
      branch: drawer.branch,
      module: "Reconciliation",
      action: "Closed cash drawer",
      record: drawer.id,
      before: `Expected ${drawer.expectedDrawer}`,
      after: `Counted ${physicalCount}, variance ${drawer.variance}`,
    });
    return next;
  },
};

function createReceipt(
  state: TransactionState,
  bill: BillingRecord,
  payments: PaymentRecord[],
): ReceiptRecord {
  const paidAmount = money(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const cashChange = payments.reduce((sum, payment) => sum + (payment.cash?.change ?? 0), 0);
  return {
    id: id("RC", state, "receipts"),
    orderId: bill.orderIds[0]!,
    invoiceId: bill.id,
    branch: bill.branch,
    cashier: payments[0]?.cashier ?? "System",
    customer: bill.customer,
    issuedAt: now(),
    total: bill.total,
    paidAmount,
    change: cashChange,
    paymentBreakdown: payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
    })),
    reprints: [],
  };
}

function createPaymentJournal(
  state: TransactionState,
  bill: BillingRecord,
  payment: PaymentRecord,
): JournalEntry {
  return {
    id: id("JE", state, "journalEntries"),
    sourceType: "Payment",
    sourceId: payment.id,
    branch: bill.branch,
    status: "POSTED",
    postedAt: now(),
    lines: [
      {
        account:
          payment.method === "CASH"
            ? "Cash Drawer"
            : payment.method === "CARD"
              ? "Card Clearing"
              : payment.method === "BANK_TRANSFER"
                ? "Bank Clearing"
                : "M-Pesa Clearing",
        debit: payment.amount,
        credit: 0,
        costCentre: bill.branch,
      },
      { account: "Accounts Receivable", debit: 0, credit: payment.amount, costCentre: bill.branch },
    ],
  };
}

export function transactionMetrics(state: TransactionState) {
  const sales = state.bills
    .filter((bill) => bill.status === "PAID")
    .reduce((sum, bill) => sum + bill.total, 0);
  const outstanding = state.bills
    .filter(
      (bill) =>
        bill.paymentStatus !== "PAID" && bill.status !== "MERGED" && bill.status !== "SPLIT",
    )
    .reduce((sum, bill) => sum + bill.total - bill.paid, 0);
  const unreconciled = state.externalTransactions.filter(
    (transaction) =>
      !["RECONCILED", "IGNORED", "DUPLICATE"].includes(transaction.reconciliationStatus),
  ).length;
  const cashVariance = state.cashDrawers.reduce((sum, drawer) => sum + (drawer.variance ?? 0), 0);
  return { sales, outstanding, unreconciled, cashVariance };
}
