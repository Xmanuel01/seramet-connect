import { useState } from "react";
import { staffRolePresets } from "@/platform/staff-role-presets";
import { Btn } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
export function StaffRolePreset({ roleId, disabled }: { roleId: string; disabled: boolean }) {
  const { activeTenantId, refreshAccess } = useAppContext();
  const [preset, setPreset] = useState("chef"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function save() {
    if (!confirmed || disabled || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const token = getSerametAccessToken();
      const response = await fetch(
        `/api/seramet/access/roles/${encodeURIComponent(roleId)}/permissions`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-seramet-tenant-id": activeTenantId,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            permissions: staffRolePresets[preset]!.permissions,
            reason: "Owner applied operational staff access preset",
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw Error(result.message ?? "Role update was not confirmed.");
      setConfirmed(false);
      await refreshAccess();
      setMessage(
        "Role permissions saved. Employee branches and preparation stations are assigned separately.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Role update failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="my-3 grid gap-2 border-y border-border py-3 text-sm">
      <label className="grid gap-1">
        Operational preset
        <select
          value={preset}
          className="min-h-10 rounded border bg-background px-2"
          disabled={disabled || busy}
          onChange={(e) => {
            setPreset(e.target.value);
            setConfirmed(false);
          }}
        >
          {Object.entries(staffRolePresets).map(([id, value]) => (
            <option key={id} value={id}>
              {value.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled || busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Replace the selected role's existing permissions with this preset
      </label>
      <Btn disabled={disabled || busy || !confirmed} onClick={() => void save()}>
        Apply operational preset
      </Btn>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
