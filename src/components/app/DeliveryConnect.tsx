import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";

type Centre = ReturnType<typeof useSetupCentre>;
const inputClass = "h-10 w-full min-w-0 rounded-md border border-border bg-card px-3 text-[13px]";

export function DeliveryConnect({ centre }: { centre: Centre }) {
  const {
    activeTenantId,
    branchId,
    hasPermission,
    currentUser,
    role,
    isAllBranches,
    sessionId,
    permissions: granted,
    switchableBranchRecords,
  } = useAppContext();
  return (
    <DeliveryForm
      key={JSON.stringify([
        activeTenantId,
        branchId,
        currentUser.id,
        role,
        isAllBranches,
        sessionId,
        granted,
      ])}
      centre={centre}
      allowedBranchIds={switchableBranchRecords.map((branch) => branch.id)}
      canManage={hasPermission(permissions.settingsIntegrationManage)}
    />
  );
}

function DeliveryForm({
  centre,
  canManage,
  allowedBranchIds,
}: {
  centre: Centre;
  canManage: boolean;
  allowedBranchIds: string[];
}) {
  const [branchId, setBranchId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const [connectionId, setConnectionId] = useState(() => `uber-testing-${crypto.randomUUID()}`);
  const connections = centre.integrations.filter(
    (item) =>
      item.providerId === "provider-delivery-uber-eats" &&
      Boolean(item.branchId && allowedBranchIds.includes(item.branchId)),
  );
  const existing = connections.some((item) => item.branchId === branchId);
  const unavailable =
    centre.status !== "ready" || centre.unavailableResources.includes("provider health");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      busy ||
      saved ||
      existing ||
      unavailable ||
      !canManage ||
      !branchId ||
      !allowedBranchIds.includes(branchId) ||
      !clientId.trim() ||
      !clientSecret.trim()
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      await centre.command("/api/seramet/setup/provider-connections", {
        id: connectionId,
        providerId: "provider-delivery-uber-eats",
        branchId,
        environment: "SANDBOX",
        enabled: false,
        credentials: { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
      });
      setClientSecret("");
      setSaved(true);
      setNotice("Testing credentials saved. Connection is disabled pending verification.");
    } catch {
      setClientSecret("");
      setNotice(
        "Credentials could not be saved. Check your permissions and protected credential storage, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Uber Eats" sub="Testing connection" />
      <div className="space-y-4 p-4">
        {connections.map((item) => (
          <div
            key={item.connectionId}
            className="flex flex-wrap items-center gap-3 border-b border-border pb-3"
          >
            <span>
              {centre.structure.branches.find((branch) => branch.id === item.branchId)?.name ??
                item.branchId}
            </span>
            <span>{item.environment === "SANDBOX" ? "Testing" : "Live"}</span>
            <Status>{item.status}</Status>
          </div>
        ))}
        <form onSubmit={(event) => void submit(event)} className="max-w-xl space-y-3">
          <fieldset disabled={!canManage || busy || unavailable} className="min-w-0 space-y-3">
            <label className="grid gap-1 text-sm">
              Branch
              <select
                required
                className={inputClass}
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value);
                  setClientId("");
                  setClientSecret("");
                  setNotice("");
                  setSaved(false);
                  setConnectionId(`uber-testing-${crypto.randomUUID()}`);
                }}
              >
                <option value="">Select branch</option>
                {centre.structure.branches
                  .filter((branch) => branch.active && allowedBranchIds.includes(branch.id))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Testing client ID
              <input
                required
                autoComplete="off"
                className={inputClass}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Testing client secret
              <input
                required
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
              />
            </label>
            <Btn
              type="submit"
              variant="primary"
              disabled={saved || existing || !branchId || !clientId.trim() || !clientSecret.trim()}
            >
              <Save className="h-4 w-4" />
              {busy ? "Saving..." : "Save testing credentials"}
            </Btn>
          </fieldset>
          {!canManage && <p role="status">Integration management permission is required.</p>}
          {existing && (
            <p role="status">
              This branch already has an Uber Eats connection. It has not been changed.
            </p>
          )}
          {unavailable && (
            <p role="status">Connection status is unavailable. Refresh before saving.</p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
        </form>
      </div>
    </Panel>
  );
}
