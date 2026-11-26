import { useState } from "react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { kitchenModeLabels } from "@/lib/printer-labels";
import type { KitchenOperatingMode } from "@/lib/seramet-print-service";

const modes: KitchenOperatingMode[] = [
  "KDS_ONLY",
  "KDS_AND_PRINTER",
  "PRINTER_ONLY",
  "NO_DEDICATED_KITCHEN_SYSTEM",
];

/** Lets a manager choose how kitchen orders reach the kitchen for the active branch. */
export function KitchenModeChooser({ current }: { current?: KitchenOperatingMode }) {
  const { activeTenantId, branchId, hasPermission, refreshConfiguration } = useAppContext();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const mayManage = hasPermission(permissions.settingsHardwareManage);

  const choose = async (kitchenMode: KitchenOperatingMode) => {
    setBusy(true);
    setNotice("");
    try {
      const token = getSerametAccessToken();
      const response = await authenticatedFetch("/api/seramet/printing/kitchen-mode", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-seramet-branch-id": branchId,
          "x-seramet-tenant-id": activeTenantId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kitchenMode }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "Couldn't save. Try again.");
      }
      await refreshConfiguration();
      window.dispatchEvent(
        new CustomEvent("seramet:hardware-profile-change", { detail: { branchId } }),
      );
      setNotice("Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex flex-wrap items-center gap-2 text-[12px] font-semibold">
      Kitchen orders go to
      <select
        className="h-9 rounded-md border border-border bg-card px-2 text-[12px]"
        value={current ?? ""}
        disabled={!mayManage || busy}
        onChange={(event) => void choose(event.target.value as KitchenOperatingMode)}
      >
        {!current && <option value="">Choose…</option>}
        {modes.map((mode) => (
          <option key={mode} value={mode}>
            {kitchenModeLabels[mode]}
          </option>
        ))}
      </select>
      {notice && <span className="font-normal text-muted-foreground">{notice}</span>}
    </label>
  );
}
