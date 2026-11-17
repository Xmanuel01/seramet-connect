import { useState } from "react";
import { Landmark } from "lucide-react";
import { Btn } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import {
  channelPayoutAccounts,
  payoutAccountFields,
  payoutAccountsSchema,
  type PayoutAccounts,
} from "@/payments/payout-accounts";
import type { OrderChannelDefinition } from "@/platform/types";

type Account = { id: string; code: string; name: string; active: boolean };

/**
 * Where a delivery app's payout posts. Pre-filled from the restaurant's standard chart, so
 * the owner or accountant usually only confirms.
 */
export function PayoutAccountsDialog({
  channel,
  tenantId,
  userId,
  disabled,
  onSave,
}: {
  channel: OrderChannelDefinition;
  tenantId: string;
  userId: string;
  disabled: boolean;
  onSave: (accounts: PayoutAccounts) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState<Partial<PayoutAccounts>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = channelPayoutAccounts(channel);

  const start = async () => {
    setError("");
    setBusy(true);
    setOpen(true);
    try {
      const token = getSerametAccessToken();
      const response = await authenticatedFetch("/api/seramet/setup/options", {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "x-seramet-tenant-id": tenantId,
          "x-seramet-user-id": userId,
        },
      });
      const body = (await response.json().catch(() => ({}))) as {
        options?: { accounts?: Array<Record<string, unknown>> };
        message?: string;
      };
      if (!response.ok) throw new Error(body.message ?? "Accounts could not be loaded");
      const list = (body.options?.accounts ?? [])
        .map((row) => ({
          id: String(row["id"]),
          code: String(row["code"] ?? ""),
          name: String(row["name"] ?? ""),
          active: Number(row["active"]) === 1 || row["active"] === true,
        }))
        .filter((row) => row.active);
      setAccounts(list);
      const byCode = (codes: string[]) =>
        codes
          .map((code) => list.find((row) => row.code === code || row.code === `${code}-STD`))
          .find(Boolean)?.id;
      setDraft(
        Object.fromEntries(
          payoutAccountFields.map((field) => [
            field.key,
            saved?.[field.key] ?? byCode(field.suggest) ?? "",
          ]),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accounts could not be loaded");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const parsed = payoutAccountsSchema.safeParse(draft);
    if (!parsed.success) return setError("Choose an account for every line.");
    setBusy(true);
    setError("");
    try {
      if (await onSave(parsed.data)) setOpen(false);
      else setError("The payout accounts were not saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Btn disabled={disabled} onClick={() => void start()}>
        <Landmark size={16} />
        Payout accounts{saved ? "" : " (not set)"}
      </Btn>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{channel.displayName} payout accounts</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            When you post {channel.displayName}&apos;s payout, each line of its report goes to these
            accounts. Suggestions come from your standard chart.
          </p>
          <div className="grid gap-3">
            {payoutAccountFields.map((field) => (
              <label key={field.key} className="grid gap-1 text-sm">
                {field.label}
                <select
                  value={draft[field.key] ?? ""}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  className="h-10 min-w-0 rounded-md border border-border bg-card px-3 text-sm"
                >
                  <option value="">Choose an account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Btn variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Working..." : "Save payout accounts"}
          </Btn>
        </DialogContent>
      </Dialog>
    </>
  );
}
