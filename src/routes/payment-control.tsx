import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { RequestError, reportError } from "@/lib/user-facing-error";
import { humanize } from "@/finance/finance-labels";
import { RefundsWorkspace } from "@/components/app/RefundsWorkspace";

const tabs = [
  { id: "payments", label: "Payments" },
  { id: "settlements", label: "Settlements" },
  { id: "cash-drawers", label: "Cash drawers" },
  { id: "bank", label: "Bank & reconciliation" },
  { id: "refunds", label: "Refunds" },
  { id: "daily-closing", label: "Daily closing" },
] as const;
type Tab = (typeof tabs)[number]["id"];
const paymentViews = ["All", "M-Pesa", "Unmatched"] as const;
type PaymentView = (typeof paymentViews)[number];

export const Route = createFileRoute("/payment-control")({
  validateSearch: (search: Record<string, unknown>): { tab: Tab } => ({
    tab: tabs.some((tab) => tab.id === search["tab"]) ? (search["tab"] as Tab) : "payments",
  }),
  head: () => ({ meta: [{ title: "Payments - Seramet" }] }),
  component: PaymentControlCentre,
});

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
    platformState,
    timeZone,
  } = useAppContext();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (next: Tab) => void navigate({ to: "/payment-control", search: { tab: next } });
  const [paymentView, setPaymentView] = useState<PaymentView>("All");
  const staffName = (id: string) =>
    platformState.users.find((user) => user.id === id)?.name ??
    state.employees.find((employee) => employee.id === id)?.name ??
    "Staff member";
  const activeBranch = branchRecords.find((candidate) => candidate.id === branchId);
  const activeTimeZone = activeBranch?.timezone ?? timeZone;
  const activeCutoffMinutes = Number(activeBranch?.metadata["businessDayCutoffMinutes"] ?? 0);
  const currentBusinessDate = businessDateForTimestamp(
    new Date(),
    activeTimeZone,
    activeCutoffMinutes,
  );
  const [periodDate, setPeriodDate] = useState(currentBusinessDate);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTransactionId, setSelectedTransactionId] = useState("");
  // The cashier enters the cash actually counted into the drawer.
  const [openingFloat, setOpeningFloat] = useState("");
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
      .catch((error) => setNotice(reportError(error, "That didn't save. Try again.")));
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
    if (!response.ok) throw new RequestError(response.status, payload.message ?? "");
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
      setNotice("Choose Match payments first, then pick a payment and its bank entry.");
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

  const openingFloatMinor = (() => {
    try {
      const minor = parseMajorAmount(openingFloat, currency);
      return minor >= 0 ? minor : null;
    } catch {
      return null;
    }
  })();
  const openDrawer = () => {
    if (openingFloatMinor === null) {
      setNotice("Enter the cash counted into the drawer.");
      return;
    }
    runMutation("Cash drawer opened.", "openPaymentDrawer", {
      input: {
        tenantId: activeTenantId,
        branchId,
        employeeId: currentUser.id,
        openingFloatMinor,
        currency,
        deviceId: `${branchId}-POS`,
        actor: currentUser.name,
      },
    });
  };

  const approveDrawer = (drawerId: string) =>
    runMutation("Cash difference approved.", "approveDrawerVariance", {
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
      setNotice(
        "Check the statement preview, and set up a bank account in Setup Centre → Payments.",
      );
      return;
    }
    runMutation("Bank statement imported.", "importBankTransactions", {
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
      setNotice("Connect a delivery platform in Integrations before importing its settlements.");
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
      setNotice("Fix the rows marked in the preview, then import.");
      return;
    }
    runMutation("Settlements imported.", "importSettlementBatches", {
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
      setNotice("No bank entry matches this settlement's amount yet.");
      return;
    }
    runMutation("Settlement matched to its bank entry.", "matchSettlementToBank", {
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
      setNotice("Set the accounts for this platform's settlements in Integrations, then post.");
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
      title="Payments"
      subtitle={branchLabel}
      actions={
        <>
          <Btn onClick={runAutomaticMatching} disabled={!hasPermission(permissions.paymentsMatch)}>
            <RefreshCcw className="h-4 w-4" /> Match payments
          </Btn>
          <Btn
            variant="primary"
            onClick={() => setTab("daily-closing")}
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
        <Metric label="Unpaid invoices" value={outstandingReceivables} money invert />
        <Metric label="Unmatched payments" value={unmatchedTransactions.length} invert />
        <Metric
          label="Cash difference"
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
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "h-9 shrink-0 rounded-md px-3 text-[12px] font-semibold",
                  tab === item.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
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

        {tab === "payments" && (
          <div
            role="group"
            aria-label="Show"
            className="flex gap-1 border-b border-border px-3 py-2"
          >
            {paymentViews.map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={paymentView === view}
                onClick={() => setPaymentView(view)}
                className={cn(
                  "h-8 rounded-md px-3 text-[12px] font-semibold",
                  paymentView === view
                    ? "bg-secondary"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {view}
                {view === "Unmatched" && unmatchedTransactions.length > 0 && (
                  <span className="ml-1.5 rounded bg-warning-soft px-1.5 text-[11px]">
                    {unmatchedTransactions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {tab === "payments" && paymentView === "All" && (
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

        {tab === "payments" &&
          paymentView === "M-Pesa" &&
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
        {tab === "payments" && paymentView === "Unmatched" && (
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div>
              <h2 className="text-[14px] font-semibold">Payments to match</h2>
              <p className="mb-3 text-[12px] text-muted-foreground">
                These couldn&apos;t be matched automatically. Match each one to its bank entry.
              </p>
              <TransactionCards rows={unmatchedTransactions} />
            </div>
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="text-[13px] font-semibold">Match by hand</div>
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
                placeholder="Reason (required)"
              />
              <Btn
                variant="primary"
                className="w-full"
                onClick={manuallyMatch}
                disabled={!hasPermission(permissions.paymentsMatch)}
              >
                Match
              </Btn>
            </div>
          </div>
        )}

        {tab === "settlements" && (
          <div className="p-4">
            <ImportBar
              label="Import settlement file (CSV or Excel)"
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
                  <Status>{humanize(settlement.status)}</Status>
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
              {!settlements.length && <EmptyLine text="No settlements imported for this day." />}
            </div>
          </div>
        )}

        {tab === "cash-drawers" && (
          <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="text-[13px] font-semibold">Drawer controls</div>
              <MoneyInput
                label="Cash counted into the drawer"
                value={openingFloat}
                onChange={setOpeningFloat}
              />
              <input
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
                placeholder="Reason for approving a difference"
              />
              <Btn
                variant="primary"
                className="w-full"
                onClick={openDrawer}
                disabled={!hasPermission(permissions.cashOpen) || openingFloatMinor === null}
              >
                Open drawer
              </Btn>
            </div>
            <div className="grid gap-3">
              {drawers.map((drawer) => (
                <div key={drawer.id} className="rounded-lg border border-border p-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                    <div>
                      <div className="font-semibold">{staffName(drawer.employeeId)}</div>
                      <div className="text-[12px] text-muted-foreground">
                        Opened {new Date(drawer.openedAt).toLocaleString()}
                      </div>
                    </div>
                    <Status>{humanize(drawer.status)}</Status>
                    <div className="flex gap-2">
                      {drawer.status === "OPEN" &&
                        closingPolicy(state, activeTenantId, branchId).mode ===
                          "MULTI_CASHIER_SHIFTS" && (
                          <Btn
                            onClick={() => setTab("daily-closing")}
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
              {!drawers.length && <EmptyLine text="No cash drawers opened on this day." />}
            </div>
          </div>
        )}

        {tab === "bank" && (
          <div className="p-4">
            <ImportBar
              label="Import bank statement (CSV or Excel)"
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

        {tab === "refunds" && <RefundsWorkspace />}

        {tab === "bank" && (
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
                  <Status>{humanize(match.confidence)}</Status>
                  <Status>{humanize(match.status)}</Status>
                </div>
              ))}
              {!matches.length && (
                <EmptyLine text="No matches yet. Choose Match payments to match them automatically." />
              )}
            </div>
            <div className="space-y-3">
              <div className="text-[13px] font-semibold">Needs review</div>
              {exceptions.map((exception) => (
                <div key={exception.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{humanize(exception.reason)}</div>
                    <Status>{humanize(exception.severity)}</Status>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">{exception.detail}</p>
                  <Btn
                    className="mt-3 w-full"
                    onClick={() =>
                      runMutation("Marked as resolved.", "resolveReconciliationException", {
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
                    Mark resolved
                  </Btn>
                </div>
              ))}
              <input
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 text-[12px]"
                placeholder="Reason (required)"
              />
            </div>
          </div>
        )}

        {tab === "daily-closing" && (
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
                <TD>{humanize(row.direction)}</TD>
                <TD className="num text-right font-semibold">
                  {formatMinor(row.amountMinor, row.currency)}
                </TD>
                <TD>
                  <Status>{humanize(row.status)}</Status>
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
            <Status>{humanize(row.status)}</Status>
          </div>
          <div className="num mt-2 text-[18px] font-bold">
            {formatMinor(row.amountMinor, row.currency)}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {row.providerTransactionId ?? row.customerReference ?? row.merchantReference}
          </div>
        </button>
      ))}
      {!rows.length && <EmptyLine text="No payments match these filters." />}
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
      <PanelHead title="Payment details" sub="Where it was applied, and its history" />
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
            <Detail label="Status" value={humanize(transaction.status)} />
            <Detail label="Invoice or order" value={transaction.merchantReference} />
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
                  label="Applied in main currency"
                  value={formatMinor(
                    transaction.currencyEvidence.baseAmountMinor,
                    transaction.currencyEvidence.baseCurrency,
                  )}
                />
                <Detail
                  label="Exchange rate"
                  value={`${transaction.currencyEvidence.rateNumerator}/${transaction.currencyEvidence.rateDenominator}`}
                />
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
        <EmptyLine text="Choose a payment to see its details." />
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
          <Status>{humanize(row.status)}</Status>
        </div>
      ))}
      {!rows.length && <EmptyLine text="No bank entries imported yet." />}
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
      <Detail label="Ready to import" value={String(preview.recognized.length)} />
      <Detail label="Duplicates" value={String(preview.duplicates.length)} />
      <Detail label="Not recognised" value={String(preview.unknown.length)} />
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
