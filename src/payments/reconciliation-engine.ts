import { normalizeTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { createJournal, reverseJournal } from "@/payments/accounting-posting";
import {
  assertMinorAmount,
  assertSameCurrency,
  majorFromMinor,
  parseMajorAmount,
  sumMinor,
} from "@/payments/money";
import type {
  NormalizedBankStatementRow,
  NormalizedSettlementImport,
} from "@/payments/statement-adapters";
import type {
  BankTransaction,
  FinancialJournal,
  PaymentMatch,
  PaymentOperationsState,
  ReconciliationSession,
  ReconciliationException,
  SettlementBatch,
  SettlementLine,
  SettlementLineType,
} from "@/payments/types";

export type SettlementAccountMappings = {
  bankAccountId: string;
  marketplaceReceivableAccountId: string;
  commissionExpenseAccountId: string;
  serviceFeeExpenseAccountId: string;
  deliveryAdjustmentAccountId: string;
  promotionExpenseAccountId: string;
  refundExpenseAccountId: string;
  taxAdjustmentAccountId: string;
  otherAdjustmentAccountId: string;
};

export class ReconciliationEngine {
  importBankTransactions(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId?: string;
      accountId: string;
      providerConnectionId?: string;
      adapterCode: string;
      rows: NormalizedBankStatementRow[];
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    for (const row of input.rows) {
      assertMinorAmount(row.amountMinor);
      const duplicate = operations.bankTransactions.find(
        (transaction) =>
          transaction.tenantId === input.tenantId &&
          transaction.accountId === input.accountId &&
          transaction.externalTransactionId === row.externalTransactionId,
      );
      if (duplicate) continue;
      operations.bankTransactions.unshift(
        Object.freeze({
          id: nextId("BANKTX", operations.bankTransactions),
          tenantId: input.tenantId,
          ...(input.branchId ? { branchId: input.branchId } : {}),
          accountId: input.accountId,
          ...(input.providerConnectionId
            ? { providerConnectionId: input.providerConnectionId }
            : {}),
          ...row,
          status: "IMPORTED",
          importedAt: new Date().toISOString(),
          sourceAdapter: input.adapterCode,
        }),
      );
    }
    return next;
  }

  automaticallyMatchPayments(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId?: string;
      businessDate: string;
      timeWindowMinutes?: number;
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const stamp = new Date().toISOString();
    const session: ReconciliationSession = {
      id: nextId("RECON", operations.reconciliationSessions),
      tenantId: input.tenantId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      type: "PAYMENT" as const,
      businessDate: input.businessDate,
      status: "MATCHING" as const,
      createdBy: "SYSTEM",
      createdAt: stamp,
      updatedAt: stamp,
    };
    operations.reconciliationSessions.unshift(session);
    const usedBankIds = new Set(
      operations.matches
        .filter((match) => match.status === "APPROVED")
        .map((match) => match.rightId),
    );
    const candidates = operations.transactions.filter(
      (transaction) =>
        transaction.tenantId === input.tenantId &&
        transaction.direction === "COLLECTION" &&
        ["CONFIRMED", "MANUALLY_CONFIRMED", "UNVERIFIED", "VERIFYING"].includes(
          transaction.status,
        ) &&
        (!input.branchId || transaction.branchId === input.branchId),
    );
    for (const payment of candidates) {
      const ranked = operations.bankTransactions
        .filter(
          (bank) =>
            bank.tenantId === input.tenantId &&
            !usedBankIds.has(bank.id) &&
            bank.currency === payment.currency &&
            (!input.branchId || !bank.branchId || bank.branchId === input.branchId),
        )
        .map((bank) => scoreMatch(payment, bank, input.timeWindowMinutes ?? 180))
        .sort((left, right) => right.score - left.score);
      const best = ranked[0];
      const second = ranked[1];
      const confidence = confidenceFor(best?.score ?? 0, second?.score ?? 0);
      if (!best || confidence === "UNMATCHED") {
        addException(operations, {
          tenantId: input.tenantId,
          branchId: payment.branchId,
          sourceType: "PAYMENT",
          sourceId: payment.id,
          reason: "OTHER",
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          severity: "WARNING",
          detail: "Incoming collection has no safe bank/provider match",
        });
        continue;
      }
      const autoApprove = confidence === "EXACT" || confidence === "HIGH";
      const match: PaymentMatch = Object.freeze({
        id: nextId("MATCH4", operations.matches),
        tenantId: input.tenantId,
        branchId: payment.branchId,
        reconciliationSessionId: session.id,
        leftType: "PAYMENT_TRANSACTION",
        leftId: payment.id,
        rightType: "BANK_TRANSACTION",
        rightId: best.bank.id,
        amountMinor: Math.min(payment.amountMinor, Math.abs(best.bank.amountMinor)),
        currency: payment.currency,
        confidence,
        status: autoApprove ? "APPROVED" : "SUGGESTED",
        matchedBy: "SYSTEM",
        reason: best.reason,
        createdAt: stamp,
      });
      operations.matches.unshift(match);
      if (autoApprove) {
        usedBankIds.add(best.bank.id);
        replaceBank(operations, best.bank.id, {
          ...best.bank,
          status: Math.abs(best.bank.amountMinor) === payment.amountMinor ? "MATCHED" : "PARTIAL",
        });
        postPaymentBankReconciliation(operations, {
          paymentTransactionId: payment.id,
          bankTransactionId: best.bank.id,
          bankAccountId: best.bank.accountId,
          amountMinor: match.amountMinor,
          currency: match.currency,
          businessDate: input.businessDate,
          actor: "SYSTEM",
        });
      }
    }
    session.status = operations.matches.some(
      (match) => match.reconciliationSessionId === session.id && match.status === "SUGGESTED",
    )
      ? "REVIEW_REQUIRED"
      : "COMPLETE";
    if (session.status === "COMPLETE") session.completedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    return next;
  }

  manuallyMatch(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId?: string;
      sessionId: string;
      paymentTransactionId: string;
      bankTransactionId: string;
      amountMinor: number;
      actor: string;
      reason: string;
    },
  ) {
    if (!input.reason.trim()) throw new Error("Manual reconciliation reason is required");
    assertMinorAmount(input.amountMinor);
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const payment = operations.transactions.find(
      (item) => item.id === input.paymentTransactionId && item.tenantId === input.tenantId,
    );
    const bank = operations.bankTransactions.find(
      (item) => item.id === input.bankTransactionId && item.tenantId === input.tenantId,
    );
    if (!payment || !bank) throw new Error("Tenant-scoped reconciliation records not found");
    assertSameCurrency(payment.currency, bank.currency);
    if (input.amountMinor > payment.amountMinor || input.amountMinor > Math.abs(bank.amountMinor)) {
      throw new Error("Manual match amount exceeds the payment or bank transaction");
    }
    operations.matches.unshift(
      Object.freeze({
        id: nextId("MATCH4", operations.matches),
        tenantId: input.tenantId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        reconciliationSessionId: input.sessionId,
        leftType: "PAYMENT_TRANSACTION",
        leftId: payment.id,
        rightType: "BANK_TRANSACTION",
        rightId: bank.id,
        amountMinor: input.amountMinor,
        currency: payment.currency,
        confidence: "POSSIBLE",
        status: "APPROVED",
        matchedBy: "MANUAL",
        approvedBy: input.actor,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      }),
    );
    operations.fraudFlags.unshift({
      id: nextId("FRAUD", operations.fraudFlags),
      tenantId: input.tenantId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      type: "MANUAL_RECONCILIATION",
      sourceId: payment.id,
      severity: "WARNING",
      status: "OPEN",
      detail: input.reason,
      createdAt: new Date().toISOString(),
    });
    replaceBank(operations, bank.id, {
      ...bank,
      status: input.amountMinor === Math.abs(bank.amountMinor) ? "MATCHED" : "PARTIAL",
    });
    postPaymentBankReconciliation(operations, {
      paymentTransactionId: payment.id,
      bankTransactionId: bank.id,
      bankAccountId: bank.accountId,
      amountMinor: input.amountMinor,
      currency: payment.currency,
      businessDate: bank.date.slice(0, 10),
      actor: input.actor,
    });
    return next;
  }

  resolveException(
    state: TransactionState,
    input: {
      tenantId: string;
      exceptionId: string;
      actor: string;
      resolution: string;
      ignored?: boolean;
    },
  ) {
    if (!input.resolution.trim()) throw new Error("Exception resolution is required");
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const exception = operations.exceptions.find(
      (candidate) => candidate.id === input.exceptionId && candidate.tenantId === input.tenantId,
    );
    if (!exception || !["OPEN", "INVESTIGATING"].includes(exception.status)) {
      throw new Error("Open reconciliation exception was not found");
    }
    exception.status = input.ignored ? "IGNORED" : "RESOLVED";
    exception.resolvedAt = new Date().toISOString();
    exception.resolvedBy = input.actor;
    exception.resolution = input.resolution;
    operations.auditEvents.unshift(
      Object.freeze({
        id: nextId("PAUD", operations.auditEvents),
        tenantId: input.tenantId,
        ...(exception.branchId ? { branchId: exception.branchId } : {}),
        actor: input.actor,
        action: input.ignored
          ? "RECONCILIATION_EXCEPTION_IGNORED"
          : "RECONCILIATION_EXCEPTION_RESOLVED",
        recordType: "ReconciliationException",
        recordId: exception.id,
        detail: input.resolution,
        createdAt: new Date().toISOString(),
      }),
    );
    return next;
  }

  importSettlement(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId?: string;
      importedBy: string;
      normalized: NormalizedSettlementImport;
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const existing = operations.settlementBatches.find(
      (batch) =>
        batch.tenantId === input.tenantId &&
        batch.connectionId === input.normalized.connectionId &&
        batch.externalSettlementId === input.normalized.providerSettlementId,
    );
    if (existing) return { state: next, batch: existing, replayed: true };
    const stamp = new Date().toISOString();
    const batchId = nextId("SETTLE", operations.settlementBatches);
    const totals = settlementTotals(input.normalized.lines);
    if (totals.grossSalesMinor !== input.normalized.grossAmountMinor) {
      throw new Error("Settlement gross total does not match its gross lines");
    }
    const netExpectedMinor = totals.grossSalesMinor - totals.totalDeductionsMinor;
    if (netExpectedMinor !== input.normalized.netAmountMinor) {
      throw new Error("Settlement net amount does not match normalized lines");
    }
    const batch: SettlementBatch = {
      id: batchId,
      tenantId: input.tenantId,
      connectionId: input.normalized.connectionId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      externalSettlementId: input.normalized.providerSettlementId,
      periodStart: input.normalized.periodStart,
      periodEnd: input.normalized.periodEnd,
      ...(input.normalized.settledAt ? { settledAt: input.normalized.settledAt } : {}),
      currency: input.normalized.currency,
      ...totals,
      netExpectedMinor,
      netSettledMinor: 0,
      status: "IMPORTED",
      importedBy: input.importedBy,
      importedAt: stamp,
      updatedAt: stamp,
    };
    operations.settlementBatches.unshift(batch);
    input.normalized.lines.forEach((line, index) => {
      const receivable = line.externalOrderId
        ? next.marketplaceReceivables.find(
            (candidate) =>
              candidate.tenantId === input.tenantId &&
              candidate.connectionId === input.normalized.connectionId &&
              candidate.externalOrderId === line.externalOrderId,
          )
        : undefined;
      operations.settlementLines.push(
        Object.freeze({
          id: `${batchId}-LINE-${index + 1}`,
          tenantId: input.tenantId,
          settlementBatchId: batchId,
          type: line.type,
          ...(line.externalOrderId ? { externalOrderId: line.externalOrderId } : {}),
          ...(receivable
            ? {
                orderId: receivable.orderId,
                marketplaceReceivableId: receivable.id,
              }
            : {}),
          amountMinor: line.amountMinor,
          taxAmountMinor: line.taxAmountMinor,
          currency: input.normalized.currency,
          reference: line.reference,
          description: line.description,
          metadata: Object.freeze({ ...line.metadata }),
        }),
      );
      if (line.type === "GROSS_SALE" && !receivable) {
        addException(operations, {
          tenantId: input.tenantId,
          ...(input.branchId ? { branchId: input.branchId } : {}),
          sourceType: "SETTLEMENT",
          sourceId: batchId,
          reason: "MISSING_ORDER",
          amountMinor: line.amountMinor,
          currency: input.normalized.currency,
          severity: "CRITICAL",
          detail: `No marketplace receivable found for ${line.externalOrderId ?? line.reference}`,
        });
      }
    });
    batch.status = operations.exceptions.some(
      (exception) => exception.sourceId === batchId && exception.status === "OPEN",
    )
      ? "EXCEPTION"
      : "MATCHING";
    return { state: next, batch, replayed: false };
  }

  matchSettlementToBank(
    state: TransactionState,
    input: {
      tenantId: string;
      settlementBatchId: string;
      bankTransactionId: string;
      actor: string;
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const batch = operations.settlementBatches.find(
      (candidate) =>
        candidate.id === input.settlementBatchId && candidate.tenantId === input.tenantId,
    );
    const bank = operations.bankTransactions.find(
      (candidate) =>
        candidate.id === input.bankTransactionId && candidate.tenantId === input.tenantId,
    );
    if (!batch || !bank) throw new Error("Settlement or bank transaction not found for tenant");
    if (["POSTED", "REVERSED"].includes(batch.status))
      throw new Error("Posted settlement is locked");
    assertSameCurrency(batch.currency, bank.currency);
    batch.bankTransactionId = bank.id;
    batch.netSettledMinor = Math.abs(bank.amountMinor);
    const variance = batch.netSettledMinor - batch.netExpectedMinor;
    if (variance !== 0) {
      batch.status = "EXCEPTION";
      addException(operations, {
        tenantId: input.tenantId,
        ...(batch.branchId ? { branchId: batch.branchId } : {}),
        sourceType: "SETTLEMENT",
        sourceId: batch.id,
        reason: variance < 0 ? "BANK_SHORTFALL" : "OTHER",
        amountMinor: variance,
        currency: batch.currency,
        severity: "CRITICAL",
        detail: `Expected ${batch.netExpectedMinor}; bank received ${batch.netSettledMinor}`,
      });
    } else {
      batch.status = "MATCHED";
      replaceBank(operations, bank.id, { ...bank, status: "MATCHED" });
    }
    batch.updatedAt = new Date().toISOString();
    return next;
  }

  postSettlement(
    state: TransactionState,
    input: {
      tenantId: string;
      settlementBatchId: string;
      actor: string;
      accounts: SettlementAccountMappings;
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const batch = operations.settlementBatches.find(
      (candidate) =>
        candidate.id === input.settlementBatchId && candidate.tenantId === input.tenantId,
    );
    if (!batch) throw new Error("Settlement batch not found");
    if (batch.status === "POSTED") return next;
    if (batch.status !== "MATCHED") throw new Error("Only a matched settlement can be posted");
    const lines = operations.settlementLines.filter((line) => line.settlementBatchId === batch.id);
    const journalLines = [
      line(input.accounts.bankAccountId, batch.netSettledMinor, 0, batch.currency, {
        settlementBatchId: batch.id,
      }),
      ...deductionJournalLines(lines, batch.currency, input.accounts),
      line(
        input.accounts.marketplaceReceivableAccountId,
        0,
        batch.grossSalesMinor,
        batch.currency,
        { settlementBatchId: batch.id },
      ),
    ];
    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        ...(batch.branchId ? { branchId: batch.branchId } : {}),
        sourceType: "MARKETPLACE_SETTLEMENT",
        sourceId: batch.id,
        businessDate: businessDateFor(batch.settledAt ?? new Date().toISOString(), 0),
        description: `Marketplace settlement ${batch.externalSettlementId}`,
        postedBy: input.actor,
        lines: journalLines,
      }),
    );
    for (const settlementLine of lines.filter((candidate) => candidate.type === "GROSS_SALE")) {
      if (!settlementLine.marketplaceReceivableId) continue;
      const receivable = next.marketplaceReceivables.find(
        (candidate) => candidate.id === settlementLine.marketplaceReceivableId,
      );
      if (!receivable) continue;
      const settledMajor = majorFromMinor(settlementLine.amountMinor, batch.currency);
      receivable.settledAmount = Math.min(
        receivable.externallyCollectedAmount,
        receivable.settledAmount + settledMajor,
      );
      receivable.outstandingAmount = Math.max(
        0,
        receivable.externallyCollectedAmount - receivable.settledAmount,
      );
      receivable.status = receivable.outstandingAmount === 0 ? "SETTLED" : "PARTIALLY_SETTLED";
      receivable.updatedAt = new Date().toISOString();
      if (receivable.status === "SETTLED") receivable.settledAt = receivable.updatedAt;
    }
    batch.status = "POSTED";
    batch.postedBy = input.actor;
    batch.postedAt = new Date().toISOString();
    batch.updatedAt = batch.postedAt;
    return next;
  }

  reversePostedSettlement(
    state: TransactionState,
    input: { tenantId: string; settlementBatchId: string; actor: string; reason: string },
  ) {
    if (!input.reason.trim()) throw new Error("Settlement reversal reason is required");
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const batch = operations.settlementBatches.find(
      (candidate) =>
        candidate.id === input.settlementBatchId && candidate.tenantId === input.tenantId,
    );
    if (!batch || batch.status !== "POSTED") throw new Error("Posted settlement not found");
    const journal = operations.journals.find(
      (candidate) =>
        candidate.sourceType === "MARKETPLACE_SETTLEMENT" &&
        candidate.sourceId === batch.id &&
        candidate.status === "POSTED",
    );
    if (!journal) throw new Error("Settlement journal not found");
    const reversal = reverseJournal(journal, {
      id: nextId("JRN4", operations.journals),
      actor: input.actor,
      businessDate: new Date().toISOString().slice(0, 10),
    });
    operations.journals.unshift(reversal);
    journal.status = "REVERSED";
    batch.status = "REVERSED";
    batch.reversalJournalId = reversal.id;
    batch.updatedAt = new Date().toISOString();
    return next;
  }

  prepareDayClose(
    state: TransactionState,
    input: { tenantId: string; branchId: string; businessDate: string; actor: string },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const existing = operations.dayCloses.find(
      (day) =>
        day.tenantId === input.tenantId &&
        day.branchId === input.branchId &&
        day.businessDate === input.businessDate,
    );
    const unresolvedExceptionIds = operations.exceptions
      .filter(
        (exception) =>
          exception.tenantId === input.tenantId &&
          (!exception.branchId || exception.branchId === input.branchId) &&
          exception.status !== "RESOLVED" &&
          exception.severity === "CRITICAL",
      )
      .map((exception) => exception.id);
    const pendingRefundIds = operations.refunds
      .filter(
        (refund) =>
          refund.tenantId === input.tenantId &&
          refund.branchId === input.branchId &&
          ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status),
      )
      .map((refund) => refund.id);
    const ids = [...new Set([...unresolvedExceptionIds, ...pendingRefundIds])];
    const stamp = new Date().toISOString();
    if (existing) {
      existing.unresolvedExceptionIds = ids;
      existing.status = ids.length ? "REVIEW" : "OPEN";
      existing.updatedAt = stamp;
      return next;
    }
    operations.dayCloses.unshift({
      id: nextId("DAYCLOSE", operations.dayCloses),
      tenantId: input.tenantId,
      branchId: input.branchId,
      businessDate: input.businessDate,
      status: ids.length ? "REVIEW" : "OPEN",
      unresolvedExceptionIds: ids,
      createdAt: stamp,
      updatedAt: stamp,
    });
    return next;
  }

  closeDay(
    state: TransactionState,
    input: {
      tenantId: string;
      dayCloseId: string;
      actor: string;
      hasOverridePermission: boolean;
      overrideReason?: string;
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const day = requiredOperations(next).dayCloses.find(
      (candidate) => candidate.id === input.dayCloseId && candidate.tenantId === input.tenantId,
    );
    if (!day) throw new Error("Day close was not found");
    if (day.status === "CLOSED") return next;
    if (day.unresolvedExceptionIds.length) {
      if (!input.hasOverridePermission) throw new Error("Critical EOD exceptions must be resolved");
      if (!input.overrideReason?.trim()) throw new Error("EOD override reason is required");
      day.overrideReason = input.overrideReason;
    }
    day.status = "CLOSED";
    day.closedBy = input.actor;
    day.closedAt = new Date().toISOString();
    day.updatedAt = day.closedAt;
    return next;
  }

  reopenDay(
    state: TransactionState,
    input: { tenantId: string; dayCloseId: string; actor: string; reason: string },
  ) {
    if (!input.reason.trim()) throw new Error("Day-close reopen reason is required");
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const day = operations.dayCloses.find(
      (candidate) => candidate.id === input.dayCloseId && candidate.tenantId === input.tenantId,
    );
    if (!day || day.status !== "CLOSED") throw new Error("Closed business day was not found");
    day.status = "REOPENED";
    day.reopenedBy = input.actor;
    day.reason = input.reason.trim();
    day.updatedAt = new Date().toISOString();
    operations.auditEvents.unshift(
      Object.freeze({
        id: `PAUD-${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        branchId: day.branchId,
        actor: input.actor,
        action: "DAY_CLOSE_REOPENED",
        recordType: "DayClose",
        recordId: day.id,
        detail: day.reason,
        createdAt: day.updatedAt,
      }),
    );
    return next;
  }
}

export function businessDateFor(timestamp: string, cutoffHour: number) {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new Error("Business-day cutoff hour must be between 0 and 23");
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid business timestamp");
  const shifted = new Date(date.getTime() - cutoffHour * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function requiredOperations(state: TransactionState) {
  if (!state.paymentOperations) throw new Error("Payment operations state was not initialized");
  return state.paymentOperations;
}

function assertTenant(state: TransactionState, tenantId: string) {
  if ((state.tenantId ?? tenantId) !== tenantId) throw new Error("Tenant scope violation");
}

function scoreMatch(
  payment: PaymentOperationsState["transactions"][number],
  bank: BankTransaction,
  timeWindowMinutes: number,
) {
  const references = [
    payment.providerTransactionId,
    payment.customerReference,
    payment.merchantReference,
  ].filter(Boolean) as string[];
  const bankReferences = [
    bank.externalTransactionId,
    bank.reference,
    bank.rawReference,
    bank.description,
  ].filter(Boolean) as string[];
  const exactReference = references.some((reference) =>
    bankReferences.some((candidate) => candidate === reference),
  );
  const containsReference = references.some((reference) =>
    bankReferences.some(
      (candidate) => candidate.includes(reference) || reference.includes(candidate),
    ),
  );
  const amountMatches = payment.amountMinor === Math.abs(bank.amountMinor);
  const minutes = Math.abs(Date.parse(payment.occurredAt) - Date.parse(bank.date)) / 60000;
  const timeMatches = minutes <= timeWindowMinutes;
  const score =
    (exactReference ? 75 : containsReference ? 45 : 0) +
    (amountMatches ? 25 : 0) +
    (timeMatches ? 5 : 0);
  return {
    bank,
    score,
    reason: `${exactReference ? "exact reference" : containsReference ? "reference contained" : "no reference"}; ${amountMatches ? "amount matched" : "amount differed"}; ${Math.round(minutes)} minutes apart`,
  };
}

function confidenceFor(best: number, second: number): PaymentMatch["confidence"] {
  if (best >= 100 && best - second >= 20) return "EXACT";
  if (best >= 75 && best - second >= 20) return "HIGH";
  if (best >= 50) return "POSSIBLE";
  return "UNMATCHED";
}

function settlementTotals(lines: NormalizedSettlementImport["lines"]) {
  const total = (type: SettlementLineType) =>
    sumMinor(lines.filter((line) => line.type === type).map((line) => line.amountMinor));
  const grossSalesMinor = total("GROSS_SALE");
  const commissionsMinor = total("COMMISSION");
  const serviceFeesMinor = total("SERVICE_FEE");
  const deliveryAdjustmentsMinor = total("DELIVERY_ADJUSTMENT");
  const promotionsMinor = total("PROMOTION");
  const refundsMinor = total("REFUND");
  const taxAdjustmentsMinor = total("TAX_ADJUSTMENT");
  const otherAdjustmentsMinor = total("OTHER_ADJUSTMENT");
  return {
    grossSalesMinor,
    commissionsMinor,
    serviceFeesMinor,
    deliveryAdjustmentsMinor,
    promotionsMinor,
    refundsMinor,
    taxAdjustmentsMinor,
    otherAdjustmentsMinor,
    totalDeductionsMinor:
      commissionsMinor +
      serviceFeesMinor +
      deliveryAdjustmentsMinor +
      promotionsMinor +
      refundsMinor +
      taxAdjustmentsMinor +
      otherAdjustmentsMinor,
  };
}

function deductionJournalLines(
  lines: SettlementLine[],
  currency: string,
  accounts: SettlementAccountMappings,
) {
  const mapping: Record<Exclude<SettlementLineType, "GROSS_SALE">, string> = {
    COMMISSION: accounts.commissionExpenseAccountId,
    SERVICE_FEE: accounts.serviceFeeExpenseAccountId,
    DELIVERY_ADJUSTMENT: accounts.deliveryAdjustmentAccountId,
    PROMOTION: accounts.promotionExpenseAccountId,
    REFUND: accounts.refundExpenseAccountId,
    TAX_ADJUSTMENT: accounts.taxAdjustmentAccountId,
    OTHER_ADJUSTMENT: accounts.otherAdjustmentAccountId,
  };
  return lines
    .filter(
      (item): item is SettlementLine & { type: Exclude<SettlementLineType, "GROSS_SALE"> } =>
        item.type !== "GROSS_SALE",
    )
    .map((item) =>
      line(mapping[item.type], item.amountMinor, 0, currency, {
        settlementLineId: item.id,
        type: item.type,
      }),
    );
}

function line(
  accountId: string,
  debitMinor: number,
  creditMinor: number,
  currency: string,
  metadata: Record<string, unknown>,
) {
  return Object.freeze({
    accountId,
    debitMinor,
    creditMinor,
    currency,
    metadata: Object.freeze(metadata),
  });
}

function postPaymentBankReconciliation(
  operations: PaymentOperationsState,
  input: {
    paymentTransactionId: string;
    bankTransactionId: string;
    bankAccountId: string;
    amountMinor: number;
    currency: string;
    businessDate: string;
    actor: string;
  },
) {
  const collection = operations.collections.find(
    (candidate) => candidate.paymentTransactionId === input.paymentTransactionId,
  );
  if (!collection || collection.collectionState === "IN_HAND") return;
  assertSameCurrency(collection.currency, input.currency);
  const sourceId = `${input.paymentTransactionId}:${input.bankTransactionId}`;
  if (
    operations.journals.some(
      (journal) =>
        journal.sourceType === "PAYMENT_RECONCILIATION" &&
        journal.sourceId === sourceId &&
        journal.status === "POSTED",
    )
  ) {
    return;
  }
  operations.journals.unshift(
    createJournal({
      id: nextId("JRN4", operations.journals),
      tenantId: collection.tenantId,
      branchId: collection.branchId,
      sourceType: "PAYMENT_RECONCILIATION",
      sourceId,
      businessDate: input.businessDate,
      description: `Payment collection reconciled to bank ${input.bankTransactionId}`,
      postedBy: input.actor,
      lines: [
        line(input.bankAccountId, input.amountMinor, 0, input.currency, {
          bankTransactionId: input.bankTransactionId,
        }),
        line(collection.accountId, 0, input.amountMinor, input.currency, {
          paymentTransactionId: input.paymentTransactionId,
        }),
      ],
    }),
  );
  const totalMatchedMinor = sumMinor(
    operations.matches
      .filter((match) => match.leftId === input.paymentTransactionId && match.status === "APPROVED")
      .map((match) => match.amountMinor),
  );
  if (totalMatchedMinor >= collection.amountMinor) {
    operations.collections = operations.collections.map((candidate) =>
      candidate.id === collection.id
        ? Object.freeze({
            ...candidate,
            collectionState: "IN_BANK" as const,
            settledAt: new Date().toISOString(),
          })
        : candidate,
    );
  }
}

function addException(
  operations: PaymentOperationsState,
  input: Omit<ReconciliationException, "id" | "status" | "createdAt">,
) {
  const duplicate = operations.exceptions.find(
    (item) =>
      item.sourceType === input.sourceType &&
      item.sourceId === input.sourceId &&
      item.reason === input.reason &&
      item.status === "OPEN",
  );
  if (duplicate) return duplicate;
  const exception: ReconciliationException = {
    id: nextId("EXC4", operations.exceptions),
    ...input,
    status: "OPEN",
    createdAt: new Date().toISOString(),
  };
  operations.exceptions.unshift(exception);
  return exception;
}

function replaceBank(operations: PaymentOperationsState, id: string, replacement: BankTransaction) {
  operations.bankTransactions = operations.bankTransactions.map((item) =>
    item.id === id ? Object.freeze(replacement) : item,
  );
}

function nextId(prefix: string, rows: readonly { id: string }[]) {
  const maximum = rows.reduce((max, row) => {
    const parsed = Number(row.id.match(/(\d+)$/)?.[1] ?? 0);
    return Math.max(max, Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(6, "0")}`;
}

export const reconciliationEngine = new ReconciliationEngine();
