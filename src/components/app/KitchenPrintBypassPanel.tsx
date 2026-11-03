import { useState } from "react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { activeKitchenPrintBypass, KITCHEN_PRINT_BYPASS_HOURS } from "@/lib/kitchen-print-bypass";
import { RequestError, reportError } from "@/lib/user-facing-error";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";

/**
 * Lets a manager send orders to the kitchen without a printer or KDS route for
 * 36 hours, for example while a printer is replaced. The server keeps the
 * window and files tickets sent during it as bypassed, so none print later.
 */
export function KitchenPrintBypassPanel() {
  const { activeTenantId, branchId, branchRecords, hasPermission, refreshConfiguration, timeZone } =
    useAppContext();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const branch = branchRecords.find((record) => record.id === branchId);
  const bypass = activeKitchenPrintBypass(branch?.metadata);
  const canManage = hasPermission(permissions.settingsHardwareManage);
  const until = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: branch?.timezone ?? timeZone,
    }).format(new Date(iso));

  const send = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setNotice("");
    try {
      const token = getSerametAccessToken();
      const response = await authenticatedFetch("/api/seramet/printing/dispatch-bypass", {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-seramet-branch-id": branchId,
          "x-seramet-tenant-id": activeTenantId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify({ reason: reason.trim() }) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new RequestError(response.status, body.message ?? "");
      }
      await refreshConfiguration();
      setReason("");
      setNotice(
        method === "POST"
          ? `Bypass on. Orders can go to the kitchen without a printer for ${KITCHEN_PRINT_BYPASS_HOURS} hours.`
          : "Bypass off. Orders need a working printer or KDS route again.",
      );
    } catch (error) {
      setNotice(reportError(error, "Couldn't change the printer bypass. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="mb-4">
      <PanelHead
        title="Printer bypass"
        sub={`Send orders to the kitchen without a printer or KDS for ${KITCHEN_PRINT_BYPASS_HOURS} hours. Tickets sent meanwhile are never printed later.`}
        right={<Status>{bypass ? "On" : "Off"}</Status>}
      />
      <div className="space-y-3 p-4 text-[13px]">
        {bypass ? (
          <>
            <p>
              On until <span className="font-semibold">{until(bypass.until)}</span>, turned on by{" "}
              {bypass.startedBy || "a manager"}
              {bypass.reason ? `: "${bypass.reason}"` : "."}
            </p>
            {canManage && (
              <Btn onClick={() => void send("DELETE")} disabled={busy}>
                Turn off now
              </Btn>
            )}
          </>
        ) : canManage ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[260px] flex-1 gap-1 text-[12px] font-semibold text-muted-foreground">
              Reason
              <input
                value={reason}
                maxLength={240}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Kitchen printer is being replaced"
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
              />
            </label>
            <Btn
              variant="primary"
              onClick={() => void send("POST")}
              disabled={busy || reason.trim().length < 12}
              title={
                reason.trim().length < 12 ? "Give a reason of at least 12 characters." : undefined
              }
            >
              Turn on for {KITCHEN_PRINT_BYPASS_HOURS} hours
            </Btn>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Ask a manager to turn the bypass on if a printer is down.
          </p>
        )}
        {notice && <p className="font-semibold">{notice}</p>}
      </div>
    </Panel>
  );
}
