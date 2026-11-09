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
  SKIPPED: "Day closed",
  CONFIGURATION_REQUIRED: "Not set up",
  DELIVERY_FAILED: "Failed",
  RECONCILIATION_REQUIRED: "Check Brevo",
};

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Who gets the daily summary, and when. A closed day sends the closing report instead. */
export function DailyReportEmail({ engine }: { engine: Engine }) {
  const { activeTenantId, branchId, isAllBranches, hasPermission } = useAppContext();
  const repository = getConfigurationRepository();
  const policy = closingPolicy(engine.state, activeTenantId, branchId);
  const [draft, setDraft] = useState<{ people: string[]; sendAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<{ emailConfigured: boolean; deliveries: Delivery[] }>();
  const canEdit = !isAllBranches && hasPermission(permissions.reconciliationApprove);
  const canRead = hasPermission(permissions.reconciliationView);

  useEffect(() => {
    setDraft(null);
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

  if (!canRead || isAllBranches) return null;

  const branch = repository.getBranch(activeTenantId, branchId);
  const cutoff = Number(branch.metadata["businessDayCutoffMinutes"] ?? 0);
  // Any whole hour after the business day ends, plus the end itself.
  const times = [
    cutoff,
    ...Array.from({ length: 24 }, (_, hour) => hour * 60).filter((minutes) => minutes > cutoff),
  ];
  // The rule the server checks: an email address, this branch, and report access.
  const eligible = repository.snapshot().users.filter((user) => {
    if (user.tenantId !== activeTenantId || !user.active || !user.email) return false;
    const session = repository.getUserSession(activeTenantId, user.id);
    return (
      session.assignedBranchIds.includes(branchId) &&
      session.permissions.includes(permissions.reconciliationView)
    );
  });
  const people = draft?.people ?? policy.recipientUserIds;
  const sendAt = draft?.sendAt ?? policy.summarySendMinutes ?? cutoff;
  const edit = (next: Partial<{ people: string[]; sendAt: number }>) =>
    setDraft({ people, sendAt, ...next });
  const name = (id: string) => eligible.find((user) => user.id === id)?.name ?? "Removed";

  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      await engine.mutate("configureDailyClosing", {
        branchId,
        mode: policy.mode,
        materialVarianceMinor: policy.materialVarianceMinor,
        recipientUserIds: people,
        summarySendMinutes: sendAt,
      });
      setDraft(null);
      setNotice("Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHead
        title="Daily report email"
        right={
          status && !status.emailConfigured ? (
            <Status className="bg-warning-soft text-warning">Email not set up</Status>
          ) : undefined
        }
      />
      <div className="grid gap-3 p-4 text-[13px]">
        <label className="flex items-center justify-between gap-3">
          Send at
          <select
            className="h-8 rounded-md border border-border bg-card px-2"
            disabled={!canEdit || busy}
            value={sendAt}
            onChange={(event) => edit({ sendAt: Number(event.target.value) })}
          >
            {times.map((minutes) => (
              <option key={minutes} value={minutes}>
                {clock(minutes)}
              </option>
            ))}
          </select>
        </label>
        {eligible.length ? (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-muted-foreground">Send to</legend>
            {eligible.map((user) => (
              <label key={user.id} className="flex items-center gap-2" title={user.email}>
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={people.includes(user.id)}
                  onChange={(event) =>
                    edit({
                      people: event.target.checked
                        ? [...people, user.id]
                        : people.filter((id) => id !== user.id),
                    })
                  }
                />
                {user.name}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-muted-foreground">Add a manager with an email first.</p>
        )}
        {canEdit && draft ? (
          <div className="flex gap-2">
            <Btn variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Btn>
            <Btn disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Btn>
          </div>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {status?.deliveries.length ? (
          <ul className="grid gap-1.5 border-t border-border pt-3">
            {status.deliveries.slice(0, 3).map((delivery) => (
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
        ) : null}
      </div>
    </Panel>
  );
}
