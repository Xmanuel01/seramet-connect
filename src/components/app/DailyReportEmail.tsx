import { useEffect, useState } from "react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import type { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { closingPolicy } from "@/payments/daily-closing";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

type Engine = ReturnType<typeof useTransactionEngine>;
type Delivery = { businessDate: string; recipientUserId: string; status: string };

const statusLabel: Record<string, string> = {
  PROVIDER_ACCEPTED: "Sent",
  QUEUED: "Sending",
  SKIPPED: "Not needed (day closed)",
  CONFIGURATION_REQUIRED: "Email not set up",
  DELIVERY_FAILED: "Failed",
  RECONCILIATION_REQUIRED: "Check in Brevo",
};

/**
 * Who gets the end-of-day summary. It goes out automatically after each business day ends;
 * when a supervisor closes the day, the official closing report goes to the same people.
 */
export function DailyReportEmail({ engine }: { engine: Engine }) {
  const { activeTenantId, branchId, isAllBranches, hasPermission } = useAppContext();
  const repository = getConfigurationRepository();
  const policy = closingPolicy(engine.state, activeTenantId, branchId);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<{ emailConfigured: boolean; deliveries: Delivery[] }>();
  const canEdit = !isAllBranches && hasPermission(permissions.reconciliationApprove);
  const canRead = hasPermission(permissions.reconciliationView);

  useEffect(() => {
    setChosen(null);
    setNotice("");
    if (!canRead || isAllBranches) return;
    const controller = new AbortController();
    const token = getSerametAccessToken();
    void fetch("/api/seramet/daily-closing/summary-emails", {
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-branch-id": branchId,
      },
    })
      .then(async (response) => (response.ok ? response.json() : undefined))
      .then((body) => {
        if (!controller.signal.aborted && body) setStatus(body);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [activeTenantId, branchId, canRead, isAllBranches]);

  if (!canRead) return null;
  if (isAllBranches)
    return (
      <Panel>
        <PanelHead title="Daily report email" />
        <p className="p-4 text-[13px] text-muted-foreground">
          Pick a branch to choose who gets its daily report.
        </p>
      </Panel>
    );

  const branch = repository.getBranch(activeTenantId, branchId);
  const cutoff = Number(branch.metadata["businessDayCutoffMinutes"] ?? 0);
  const endsAt = `${String(Math.floor(cutoff / 60)).padStart(2, "0")}:${String(cutoff % 60).padStart(2, "0")}`;
  // Same rule the server checks: an email address, this branch, and report access.
  const eligible = repository.snapshot().users.filter((user) => {
    if (user.tenantId !== activeTenantId || !user.active || !user.email) return false;
    const session = repository.getUserSession(activeTenantId, user.id);
    return (
      session.assignedBranchIds.includes(branchId) &&
      session.permissions.includes(permissions.reconciliationView)
    );
  });
  const selected = chosen ?? policy.recipientUserIds;
  const name = (id: string) => eligible.find((user) => user.id === id)?.name ?? "Former recipient";

  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      await engine.mutate("configureDailyClosing", {
        branchId,
        mode: policy.mode,
        materialVarianceMinor: policy.materialVarianceMinor,
        recipientUserIds: selected,
      });
      setChosen(null);
      setNotice(selected.length ? "Saved." : "Saved. Nobody will get the daily report.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHead title="Daily report email" />
      <div className="grid gap-3 p-4 text-[13px]">
        <p className="text-muted-foreground">
          Sent each day after the business day ends at {endsAt}. If a supervisor closes the day, the
          official closing report goes instead.
        </p>
        {status && !status.emailConfigured ? (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-warning">
            Email sending isn&apos;t set up on the server yet, so nothing will be sent.
          </p>
        ) : null}
        {eligible.length ? (
          <fieldset className="grid gap-2">
            <legend className="sr-only">People who get the daily report</legend>
            {eligible.map((user) => (
              <label key={user.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={selected.includes(user.id)}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked
                        ? [...selected, user.id]
                        : selected.filter((id) => id !== user.id),
                    )
                  }
                />
                <span>
                  {user.name}
                  <span className="ml-1 text-muted-foreground">{user.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-muted-foreground">
            Nobody can receive it yet. Give a manager an email and a role that can see reports.
          </p>
        )}
        {canEdit && chosen !== null ? (
          <div className="flex gap-2">
            <Btn variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Btn>
            <Btn disabled={busy} onClick={() => setChosen(null)}>
              Cancel
            </Btn>
          </div>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {status?.deliveries.length ? (
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Recent
            </div>
            <ul className="grid gap-1.5">
              {status.deliveries.slice(0, 5).map((delivery) => (
                <li
                  key={`${delivery.businessDate}:${delivery.recipientUserId}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {delivery.businessDate} · {name(delivery.recipientUserId)}
                  </span>
                  <Status>{statusLabel[delivery.status] ?? delivery.status}</Status>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
