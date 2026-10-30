import { createFileRoute } from "@tanstack/react-router";
import { FileUp, RefreshCcw, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { businessDateForTimestamp } from "@/lib/business-date";
import { formatMinor, majorFromMinor, parseMajorAmount, sumMinor } from "@/payments/money";
import type { SettlementAccountMappings } from "@/payments/reconciliation-engine";
import {
  genericBankStatementAdapter,
  genericSettlementAdapter,
  type NormalizedBankStatementRow,
  type NormalizedSettlementImport,
  type StatementPreview,
} from "@/payments/statement-adapters";
import type { PaymentTransaction } from "@/payments/types";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { cn } from "@/lib/utils";
import { projectFinancialLifecycle } from "@/lib/financial-lifecycle";
import { recordBusinessDate } from "@/lib/pos-workflow";
import { DailyClosingPanel } from "@/components/app/DailyClosingPanel";
import { MpesaPrompts, MpesaToMatch } from "@/components/app/MpesaToMatch";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { closingPolicy } from "@/payments/daily-closing";

export const Route = createFileRoute("/payment-control")({
  head: () => ({
    meta: [
      { title: "Payment Control Centre - Seramet" },
      {
        name: "description",
        content: "Payment, settlement, cash drawer, bank and EOD reconciliation operations.",
      },
    ],
  }),
  component: PaymentControlCentre,
});

const tabs = [
  "Payments",
  "M-Pesa",
  "Unmatched",
  "Settlements",
  "Cash Drawers",
  "Bank",
  "Refunds",
  "Reconciliation",
  "EOD",
] as const;
type Tab = (typeof tabs)[number];

function PaymentControlCentre() {
  const engine = useTransactionEngine();
  const { state, mutate: mutateTransaction, syncFromBackend } = engine;
  const {
    activeTenantId,
    branchId,
    branchLabel,
    branchRecords,
    currentUser,
    hasPermission,
    isAllBranches,
    timeZone,
  } = useAppContext();
  const activeBranch = branchRecords.find((candidate) => candidate.id === branchId);
  const activeTimeZone = activeBranch?.timezone ?? timeZone;
  const activeCutoffMinutes = Number(activeBranch?.metadata["businessDayCutoffMinutes"] ?? 0);
  const currentBusinessDate = businessDateForTimestamp(
    new Date(),
    activeTimeZone,
    activeCutoffMinutes,
  );
  const [tab, setTab] = useState<Tab>("Payments");
  const [periodDate, setPeriodDate] = useState(currentBusinessDate);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTransactionId, setSelectedTransactionId] = useState("");
  const [openingFloat, setOpeningFloat] = useState("5000");
  const [manualPaymentId, setManualPaymentId] = useState("");
  const [manualBankId, setManualBankId] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [bankPreview, setBankPreview] =
    useState<StatementPreview<NormalizedBankStatementRow> | null>(null);
  const [settlementPreview, setSettlementPreview] =
    useState<StatementPreview<NormalizedSettlementImport> | null>(null);
  const operations = state.paymentOperations;
  const configuration = getConfigurationRepository();
  useEffect(() => setPeriodDate(currentBusinessDate), [branchId, currentBusinessDate]);
  const currency = configuration.getTenant(activeTenantId).defaultCurrency;
  const scoped = useCallback(
    <T extends { tenantId: string; branchId?: string }>(rows: T[]) =>
      rows.filter(
        (row) =>
          row.tenantId === activeTenantId &&
          (isAllBranches || !row.branchId || row.branchId === branchId),
      ),
    [activeTenantId, branchId, isAllBranches],
  );
  const operationBusinessDate = useCallback(
    (timestamp: string, operationBranchId: string) => {
      const record = branchRecords.find((candidate) => candidate.id === operationBranchId);
      return recordBusinessDate(
        undefined,
        timestamp,
        record?.timezone ?? timeZone,
        Number(record?.metadata["businessDayCutoffMinutes"] ?? 0),
      );
    },
    [branchRecords, timeZone],
  );
  const transactions = useMemo(
    () =>
      scoped(operations?.transactions ?? [])
        .filter(
          (transaction) =>
            !periodDate ||
            operationBusinessDate(transaction.occurredAt, transaction.branchId) === periodDate,
        )
        .filter((transaction) => {
          const term = query.trim().toLowerCase();
          return (
            !term ||
            transaction.id.toLowerCase().includes(term) ||
            transaction.merchantReference.toLowerCase().includes(term) ||
            transaction.customerReference?.toLowerCase().includes(term) ||
            transaction.providerTransactionId?.toLowerCase().includes(term)
          );
        })
        .slice(0, 100),
    [operationBusinessDate, operations?.transactions, periodDate, query, scoped],
  );
  const selectedTransaction = transactions.find(
    (transaction) => transaction.id === selectedTransactionId,
  );
  const collections = scoped(operations?.collections ?? []).filter(
    (collection) =>
      !periodDate ||
      operationBusinessDate(collection.collectedAt, collection.branchId) === periodDate,
  );
  const drawers = scoped(operations?.drawerSessions ?? []);
  const bankTransactions = scoped(operations?.bankTransactions ?? []);
  const settlements = scoped(operations?.settlementBatches ?? []);
  const exceptions = scoped(operations?.exceptions ?? []).filter(
    (exception) => exception.status === "OPEN" || exception.status === "INVESTIGATING",
  );
  const refunds = scoped(operations?.refunds ?? []);
  const matches = scoped(operations?.matches ?? []);
  const unmatchedTransactions = transactions.filter((transaction) =>
    ["PENDING", "UNVERIFIED", "VERIFYING", "NOT_FOUND", "AMOUNT_MISMATCH"].includes(
      transaction.status,
    ),
  );
  const cashVarianceMinor = sumMinor(drawers.map((drawer) => drawer.varianceMinor ?? 0));
  const collectedMinor = sumMinor(collections.map((collection) => collection.amountMinor));
  const outstandingReceivables = state.marketplaceReceivables
    .filter(
      (receivable) =>
        receivable.tenantId === activeTenantId &&
        (isAllBranches || receivable.branchId === branchId),
    )
    .reduce((total, receivable) => total + receivable.outstandingAmount, 0);
  const salesToday = majorFromMinor(
    branchRecords
      .filter((record) => isAllBranches || record.id === branchId)
      .map((record) =>
        projectFinancialLifecycle(state, {
          tenantId: activeTenantId,
          branchId: record.id,
          businessDate: periodDate,
          currency,
          timeZone: record.timezone ?? timeZone,
          businessDayCutoffMinutes: Number(record.metadata["businessDayCutoffMinutes"] ?? 0),
        }),
      )
      .reduce((total, projection) => total + projection.settledMinor, 0),
    currency,
  );

  const runMutation = (label: string, action: string, payload: unknown) => {
    void mutateTransaction(action, payload)
      .then(() => setNotice(label))
      .catch((error) =>
        setNotice(error instanceof Error ? error.message : "Payment operation failed"),
      );
  };

  // Asks Safaricom about one unanswered prompt and reports the outcome in plain words.
  const checkPrompt = async (intentId: string) => {
    const token = getSerametAccessToken();
    const response = await authenticatedFetch("/api/seramet/payments/prompts/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-user-id": currentUser.id,
        "x-seramet-branch-id": branchId,
      },
      body: JSON.stringify({ intentId }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      results?: Array<{ outcome: string; reason?: string }>;
    };
    if (!response.ok) throw new Error(payload.message ?? "Could not check the payment");
    await syncFromBackend();
    const result = payload.results?.[0];
    if (!result) return "Nothing to check; the prompt already finished";
    if (result.outcome === "FAILED") return result.reason ?? "The payment was not completed";
    if (result.outcome === "PAID_AWAITING_RECEIPT")
      return "Safaricom says paid; waiting for the receipt";
    if (result.outcome === "WAITING") return "Still waiting for the customer";
    return result.reason ?? "Safaricom did not answer; try again shortly";
  };

  const runAutomaticMatching = () => {
    runMutation(
      "Automatic matching completed. Ambiguous records remain in review.",
      "automaticPaymentMatching",
      {
        input: {
          tenantId: activeTenantId,
          ...(isAllBranches ? {} : { branchId }),
          businessDate: periodDate,
        },
      },
    );
  };

  const manuallyMatch = () => {
    const session = operations?.reconciliationSessions.find(
      (candidate) => candidate.tenantId === activeTenantId && candidate.type === "PAYMENT",
    );
    const payment = transactions.find((candidate) => candidate.id === manualPaymentId);
    const bank = bankTransactions.find((candidate) => candidate.id === manualBankId);
    if (!session || !payment || !bank) {
      setNotice("Select a payment and bank transaction after starting reconciliation.");
      return;
    }
    runMutation(
      "Manual match recorded with audit and fraud-control history.",
      "manualPaymentMatch",
      {
        input: {
          tenantId: activeTenantId,
          ...(isAllBranches ? {} : { branchId }),
          sessionId: session.id,
          paymentTransactionId: payment.id,
          bankTransactionId: bank.id,
          amountMinor: Math.min(payment.amountMinor, Math.abs(bank.amountMinor)),
          actor: currentUser.name,
          reason: manualReason,
        },
      },
    );
  };

  const openDrawer = () =>
    runMutation("Cash drawer opened.", "openPaymentDrawer", {
      input: {
        tenantId: activeTenantId,
        branchId,
        employeeId: currentUser.id,
        openingFloatMinor: parseMajorAmount(openingFloat, currency),
        currency,
        deviceId: `${branchId}-POS`,
        actor: currentUser.name,
      },
    });

  const approveDrawer = (drawerId: string) =>
    runMutation("Cash variance approved with an audit reason.", "approveDrawerVariance", {
      input: {
        tenantId: activeTenantId,
        drawerSessionId: drawerId,
        approvedBy: currentUser.name,
        reason: manualReason,
      },
    });

  const handleBankFile = async (file: File) => {
    const source = file.name.toLowerCase().endsWith(".xlsx")
      ? await file.arrayBuffer()
      : await file.text();
    setBankPreview(await genericBankStatementAdapter.parse(source, currency));
  };

  const importBankPreview = () => {
    const bankAccount = operations?.accounts.find(
      (account) => account.tenantId === activeTenantId && account.type === "BANK" && account.active,
    );
    if (!bankPreview?.canPost || !bankAccount) {
      setNotice("A valid preview and configured bank account are required.");
      return;
    }
    runMutation("Bank statement imported idempotently.", "importBankTransactions", {
      input: {
        tenantId: activeTenantId,
        ...(isAllBranches ? {} : { branchId }),
        accountId: bankAccount.id,
        adapterCode: bankPreview.adapterCode,
        rows: bankPreview.recognized,
      },
    });
    setBankPreview(null);
  };

  const handleSettlementFile = async (file: File) => {
    const connection = configuration
      .listConnections(activeTenantId, isAllBranches ? undefined : branchId)
      .find((candidate) => {
        const provider = configuration
          .listProviders()
          .find((item) => item.id === candidate.providerId);
        return provider?.category === "DELIVERY";
      });
    if (!connection) {
      setNotice("Configure a marketplace connection before importing a settlement.");
      return;
    }
    const source = file.name.toLowerCase().endsWith(".xlsx")
      ? await file.arrayBuffer()
      : await file.text();
    setSettlementPreview(
      await genericSettlementAdapter.parse(source, { connectionId: connection.id, currency }),
    );
  };

  const importSettlementPreview = () => {
    if (!settlementPreview?.canPost) {
      setNotice("Resolve settlement preview errors before importing.");
      return;
    }
    runMutation("Settlement batches imported for matching.", "importSettlementBatches", {
      inputs: settlementPreview.recognized.map((normalized) => ({
        tenantId: activeTenantId,
        ...(isAllBranches ? {} : { branchId }),
        importedBy: currentUser.name,
        normalized,
      })),
    });
    setSettlementPreview(null);
  };

  const matchSettlement = (settlementId: string) => {
    const settlement = settlements.find((candidate) => candidate.id === settlementId);
    const bank = bankTransactions.find(
      (candidate) =>
        candidate.currency === settlement?.currency &&
        Math.abs(candidate.amountMinor) === settlement?.netExpectedMinor &&
        candidate.status !== "MATCHED",
    );
    if (!bank) {
      setNotice("No exact unallocated bank receipt matches this settlement.");
      return;
    }
    runMutation("Settlement matched to the exact bank receipt.", "matchSettlementToBank", {
      input: {
        tenantId: activeTenantId,
        settlementBatchId: settlementId,
        bankTransactionId: bank.id,
        actor: currentUser.name,
      },
    });
  };

  const postSettlement = (settlementId: string) => {
    const settlement = settlements.find((candidate) => candidate.id === settlementId);
    const connection = settlement
      ? configuration
          .listConnections(activeTenantId, settlement.branchId)
          .find((candidate) => candidate.id === settlement.connectionId)
      : undefined;
    const accountConfig = connection?.configuration["settlementAccounts"];
    if (!isSettlementAccountMappings(accountConfig)) {
      setNotice("Configure every settlement posting account before posting.");
      return;
    }
    runMutation(
      "Settlement posted and receivables cleared with a balanced journal.",
      "postSettlement",
      {
        input: {
          tenantId: activeTenantId,
          settlementBatchId: settlementId,
          actor: currentUser.name,
          accounts: accountConfig,
        },
      },
    );
  };

  return (
    <AppShell
      title="Payment Control Centre"
      subtitle={`Sales, collections, settlements and EOD control - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={runAutomaticMatching} disabled={!hasPermission(permissions.paymentsMatch)}>
            <RefreshCcw className="h-4 w-4" /> Auto reconcile
          </Btn>
          <Btn
            variant="primary"
            onClick={() => setTab("EOD")}
            disabled={!hasPermission(permissions.reconciliationView)}
          >
            <ShieldCheck className="h-4 w-4" /> Daily closing
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Sales today" value={salesToday} money />
        <Metric label="Collected today" value={majorFromMinor(collectedMinor, currency)} money />
        <Metric label="Outstanding receivables" value={outstandingReceivables} money invert />
        <Metric label="Unmatched payments" value={unmatchedTransactions.length} invert />
        <Metric
          label="Cash variance"
          value={majorFromMinor(cashVarianceMinor, currency)}
          money
          invert
        />
        <Metric
          label="Settlements pending"
          value={settlements.filter((item) => !["POSTED", "REVERSED"].includes(item.status)).length}
          invert
        />
      </div>

      <Panel className="mt-4 overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={cn(
                  "h-9 shrink-0 rounded-md px-3 text-[12px] font-semibold",
                  tab === item ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chips items={[`Scope: ${branchLabel}`, `Period: ${periodDate}`]} />
            <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[13px] outline-none"
                placeholder="Search reference or transaction"
              />
            </label>
            <input
              type="date"
              value={periodDate}
              onChange={(event) => setPeriodDate(event.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-[12px] font-semibold"
            />
          </div>
        </div>
        {notice && (
          <div className="border-b border-border bg-info-soft px-4 py-2.5 text-[12px] font-semibold text-info">
            {notice}
          </div>
        )}

        {tab === "Payments" && (
          <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
            <TransactionList
              rows={transactions}
              selectedId={selectedTransactionId}
              onSelect={setSelectedTransactionId}
            />
            <PaymentDetails
              transaction={selectedTransaction}
              allocations={operations?.allocations ?? []}
              audit={operations?.auditEvents ?? []}
              methods={configuration.listPaymentMethods(activeTenantId, false)}
            />
          </div>
        )}

        {tab === "M-Pesa" &&
          (isAllBranches ? (
            <p className="p-6 text-[13px] text-muted-foreground">
              Choose a branch to match its M-Pesa payments.
            </p>
          ) : (
            <>
              <MpesaPrompts
                state={state}
                tenantId={activeTenantId}
                branchId={branchId}
                onCheck={checkPrompt}
              />
              <MpesaToMatch
                state={state}
                tenantId={activeTenantId}
                branchId={branchId}
                canMatch={hasPermission(permissions.paymentsMatch)}
                onApply={(transactionId, invoiceId) =>
                  runMutation("Payment applied to the bill.", "applyUnallocatedPayment", {
                    transactionId,
                    invoiceId,
                  })
                }
              />
            </>
          ))}
        {tab === "Unmatched" && (
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div>
              <h2 className="text-[14px] font-semibold">Unmatched payment queue</h2>
              <p className="mb-3 text-[12px] text-muted-foreground">
                Weak and ambiguous matches require authorized review.
              </p>
              <TransactionCards rows={unmatchedTransactions} />
            </div>
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="text-[13px] font-semibold">Manual match</div>
              <select
                value={manualPaymentId}
                onChange={(event) => setManualPaymentId(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
              >
                <option value="">Select payment</option>
                {unmatchedTransactions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} - {formatMinor(item.amountMinor, item.currency)}
                  </option>
                ))}
              </select>
              <select
                value={manualBankId}
                onChange={(event) => setManualBankId(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
              >
                <option value="">Select bank transaction</option>
                {bankTransactions
                  .filter((item) => item.status !== "MATCHED")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.externalTransactionId} - {formatMinor(item.amountMinor, item.currency)}
                    </option>
                  ))}
              </select>
              <input
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
                placeholder="Required review reason"
              />
              <Btn
                variant="primary"
                className="w-full"
                onClick={manuallyMatch}
                disabled={!hasPermission(permissions.paymentsMatch)}
              >
                Approve manual match
              </Btn>
            </div>
          </div>
        )}

        {tab === "Settlements" && (
          <div className="p-4">
            <ImportBar
              label="Import settlement CSV/XLSX"
              onFile={handleSettlementFile}
              canPost={Boolean(settlementPreview?.canPost)}
              onPost={importSettlementPreview}
            />
            {settlementPreview && <PreviewSummary preview={settlementPreview} />}
            <div className="mt-4 grid gap-3">
              {settlements.map((settlement) => (
                <div
                  key={settlement.id}
                  className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,1fr)_repeat(3,auto)] md:items-center"
                >
                  <div>
                    <div className="font-semibold">{settlement.externalSettlementId}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {settlement.periodStart.slice(0, 10)} to {settlement.periodEnd.slice(0, 10)} -
                      gross {formatMinor(settlement.grossSalesMinor, settlement.currency)}
                    </div>
                  </div>
                  <div className="num text-[13px] font-semibold">
                    Net {formatMinor(settlement.netExpectedMinor, settlement.currency)}
                  </div>
                  <Status>{settlement.status}</Status>
                  <div className="flex gap-2">
                    <Btn
                      onClick={() => matchSettlement(settlement.id)}
                      disabled={
                        !hasPermission(permissions.reconciliationManage) ||
                        !["IMPORTED", "MATCHING", "EXCEPTION"].includes(settlement.status)
                      }
                    >
                      Match
                    </Btn>
                    <Btn
                      variant="primary"
                      onClick={() => postSettlement(settlement.id)}
                      disabled={
                        !hasPermission(permissions.settlementsPost) ||
                        settlement.status !== "MATCHED"
                      }
                    >
                      Post
                    </Btn>
                  </div>
                </div>
              ))}
              {!settlements.length && <EmptyLine text="No settlement batches in this scope." />}
            </div>
          </div>
        )}

        {tab === "Cash Drawers" && (
          <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="text-[13px] font-semibold">Drawer controls</div>
              <MoneyInput label="Opening float" value={openingFloat} onChange={setOpeningFloat} />
              <input
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
                placeholder="Variance approval reason"
              />
              <Btn
                variant="primary"
                className="w-full"
                onClick={openDrawer}
                disabled={!hasPermission(permissions.cashOpen)}
              >
                Open drawer
              </Btn>
            </div>
            <div className="grid gap-3">
              {drawers.map((drawer) => (
                <div key={drawer.id} className="rounded-lg border border-border p-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                    <div>
                      <div className="font-semibold">{drawer.id}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {drawer.employeeId} - opened {new Date(drawer.openedAt).toLocaleString()}
                      </div>
                    </div>
                    <Status>{drawer.status}</Status>
                    <div className="flex gap-2">
                      {drawer.status === "OPEN" &&
                        closingPolicy(state, activeTenantId, branchId).mode ===
                          "MULTI_CASHIER_SHIFTS" && (
                          <Btn
                            onClick={() => setTab("EOD")}
                            disabled={!hasPermission(permissions.cashClose)}
                          >
                            Shift review
                          </Btn>
                        )}
                      {drawer.status === "REVIEW_REQUIRED" && (
                        <Btn
                          variant="primary"
                          onClick={() => approveDrawer(drawer.id)}
                          disabled={!hasPermission(permissions.cashAdjust)}
                        >
                          Approve
                        </Btn>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(drawer.currencyBalances).map(([currencyCode, balance]) => (
                      <div
                        key={currencyCode}
                        className="rounded-md border border-border bg-secondary/30 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-[12px]">
                          <span className="font-semibold">{currencyCode}</span>
                          <span className="num font-semibold">
                            Expected {formatMinor(balance.expectedCashMinor, currencyCode)}
                          </span>
                        </div>
                        {drawer.status === "OPEN" ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Counted in the closing review.
                          </p>
                        ) : (
                          <div className="num mt-2 flex justify-between gap-2 text-[11px]">
                            <span>
                              Counted {formatMinor(balance.countedCashMinor ?? 0, currencyCode)}
                            </span>
                            <span
                              className={cn(
                                "font-semibold",
                                (balance.varianceMinor ?? 0) !== 0 && "text-destructive",
                              )}
                            >
                              Variance {formatMinor(balance.varianceMinor ?? 0, currencyCode)}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!drawers.length && <EmptyLine text="No cash drawer sessions in this scope." />}
            </div>
          </div>
        )}

        {tab === "Bank" && (
          <div className="p-4">
            <ImportBar
              label="Import bank statement CSV/XLSX"
              onFile={handleBankFile}
              canPost={Boolean(bankPreview?.canPost)}
              onPost={importBankPreview}
            />
            {bankPreview && <PreviewSummary preview={bankPreview} />}
            <div className="mt-4">
              <BankRows rows={bankTransactions} />
            </div>
          </div>
        )}

        {tab === "Refunds" && (
          <div className="grid gap-3 p-4">
            {refunds.map((refund) => (
              <div
                key={refund.id}
                className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
              >
                <div>
                  <div className="font-semibold">
                    {refund.id} - {refund.reason}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    Original {refund.originalTransactionId} - requested by {refund.requestedBy}
                  </div>
                </div>
                <div className="num text-[13px] font-semibold">
                  {formatMinor(refund.amountMinor, refund.currency)}
                </div>
                <div className="flex items-center gap-2">
                  <Status>{refund.status}</Status>
                  {refund.status === "REQUESTED" && (
                    <Btn
                      variant="primary"
                      onClick={() =>
                        runMutation("Refund approved for provider processing.", "approveRefund", {
                          refundId: refund.id,
                        })
                      }
                      disabled={!hasPermission(permissions.paymentsRefundApprove)}
                    >
                      Approve
                    </Btn>
                  )}
                </div>
              </div>
            ))}
            {!refunds.length && <EmptyLine text="No refund requests in this scope." />}
          </div>
        )}

        {tab === "Reconciliation" && (
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="grid gap-3">
              {matches.map((match) => (
                <div
                  key={match.id}
                  className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                >
                  <div>
                    <div className="font-semibold">
                      {match.leftId} to {match.rightId}
                    </div>
                    <div className="text-[12px] text-muted-foreground">{match.reason}</div>
                  </div>
                  <Status>{match.confidence}</Status>
                  <Status>{match.status}</Status>
                </div>
              ))}
              {!matches.length && (
                <EmptyLine text="Run automatic matching to create a reconciliation session." />
              )}
            </div>
            <div className="space-y-3">
              <div className="text-[13px] font-semibold">Open exceptions</div>
              {exceptions.map((exception) => (
                <div key={exception.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{exception.reason.replaceAll("_", " ")}</div>
                    <Status>{exception.severity}</Status>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">{exception.detail}</p>
                  <Btn
                    className="mt-3 w-full"
                    onClick={() =>
                      runMutation("Exception resolved.", "resolveReconciliationException", {
                        input: {
                          tenantId: activeTenantId,
                          exceptionId: exception.id,
                          actor: currentUser.name,
                          resolution: manualReason,
                        },
                      })
                    }
                    disabled={!hasPermission(permissions.reconciliationManage)}
                  >
                    Resolve with reason
                  </Btn>
                </div>
              ))}
              <input
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
                placeholder="Required resolution reason"
              />
            </div>
          </div>
        )}

        {tab === "EOD" && (
          <DailyClosingPanel key={`${activeTenantId}:${branchId}`} engine={engine} />
        )}
      </Panel>
    </AppShell>
  );
}

function TransactionList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: PaymentTransaction[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <TransactionCards rows={rows} selectedId={selectedId} onSelect={onSelect} />
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <TH>Transaction</TH>
              <TH>Reference</TH>
              <TH>Direction</TH>
              <TH className="text-right">Amount</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className={cn(
                  "cursor-pointer hover:bg-secondary/50",
                  selectedId === row.id && "bg-accent/60",
                )}
              >
                <TD className="num font-semibold">{row.id}</TD>
                <TD className="num text-muted-foreground">
                  {row.providerTransactionId ?? row.customerReference ?? row.merchantReference}
                </TD>
                <TD>{row.direction}</TD>
                <TD className="num text-right font-semibold">
                  {formatMinor(row.amountMinor, row.currency)}
                </TD>
                <TD>
                  <Status>{row.status}</Status>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionCards({
  rows,
  selectedId,
  onSelect,
}: {
  rows: PaymentTransaction[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 p-3 md:hidden">
      {rows.map((row) => (
        <button
          key={row.id}
          onClick={() => onSelect?.(row.id)}
          className={cn(
            "rounded-lg border border-border bg-card p-3 text-left shadow-card",
            selectedId === row.id && "border-primary",
          )}
        >
          <div className="flex justify-between gap-3">
            <span className="num font-semibold">{row.id}</span>
            <Status>{row.status}</Status>
          </div>
          <div className="num mt-2 text-[18px] font-bold">
            {formatMinor(row.amountMinor, row.currency)}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {row.providerTransactionId ?? row.customerReference ?? row.merchantReference}
          </div>
        </button>
      ))}
      {!rows.length && <EmptyLine text="No payment transactions match the current filters." />}
    </div>
  );
}

function PaymentDetails({
  transaction,
  allocations,
  audit,
  methods,
}: {
  transaction: PaymentTransaction | undefined;
  allocations: Array<{
    paymentTransactionId: string;
    invoiceId: string;
    amountMinor: number;
    currency: string;
  }>;
  audit: Array<{ recordId: string; action: string; detail: string; createdAt: string }>;
  methods: Array<{ id: string; displayName: string }>;
}) {
  return (
    <aside className="border-t border-border p-4 xl:border-l xl:border-t-0">
      <PanelHead title="Payment details" sub="Allocation and audit timeline" />
      {transaction ? (
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <Detail
              label="Method"
              value={
                methods.find((item) => item.id === transaction.paymentMethodId)?.displayName ??
                transaction.paymentMethodId
              }
            />
            <Detail label="Status" value={transaction.status} />
            <Detail label="Invoice/order" value={transaction.merchantReference} />
            <Detail
              label="Amount"
              value={formatMinor(transaction.amountMinor, transaction.currency)}
            />
            {transaction.currencyEvidence && (
              <>
                <Detail
                  label="Tender received"
                  value={formatMinor(
                    transaction.currencyEvidence.tenderAmountMinor,
                    transaction.currencyEvidence.tenderCurrency,
                  )}
                />
                <Detail
                  label="Base allocation"
                  value={formatMinor(
                    transaction.currencyEvidence.baseAmountMinor,
                    transaction.currencyEvidence.baseCurrency,
                  )}
                />
                <Detail
                  label="Rate evidence"
                  value={`${transaction.currencyEvidence.rateNumerator}/${transaction.currencyEvidence.rateDenominator}`}
                />
                <Detail label="FX quote" value={transaction.currencyEvidence.quoteId} />
              </>
            )}
          </div>
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase text-muted-foreground">
              Allocations
            </div>
            {allocations
              .filter((item) => item.paymentTransactionId === transaction.id)
              .map((item) => (
                <div
                  key={item.invoiceId}
                  className="flex justify-between border-t border-border py-2 text-[12px]"
                >
                  <span>{item.invoiceId}</span>
                  <span className="num font-semibold">
                    {formatMinor(item.amountMinor, item.currency)}
                  </span>
                </div>
              ))}
          </div>
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase text-muted-foreground">
              Audit timeline
            </div>
            {audit
              .filter((item) => item.recordId === transaction.id)
              .map((item) => (
                <div
                  key={`${item.action}-${item.createdAt}`}
                  className="border-l-2 border-border py-1 pl-3 text-[12px]"
                >
                  <div className="font-semibold">{item.action.replaceAll("_", " ")}</div>
                  <div className="text-muted-foreground">{item.detail}</div>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <EmptyLine text="Select a transaction to inspect its references, allocations and audit history." />
      )}
    </aside>
  );
}

function BankRows({
  rows,
}: {
  rows: Array<{
    id: string;
    externalTransactionId: string;
    date: string;
    description: string;
    amountMinor: number;
    currency: string;
    status: string;
  }>;
}) {
  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
        >
          <div>
            <div className="font-semibold">{row.externalTransactionId}</div>
            <div className="text-[12px] text-muted-foreground">
              {new Date(row.date).toLocaleDateString()} - {row.description}
            </div>
          </div>
          <span className="num font-semibold">{formatMinor(row.amountMinor, row.currency)}</span>
          <Status>{row.status}</Status>
        </div>
      ))}
      {!rows.length && <EmptyLine text="No bank transactions imported for this scope." />}
    </div>
  );
}

function ImportBar({
  label,
  onFile,
  canPost,
  onPost,
}: {
  label: string;
  onFile: (file: File) => Promise<void>;
  canPost: boolean;
  onPost: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-[12px] font-semibold hover:bg-secondary">
        <FileUp className="h-4 w-4" />
        {label}
        <input
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <Btn variant="primary" onClick={onPost} disabled={!canPost}>
        Import recognized rows
      </Btn>
    </div>
  );
}

function PreviewSummary({ preview }: { preview: StatementPreview<unknown> }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
      <Detail label="Recognized" value={String(preview.recognized.length)} />
      <Detail label="Duplicates" value={String(preview.duplicates.length)} />
      <Detail label="Unknown" value={String(preview.unknown.length)} />
      <Detail
        label="Errors"
        value={String(preview.issues.filter((item) => item.severity === "ERROR").length)}
      />
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ""))}
        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground"
      />
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/60 p-2">
      <div className="text-[10px] font-bold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-semibold">{value}</div>
    </div>
  );
}
function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}
function isSettlementAccountMappings(value: unknown): value is SettlementAccountMappings {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [
    "bankAccountId",
    "marketplaceReceivableAccountId",
    "commissionExpenseAccountId",
    "serviceFeeExpenseAccountId",
    "deliveryAdjustmentAccountId",
    "promotionExpenseAccountId",
    "refundExpenseAccountId",
    "taxAdjustmentAccountId",
    "otherAdjustmentAccountId",
  ].every((key) => typeof record[key] === "string" && Boolean(record[key]));
}
