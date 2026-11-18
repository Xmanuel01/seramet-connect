import { useMemo, useState, type FormEvent } from "react";
import { Copy, PlugZap, Save } from "lucide-react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";
import { uberConnectionId, uberWebhookUrl } from "@/lib/uber-eats-connection";

type Centre = ReturnType<typeof useSetupCentre>;
const providerId = "provider-delivery-uber-eats";
const inputClass = "h-10 w-full min-w-0 rounded-md border border-border bg-card px-3 text-[13px]";
const labelClass = "grid gap-1 text-[13px] font-semibold";

/** Turns a connection test result into words an owner can act on. */
function testOutcome(health: { status: string; message?: string }) {
  if (health.status === "HEALTHY") return undefined;
  if (health.status === "AUTH_ERROR")
    return "Uber didn't accept the client ID or secret. Check they belong to the chosen mode (testing or live).";
  if (health.status === "OFFLINE" || /fetch failed|network|timed? ?out/i.test(health.message ?? ""))
    return "Couldn't reach Uber. Check the internet connection, then test again.";
  return health.message ?? "The test didn't pass. Check the details and try again.";
}

const statusLabels: Record<string, string> = {
  SANDBOX: "Connected (testing)",
  ACTIVE: "Connected (live)",
  CONFIGURED: "Saved, not tested",
  CREDENTIALS_REQUIRED: "Credentials missing",
  AUTH_ERROR: "Uber rejected the credentials",
  DEGRADED: "Connected with problems",
  ERROR: "Can't reach Uber",
  DISABLED: "Turned off",
};

/**
 * Connects a branch to its Uber Eats store: Uber app credentials (stored
 * encrypted), the Uber store ID, the order channel orders arrive on, then a
 * live test against Uber. Shows the webhook address to paste into Uber.
 */
export function UberEatsConnect({ centre }: { centre: Centre }) {
  const { activeTenantId, hasPermission, switchableBranchRecords } = useAppContext();
  const canManage = hasPermission(permissions.settingsIntegrationManage);
  const allowed = switchableBranchRecords.map((branch) => branch.id);
  const branches = centre.structure.branches.filter(
    (branch) => branch.active && allowed.includes(branch.id),
  );
  const channels = useMemo(
    () =>
      getConfigurationRepository()
        .listOrderChannels(activeTenantId, true)
        .filter((channel) => channel.enabled),
    [activeTenantId],
  );
  const defaultChannel =
    channels.find((channel) => channel.channelType === "MARKETPLACE")?.id ?? channels[0]?.id ?? "";
  const connections = centre.integrations.filter(
    (item) => item.providerId === providerId && item.branchId && allowed.includes(item.branchId),
  );
  const [form, setForm] = useState({
    branchId: "",
    environment: "SANDBOX" as "SANDBOX" | "PRODUCTION",
    storeId: "",
    clientId: "",
    clientSecret: "",
    signingSecret: "",
    channelId: "",
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [webhooks, setWebhooks] = useState<Record<string, string>>({});
  const existing = connections.find((item) => item.branchId === form.branchId);
  const branchName = (id?: string) => branches.find((branch) => branch.id === id)?.name ?? id;

  async function test(connectionId: string) {
    // command() reloads Setup Centre afterwards, so the connection status updates.
    const result = await centre.command<{ health: { status: string; message?: string } }>(
      `/api/seramet/integrations/connections/${encodeURIComponent(connectionId)}/test`,
      {},
    );
    return result.health;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !canManage || !form.branchId) return;
    const channelId = form.channelId || defaultChannel;
    if (!channelId) {
      setNotice({
        kind: "error",
        text: "Add a Delivery apps order channel first (Setup Centre, Channels).",
      });
      return;
    }
    if (!existing && (!form.clientId.trim() || !form.clientSecret.trim())) {
      setNotice({ kind: "error", text: "Enter the client ID and client secret from Uber." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const connectionId = existing?.connectionId ?? uberConnectionId(form.branchId);
    try {
      const credentials = Object.fromEntries(
        Object.entries({
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          webhookSigningSecret: form.signingSecret.trim(),
        }).filter(([, value]) => value),
      );
      const saved = await centre.send<{ connection: { callbackUrl?: string } }>(
        "/api/seramet/setup/provider-connections",
        {
          id: connectionId,
          providerId,
          branchId: form.branchId,
          environment: form.environment,
          enabled: true,
          configuration: { orderChannelId: channelId },
          ...(Object.keys(credentials).length ? { credentials } : {}),
        },
      );
      if (form.storeId.trim())
        await centre.send("/api/seramet/integrations/mappings", {
          connectionId,
          branchId: form.branchId,
          resourceType: "STORE",
          internalId: form.branchId,
          externalId: form.storeId.trim(),
          status: "MAPPED",
        });
      setWebhooks((current) => ({
        ...current,
        [connectionId]:
          saved.connection.callbackUrl ?? uberWebhookUrl(connectionId, window.location.origin),
      }));
      setForm((current) => ({ ...current, clientSecret: "", signingSecret: "" }));
      const health = await test(connectionId);
      setNotice(
        health.status === "HEALTHY"
          ? {
              kind: "ok",
              text: `Connected to Uber Eats for ${branchName(form.branchId)}. Paste the webhook address below into your Uber app.`,
            }
          : { kind: "error", text: `Saved, but the test didn't pass. ${testOutcome(health)}` },
      );
    } catch (error) {
      setForm((current) => ({ ...current, clientSecret: "", signingSecret: "" }));
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Couldn't save the Uber Eats connection.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function retest(connectionId: string) {
    setBusy(true);
    setNotice(null);
    try {
      const health = await test(connectionId);
      setNotice(
        health.status === "HEALTHY"
          ? { kind: "ok", text: "Uber Eats answered. The connection works." }
          : { kind: "error", text: testOutcome(health)! },
      );
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The test couldn't run.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead
        title="Uber Eats"
        sub="Receive Uber Eats orders on your tills and kitchen screens."
        right={<PlugZap className="h-4 w-4 text-primary" />}
      />
      <div className="space-y-4 p-4 text-[13px]">
        {connections.map((item) => {
          const webhook =
            webhooks[item.connectionId] ??
            uberWebhookUrl(item.connectionId, window.location.origin);
          return (
            <div key={item.connectionId} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {branchName(item.branchId)} ·{" "}
                  {item.environment === "SANDBOX" ? "Testing" : "Live"}
                </span>
                <Status>{statusLabels[item.status] ?? item.status}</Status>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Webhook address for Uber:</span>
                <code className="break-all rounded bg-secondary px-2 py-1 text-[12px]">
                  {webhook}
                </code>
                <Btn
                  onClick={() => void navigator.clipboard?.writeText(webhook)}
                  title="Copy webhook address"
                >
                  <Copy className="h-4 w-4" />
                </Btn>
              </div>
              {canManage && (
                <Btn disabled={busy} onClick={() => void retest(item.connectionId)}>
                  Test connection
                </Btn>
              )}
            </div>
          );
        })}
        {canManage ? (
          <form onSubmit={(event) => void submit(event)} className="grid gap-3 md:grid-cols-2">
            <label className={labelClass}>
              Branch
              <select
                required
                className={inputClass}
                value={form.branchId}
                onChange={(event) => setForm({ ...form, branchId: event.target.value })}
              >
                <option value="">Select branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Mode
              <select
                className={inputClass}
                value={form.environment}
                onChange={(event) =>
                  setForm({
                    ...form,
                    environment: event.target.value as "SANDBOX" | "PRODUCTION",
                  })
                }
              >
                <option value="SANDBOX">Testing (Uber sandbox)</option>
                <option value="PRODUCTION">Live orders</option>
              </select>
            </label>
            <label className={labelClass}>
              Uber store ID
              <input
                className={inputClass}
                value={form.storeId}
                required={!existing}
                autoComplete="off"
                placeholder="From Uber: your store's UUID"
                onChange={(event) => setForm({ ...form, storeId: event.target.value })}
              />
            </label>
            <label className={labelClass}>
              Orders arrive as
              <select
                className={inputClass}
                value={form.channelId || defaultChannel}
                onChange={(event) => setForm({ ...form, channelId: event.target.value })}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Client ID
              <input
                className={inputClass}
                value={form.clientId}
                required={!existing}
                autoComplete="off"
                onChange={(event) => setForm({ ...form, clientId: event.target.value })}
              />
            </label>
            <label className={labelClass}>
              Client secret
              <input
                className={inputClass}
                type="password"
                value={form.clientSecret}
                required={!existing}
                autoComplete="new-password"
                onChange={(event) => setForm({ ...form, clientSecret: event.target.value })}
              />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              Webhook signing key (optional)
              <input
                className={inputClass}
                type="password"
                value={form.signingSecret}
                autoComplete="new-password"
                placeholder="Leave blank if Uber signs webhooks with your client secret"
                onChange={(event) => setForm({ ...form, signingSecret: event.target.value })}
              />
            </label>
            <p className="text-[12px] text-muted-foreground md:col-span-2">
              Find these in the Uber developer dashboard under your app. Secrets are stored
              encrypted and are never shown again.
              {existing && " Leave a field blank to keep what is saved."}
            </p>
            <div className="md:col-span-2">
              <Btn type="submit" variant="primary" disabled={busy || !form.branchId}>
                <Save className="h-4 w-4" />
                {busy ? "Connecting..." : existing ? "Save and test again" : "Connect and test"}
              </Btn>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground">
            Ask someone with integration-management rights to connect Uber Eats.
          </p>
        )}
        {notice && (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={notice.kind === "error" ? "text-danger" : "text-success"}
          >
            {notice.text}
          </p>
        )}
      </div>
    </Panel>
  );
}
