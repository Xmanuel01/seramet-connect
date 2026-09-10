import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  CrmEmpty,
  CrmError,
  CrmLoading,
  minorToMajor,
  readableStatus,
  shortDate,
} from "@/crm/crm-ui";
import { useCrmApi, useCrmQuery } from "@/crm/use-crm";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/gift-cards")({
  head: () => ({ meta: [{ title: "Gift Cards - Seramet" }] }),
  component: GiftCards,
});

type GiftCardRow = {
  id: string;
  token_last_four: string;
  status: string;
  currency: string;
  original_value_minor: number;
  balance_minor: number;
  issued_at: string;
  expires_at?: string;
};

function GiftCards() {
  const { activeTenantId, branchLabel, platformState } = useAppContext();
  const tenant = platformState.tenants.find((item) => item.id === activeTenantId);
  const { command } = useCrmApi();
  const { state } = useTransactionEngine();
  const cards = useCrmQuery<{ giftCards: GiftCardRow[] }>("/api/seramet/crm/gift-cards");
  const accounts = useMemo(
    () =>
      state.paymentOperations?.accounts.filter(
        (account) => account.active && account.currency === tenant?.defaultCurrency,
      ) ?? [],
    [state.paymentOperations?.accounts, tenant?.defaultCurrency],
  );
  const [issueOpen, setIssueOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [balanceToken, setBalanceToken] = useState("");
  const [balanceResult, setBalanceResult] = useState<{
    currency: string;
    balanceMinor: number;
    status: string;
  } | null>(null);
  const [form, setForm] = useState({
    amount: "",
    liabilityAccountId: "",
    collectionAccountId: "",
    redemptionAccountId: "",
    expiresAt: "",
  });

  useEffect(() => {
    if (form.liabilityAccountId || !accounts.length) return;
    const liability = accounts.find(
      (account) => account.type === "VOUCHER_LIABILITY" || account.type === "LOYALTY_LIABILITY",
    );
    const collection = accounts.find((account) =>
      ["CASH", "BANK", "MOBILE_MONEY"].includes(account.type),
    );
    const redemption = accounts.find(
      (account) => account.type === "REVENUE" || account.type === "OTHER",
    );
    setForm((current) => ({
      ...current,
      liabilityAccountId: liability?.id ?? "",
      collectionAccountId: collection?.id ?? "",
      redemptionAccountId: redemption?.id ?? "",
    }));
  }, [accounts, form.liabilityAccountId]);

  const rows = cards.data?.giftCards ?? [];
  const liabilityMinor = rows.reduce((sum, card) => sum + Number(card.balance_minor ?? 0), 0);
  const issue = async () => {
    const amount = Number(form.amount);
    if (
      !tenant ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !form.liabilityAccountId ||
      !form.collectionAccountId ||
      !form.redemptionAccountId
    )
      return;
    setBusy(true);
    try {
      const result = await command<{ giftCard: { token: string; tokenLastFour: string } }>(
        "/api/seramet/crm/gift-cards/issue",
        {
          amountMinor: Math.round(amount * 100),
          currency: tenant.defaultCurrency,
          liabilityAccountId: form.liabilityAccountId,
          collectionAccountId: form.collectionAccountId,
          redemptionAccountId: form.redemptionAccountId,
          ...(form.expiresAt
            ? { expiresAt: new Date(`${form.expiresAt}T23:59:59.999Z`).toISOString() }
            : {}),
          idempotencyKey: `gift-issue:${crypto.randomUUID()}`,
        },
      );
      setNotice(
        `Gift card issued. Secure token: ${result.giftCard.token}. This is the only time the full token is shown.`,
      );
      setIssueOpen(false);
      setForm((current) => ({ ...current, amount: "", expiresAt: "" }));
      await cards.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Gift card could not be issued");
    } finally {
      setBusy(false);
    }
  };
  const checkBalance = async () => {
    if (!balanceToken.trim()) return;
    setBusy(true);
    try {
      const result = await command<{
        balance: { currency: string; balanceMinor: number; status: string };
      }>("/api/seramet/crm/gift-cards/balance", { token: balanceToken.trim() });
      setBalanceResult(result.balance);
    } catch (error) {
      setBalanceResult(null);
      setNotice(error instanceof Error ? error.message : "Gift card was not found");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Gift cards"
      subtitle={`Stored-value liability, secure tokens and append-only balance history - ${branchLabel}`}
      actions={
        <Btn variant="primary" onClick={() => setIssueOpen(true)}>
          Issue gift card
        </Btn>
      }
    >
      {notice && (
        <div className="mb-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] font-medium break-all">
          {notice}
        </div>
      )}
      {cards.status === "loading" && !cards.data ? (
        <CrmLoading />
      ) : cards.status === "error" ? (
        <Panel>
          <CrmError message={cards.error} retry={() => void cards.refresh()} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Cards issued" value={rows.length} />
            <Metric label="Active" value={rows.filter((row) => row.status === "ACTIVE").length} />
            <Metric label="Outstanding liability" value={minorToMajor(liabilityMinor)} money />
            <Metric
              label="Redeemed/closed"
              value={
                rows.filter((row) => ["REDEEMED", "EXPIRED", "CANCELLED"].includes(row.status))
                  .length
              }
            />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Panel>
              <PanelHead
                title="Gift-card register"
                sub="Only token endings are displayed; public redemption tokens are never listed"
              />
              {!rows.length ? (
                <CrmEmpty
                  title="No gift cards"
                  body="Issue stored value only after selecting configured accounting accounts."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <TH>Card</TH>
                        <TH>Issued</TH>
                        <TH className="text-right">Original</TH>
                        <TH className="text-right">Balance</TH>
                        <TH>Expiry</TH>
                        <TH>Status</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((card) => (
                        <tr key={card.id}>
                          <TD className="num font-semibold">Ending {card.token_last_four}</TD>
                          <TD>{shortDate(card.issued_at)}</TD>
                          <TD className="num text-right">
                            {ksh(minorToMajor(card.original_value_minor))}
                          </TD>
                          <TD className="num text-right font-semibold">
                            {ksh(minorToMajor(card.balance_minor))}
                          </TD>
                          <TD>{shortDate(card.expires_at)}</TD>
                          <TD>
                            <Status>{readableStatus(card.status)}</Status>
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel>
              <PanelHead
                title="Balance enquiry"
                sub="Checks a full token securely against the server ledger"
              />
              <div className="space-y-3 p-4">
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  Gift-card token
                  <input
                    value={balanceToken}
                    onChange={(event) => setBalanceToken(event.target.value.trim().slice(0, 200))}
                    className="h-10 rounded-md border border-border bg-card px-3 font-mono text-[12px] text-foreground outline-none focus:border-primary"
                    placeholder="Enter or scan token"
                  />
                </label>
                <Btn
                  className="w-full"
                  disabled={busy || balanceToken.length < 20}
                  onClick={() => void checkBalance()}
                >
                  Check balance
                </Btn>
                {balanceResult && (
                  <div className="rounded-md bg-secondary/50 p-4 text-center">
                    <div className="text-[11px] font-bold uppercase text-muted-foreground">
                      Available balance
                    </div>
                    <div className="num mt-1 text-[24px] font-bold">
                      {ksh(minorToMajor(balanceResult.balanceMinor))}
                    </div>
                    <Status>{readableStatus(balanceResult.status)}</Status>
                  </div>
                )}
                <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
                  Redemption occurs only through authoritative checkout. Balance enquiries do not
                  reserve value.
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-w-[600px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Issue gift card</DialogTitle>
            <DialogDescription>
              Gift-card issuance debits the selected collection account and credits the configured
              liability account.
            </DialogDescription>
          </DialogHeader>
          {!accounts.length ? (
            <CrmEmpty
              title="No financial accounts"
              body="Configure active accounts in the tenant currency before issuing stored value."
            />
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={`Amount (${tenant?.defaultCurrency ?? "currency"})`}
                  value={form.amount}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, amount: value.replace(/[^0-9.]/g, "") }))
                  }
                />
                <Input
                  type="date"
                  label="Expires on (optional)"
                  value={form.expiresAt}
                  onChange={(value) => setForm((current) => ({ ...current, expiresAt: value }))}
                />
              </div>
              <AccountSelect
                label="Liability account"
                value={form.liabilityAccountId}
                onChange={(value) =>
                  setForm((current) => ({ ...current, liabilityAccountId: value }))
                }
                accounts={accounts}
              />
              <AccountSelect
                label="Collection account"
                value={form.collectionAccountId}
                onChange={(value) =>
                  setForm((current) => ({ ...current, collectionAccountId: value }))
                }
                accounts={accounts}
              />
              <AccountSelect
                label="Redemption account"
                value={form.redemptionAccountId}
                onChange={(value) =>
                  setForm((current) => ({ ...current, redemptionAccountId: value }))
                }
                accounts={accounts}
              />
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <Btn onClick={() => setIssueOpen(false)}>Cancel</Btn>
                <Btn variant="primary" disabled={busy} onClick={() => void issue()}>
                  {busy ? "Issuing..." : "Issue stored value"}
                </Btn>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 160))}
        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}
function AccountSelect({
  label,
  value,
  onChange,
  accounts,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accounts: NonNullable<
    ReturnType<typeof useTransactionEngine>["state"]["paymentOperations"]
  >["accounts"];
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      >
        <option value="">Select configured account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} - {account.name} ({readableStatus(account.type)})
          </option>
        ))}
      </select>
    </label>
  );
}
