import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Link2, RefreshCcw, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { TransactionEngine, transactionMetrics } from "@/lib/transaction-engine";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/reconciliation")({
  head: () => ({
    meta: [
      { title: "Reconciliation - Seramet" },
      {
        name: "description",
        content:
          "Match expected Seramet transactions against M-Pesa, bank, card, cash and TendePay feeds.",
      },
      { property: "og:title", content: "Reconciliation - Seramet" },
      {
        property: "og:description",
        content: "Professional branch-level payment, cash, bank and expense reconciliation.",
      },
    ],
  }),
  component: Reconciliation,
});

function Reconciliation() {
  const { state, apply } = useTransactionEngine();
  const { branch, matchesBranch } = useAppContext();
  const metrics = transactionMetrics(state);
  const external = state.externalTransactions.filter((transaction) =>
    matchesBranch(transaction.branch ?? "All"),
  );
  const payments = state.payments.filter((payment) => matchesBranch(payment.branch));
  const matches = state.reconciliationMatches.filter((match) => {
    const externalTransaction = state.externalTransactions.find(
      (transaction) => transaction.id === match.externalTransactionId,
    );
    return externalTransaction ? matchesBranch(externalTransaction.branch ?? "All") : true;
  });
  const drawers = state.cashDrawers.filter((drawer) => matchesBranch(drawer.branch));
  const unmatched = external.filter(
    (transaction) => transaction.reconciliationStatus === "UNMATCHED",
  );
  const suggested = external.filter(
    (transaction) =>
      transaction.reconciliationStatus === "SUGGESTED" ||
      transaction.reconciliationStatus === "MATCHED",
  );
  const reconciled = external.filter(
    (transaction) => transaction.reconciliationStatus === "RECONCILED",
  );

  const importMpesaFeed = () => {
    const candidate = payments.find(
      (payment) =>
        payment.method === "MPESA_TILL_MANUAL" && payment.reconciliationStatus !== "RECONCILED",
    );
    if (!candidate) return;
    apply((current) =>
      TransactionEngine.importExternalTransaction(current, {
        provider: "M-Pesa",
        sourceAccount: "Customer Till Payment",
        destination: "Till 123456",
        branch: candidate.branch,
        amount: candidate.amount,
        direction: "INBOUND",
        currency: "KES",
        reference: candidate.reference,
        timestamp: "2026-08-14T12:52:00+03:00",
        description: `Till confirmation for ${candidate.invoiceId}`,
        providerMetadata: { till: "123456" },
      }),
    );
  };

  const importTendePayExpense = () => {
    apply((current) =>
      TransactionEngine.importExternalTransaction(current, {
        provider: "TendePay",
        sourceAccount: "Mona Operating",
        destination: "KPLC",
        branch: branch === "All Branches" ? "Westlands" : branch,
        amount: 18400,
        direction: "OUTBOUND",
        currency: "KES",
        reference: `KPLC-${current.externalTransactions.length + 1}`,
        timestamp: "2026-08-14T09:00:00+03:00",
        description: "KPLC electricity payment awaiting authorized expense match",
        providerMetadata: { category: "Utilities", adapter: "TendePayAdapter" },
      }),
    );
  };

  const closeDrawer = () => {
    const drawer = drawers.find((item) => item.status === "OPEN");
    if (!drawer) return;
    apply((current) =>
      TransactionEngine.closeCashDrawer(
        current,
        drawer.id,
        drawer.expectedDrawer - 200,
        "Emmanuel K.",
      ),
    );
  };

  const manualMatch = () => {
    const payment = payments.find((item) => item.reconciliationStatus !== "RECONCILED");
    const transaction = unmatched.find(
      (item) => item.direction === "INBOUND" && item.amount === payment?.amount,
    );
    if (!payment || !transaction) return;
    apply((current) =>
      TransactionEngine.manuallyReconcile(
        current,
        transaction.id,
        payment.id,
        "Finance",
        "Manual review approved after verifying branch till statement.",
      ),
    );
  };

  return (
    <AppShell
      title="Reconciliation"
      subtitle={`Expected vs actual money movement - ${branch}`}
      actions={
        <>
          <Btn onClick={importMpesaFeed}>
            <RefreshCcw className="h-4 w-4" /> Import M-Pesa feed
          </Btn>
          <Btn onClick={importTendePayExpense}>Import TendePay expense</Btn>
          <Btn variant="primary" onClick={manualMatch}>
            <Link2 className="h-4 w-4" /> Manual match
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected sales" value={metrics.sales} money />
        <Metric label="Outstanding bills" value={metrics.outstanding} money invert />
        <Metric label="Unreconciled" value={metrics.unreconciled} invert />
        <Metric label="Cash variance" value={metrics.cashVariance} money invert />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="External transaction feed"
            sub="M-Pesa, bank, card/acquirer, TendePay and manual imports"
            right={<Status>{unmatched.length} unmatched</Status>}
          />
          <div className="border-b border-border px-4 py-3">
            <Chips
              items={[`Branch: ${branch}`, "Source: All providers", "Status: Open exceptions"]}
            />
          </div>
          <div className="grid gap-3 p-3 md:hidden">
            {external.map((transaction) => (
              <article
                key={transaction.id}
                className="rounded-lg border border-border bg-card p-3 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">{transaction.provider}</div>
                    <div className="num text-[12px] text-muted-foreground">
                      {transaction.reference}
                    </div>
                  </div>
                  <Status>{transaction.reconciliationStatus}</Status>
                </div>
                <div className="num mt-3 text-[18px] font-extrabold">{ksh(transaction.amount)}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {transaction.description}
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>External ID</TH>
                  <TH>Provider</TH>
                  <TH>Direction</TH>
                  <TH>Branch</TH>
                  <TH>Reference</TH>
                  <TH>Description</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {external.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-secondary/50">
                    <TD className="num font-semibold">{transaction.id}</TD>
                    <TD>{transaction.provider}</TD>
                    <TD>{transaction.direction}</TD>
                    <TD className="text-muted-foreground">{transaction.branch ?? "Unknown"}</TD>
                    <TD className="num">{transaction.reference}</TD>
                    <TD className="text-muted-foreground">{transaction.description}</TD>
                    <TD className="num text-right font-semibold">{ksh(transaction.amount)}</TD>
                    <TD>
                      <Status>{transaction.reconciliationStatus}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-4">
          <Panel>
            <PanelHead
              title="Exception summary"
              sub="Requires authorized review"
              right={<ShieldAlert className="h-4 w-4 text-warning" />}
            />
            <div className="grid gap-2 p-4">
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Unmatched
                </div>
                <div className="mt-1 text-[20px] font-extrabold">{unmatched.length}</div>
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Suggested / matched
                </div>
                <div className="mt-1 text-[20px] font-extrabold">{suggested.length}</div>
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Reconciled
                </div>
                <div className="mt-1 text-[20px] font-extrabold">{reconciled.length}</div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="Cash drawer close"
              sub="Expected drawer vs physical count"
              right={<Btn onClick={closeDrawer}>Close sample</Btn>}
            />
            <div className="divide-y divide-border">
              {drawers.map((drawer) => (
                <div key={drawer.id} className="px-4 py-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">
                      {drawer.id} - {drawer.cashier}
                    </div>
                    <Status>{drawer.status}</Status>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      Expected <span className="num font-bold">{ksh(drawer.expectedDrawer)}</span>
                    </div>
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      Variance <span className="num font-bold">{ksh(drawer.variance ?? 0)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Reconciliation matches"
          sub="Confidence-based matching; low confidence requires human approval"
          right={<CheckCircle2 className="h-4 w-4 text-success" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr>
                <TH>Match</TH>
                <TH>External</TH>
                <TH>Internal</TH>
                <TH>Type</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Confidence</TH>
                <TH>Status</TH>
                <TH>Notes</TH>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.id} className="hover:bg-secondary/50">
                  <TD className="num font-semibold">{match.id}</TD>
                  <TD className="num">{match.externalTransactionId}</TD>
                  <TD className="num">{match.internalTransactionId}</TD>
                  <TD>{match.matchType}</TD>
                  <TD className="num text-right">{ksh(match.amount)}</TD>
                  <TD className="num text-right font-semibold">{match.confidence}%</TD>
                  <TD>
                    <Status>{match.status}</Status>
                  </TD>
                  <TD className="text-muted-foreground">{match.notes}</TD>
                </tr>
              ))}
              {matches.length === 0 && (
                <tr>
                  <TD colSpan={8} className="text-muted-foreground">
                    No reconciliation matches yet. Import a provider feed or manually match an
                    exception.
                  </TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
