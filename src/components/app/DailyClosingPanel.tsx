import { useEffect, useRef, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { Btn, Status } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppContext } from "@/lib/app-context";
import type { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  closingPolicy,
  drawersForDay,
  type ClosingMode,
  type DrawerCount,
} from "@/payments/daily-closing";
import { financialCloseReadiness, projectFinancialLifecycle } from "@/lib/financial-lifecycle";
import { formatMinor, majorFromMinor, parseMajorAmount, sumMinor } from "@/payments/money";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { permissions } from "@/platform/permissions";
import { getSerametAccessToken } from "@/lib/access-token";

type Engine = ReturnType<typeof useTransactionEngine>;
export function DailyClosingPanel({ engine }: { engine: Engine }) {
  const {
    activeTenantId,
    branchId,
    branchLabel,
    currentUser,
    hasPermission,
    isAllBranches,
    timeZone,
  } = useAppContext();
  const { state, mutate, backendStatus, pendingSyncCount, activeMutationCount } = engine;
  const repository = getConfigurationRepository();
  const branch = repository.getBranch(activeTenantId, branchId);
  const currency = repository.getTenant(activeTenantId).defaultCurrency;
  const zone = branch.timezone ?? timeZone;
  const cutoff = Number(branch.metadata["businessDayCutoffMinutes"] ?? 0);
  const [currentDate, setCurrentDate] = useState("");
  const policy = closingPolicy(state, activeTenantId, branchId);
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);
  const [targetShift, setTargetShift] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmFingerprint, setConfirmFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<ClosingMode>(policy.mode);
  const [threshold, setThreshold] = useState(
    String(majorFromMinor(policy.materialVarianceMinor, currency)),
  );
  const [recipients, setRecipients] = useState<string[]>(policy.recipientUserIds);
  const lock = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const token = getSerametAccessToken();
    void fetch("/api/seramet/daily-closing/context", {
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-branch-id": branchId,
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Authoritative closing date is unavailable");
        const context = (await response.json()) as { branchId: string; businessDate: string };
        if (context.branchId !== branchId || !/^\d{4}-\d{2}-\d{2}$/.test(context.businessDate))
          throw new Error("Closing context does not match the selected branch");
        if (!controller.signal.aborted) {
          setCurrentDate(context.businessDate);
          setDate(context.businessDate);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setNotice(error instanceof Error ? error.message : "Closing context unavailable");
      });
    return () => controller.abort();
  }, [activeTenantId, branchId]);
  const drawers = drawersForDay(state, activeTenantId, branchId, date);
  const selectedDrawers = targetShift ? drawers.filter((d) => d.id === targetShift) : drawers;
  const countsNeeded = selectedDrawers.filter((d) => d.status === "OPEN");
  const projection = projectFinancialLifecycle(state, {
    tenantId: activeTenantId,
    branchId,
    businessDate: date,
    currency,
    timeZone: zone,
    businessDayCutoffMinutes: cutoff,
  });
  const readiness = financialCloseReadiness(state, {
    tenantId: activeTenantId,
    branchId,
    businessDate: date,
    timeZone: zone,
    businessDayCutoffMinutes: cutoff,
  });
  const fingerprint = JSON.stringify({
    date,
    projection: { ...projection, calculatedAt: undefined },
    drawers,
    readiness,
  });
  const canClose = targetShift
    ? hasPermission(permissions.cashClose)
    : hasPermission(permissions.reconciliationApprove);
  const unavailable =
    !currentDate ||
    !date ||
    isAllBranches ||
    backendStatus !== "synced" ||
    pendingSyncCount > 0 ||
    activeMutationCount > 0;
  const days = (state.paymentOperations?.dayCloses ?? []).filter(
    (d) => d.branchId === branchId && d.tenantId === activeTenantId,
  );
  const closed = days.some((d) => d.businessDate === date && d.status === "CLOSED");
  const eligible = repository.snapshot().users.filter((user) => {
    if (user.tenantId !== activeTenantId || !user.active) return false;
    const session = repository.getUserSession(activeTenantId, user.id);
    return (
      session.assignedBranchIds.includes(branchId) &&
      session.permissions.includes(permissions.reconciliationView)
    );
  });
  function readCounts(): DrawerCount[] {
    return countsNeeded.map((drawer) => ({
      drawerSessionId: drawer.id,
      varianceReason: reasons[drawer.id],
      countedByCurrency: Object.fromEntries(
        Object.keys(drawer.currencyBalances).map((code) => {
          const value = counts[`${drawer.id}:${code}`];
          if (!value?.trim()) throw new Error(`Enter the ${code} physical cash count`);
          const minor = parseMajorAmount(value, code);
          if (minor < 0) throw new Error("Cash count cannot be negative");
          return [code, minor];
        }),
      ),
    }));
  }
  function varianceFor(drawerId: string, code: string, expected: number) {
    const value = counts[`${drawerId}:${code}`];
    if (!value?.trim()) return "Enter physical count";
    try {
      return formatMinor(sumMinor([parseMajorAmount(value, code), -expected]), code);
    } catch {
      return "Invalid cash count";
    }
  }
  async function submit() {
    if (lock.current || unavailable || confirmFingerprint !== fingerprint) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const entries = readCounts();
      if (targetShift) await mutate("closeCashierShift", entries[0]);
      else
        await mutate("closeBusinessDay", {
          businessDate: date,
          drawerCounts: policy.mode === "SUPERVISOR_DAILY_CLOSE" ? entries : [],
          confirmed: true,
        });
      setOpen(false);
      setConfirmFingerprint(null);
      setCounts({});
      setReasons({});
      setNotice(
        targetShift
          ? "Cashier shift closed. Branch business day remains open."
          : "Business day closed. The immutable report is available below.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Closing failed");
      setConfirmFingerprint(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download(dayId: string, revision: number) {
    setNotice("");
    try {
      const token = getSerametAccessToken();
      const response = await fetch(
        `/api/seramet/daily-closing/reports/${encodeURIComponent(dayId)}/${revision}.pdf`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-seramet-tenant-id": activeTenantId,
            "x-seramet-branch-id": branchId,
          },
        },
      );
      if (!response.ok) throw new Error(`Report download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daily-closing-${date}-r${revision}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Report unavailable");
    }
  }
  return (
    <section className="space-y-4 p-4" aria-label="Daily closing">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-sm">
          Business date
          <input
            aria-label="Closing business date"
            type="date"
            max={currentDate}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setCounts({});
              setReasons({});
            }}
            className="rounded-md border p-2"
          />
        </label>
        <Btn
          variant="primary"
          disabled={unavailable || closed || !hasPermission(permissions.reconciliationApprove)}
          onClick={() => {
            setTargetShift(null);
            setConfirmFingerprint(null);
            setOpen(true);
            setNotice("");
          }}
        >
          <ShieldCheck className="h-4 w-4" />
          Close Business Day
        </Btn>
      </div>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {unavailable && (
        <p className="text-sm text-muted-foreground">
          Select one branch and resolve pending saves or offline work before closing.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Invoiced", projection.invoicedMinor],
          ["Collections", projection.collectedMinor],
          ["Completed refunds", projection.refundsMinor],
        ].map(([label, amount]) => (
          <div key={String(label)}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <strong>{formatMinor(Number(amount), currency)}</strong>
          </div>
        ))}
      </div>
      {policy.mode === "MULTI_CASHIER_SHIFTS" &&
        drawers
          .filter(
            (d) =>
              d.status === "OPEN" &&
              (d.employeeId === currentUser.id || hasPermission(permissions.reconciliationApprove)),
          )
          .map((d) => (
            <div key={d.id} className="flex flex-wrap justify-between gap-2 border-t py-3">
              <span>
                Cashier {d.employeeId} / {d.id}
              </span>
              <Btn
                disabled={unavailable || !hasPermission(permissions.cashClose)}
                onClick={() => {
                  setTargetShift(d.id);
                  setConfirmFingerprint(null);
                  setOpen(true);
                }}
              >
                End Shift
              </Btn>
            </div>
          ))}
      <div className="border-t pt-4">
        <h3 className="font-semibold">Closing reports</h3>
        {days.flatMap((day) =>
          day.snapshots
            .filter((s) => s.dailyReport)
            .map((snapshot) => (
              <div
                key={`${day.id}:${snapshot.revision}`}
                className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
              >
                <div>
                  {day.businessDate} / Revision {snapshot.revision} <Status>{day.status}</Status>
                </div>
                <Btn
                  disabled={!hasPermission(permissions.reconciliationView)}
                  onClick={() => void download(day.id, snapshot.revision)}
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Btn>
              </div>
            )),
        )}
      </div>
      {hasPermission(permissions.reconciliationApprove) && (
        <details className="border-t pt-4">
          <summary>Branch closing settings</summary>
          <div className="mt-3 grid max-w-xl gap-3">
            <label className="grid gap-1 text-sm">
              Closing mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ClosingMode)}
                className="rounded-md border p-2"
              >
                <option value="SUPERVISOR_DAILY_CLOSE">Supervisor-led daily closing</option>
                <option value="MULTI_CASHIER_SHIFTS">Multiple cashier shifts</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Material variance threshold ({currency})
              <input
                type="number"
                min="0.01"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="rounded-md border p-2"
              />
            </label>
            <fieldset>
              <legend className="text-sm">Management report recipients</legend>
              {eligible.map((user) => (
                <label key={user.id} className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={recipients.includes(user.id)}
                    onChange={(e) =>
                      setRecipients((ids) =>
                        e.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id),
                      )
                    }
                  />
                  {user.name}
                </label>
              ))}
            </fieldset>
            <Btn
              disabled={unavailable || busy}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                try {
                  await mutate("configureDailyClosing", {
                    branchId,
                    mode,
                    materialVarianceMinor: parseMajorAmount(threshold, currency),
                    recipientUserIds: recipients,
                  });
                  setNotice("Closing settings saved.");
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : "Settings were not saved");
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              Save closing settings
            </Btn>
          </div>
        </details>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancel.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{targetShift ? "End cashier shift" : "Close Business Day"}</DialogTitle>
            <DialogDescription>
              {branchLabel} / {date} / {zone}. Supervisor: {currentUser.name}.
            </DialogDescription>
          </DialogHeader>
          {!confirmFingerprint ? (
            <div className="space-y-4">
              <h3 className="font-semibold">1. Review financial summary</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {[
                  ["Invoiced", projection.invoicedMinor],
                  ["Collections", projection.collectedMinor],
                  ["Tax on settled invoices", projection.taxMinor],
                  ["Completed refunds", projection.refundsMinor],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{label}</dt>
                    <dd className="font-semibold">{formatMinor(Number(value), currency)}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="font-semibold">2. Reconcile cash</h3>
              {selectedDrawers.map((drawer) => (
                <fieldset key={drawer.id} className="space-y-2 border-t py-3">
                  <legend className="text-sm">
                    Cashier {drawer.employeeId} / {drawer.id} / {drawer.status}
                  </legend>
                  {Object.entries(drawer.currencyBalances).map(([code, balance]) => (
                    <div key={code} className="grid gap-2 text-sm sm:grid-cols-2">
                      <span>
                        Opening {formatMinor(balance.openingFloatMinor, code)}; expected{" "}
                        {formatMinor(balance.expectedCashMinor, code)}
                      </span>
                      {drawer.status === "OPEN" ? (
                        <label>
                          Counted {code}
                          <input
                            aria-label={`Counted ${code} ${drawer.id}`}
                            inputMode="decimal"
                            value={counts[`${drawer.id}:${code}`] ?? ""}
                            onChange={(e) =>
                              setCounts((values) => ({
                                ...values,
                                [`${drawer.id}:${code}`]: e.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-md border p-2"
                          />
                          <span className="mt-1 block">
                            Variance: {varianceFor(drawer.id, code, balance.expectedCashMinor)}
                          </span>
                        </label>
                      ) : (
                        <span>
                          Counted{" "}
                          {balance.countedCashMinor === undefined
                            ? "Not recorded"
                            : formatMinor(balance.countedCashMinor, code)}
                        </span>
                      )}
                    </div>
                  ))}
                  {drawer.status === "OPEN" && (
                    <label className="block text-sm">
                      Variance explanation
                      <input
                        value={reasons[drawer.id] ?? ""}
                        onChange={(e) =>
                          setReasons((values) => ({ ...values, [drawer.id]: e.target.value }))
                        }
                        className="mt-1 w-full rounded-md border p-2"
                      />
                    </label>
                  )}
                </fieldset>
              ))}
              <h3 className="font-semibold">3. Review outstanding obligations</h3>
              <ul className="space-y-1 text-sm">
                {readiness.map((issue) => (
                  <li key={issue.id}>
                    {issue.code === "UNSETTLED_INVOICE"
                      ? "Reported receivable"
                      : issue.code === "OPEN_CASH_DRAWER" &&
                          policy.mode === "SUPERVISOR_DAILY_CLOSE"
                        ? "Finalized with this close"
                        : "Requires review"}
                    : {issue.message} ({issue.sourceId})
                  </li>
                ))}
              </ul>
              {notice && (
                <p role="alert" className="text-sm text-destructive">
                  {notice}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <h3 className="font-semibold">Confirm closure</h3>
              <p>
                Invoiced: {formatMinor(projection.invoicedMinor, currency)}. Collections:{" "}
                {formatMinor(projection.collectedMinor, currency)}.
              </p>
              {countsNeeded.map((drawer) => (
                <div key={drawer.id} className="border-t py-2">
                  <strong>Cashier {drawer.employeeId}</strong>
                  {Object.entries(drawer.currencyBalances).map(([code, balance]) => (
                    <p key={code}>
                      {code}: expected {formatMinor(balance.expectedCashMinor, code)}; counted{" "}
                      {counts[`${drawer.id}:${code}`]}; variance{" "}
                      {varianceFor(drawer.id, code, balance.expectedCashMinor)}.
                    </p>
                  ))}
                  {reasons[drawer.id] && <p>Reason: {reasons[drawer.id]}</p>}
                </div>
              ))}
              <p>
                The closing financial snapshot will be immutable. Ordinary transactions cannot be
                backdated into the closed period. A report or email failure will not undo the
                financial close.
              </p>
              {confirmFingerprint !== fingerprint && (
                <p role="alert">Financial state changed. Return to review before confirming.</p>
              )}
              {notice && <p role="alert">{notice}</p>}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              ref={cancel}
              disabled={busy}
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            {confirmFingerprint && (
              <Btn disabled={busy} onClick={() => setConfirmFingerprint(null)}>
                Back to review
              </Btn>
            )}
            <Btn
              variant="primary"
              disabled={
                busy ||
                unavailable ||
                !canClose ||
                (!!confirmFingerprint && confirmFingerprint !== fingerprint)
              }
              onClick={() => {
                if (confirmFingerprint) void submit();
                else {
                  try {
                    if (targetShift || policy.mode === "SUPERVISOR_DAILY_CLOSE") readCounts();
                    setConfirmFingerprint(fingerprint);
                    setNotice("");
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : "Check cash counts");
                  }
                }
              }}
            >
              {busy
                ? "Closing..."
                : confirmFingerprint
                  ? targetShift
                    ? "Confirm & End Shift"
                    : "Confirm & Close Business Day"
                  : "Review confirmation"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
