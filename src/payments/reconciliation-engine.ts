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
  ReconciliationRule,
  SettlementBatch,
  SettlementLine,
  SettlementLineType,
} from "@/payments/types";

export type SettlementAccountMappings = {
  bankAccountId: string;
  marketplaceReceivableAccountId: string;
  marketplacePayableAccountId?: string;
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

  upsertRule(
    state: TransactionState,
    input: Omit<ReconciliationRule, "createdAt" | "updatedAt"> & { createdAt?: string },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    validateRule(input);
    const operations = requiredOperations(next);
    const stamp = new Date().toISOString();
    const existing = operations.reconciliationRules.find(
      (rule) => rule.id === input.id && rule.tenantId === input.tenantId,
    );
    const rule: ReconciliationRule = {
      ...input,
      createdAt: existing?.createdAt ?? input.createdAt ?? stamp,
      updatedAt: stamp,
    };
    if (existing) {
      operations.reconciliationRules = operations.reconciliationRules.map((candidate) =>
        candidate.id === rule.id ? rule : candidate,
      );
    } else {
      operations.reconciliationRules.unshift(rule);
    }
    return next;
  }

  setRuleActive(
    state: TransactionState,
    input: { tenantId: string; ruleId: string; active: boolean },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const rule = operations.reconciliationRules.find(
      (candidate) => candidate.id === input.ruleId && candidate.tenantId === input.tenantId,
    );
    if (!rule) throw new Error("Reconciliation rule not found");
    rule.active = input.active;
    rule.updatedAt = new Date().toISOString();
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

    const candidates = operations.transactions.filter(
      (transaction) =>
        transaction.tenantId === input.tenantId &&
        transaction.direction === "COLLECTION" &&
        ["CONFIRMED", "MANUALLY_CONFIRMED", "UNVERIFIED", "VERIFYING"].includes(
          transaction.status,
        ) &&
        !operations.collections.some(
          (collection) =>
            collection.paymentTransactionId === transaction.id &&
            collection.collectionState === "IN_CUSTODY",
        ) &&
        (!input.branchId || transaction.branchId === input.branchId),
    );

    for (const payment of candidates) {
      let remaining = paymentResidualMinor(operations, payment.id, payment.amountMinor);
      let guard = 0;
      while (remaining > 0 && guard < Math.max(operations.bankTransactions.length, 1) + 1) {
        guard += 1;
        const ranked = operations.bankTransactions
          .filter((bank) => {
            if (
              bank.tenantId !== input.tenantId ||
              bank.currency !== payment.currency ||
              ["DUPLICATE", "IGNORED"].includes(bank.status) ||
              (input.branchId && bank.branchId && bank.branchId !== input.branchId)
            ) {
              return false;
            }
            const bankRemaining = bankResidualMinor(operations, bank.id, Math.abs(bank.amountMinor));
            if (bankRemaining <= 0) return false;
            const rule = ruleFor(operations, payment, bank, input.timeWindowMinutes);
            if (bankRemaining > remaining && !rule.allowAggregation) return false;
            if (remaining > bankRemaining && !rule.allowSplit) return false;
            return !operations.matches.some(
              (match) =>
                match.leftId === payment.id &&
                match.rightId === bank.id &&
                match.status === "SUGGESTED",
            );
          })
          .map((bank) => {
            const bankRemaining = bankResidualMinor(operations, bank.id, Math.abs(bank.amountMinor));
            return scoreMatch(
              payment,
              bank,
              remaining,
              bankRemaining,
              operations,
              input.timeWindowMinutes,
            );
          })
          .sort((left, right) => right.score - left.score);

        const best = ranked[0];
        const second = ranked[1];
        if (!best) break;
        const confidence = confidenceFor(best, second?.score ?? 0);
        if (confidence === "UNMATCHED") break;

        const amountMinor = Math.min(remaining, best.bankRemainingMinor);
        if (amountMinor <= 0) break;
        const verified = ["CONFIRMED", "MANUALLY_CONFIRMED"].includes(payment.status);
        const autoApprove =
          verified &&
          ["EXACT", "HIGH"].includes(confidence) &&
          best.score >= best.rule.minimumAutoApproveScore &&
          best.score - (second?.score ?? 0) >= best.rule.minimumLeadScore &&
          (!best.rule.requireExactReferenceForAutoApprove || best.exactReference);

        const match: PaymentMatch = Object.freeze({
          id: nextId("MATCH4", operations.matches),
          tenantId: input.tenantId,
          branchId: payment.branchId,
          reconciliationSessionId: session.id,
          leftType: "PAYMENT_TRANSACTION",
          leftId: payment.id,
          rightType: "BANK_TRANSACTION",
          rightId: best.bank.id,
          amountMinor,
          currency: payment.currency,
          confidence,
          status: autoApprove ? "APPROVED" : "SUGGESTED",
          matchedBy: "SYSTEM",
          reason: best.reason,
          createdAt: stamp,
        });
        operations.matches.unshift(match);

        if (!autoApprove) break;

        const bankAfter = bankResidualMinor(
          operations,
          best.bank.id,
          Math.abs(best.bank.amountMinor),
        );
        replaceBank(operations, best.bank.id, {
          ...best.bank,
          status: bankAfter === 0 ? "MATCHED" : "PARTIAL",
        });
        postPaymentBankReconciliation(operations, {
          matchId: match.id,
          paymentTransactionId: payment.id,
          bankTransactionId: best.bank.id,
          bankAccountId: best.bank.accountId,
          amountMinor: match.amountMinor,
          currency: match.currency,
          businessDate: input.businessDate,
          actor: "SYSTEM",
        });
        remaining = paymentResidualMinor(operations, payment.id, payment.amountMinor);
      }

      const residual = paymentResidualMinor(operations, payment.id, payment.amountMinor);
      if (residual > 0) {
        addException(operations, {
          tenantId: input.tenantId,
          branchId: payment.branchId,
          sourceType: "PAYMENT",
          sourceId: payment.id,
          reason: "OTHER",
          amountMinor: residual,
          currency: payment.currency,
          severity: "WARNING",
          detail: "Collection has an unreconciled residual after automatic matching",
        });
      } else {
        resolveResidualException(operations, "PAYMENT", payment.id);
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
    if (input.amountMinor <= 0) throw new Error("Manual reconciliation amount must be positive");
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
    const paymentRemaining = paymentResidualMinor(operations, payment.id, payment.amountMinor);
    const bankRemaining = bankResidualMinor(operations, bank.id, Math.abs(bank.amountMinor));
    if (input.amountMinor > paymentRemaining || input.amountMinor > bankRemaining) {
      throw new Error("Manual match amount exceeds the remaining payment or bank balance");
    }
    const match: PaymentMatch = Object.freeze({
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
    });
    operations.matches.unshift(match);
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
    const bankAfter = bankResidualMinor(operations, bank.id, Math.abs(bank.amountMinor));
    replaceBank(operations, bank.id, {
      ...bank,
      status: bankAfter === 0 ? "MATCHED" : "PARTIAL",
    });
    postPaymentBankReconciliation(operations, {
      matchId: match.id,
      paymentTransactionId: payment.id,
      bankTransactionId: bank.id,
      bankAccountId: bank.accountId,
      amountMinor: input.amountMinor,
      currency: payment.currency,
      businessDate: bank.date.slice(0, 10),
      actor: input.actor,
    });
    if (paymentResidualMinor(operations, payment.id, payment.amountMinor) === 0) {
      resolveResidualException(operations, "PAYMENT", payment.id);
    }
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
      amountMinor?: number;
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

    const settlementRemaining = Math.max(
      0,
      batch.netExpectedMinor -
        approvedMatchedMinor(operations, "SETTLEMENT", batch.id, "left"),
    );
    const bankRemaining = bankResidualMinor(operations, bank.id, Math.abs(bank.amountMinor));
    const amountMinor = input.amountMinor ?? Math.min(settlementRemaining, bankRemaining);
    assertMinorAmount(amountMinor);
    if (amountMinor <= 0) throw new Error("Settlement match has no remaining amount");
    if (amountMinor > settlementRemaining || amountMinor > bankRemaining) {
      throw new Error("Settlement match exceeds the remaining settlement or bank balance");
    }

    const session =
      operations.reconciliationSessions.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.type === "SETTLEMENT" &&
          candidate.businessDate === batch.periodEnd &&
          candidate.status !== "REVERSED",
      ) ??
      ({
        id: nextId("RECON", operations.reconciliationSessions),
        tenantId: input.tenantId,
        ...(batch.branchId ? { branchId: batch.branchId } : {}),
        type: "SETTLEMENT" as const,
        businessDate: batch.periodEnd,
        status: "MATCHING" as const,
        createdBy: input.actor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies ReconciliationSession);
    if (!operations.reconciliationSessions.some((candidate) => candidate.id === session.id)) {
      operations.reconciliationSessions.unshift(session);
    }

    const match: PaymentMatch = Object.freeze({
      id: nextId("MATCH4", operations.matches),
      tenantId: input.tenantId,
      ...(batch.branchId ? { branchId: batch.branchId } : {}),
      reconciliationSessionId: session.id,
      leftType: "SETTLEMENT",
      leftId: batch.id,
      rightType: "BANK_TRANSACTION",
      rightId: bank.id,
      amountMinor,
      currency: batch.currency,
      confidence: amountMinor === settlementRemaining && amountMinor === bankRemaining ? "EXACT" : "HIGH",
      status: "APPROVED",
      matchedBy: input.actor === "SYSTEM" ? "SYSTEM" : "MANUAL",
      ...(input.actor === "SYSTEM" ? {} : { approvedBy: input.actor }),
      reason: "Settlement allocated against remaining bank balance",
      createdAt: new Date().toISOString(),
    });
    operations.matches.unshift(match);

    batch.bankTransactionId ??= bank.id;
    batch.netSettledMinor = approvedMatchedMinor(operations, "SETTLEMENT", batch.id, "left");
    const settlementAfter = Math.max(0, batch.netExpectedMinor - batch.netSettledMinor);
    batch.status = settlementAfter === 0 ? "MATCHED" : "MATCHING";
    batch.updatedAt = new Date().toISOString();

    const bankAfter = bankResidualMinor(operations, bank.id, Math.abs(bank.amountMinor));
    replaceBank(operations, bank.id, {
      ...bank,
      status: bankAfter === 0 ? "MATCHED" : "PARTIAL",
    });
    if (settlementAfter === 0) resolveResidualException(operations, "SETTLEMENT", batch.id);
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
        batch.grossSalesMinor - (batch.merchantCollectionsMinor ?? 0),
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
      const platformExpected =
        receivable.platformExpectedAmount ?? receivable.externallyCollectedAmount;
      const merchantCollected = receivable.merchantCollectedAmount ?? 0;
      receivable.settledAmount = Math.min(
        platformExpected,
        receivable.settledAmount + settledMajor,
      );
      receivable.outstandingAmount = Math.max(
        0,
        receivable.grossAmount - merchantCollected - receivable.settledAmount,
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
  paymentRemainingMinor: number,
  bankRemainingMinor: number,
  operations: PaymentOperationsState,
  overrideTimeWindowMinutes?: number,
) {
  const rule = ruleFor(operations, payment, bank, overrideTimeWindowMinutes);
  const references = [
    payment.providerTransactionId,
    payment.customerReference,
    payment.merchantReference,
  ]
    .filter(Boolean)
    .map((value) => normalizeReference(String(value)));
  const bankReferences = [
    bank.externalTransactionId,
    bank.reference,
    bank.rawReference,
    bank.description,
  ]
    .filter(Boolean)
    .map((value) => normalizeReference(String(value)));
  const exactReference = references.some((reference) =>
    bankReferences.some((candidate) => candidate === reference),
  );
  const containsReference =
    !exactReference &&
    references.some((reference) =>
      bankReferences.some(
        (candidate) =>
          reference.length >= 5 &&
          candidate.length >= 5 &&
          (candidate.includes(reference) || reference.includes(candidate)),
      ),
    );
  const amountDifference = Math.abs(paymentRemainingMinor - bankRemainingMinor);
  const amountMatches = amountDifference <= rule.amountToleranceMinor;
  const paymentTime = Date.parse(payment.occurredAt);
  const bankTime = Date.parse(bank.date);
  const minutes =
    Number.isFinite(paymentTime) && Number.isFinite(bankTime)
      ? Math.abs(paymentTime - bankTime) / 60000
      : Number.POSITIVE_INFINITY;
  const timeMatches = minutes <= rule.timeWindowMinutes;
  const score =
    (exactReference
      ? rule.exactReferenceWeight
      : containsReference
        ? rule.containedReferenceWeight
        : 0) +
    (amountMatches ? rule.amountWeight : 0) +
    (timeMatches ? rule.timeWeight : 0);
  return {
    bank,
    bankRemainingMinor,
    score,
    exactReference,
    amountMatches,
    rule,
    reason: `${exactReference ? "exact reference" : containsReference ? "reference contained" : "no reference"}; ${amountMatches ? "residual amount matched" : `residual differed by ${amountDifference}`}; ${Number.isFinite(minutes) ? Math.round(minutes) : "unknown"} minutes apart; rule ${rule.name}`,
  };
}

type ScoredMatch = ReturnType<typeof scoreMatch>;

function confidenceFor(best: ScoredMatch, second: number): PaymentMatch["confidence"] {
  const lead = best.score - second;
  if (
    best.exactReference &&
    best.amountMatches &&
    best.score >= best.rule.minimumAutoApproveScore &&
    lead >= best.rule.minimumLeadScore
  ) {
    return "EXACT";
  }
  if (
    best.score >= best.rule.minimumAutoApproveScore &&
    lead >= best.rule.minimumLeadScore
  ) {
    return "HIGH";
  }
  if (best.score >= best.rule.minimumSuggestionScore) return "POSSIBLE";
  return "UNMATCHED";
}

function ruleFor(
  operations: PaymentOperationsState,
  payment: PaymentOperationsState["transactions"][number],
  bank: BankTransaction,
  overrideTimeWindowMinutes?: number,
): ReconciliationRule {
  const candidates = operations.reconciliationRules
    .filter(
      (rule) =>
        rule.active &&
        rule.tenantId === payment.tenantId &&
        (!rule.branchId || rule.branchId === payment.branchId) &&
        (!rule.providerConnectionId ||
          rule.providerConnectionId === payment.providerConnectionId ||
          rule.providerConnectionId === bank.providerConnectionId) &&
        (!rule.bankAccountId || rule.bankAccountId === bank.accountId),
    )
    .sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left));
  const configured = candidates[0];
  if (configured) {
    return overrideTimeWindowMinutes === undefined
      ? configured
      : { ...configured, timeWindowMinutes: overrideTimeWindowMinutes };
  }
  return defaultRule(payment.tenantId, payment.branchId, overrideTimeWindowMinutes);
}

function defaultRule(
  tenantId: string,
  branchId?: string,
  timeWindowMinutes = 180,
): ReconciliationRule {
  const stamp = new Date(0).toISOString();
  return {
    id: "SYSTEM-DEFAULT",
    tenantId,
    ...(branchId ? { branchId } : {}),
    name: "System safe default",
    active: true,
    timeWindowMinutes,
    amountToleranceMinor: 0,
    exactReferenceWeight: 75,
    containedReferenceWeight: 45,
    amountWeight: 25,
    timeWeight: 5,
    minimumSuggestionScore: 50,
    minimumAutoApproveScore: 75,
    minimumLeadScore: 20,
    requireExactReferenceForAutoApprove: false,
    allowSplit: true,
    allowAggregation: true,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function ruleSpecificity(rule: ReconciliationRule) {
  return Number(Boolean(rule.branchId)) * 4 +
    Number(Boolean(rule.providerConnectionId)) * 2 +
    Number(Boolean(rule.bankAccountId));
}

function validateRule(
  rule: Omit<ReconciliationRule, "createdAt" | "updatedAt"> & { createdAt?: string },
) {
  if (!rule.id.trim() || !rule.name.trim()) throw new Error("Reconciliation rule id and name are required");
  const nonNegative = [
    rule.timeWindowMinutes,
    rule.amountToleranceMinor,
    rule.exactReferenceWeight,
    rule.containedReferenceWeight,
    rule.amountWeight,
    rule.timeWeight,
    rule.minimumSuggestionScore,
    rule.minimumAutoApproveScore,
    rule.minimumLeadScore,
  ];
  if (nonNegative.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Reconciliation rule numeric values must be non-negative safe integers");
  }
  if (rule.minimumAutoApproveScore < rule.minimumSuggestionScore) {
    throw new Error("Auto-approve score cannot be below suggestion score");
  }
}

function normalizeReference(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function approvedMatchedMinor(
  operations: PaymentOperationsState,
  type: PaymentMatch["leftType"] | PaymentMatch["rightType"],
  id: string,
  side: "left" | "right",
) {
  return sumMinor(
    operations.matches
      .filter(
        (match) =>
          match.status === "APPROVED" &&
          (side === "left"
            ? match.leftType === type && match.leftId === id
            : match.rightType === type && match.rightId === id),
      )
      .map((match) => match.amountMinor),
  );
}

function paymentResidualMinor(
  operations: PaymentOperationsState,
  paymentId: string,
  amountMinor: number,
) {
  return Math.max(
    0,
    amountMinor -
      approvedMatchedMinor(operations, "PAYMENT_TRANSACTION", paymentId, "left"),
  );
}

function bankResidualMinor(
  operations: PaymentOperationsState,
  bankId: string,
  amountMinor: number,
) {
  return Math.max(
    0,
    amountMinor - approvedMatchedMinor(operations, "BANK_TRANSACTION", bankId, "right"),
  );
}

function resolveResidualException(
  operations: PaymentOperationsState,
  sourceType: ReconciliationException["sourceType"],
  sourceId: string,
) {
  const stamp = new Date().toISOString();
  for (const exception of operations.exceptions) {
    if (
      exception.sourceType === sourceType &&
      exception.sourceId === sourceId &&
      exception.reason === "OTHER" &&
      exception.status === "OPEN" &&
      exception.detail.includes("unreconciled residual")
    ) {
      exception.status = "RESOLVED";
      exception.resolvedAt = stamp;
      exception.resolvedBy = "SYSTEM";
      exception.resolution = "Residual fully reconciled";
    }
  }
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
  const merchantCollectionsMinor = total("MERCHANT_COLLECTION");
  const marketplacePayableOffsetsMinor = total("MARKETPLACE_PAYABLE_OFFSET");
  const otherAdjustmentsMinor = total("OTHER_ADJUSTMENT");
  return {
    grossSalesMinor,
    commissionsMinor,
    serviceFeesMinor,
    deliveryAdjustmentsMinor,
    promotionsMinor,
    refundsMinor,
    taxAdjustmentsMinor,
    merchantCollectionsMinor,
    marketplacePayableOffsetsMinor,
    otherAdjustmentsMinor,
    totalDeductionsMinor:
      commissionsMinor +
      serviceFeesMinor +
      deliveryAdjustmentsMinor +
      promotionsMinor +
      refundsMinor +
      taxAdjustmentsMinor +
      merchantCollectionsMinor +
      marketplacePayableOffsetsMinor +
      otherAdjustmentsMinor,
  };
}

function deductionJournalLines(
  lines: SettlementLine[],
  currency: string,
  accounts: SettlementAccountMappings,
) {
  const expenseMapping: Partial<Record<SettlementLineType, string>> = {
    COMMISSION: accounts.commissionExpenseAccountId,
    SERVICE_FEE: accounts.serviceFeeExpenseAccountId,
    DELIVERY_ADJUSTMENT: accounts.deliveryAdjustmentAccountId,
    PROMOTION: accounts.promotionExpenseAccountId,
    REFUND: accounts.refundExpenseAccountId,
    TAX_ADJUSTMENT: accounts.taxAdjustmentAccountId,
    OTHER_ADJUSTMENT: accounts.otherAdjustmentAccountId,
  };
  return lines.flatMap((item) => {
    if (item.type === "GROSS_SALE" || item.type === "MERCHANT_COLLECTION") return [];
    if (item.type === "MARKETPLACE_PAYABLE_OFFSET") {
      if (!accounts.marketplacePayableAccountId) {
        throw new Error("Marketplace payable account is required for payable settlement offsets");
      }
      return [
        line(accounts.marketplacePayableAccountId, item.amountMinor, 0, currency, {
          settlementLineId: item.id,
          type: item.type,
        }),
      ];
    }
    const accountId = expenseMapping[item.type];
    if (!accountId) throw new Error(`No settlement account mapping for ${item.type}`);
    return [
      line(accountId, item.amountMinor, 0, currency, {
        settlementLineId: item.id,
        type: item.type,
      }),
    ];
  });
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
    matchId: string;
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
  const sourceId = input.matchId;
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
