import { normalizeTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { createJournal } from "@/payments/accounting-posting";
import { assertMinorAmount, majorFromMinor } from "@/payments/money";
import type { CustodyMovement, CustodyObligation, PaymentOperationsState } from "@/payments/types";

export class CustodyLedger {
  createObligation(
    state: TransactionState,
    input: {
      tenantId: string;
      branchId: string;
      orderId: string;
      invoiceId?: string;
      connectionId?: string;
      providerId?: string;
      externalOrderId?: string;
      currency: string;
      collectionMode: CustodyObligation["collectionMode"];
      amountDueMinor: number;
      merchantAmountDueMinor: number;
      marketplaceFeeDueMinor?: number;
      unclassifiedDueMinor?: number;
      custodyAccountId?: string;
      marketplacePayableAccountId?: string;
      suspenseAccountId?: string;
    },
  ) {
    assertMinorAmount(input.amountDueMinor);
    assertMinorAmount(input.merchantAmountDueMinor);
    assertMinorAmount(input.marketplaceFeeDueMinor ?? 0);
    assertMinorAmount(input.unclassifiedDueMinor ?? 0);
    if (input.amountDueMinor <= 0) throw new Error("Custody amount due must be positive");
    if (input.merchantAmountDueMinor < 0) throw new Error("Merchant amount due cannot be negative");
    const classifiedDue =
      input.merchantAmountDueMinor +
      (input.marketplaceFeeDueMinor ?? 0) +
      (input.unclassifiedDueMinor ?? 0);
    if (classifiedDue < input.amountDueMinor) {
      throw new Error("Custody obligation must classify the full customer amount due");
    }

    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const existing = operations.custodyObligations.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        ((input.externalOrderId &&
          candidate.connectionId === input.connectionId &&
          candidate.externalOrderId === input.externalOrderId) ||
          candidate.orderId === input.orderId),
    );
    if (existing) return next;

    const stamp = new Date().toISOString();
    const obligation: CustodyObligation = {
      id: nextId("CUST", operations.custodyObligations),
      tenantId: input.tenantId,
      branchId: input.branchId,
      orderId: input.orderId,
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.externalOrderId ? { externalOrderId: input.externalOrderId } : {}),
      currency: input.currency.toUpperCase(),
      collectionMode: input.collectionMode,
      amountDueMinor: input.amountDueMinor,
      merchantAmountDueMinor: input.merchantAmountDueMinor,
      marketplaceFeeDueMinor: input.marketplaceFeeDueMinor ?? 0,
      unclassifiedDueMinor: input.unclassifiedDueMinor ?? 0,
      collectedMinor: 0,
      merchantCollectedMinor: 0,
      marketplaceFeeCollectedMinor: 0,
      unclassifiedCollectedMinor: 0,
      remittedMinor: 0,
      paymentTransactionIds: [],
      ...(input.custodyAccountId ? { custodyAccountId: input.custodyAccountId } : {}),
      ...(input.marketplacePayableAccountId
        ? { marketplacePayableAccountId: input.marketplacePayableAccountId }
        : {}),
      ...(input.suspenseAccountId ? { suspenseAccountId: input.suspenseAccountId } : {}),
      status: "AWAITING_COLLECTION",
      createdAt: stamp,
      updatedAt: stamp,
    };
    operations.custodyObligations.unshift(obligation);
    return next;
  }

  assignRider(
    state: TransactionState,
    input: {
      tenantId: string;
      orderId: string;
      riderId?: string;
      riderName: string;
    },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const obligation = requiredOperations(next).custodyObligations.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.orderId === input.orderId &&
        !["CANCELLED", "REMITTED"].includes(candidate.status),
    );
    if (!obligation) return next;
    obligation.riderName = input.riderName.trim();
    if (input.riderId) obligation.riderId = input.riderId;
    obligation.updatedAt = new Date().toISOString();
    return next;
  }

  recordCustomerCollection(
    state: TransactionState,
    input: {
      tenantId: string;
      obligationId: string;
      amountMinor: number;
      merchantAppliedMinor: number;
      marketplaceFeeAppliedMinor: number;
      unclassifiedAppliedMinor: number;
      tender: CustodyMovement["tender"];
      actor: string;
      riderId?: string;
      riderName?: string;
      paymentTransactionId?: string;
      reference?: string;
      occurredAt?: string;
    },
  ) {
    for (const amount of [
      input.amountMinor,
      input.merchantAppliedMinor,
      input.marketplaceFeeAppliedMinor,
      input.unclassifiedAppliedMinor,
    ]) {
      assertMinorAmount(amount);
    }
    if (input.amountMinor <= 0) throw new Error("Collection amount must be positive");
    if (
      input.merchantAppliedMinor +
        input.marketplaceFeeAppliedMinor +
        input.unclassifiedAppliedMinor !==
      input.amountMinor
    ) {
      throw new Error("Every collected amount must be classified");
    }

    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const obligation = operations.custodyObligations.find(
      (candidate) => candidate.id === input.obligationId && candidate.tenantId === input.tenantId,
    );
    if (!obligation || ["CANCELLED", "REMITTED"].includes(obligation.status)) {
      throw new Error("Open custody obligation not found");
    }
    const customerRemaining = obligation.amountDueMinor - obligation.collectedMinor;
    const merchantRemaining = obligation.merchantAmountDueMinor - obligation.merchantCollectedMinor;
    const feeRemaining =
      obligation.marketplaceFeeDueMinor - obligation.marketplaceFeeCollectedMinor;
    const unclassifiedRemaining =
      obligation.unclassifiedDueMinor - obligation.unclassifiedCollectedMinor;
    if (
      input.amountMinor > customerRemaining ||
      input.merchantAppliedMinor > merchantRemaining ||
      input.marketplaceFeeAppliedMinor > feeRemaining ||
      input.unclassifiedAppliedMinor > unclassifiedRemaining
    ) {
      throw new Error("Collection exceeds the remaining custody obligation");
    }
    if (input.marketplaceFeeAppliedMinor > 0 && !obligation.marketplacePayableAccountId) {
      throw new Error("Marketplace payable account is required before collecting provider funds");
    }
    if (input.unclassifiedAppliedMinor > 0 && !obligation.suspenseAccountId) {
      throw new Error("Suspense account is required before collecting unclassified provider funds");
    }
    if (
      (input.marketplaceFeeAppliedMinor > 0 || input.unclassifiedAppliedMinor > 0) &&
      !obligation.custodyAccountId
    ) {
      throw new Error("Rider custody account is required before collecting provider funds");
    }

    const stamp = input.occurredAt ?? new Date().toISOString();
    const movement: CustodyMovement = Object.freeze({
      id: nextId("CUSTMOV", operations.custodyMovements),
      tenantId: input.tenantId,
      branchId: obligation.branchId,
      obligationId: obligation.id,
      orderId: obligation.orderId,
      ...((input.riderId ?? obligation.riderId)
        ? { riderId: input.riderId ?? obligation.riderId }
        : {}),
      ...((input.riderName ?? obligation.riderName)
        ? { riderName: input.riderName ?? obligation.riderName }
        : {}),
      type: "CUSTOMER_COLLECTION",
      tender: input.tender,
      fromHolder: "CUSTOMER",
      toHolder: "RIDER",
      ...(obligation.custodyAccountId ? { destinationAccountId: obligation.custodyAccountId } : {}),
      amountMinor: input.amountMinor,
      currency: obligation.currency,
      ...(input.reference ? { reference: input.reference.trim() } : {}),
      actor: input.actor,
      occurredAt: stamp,
      createdAt: new Date().toISOString(),
    });
    operations.custodyMovements.unshift(movement);

    obligation.collectedMinor += input.amountMinor;
    obligation.merchantCollectedMinor += input.merchantAppliedMinor;
    obligation.marketplaceFeeCollectedMinor += input.marketplaceFeeAppliedMinor;
    obligation.unclassifiedCollectedMinor += input.unclassifiedAppliedMinor;
    if (
      input.paymentTransactionId &&
      !obligation.paymentTransactionIds.includes(input.paymentTransactionId)
    ) {
      obligation.paymentTransactionIds.push(input.paymentTransactionId);
    }
    if (input.riderId) obligation.riderId = input.riderId;
    if (input.riderName) obligation.riderName = input.riderName;
    updateStatus(obligation);
    obligation.updatedAt = new Date().toISOString();

    if (input.merchantAppliedMinor > 0) {
      const receivable = next.marketplaceReceivables.find(
        (candidate) =>
          candidate.orderId === obligation.orderId &&
          candidate.tenantId === input.tenantId &&
          candidate.status !== "CANCELLED",
      );
      if (receivable) {
        const merchantAppliedMajor = majorFromMinor(
          input.merchantAppliedMinor,
          receivable.currency,
        );
        receivable.merchantCollectedAmount = Math.min(
          receivable.grossAmount,
          (receivable.merchantCollectedAmount ?? 0) + merchantAppliedMajor,
        );
        receivable.outstandingAmount = Math.max(
          0,
          receivable.grossAmount -
            (receivable.merchantCollectedAmount ?? 0) -
            receivable.settledAmount,
        );
        receivable.status =
          receivable.outstandingAmount === 0
            ? "SETTLED"
            : (receivable.merchantCollectedAmount ?? 0) > 0 || receivable.settledAmount > 0
              ? "PARTIALLY_SETTLED"
              : "OPEN";
        if (receivable.status === "SETTLED") receivable.settledAt = new Date().toISOString();
        receivable.updatedAt = new Date().toISOString();
      }
    }

    const nonMerchantMinor = input.marketplaceFeeAppliedMinor + input.unclassifiedAppliedMinor;
    if (nonMerchantMinor > 0) {
      const lines = [
        journalLine(obligation.custodyAccountId!, nonMerchantMinor, 0, obligation.currency, {
          custodyObligationId: obligation.id,
          custodyMovementId: movement.id,
        }),
        ...(input.marketplaceFeeAppliedMinor > 0
          ? [
              journalLine(
                obligation.marketplacePayableAccountId!,
                0,
                input.marketplaceFeeAppliedMinor,
                obligation.currency,
                { role: "marketplace-fee-payable", custodyObligationId: obligation.id },
              ),
            ]
          : []),
        ...(input.unclassifiedAppliedMinor > 0
          ? [
              journalLine(
                obligation.suspenseAccountId!,
                0,
                input.unclassifiedAppliedMinor,
                obligation.currency,
                { role: "unclassified-provider-funds", custodyObligationId: obligation.id },
              ),
            ]
          : []),
      ];
      operations.journals.unshift(
        createJournal({
          id: nextId("JRN4", operations.journals),
          tenantId: input.tenantId,
          branchId: obligation.branchId,
          sourceType: "CUSTODY_COLLECTION",
          sourceId: movement.id,
          businessDate: stamp.slice(0, 10),
          description: `Customer funds collected into rider custody for ${obligation.orderId}`,
          postedBy: input.actor,
          lines,
        }),
      );
    }
    return next;
  }

  recordDirectCompanyCollection(
    state: TransactionState,
    input: {
      tenantId: string;
      obligationId: string;
      amountMinor: number;
      merchantAppliedMinor: number;
      marketplaceFeeAppliedMinor: number;
      unclassifiedAppliedMinor: number;
      tender: CustodyMovement["tender"];
      toHolder: Extract<CustodyMovement["toHolder"], "CASH_DRAWER" | "MOBILE_MONEY_TILL" | "BANK">;
      destinationAccountId: string;
      actor: string;
      paymentTransactionId?: string;
      reference?: string;
      occurredAt?: string;
    },
  ) {
    for (const amount of [
      input.amountMinor,
      input.merchantAppliedMinor,
      input.marketplaceFeeAppliedMinor,
      input.unclassifiedAppliedMinor,
    ]) {
      assertMinorAmount(amount);
    }
    if (input.amountMinor <= 0) throw new Error("Collection amount must be positive");
    if (!input.destinationAccountId.trim()) throw new Error("Destination account is required");
    if (
      input.merchantAppliedMinor +
        input.marketplaceFeeAppliedMinor +
        input.unclassifiedAppliedMinor !==
      input.amountMinor
    ) {
      throw new Error("Every collected amount must be classified");
    }

    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const obligation = operations.custodyObligations.find(
      (candidate) => candidate.id === input.obligationId && candidate.tenantId === input.tenantId,
    );
    if (!obligation || ["CANCELLED", "REMITTED"].includes(obligation.status)) {
      throw new Error("Open custody obligation not found");
    }

    const customerRemaining = obligation.amountDueMinor - obligation.collectedMinor;
    const merchantRemaining = obligation.merchantAmountDueMinor - obligation.merchantCollectedMinor;
    const feeRemaining =
      obligation.marketplaceFeeDueMinor - obligation.marketplaceFeeCollectedMinor;
    const unclassifiedRemaining =
      obligation.unclassifiedDueMinor - obligation.unclassifiedCollectedMinor;
    if (
      input.amountMinor > customerRemaining ||
      input.merchantAppliedMinor > merchantRemaining ||
      input.marketplaceFeeAppliedMinor > feeRemaining ||
      input.unclassifiedAppliedMinor > unclassifiedRemaining
    ) {
      throw new Error("Collection exceeds the remaining custody obligation");
    }
    if (input.marketplaceFeeAppliedMinor > 0 && !obligation.marketplacePayableAccountId) {
      throw new Error("Marketplace payable account is required before collecting provider funds");
    }
    if (input.unclassifiedAppliedMinor > 0 && !obligation.suspenseAccountId) {
      throw new Error("Suspense account is required before collecting unclassified provider funds");
    }

    const stamp = input.occurredAt ?? new Date().toISOString();
    const movement: CustodyMovement = Object.freeze({
      id: nextId("CUSTMOV", operations.custodyMovements),
      tenantId: input.tenantId,
      branchId: obligation.branchId,
      obligationId: obligation.id,
      orderId: obligation.orderId,
      type: "CUSTOMER_COLLECTION",
      tender: input.tender,
      fromHolder: "CUSTOMER",
      toHolder: input.toHolder,
      destinationAccountId: input.destinationAccountId,
      amountMinor: input.amountMinor,
      currency: obligation.currency,
      ...(input.reference ? { reference: input.reference.trim() } : {}),
      actor: input.actor,
      occurredAt: stamp,
      createdAt: new Date().toISOString(),
    });
    operations.custodyMovements.unshift(movement);

    obligation.collectedMinor += input.amountMinor;
    obligation.merchantCollectedMinor += input.merchantAppliedMinor;
    obligation.marketplaceFeeCollectedMinor += input.marketplaceFeeAppliedMinor;
    obligation.unclassifiedCollectedMinor += input.unclassifiedAppliedMinor;
    obligation.remittedMinor += input.amountMinor;
    if (
      input.paymentTransactionId &&
      !obligation.paymentTransactionIds.includes(input.paymentTransactionId)
    ) {
      obligation.paymentTransactionIds.push(input.paymentTransactionId);
    }
    updateStatus(obligation);
    obligation.updatedAt = new Date().toISOString();

    if (input.merchantAppliedMinor > 0) {
      const receivable = next.marketplaceReceivables.find(
        (candidate) =>
          candidate.orderId === obligation.orderId &&
          candidate.tenantId === input.tenantId &&
          candidate.status !== "CANCELLED",
      );
      if (receivable) {
        const merchantAppliedMajor = majorFromMinor(
          input.merchantAppliedMinor,
          receivable.currency,
        );
        receivable.merchantCollectedAmount = Math.min(
          receivable.grossAmount,
          (receivable.merchantCollectedAmount ?? 0) + merchantAppliedMajor,
        );
        receivable.outstandingAmount = Math.max(
          0,
          receivable.grossAmount -
            (receivable.merchantCollectedAmount ?? 0) -
            receivable.settledAmount,
        );
        receivable.status =
          receivable.outstandingAmount === 0
            ? "SETTLED"
            : (receivable.merchantCollectedAmount ?? 0) > 0 || receivable.settledAmount > 0
              ? "PARTIALLY_SETTLED"
              : "OPEN";
        if (receivable.status === "SETTLED") receivable.settledAt = stamp;
        receivable.updatedAt = stamp;
      }
    }

    const nonMerchantMinor = input.marketplaceFeeAppliedMinor + input.unclassifiedAppliedMinor;
    if (nonMerchantMinor > 0) {
      const lines = [
        journalLine(input.destinationAccountId, nonMerchantMinor, 0, obligation.currency, {
          custodyObligationId: obligation.id,
          custodyMovementId: movement.id,
          collectionPurpose: "DIRECT_COMPANY_COLLECTION",
        }),
        ...(input.marketplaceFeeAppliedMinor > 0
          ? [
              journalLine(
                obligation.marketplacePayableAccountId!,
                0,
                input.marketplaceFeeAppliedMinor,
                obligation.currency,
                { role: "marketplace-fee-payable", custodyObligationId: obligation.id },
              ),
            ]
          : []),
        ...(input.unclassifiedAppliedMinor > 0
          ? [
              journalLine(
                obligation.suspenseAccountId!,
                0,
                input.unclassifiedAppliedMinor,
                obligation.currency,
                { role: "unclassified-provider-funds", custodyObligationId: obligation.id },
              ),
            ]
          : []),
      ];
      operations.journals.unshift(
        createJournal({
          id: nextId("JRN4", operations.journals),
          tenantId: input.tenantId,
          branchId: obligation.branchId,
          sourceType: "CUSTODY_COLLECTION",
          sourceId: movement.id,
          businessDate: stamp.slice(0, 10),
          description: `Customer funds collected directly by company for ${obligation.orderId}`,
          postedBy: input.actor,
          lines,
        }),
      );
    }
    return next;
  }

  recordRemittance(
    state: TransactionState,
    input: {
      tenantId: string;
      obligationId: string;
      amountMinor: number;
      tender: CustodyMovement["tender"];
      toHolder: Extract<
        CustodyMovement["toHolder"],
        "CASH_DRAWER" | "MOBILE_MONEY_TILL" | "BANK" | "OTHER"
      >;
      destinationAccountId: string;
      actor: string;
      reference?: string;
      occurredAt?: string;
    },
  ) {
    assertMinorAmount(input.amountMinor);
    if (input.amountMinor <= 0) throw new Error("Remittance amount must be positive");
    if (!input.destinationAccountId.trim()) throw new Error("Destination account is required");

    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const operations = requiredOperations(next);
    const obligation = operations.custodyObligations.find(
      (candidate) => candidate.id === input.obligationId && candidate.tenantId === input.tenantId,
    );
    if (!obligation || ["CANCELLED"].includes(obligation.status)) {
      throw new Error("Custody obligation not found");
    }
    if (!obligation.custodyAccountId) {
      throw new Error("Rider custody account is required before remittance");
    }
    const remaining = obligation.collectedMinor - obligation.remittedMinor;
    if (input.amountMinor > remaining) {
      throw new Error("Remittance exceeds rider-held funds");
    }
    const stamp = input.occurredAt ?? new Date().toISOString();
    const movement: CustodyMovement = Object.freeze({
      id: nextId("CUSTMOV", operations.custodyMovements),
      tenantId: input.tenantId,
      branchId: obligation.branchId,
      obligationId: obligation.id,
      orderId: obligation.orderId,
      ...(obligation.riderId ? { riderId: obligation.riderId } : {}),
      ...(obligation.riderName ? { riderName: obligation.riderName } : {}),
      type:
        input.toHolder === "CASH_DRAWER"
          ? "CASHIER_HANDOVER"
          : input.toHolder === "MOBILE_MONEY_TILL"
            ? "TILL_TRANSFER"
            : input.toHolder === "BANK"
              ? "BANK_DEPOSIT"
              : "RIDER_REMITTANCE",
      tender: input.tender,
      fromHolder: "RIDER",
      toHolder: input.toHolder,
      sourceAccountId: obligation.custodyAccountId,
      destinationAccountId: input.destinationAccountId,
      amountMinor: input.amountMinor,
      currency: obligation.currency,
      ...(input.reference ? { reference: input.reference.trim() } : {}),
      actor: input.actor,
      occurredAt: stamp,
      createdAt: new Date().toISOString(),
    });
    operations.custodyMovements.unshift(movement);
    obligation.remittedMinor += input.amountMinor;
    updateStatus(obligation);
    obligation.updatedAt = new Date().toISOString();

    operations.journals.unshift(
      createJournal({
        id: nextId("JRN4", operations.journals),
        tenantId: input.tenantId,
        branchId: obligation.branchId,
        sourceType: "CUSTODY_REMITTANCE",
        sourceId: movement.id,
        businessDate: stamp.slice(0, 10),
        description: `Rider custody remitted for ${obligation.orderId}`,
        postedBy: input.actor,
        lines: [
          journalLine(input.destinationAccountId, input.amountMinor, 0, obligation.currency, {
            custodyMovementId: movement.id,
            toHolder: input.toHolder,
          }),
          journalLine(obligation.custodyAccountId, 0, input.amountMinor, obligation.currency, {
            custodyMovementId: movement.id,
            fromHolder: "RIDER",
          }),
        ],
      }),
    );

    if (obligation.remittedMinor >= obligation.merchantCollectedMinor) {
      const collectionState =
        input.toHolder === "BANK"
          ? ("IN_BANK" as const)
          : input.toHolder === "CASH_DRAWER"
            ? ("IN_HAND" as const)
            : ("IN_CLEARING" as const);
      operations.collections = operations.collections.map((collection) =>
        obligation.paymentTransactionIds.includes(collection.paymentTransactionId)
          ? Object.freeze({
              ...collection,
              collectionState,
              ...(collectionState === "IN_BANK" ? { settledAt: stamp } : {}),
            })
          : collection,
      );
    }
    return next;
  }

  cancelObligation(
    state: TransactionState,
    input: { tenantId: string; orderId: string; actor: string; reason: string },
  ) {
    const next = normalizeTransactionState(state);
    assertTenant(next, input.tenantId);
    const obligation = requiredOperations(next).custodyObligations.find(
      (candidate) => candidate.tenantId === input.tenantId && candidate.orderId === input.orderId,
    );
    if (!obligation) return next;
    if (obligation.collectedMinor > 0 || obligation.remittedMinor > 0) {
      obligation.status = "DISPUTED";
    } else {
      obligation.status = "CANCELLED";
    }
    obligation.updatedAt = new Date().toISOString();
    return next;
  }
}

function updateStatus(obligation: CustodyObligation) {
  if (["CANCELLED", "DISPUTED"].includes(obligation.status)) return;
  if (
    obligation.collectedMinor >= obligation.amountDueMinor &&
    obligation.remittedMinor >= obligation.collectedMinor
  ) {
    obligation.status = "REMITTED";
  } else if (
    obligation.remittedMinor > 0 &&
    obligation.remittedMinor < obligation.collectedMinor
  ) {
    obligation.status = "PARTIALLY_REMITTED";
  } else if (obligation.collectedMinor >= obligation.amountDueMinor) {
    obligation.status = "COLLECTED";
  } else if (obligation.collectedMinor > 0) {
    obligation.status = "PARTIALLY_COLLECTED";
  } else {
    obligation.status = "AWAITING_COLLECTION";
  }
}

function requiredOperations(state: TransactionState) {
  if (!state.paymentOperations) throw new Error("Payment operations state was not initialized");
  return state.paymentOperations;
}

function assertTenant(state: TransactionState, tenantId: string) {
  if ((state.tenantId ?? tenantId) !== tenantId) throw new Error("Tenant scope violation");
}

function journalLine(
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

function nextId(prefix: string, rows: readonly { id: string }[]) {
  const maximum = rows.reduce((max, row) => {
    const parsed = Number(row.id.match(/(\d+)$/)?.[1] ?? 0);
    return Math.max(max, Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(6, "0")}`;
}

export const custodyLedger = new CustodyLedger();
