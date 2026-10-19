import type { ServerActor } from "@/lib/seramet-auth";
import { normalizeTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { businessDateForTimestamp } from "@/lib/business-date";
import {
  financialCloseReadiness,
  projectFinancialLifecycle,
  type DayCloseReadinessIssue,
} from "@/lib/financial-lifecycle";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import { ReconciliationEngine } from "@/payments/reconciliation-engine";
import { assertMinorAmount, majorFromMinor, parseMajorAmount, sumMinor } from "@/payments/money";
import type { CashDrawerSession, CashMovement, DayClose } from "@/payments/types";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { permissions } from "@/platform/permissions";
export class DailyClosingError extends Error {
  readonly code: "PERMISSION_DENIED" | "INVALID_STATE_TRANSITION";
  constructor(
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.code = status === 403 ? "PERMISSION_DENIED" : "INVALID_STATE_TRANSITION";
  }
}

export type ClosingMode = "SUPERVISOR_DAILY_CLOSE" | "MULTI_CASHIER_SHIFTS";
export const closingMutationActions = new Set([
  "closeBusinessDay",
  "closeCashierShift",
  "closeDay",
  "recordPeriodClose",
  "configureDailyClosing",
]);
export const unresolvedClosingPaymentStatuses = new Set([
  "CREATED",
  "PENDING",
  "AWAITING_CUSTOMER",
  "PROCESSING",
  "AUTHORIZED",
  "PARTIALLY_PAID",
  "REFUND_PENDING",
]);
export type ClosingPolicy = {
  id: string;
  tenantId: string;
  branchId: string;
  mode: ClosingMode;
  materialVarianceMinor: number;
  recipientUserIds: string[];
  updatedBy: string;
  updatedAt: string;
};
export type DrawerCount = {
  drawerSessionId: string;
  countedByCurrency: Record<string, number>;
  varianceReason?: string;
};
export type DailyClosingReport = {
  reference: string;
  mode: ClosingMode;
  restaurant: string;
  branch: string;
  timeZone: string;
  cutoffMinutes: number;
  supervisorId: string;
  operatorNames?: Record<string, string>;
  drawers: CashDrawerSession[];
  cashMovements: CashMovement[];
  outstandingInvoices: Array<{ id: string; balanceMinor: number }>;
  nonblocking: DayCloseReadinessIssue[];
  recipientUserIds: string[];
  invoices: TransactionState["bills"];
  voidedInvoiceIds: string[];
};

export function closingPolicy(
  state: TransactionState,
  tenantId: string,
  branchId: string,
): ClosingPolicy {
  return (
    state.paymentOperations?.closingPolicies?.find(
      (p) => p.tenantId === tenantId && p.branchId === branchId,
    ) ?? {
      id: branchId,
      tenantId,
      branchId,
      mode: "SUPERVISOR_DAILY_CLOSE",
      materialVarianceMinor: 50_000,
      recipientUserIds: [],
      updatedBy: "default",
      updatedAt: "",
    }
  );
}

export function closingStateForReader(
  state: TransactionState,
  canReadReports: boolean,
): TransactionState {
  if (canReadReports || !state.paymentOperations) return state;
  return {
    ...state,
    paymentOperations: {
      ...state.paymentOperations,
      dayCloses: state.paymentOperations.dayCloses.map((day) => ({
        ...day,
        snapshot: undefined,
        snapshots: [],
      })),
      closingPolicies: state.paymentOperations.closingPolicies?.map((policy) => ({
        ...policy,
        recipientUserIds: [],
      })),
    },
  };
}

function scope(actor: ServerActor, tenantId: string, branchId: string, permission: string) {
  if (
    actor.tenantId !== tenantId ||
    actor.branchId !== branchId ||
    !actor.assignedBranchIds.includes(branchId)
  ) {
    throw new DailyClosingError("Closing requires the authorized active tenant and branch", 403);
  }
  if (!actor.permissions.includes(permission))
    throw new DailyClosingError(`Permission ${permission} is required`, 403);
}

export function configureClosing(
  state: TransactionState,
  actor: ServerActor,
  input: {
    branchId: string;
    mode: ClosingMode;
    materialVarianceMinor: number;
    recipientUserIds: string[];
  },
) {
  if (state.tenantId !== actor.tenantId)
    throw new DailyClosingError("Cross-tenant closing configuration denied");
  scope(actor, actor.tenantId, input.branchId, permissions.reconciliationApprove);
  if (!["SUPERVISOR_DAILY_CLOSE", "MULTI_CASHIER_SHIFTS"].includes(input.mode))
    throw new DailyClosingError("Invalid closing mode");
  assertMinorAmount(input.materialVarianceMinor, "Material variance threshold");
  if (input.materialVarianceMinor <= 0)
    throw new DailyClosingError("Material variance threshold must be positive");
  const next = normalizeTransactionState(state);
  const operations = next.paymentOperations!;
  const prior = closingPolicy(next, actor.tenantId, input.branchId);
  if (
    prior.mode !== input.mode &&
    operations.drawerSessions.some(
      (d) => d.branchId === input.branchId && ["OPEN", "REVIEW_REQUIRED"].includes(d.status),
    )
  ) {
    throw new DailyClosingError(
      "Resolve active drawer reconciliations before changing closing mode",
    );
  }
  const repository = getConfigurationRepository();
  const ids = [...new Set(input.recipientUserIds)];
  if (ids.length > 20) throw new DailyClosingError("At most 20 report recipients are supported");
  for (const id of ids) {
    const recipient = repository.getUserSession(actor.tenantId, id);
    if (!recipient.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.email))
      throw new DailyClosingError("Report recipients need a valid email address");
    if (
      !recipient.assignedBranchIds.includes(input.branchId) ||
      !recipient.permissions.includes(permissions.reconciliationView)
    ) {
      throw new DailyClosingError(
        "Report recipients require branch access and reconciliation view permission",
      );
    }
  }
  operations.closingPolicies = [
    ...(operations.closingPolicies ?? []).filter((p) => p.branchId !== input.branchId),
    {
      ...input,
      id: input.branchId,
      recipientUserIds: ids,
      tenantId: actor.tenantId,
      updatedBy: actor.id,
      updatedAt: new Date().toISOString(),
    },
  ];
  return next;
}

function context(tenantId: string, branchId: string) {
  const repository = getConfigurationRepository();
  const branch = repository.getBranch(tenantId, branchId);
  const tenant = repository.getTenant(tenantId);
  return {
    tenant,
    branch,
    timeZone: branch.timezone ?? tenant.timezone,
    businessDayCutoffMinutes: Number(branch.metadata["businessDayCutoffMinutes"] ?? 0),
  };
}

export function drawersForDay(
  state: TransactionState,
  tenantId: string,
  branchId: string,
  businessDate: string,
) {
  const accounting = context(tenantId, branchId);
  return (state.paymentOperations?.drawerSessions ?? []).filter(
    (d) =>
      d.tenantId === tenantId &&
      d.branchId === branchId &&
      (d.businessDate ??
        businessDateForTimestamp(
          d.openedAt,
          accounting.timeZone,
          accounting.businessDayCutoffMinutes,
        )) === businessDate,
  );
}

function finalizeDrawer(
  state: TransactionState,
  actor: ServerActor,
  count: DrawerCount,
  policy: ClosingPolicy,
) {
  const drawer = state.paymentOperations?.drawerSessions.find(
    (d) =>
      d.id === count.drawerSessionId &&
      d.branchId === actor.branchId &&
      d.tenantId === actor.tenantId,
  );
  if (!drawer || drawer.status !== "OPEN")
    throw new DailyClosingError("Open drawer was not found in the active branch");
  const currencies = Object.keys(drawer.currencyBalances).sort();
  if (currencies.join() !== Object.keys(count.countedByCurrency).sort().join())
    throw new DailyClosingError("Count every drawer currency exactly once");
  let hasVariance = false;
  let materialVariance = false;
  for (const currency of currencies) {
    const counted = count.countedByCurrency[currency]!;
    assertMinorAmount(counted, "Counted cash");
    if (counted < 0) throw new DailyClosingError("Counted cash cannot be negative");
    const variance = sumMinor([counted, -drawer.currencyBalances[currency]!.expectedCashMinor]);
    hasVariance ||= variance !== 0;
    // A foreign-currency variance cannot be compared with the base-currency threshold without FX evidence.
    materialVariance ||=
      currency !== drawer.baseCurrency
        ? variance !== 0
        : Math.abs(variance) >= policy.materialVarianceMinor;
  }
  if (hasVariance && !count.varianceReason?.trim())
    throw new DailyClosingError("A cash variance explanation is required");
  if (
    materialVariance &&
    (!actor.permissions.includes(permissions.cashAdjust) ||
      !actor.permissions.includes(permissions.reconciliationApprove))
  ) {
    throw new DailyClosingError("Material variance requires supervisor cash-adjustment approval");
  }
  let next = paymentOrchestrator.closeDrawer(state, {
    tenantId: actor.tenantId,
    drawerSessionId: drawer.id,
    actor: actor.id,
    countedCashMinor: count.countedByCurrency[drawer.baseCurrency]!,
    countedByCurrency: count.countedByCurrency,
    largeVarianceThresholdMinor: policy.materialVarianceMinor,
  });
  if (hasVariance && materialVariance) {
    next = paymentOrchestrator.approveDrawerVariance(next, {
      tenantId: actor.tenantId,
      drawerSessionId: drawer.id,
      approvedBy: actor.id,
      reason: count.varianceReason!.trim(),
    });
  }
  const closed = next.paymentOperations!.drawerSessions.find((d) => d.id === drawer.id)!;
  if (hasVariance && !materialVariance) closed.status = "CLOSED";
  if (hasVariance) closed.varianceReason = count.varianceReason!.trim();
  const legacy = next.cashDrawers.find((d) => `MIGRATED-${d.id}` === closed.id);
  if (legacy) {
    legacy.status = "APPROVED";
    legacy.physicalCount = majorFromMinor(closed.countedCashMinor!, closed.baseCurrency);
    legacy.variance = majorFromMinor(closed.varianceMinor!, closed.baseCurrency);
    legacy.closedAt = closed.closedAt;
    legacy.supervisor = actor.id;
  }
  return next;
}

export function closeCashierShift(state: TransactionState, actor: ServerActor, count: DrawerCount) {
  if (state.tenantId !== actor.tenantId)
    throw new DailyClosingError("Cross-tenant shift closure denied");
  scope(actor, actor.tenantId, actor.branchId, permissions.cashClose);
  const policy = closingPolicy(state, actor.tenantId, actor.branchId);
  if (policy.mode !== "MULTI_CASHIER_SHIFTS")
    throw new DailyClosingError("This branch uses supervisor-led daily closing");
  const drawer = state.paymentOperations?.drawerSessions.find(
    (d) =>
      d.id === count.drawerSessionId &&
      d.tenantId === actor.tenantId &&
      d.branchId === actor.branchId,
  );
  if (!drawer) throw new DailyClosingError("Cashier drawer was not found");
  if (
    drawer.employeeId !== actor.id &&
    !actor.permissions.includes(permissions.reconciliationApprove)
  )
    throw new DailyClosingError("Cannot close another cashier's shift");
  if (drawer.status !== "OPEN") throw new DailyClosingError("This shift is already finalized");
  return finalizeDrawer(state, actor, count, policy);
}

export function closeCompatibleDrawer(
  state: TransactionState,
  actor: ServerActor,
  count: DrawerCount,
  confirmed: boolean,
) {
  if (!confirmed) throw new DailyClosingError("Explicit drawer confirmation is required");
  if (state.tenantId !== actor.tenantId)
    throw new DailyClosingError("Cross-tenant shift closure denied");
  scope(actor, actor.tenantId, actor.branchId, permissions.cashClose);
  const policy = closingPolicy(state, actor.tenantId, actor.branchId);
  if (policy.mode === "MULTI_CASHIER_SHIFTS") return closeCashierShift(state, actor, count);
  if (!actor.permissions.includes(permissions.reconciliationApprove))
    throw new DailyClosingError("This branch uses supervisor-led daily closing");
  return finalizeDrawer(state, actor, count, policy);
}

export function closeBusinessDay(
  state: TransactionState,
  actor: ServerActor,
  input: {
    businessDate: string;
    drawerCounts: DrawerCount[];
    confirmed: boolean;
  },
) {
  if (state.tenantId !== actor.tenantId)
    throw new DailyClosingError("Cross-tenant business-day closure denied");
  scope(actor, actor.tenantId, actor.branchId, permissions.reconciliationApprove);
  if (input.confirmed !== true)
    throw new DailyClosingError("Explicit business-day confirmation is required");
  const accounting = context(actor.tenantId, actor.branchId);
  const currentDate = businessDateForTimestamp(
    new Date(),
    accounting.timeZone,
    accounting.businessDayCutoffMinutes,
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) ||
    !Number.isFinite(Date.parse(`${input.businessDate}T12:00:00.000Z`)) ||
    new Date(`${input.businessDate}T12:00:00.000Z`).toISOString().slice(0, 10) !==
      input.businessDate ||
    input.businessDate > currentDate
  )
    throw new DailyClosingError("Invalid or future business date");
  const existing = state.paymentOperations?.dayCloses.find(
    (d) =>
      d.tenantId === actor.tenantId &&
      d.branchId === actor.branchId &&
      d.businessDate === input.businessDate,
  );
  if (existing?.status === "CLOSED") {
    // A new key may not silently substitute different counts for an existing close.
    const recorded = existing.snapshot?.dailyReport?.drawers ?? [];
    for (const count of input.drawerCounts) {
      const drawer = recorded.find((d) => d.id === count.drawerSessionId);
      if (
        !drawer ||
        Object.entries(count.countedByCurrency).some(
          ([currency, amount]) => drawer.currencyBalances[currency]?.countedCashMinor !== amount,
        )
      )
        throw new DailyClosingError("Closed reconciliation is immutable");
    }
    return normalizeTransactionState(state);
  }
  const policy = closingPolicy(state, actor.tenantId, actor.branchId);
  let next = normalizeTransactionState(state);
  const drawers = drawersForDay(next, actor.tenantId, actor.branchId, input.businessDate);
  if (
    next.paymentOperations!.cashMovements.some(
      (movement) =>
        drawers.some((drawer) => drawer.id === movement.drawerSessionId) &&
        businessDateForTimestamp(
          movement.timestamp,
          accounting.timeZone,
          accounting.businessDayCutoffMinutes,
        ) > input.businessDate,
    )
  ) {
    throw new DailyClosingError(
      "A drawer spans accounting periods; reconcile its later-period cash before closing this business date",
    );
  }
  const open = drawers.filter((d) => d.status === "OPEN");
  if (policy.mode === "MULTI_CASHIER_SHIFTS" && (open.length || input.drawerCounts.length))
    throw new DailyClosingError(
      "Finalize individual cashier shifts before branch closing; do not recount closed drawers",
    );
  if (policy.mode === "SUPERVISOR_DAILY_CLOSE") {
    if (open.length > 1)
      throw new DailyClosingError(
        "More than one active cashier requires separate authorized shift reconciliation",
      );
    const countIds = input.drawerCounts.map((c) => c.drawerSessionId);
    if (
      new Set(countIds).size !== countIds.length ||
      open.length !== countIds.length ||
      open.some((d) => !countIds.includes(d.id))
    )
      throw new DailyClosingError("Provide exactly one count for each associated open drawer");
    for (const count of input.drawerCounts) next = finalizeDrawer(next, actor, count, policy);
  }
  if (
    drawersForDay(next, actor.tenantId, actor.branchId, input.businessDate).some(
      (d) => !["CLOSED", "APPROVED"].includes(d.status),
    )
  )
    throw new DailyClosingError("Drawer reconciliation requires approval");
  for (const drawer of drawersForDay(next, actor.tenantId, actor.branchId, input.businessDate)) {
    for (const balance of Object.values(drawer.currencyBalances)) {
      if (
        !Number.isSafeInteger(balance.countedCashMinor) ||
        !Number.isSafeInteger(balance.varianceMinor) ||
        balance.countedCashMinor! < 0 ||
        sumMinor([balance.countedCashMinor!, -balance.expectedCashMinor]) !== balance.varianceMinor
      )
        throw new DailyClosingError(
          "Finalized drawer reconciliation is incomplete or inconsistent",
        );
      if (
        balance.varianceMinor !== 0 &&
        !(drawer.varianceReason?.trim() || drawer.approvalReason?.trim())
      )
        throw new DailyClosingError("Finalized cash variance requires an explanation");
    }
  }
  if (
    next.paymentOperations!.drawerSessions.some(
      (d) => d.branchId === actor.branchId && ["OPEN", "REVIEW_REQUIRED"].includes(d.status),
    )
  )
    throw new DailyClosingError("Another active cashier session must be resolved before closing");
  const readiness = financialCloseReadiness(next, {
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    businessDate: input.businessDate,
    ...accounting,
  });
  const outstanding = next.bills.filter(
    (b) =>
      b.branchId === actor.branchId &&
      (b.businessDate ??
        businessDateForTimestamp(
          b.issuedAt,
          accounting.timeZone,
          accounting.businessDayCutoffMinutes,
        )) === input.businessDate &&
      ["OPEN", "PARTIAL", "PENDING"].includes(b.status) &&
      !["PAID", "PROVIDER_RECEIVABLE"].includes(b.paymentStatus),
  );
  const invoiceOrderIds = new Set(
    outstanding
      .flatMap((b) => b.orderIds)
      .filter((id) =>
        next.orders.some(
          (order) =>
            order.id === id &&
            ["SERVED", "BILL_REQUESTED", "AWAITING_PAYMENT", "PARTIALLY_PAID"].includes(
              order.status,
            ),
        ),
      ),
  );
  const nonblocking = readiness.filter(
    (i) =>
      (i.code === "UNSETTLED_INVOICE" && outstanding.some((b) => b.id === i.sourceId)) ||
      (i.code === "OPEN_ORDER" && invoiceOrderIds.has(i.sourceId)),
  );
  const blockers = readiness.filter((i) => !nonblocking.includes(i));
  if (blockers.length)
    throw new DailyClosingError(
      `Business day cannot close: ${blockers.map((i) => i.code).join(", ")}`,
    );
  if (
    next.refunds.some(
      (refund) =>
        refund.branchId === actor.branchId && ["REQUESTED", "APPROVED"].includes(refund.status),
    )
  )
    throw new DailyClosingError("Refund has not reached a final state");
  if (
    next.paymentOperations!.intents.some(
      (i) => i.branchId === actor.branchId && unresolvedClosingPaymentStatuses.has(i.status),
    )
  )
    throw new DailyClosingError("Payment confirmation is unresolved");
  if (
    next.paymentIntents.some(
      (intent) =>
        intent.branchId === actor.branchId && unresolvedClosingPaymentStatuses.has(intent.status),
    )
  )
    throw new DailyClosingError("Payment confirmation is unresolved");
  if (
    next.paymentOperations!.transactions.some(
      (p) =>
        p.branchId === actor.branchId &&
        ["PENDING", "UNVERIFIED", "VERIFYING", "AMOUNT_MISMATCH"].includes(p.status),
    )
  )
    throw new DailyClosingError("Payment evidence requires resolution");
  const engine = new ReconciliationEngine();
  next = engine.prepareDayClose(next, {
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    businessDate: input.businessDate,
    currency: accounting.tenant.defaultCurrency,
    actor: actor.id,
  });
  const day = next.paymentOperations!.dayCloses.find(
    (d) => d.branchId === actor.branchId && d.businessDate === input.businessDate,
  )!;
  // Only explicitly classified receivables are allowed. No financial blocker can be overridden here.
  const closedAt = new Date().toISOString();
  const finalDrawers = drawersForDay(next, actor.tenantId, actor.branchId, input.businessDate);
  const operatorIds = new Set([
    actor.id,
    ...finalDrawers.flatMap((drawer) => [
      drawer.employeeId,
      drawer.closedBy ?? "",
      drawer.approvedBy ?? "",
    ]),
  ]);
  const operatorNames = Object.fromEntries(
    getConfigurationRepository()
      .snapshot()
      .users.filter((user) => user.tenantId === actor.tenantId && operatorIds.has(user.id))
      .map((user) => [user.id, user.name]),
  );
  operatorNames[actor.id] = actor.name;
  const snapshot: NonNullable<DayClose["snapshot"]> = {
    ...projectFinancialLifecycle(next, {
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      businessDate: day.businessDate,
      currency: accounting.tenant.defaultCurrency,
      calculatedAt: closedAt,
      ...accounting,
    }),
    revision: day.snapshots.length + 1,
    closedBy: actor.id,
    closedAt,
    dailyReport: {
      reference: `${day.id}-R${day.snapshots.length + 1}`,
      mode: policy.mode,
      restaurant: accounting.tenant.tradingName,
      branch: accounting.branch.name,
      timeZone: accounting.timeZone,
      cutoffMinutes: accounting.businessDayCutoffMinutes,
      supervisorId: actor.id,
      operatorNames,
      drawers: structuredClone(
        drawersForDay(next, actor.tenantId, actor.branchId, input.businessDate),
      ),
      cashMovements: structuredClone(
        next.paymentOperations!.cashMovements.filter((m) =>
          drawers.some((d) => d.id === m.drawerSessionId),
        ),
      ),
      outstandingInvoices: outstanding.map((b) => ({
        id: b.id,
        balanceMinor: sumMinor([
          parseMajorAmount(b.total, accounting.tenant.defaultCurrency),
          -parseMajorAmount(b.paid, accounting.tenant.defaultCurrency),
        ]),
      })),
      nonblocking: structuredClone(nonblocking),
      recipientUserIds: [...policy.recipientUserIds],
      invoices: structuredClone(
        next.bills.filter(
          (b) =>
            b.branchId === actor.branchId &&
            (b.businessDate ??
              businessDateForTimestamp(
                b.issuedAt,
                accounting.timeZone,
                accounting.businessDayCutoffMinutes,
              )) === day.businessDate &&
            !["VOID", "MERGED", "SPLIT"].includes(b.status),
        ),
      ),
      voidedInvoiceIds: next.bills
        .filter(
          (b) =>
            b.branchId === actor.branchId &&
            b.status === "VOID" &&
            (b.businessDate ??
              businessDateForTimestamp(
                b.issuedAt,
                accounting.timeZone,
                accounting.businessDayCutoffMinutes,
              )) === day.businessDate,
        )
        .map((b) => b.id),
    },
  };
  day.status = "CLOSED";
  day.closedBy = actor.id;
  day.closedAt = closedAt;
  day.updatedAt = closedAt;
  day.readiness = nonblocking;
  day.unresolvedExceptionIds = nonblocking.map((i) => i.id);
  day.snapshot = snapshot;
  day.snapshots.push(structuredClone(snapshot));
  next.paymentOperations!.auditEvents.unshift({
    id: `closing:${snapshot.dailyReport!.reference}`,
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    actor: actor.id,
    action: "BUSINESS_DAY_CLOSED",
    recordType: "DayClose",
    recordId: day.id,
    detail: `${policy.mode}; revision ${snapshot.revision}`,
    createdAt: closedAt,
  });
  return next;
}
