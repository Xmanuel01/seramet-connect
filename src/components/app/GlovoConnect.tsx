import { useState, type FormEvent } from "react";
import { Btn, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";
import type { GlovoStoreLinkInput } from "@/onboarding/types";

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const labelClass = "grid min-w-0 gap-1.5 text-[12px] font-semibold text-muted-foreground";

export function GlovoConnect({ centre }: { centre: ReturnType<typeof useSetupCentre> }) {
  const { platformState, activeTenantId } = useAppContext();
  const branches = centre.structure.branches;
  const channels = platformState.orderChannels.filter(
    (channel) =>
      channel.tenantId === activeTenantId && channel.enabled && channel.channelType === "MARKETPLACE",
  );
  const connections = centre.integrations.filter(
    (row) => row.providerId === "provider-delivery-glovo",
  );
  const [form, setForm] = useState({
    branchId: "",
    environment: "SANDBOX" as GlovoStoreLinkInput["environment"],
    chainId: "",
    storeId: "",
    storeName: "",
    orderChannelId: "",
    webhookHeaderName: "",
    clientId: "",
    clientSecret: "",
    webhookToken: "",
  });
  const branchId = form.branchId || branches[0]?.id || "";
  const channelId =
    form.orderChannelId || channels.find((channel) => /glovo/i.test(channel.displayName))?.id || "";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setCallbackUrl("");
    try {
      const result = await centre.send<{
        connection: { callbackUrl?: string };
        store: { name: string };
      }>("/api/seramet/setup/glovo/link", {
        branchId,
        environment: form.environment,
        chainId: form.chainId,
        storeId: form.storeId,
        storeName: form.storeName,
        orderChannelId: channelId,
        webhookHeaderName: form.webhookHeaderName,
        credentials: {
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          webhookToken: form.webhookToken,
        },
      } satisfies GlovoStoreLinkInput);
      setForm((current) => ({
        ...current,
        storeId: "",
        storeName: "",
        clientId: "",
        clientSecret: "",
        webhookToken: "",
      }));
      setCallbackUrl(result.connection.callbackUrl ?? "");
      setNotice({
        error: false,
        text: `${result.store.name} saved. Configure its webhook with Glovo before receiving orders.`,
      });
      await centre.refresh().catch(() => undefined);
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Glovo store could not be saved",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Panel>
        <PanelHead title="Glovo" sub={`${connections.length} configured`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr>
                <TH>Store</TH>
                <TH>Branch</TH>
                <TH>Mode</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {connections.map((row) => {
                const mapping = centre.mappings.find(
                  (item) =>
                    item["connectionId"] === row.connectionId && item["resourceType"] === "STORE",
                );
                const metadata = (mapping?.["metadata"] ?? {}) as Record<string, unknown>;
                return (
                  <tr key={row.connectionId}>
                    <TD>{String(metadata["displayName"] ?? mapping?.["externalId"] ?? "Glovo")}</TD>
                    <TD>{branches.find((item) => item.id === row.branchId)?.name ?? "—"}</TD>
                    <TD>{row.environment === "SANDBOX" ? "Testing" : "Live"}</TD>
                    <TD>
                      <Status>{row.status}</Status>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!connections.length && (
          <p className="p-4 text-[13px] text-muted-foreground">No Glovo stores configured yet.</p>
        )}
      </Panel>
      <Panel>
        <PanelHead title="Add a Glovo store" sub="Use the details supplied by Glovo Partner API." />
        <form onSubmit={(event) => void submit(event)} className="grid gap-3 p-4">
          <label className={labelClass}>
            Branch
            <select
              required
              value={branchId}
              onChange={(event) => set("branchId", event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a branch</option>
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
              value={form.environment}
              onChange={(event) =>
                set("environment", event.target.value as GlovoStoreLinkInput["environment"])
              }
              className={inputClass}
            >
              <option value="SANDBOX">Testing</option>
              <option value="PRODUCTION">Live</option>
            </select>
          </label>
          <label className={labelClass}>
            Order channel
            <select
              required
              value={channelId}
              onChange={(event) => set("orderChannelId", event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a marketplace channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.displayName}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["storeName", "Store name", false],
              ["chainId", "Glovo chain ID", false],
              ["storeId", "Glovo vendor ID", false],
              ["clientId", "Partner client ID", true],
              ["clientSecret", "Partner client secret", true],
              ["webhookHeaderName", "Webhook authentication header", false],
              ["webhookToken", "Webhook authentication token", true],
            ] as const
          ).map(([key, label, secret]) => (
            <label key={key} className={labelClass}>
              {label}
              <input
                required
                type={secret ? "password" : "text"}
                value={form[key]}
                autoComplete="off"
                onChange={(event) => set(key, event.target.value)}
                className={inputClass}
              />
            </label>
          ))}
          {notice && (
            <p
              role="status"
              className={notice.error ? "text-[12px] text-danger" : "text-[12px] text-foreground"}
            >
              {notice.text}
            </p>
          )}
          {callbackUrl && (
            <label className={labelClass}>
              Glovo webhook URL
              <input readOnly value={callbackUrl} className={inputClass} />
            </label>
          )}
          <Btn type="submit" variant="primary" disabled={busy || !branchId || !channelId}>
            {busy ? "Verifying store..." : "Verify and add store"}
          </Btn>
        </form>
      </Panel>
    </div>
  );
}
