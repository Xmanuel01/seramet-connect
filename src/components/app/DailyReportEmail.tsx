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
const minutesOf = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** Who gets the daily summary, and when. A closed day sends the closing report instead. */
export function DailyReportEmail({ engine }: { engine: Engine }) {
  const { activeTenantId, branchId, isAllBranches, hasPermission } = useAppContext();
  const repository = getConfigurationRepository();
  const policy = closingPolicy(engine.state, activeTenantId, branchId);
  const [draft, setDraft] = useState<{ people: string[]; sendAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<{ emailConfigured: boolean; deliveries: Delivery[] }>();
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [loaded, setLoaded] = useState(0);
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
  }, [activeTenantId, branchId, canRead, isAllBranches, loaded]);

  if (!canRead || isAllBranches) return null;

  const branch = repository.getBranch(activeTenantId, branchId);
  const cutoff = Number(branch.metadata["businessDayCutoffMinutes"] ?? 0);
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

  const sendNow = async () => {
    setBusy(true);
    setNotice("");
    try {
      const token = getSerametAccessToken();
      const response = await fetch("/api/seramet/daily-closing/summary-emails/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "x-seramet-tenant-id": activeTenantId,
          "x-seramet-branch-id": branchId,
        },
        body: JSON.stringify({ recipientUserIds: people, day }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Couldn't send. Try again.");
      setNotice(
        `Sending to ${people.length === 1 ? name(people[0]!) : `${people.length} people`}.`,
      );
      // Show it in the list once the worker has picked it up.
      setTimeout(() => setLoaded((value) => value + 1), 1_500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

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
          <input
            type="time"
            step={300}
            className="h-8 rounded-md border border-border bg-card px-2"
            disabled={!canEdit || busy}
            value={clock(sendAt)}
            min={clock(cutoff)}
            onChange={(event) => {
              const minutes = minutesOf(event.target.value);
              if (event.target.value && minutes >= cutoff) edit({ sendAt: minutes });
            }}
          />
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
        {people.length && status?.emailConfigured ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <select
              aria-label="Which day"
              className="h-8 rounded-md border border-border bg-card px-2"
              disabled={busy}
              value={day}
              onChange={(event) => setDay(event.target.value as "today" | "yesterday")}
            >
              <option value="today">Today so far</option>
              <option value="yesterday">Yesterday</option>
            </select>
            <Btn disabled={busy} onClick={() => void sendNow()}>
              Send now
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
