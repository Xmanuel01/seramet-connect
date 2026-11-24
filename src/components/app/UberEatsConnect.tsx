import { useEffect, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { Btn, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";

const uberProviderId = "provider-delivery-uber-eats";
const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
const labelClass = "grid min-w-0 gap-1.5 text-[12px] font-semibold text-muted-foreground";

type StoreChoice = { storeId: string; name: string; address?: string };
type Environment = "SANDBOX" | "PRODUCTION";

const signInErrors: Record<string, string> = {
  expired: "The Uber sign-in took too long or was started elsewhere. Start again.",
  declined: "Uber sign-in was cancelled.",
  config: "Uber Eats is not switched on for this server yet.",
  uber: "Uber did not finish the sign-in. Try again in a moment.",
};

/**
 * Links a branch to its Uber Eats store: the owner signs in to Uber, picks the store, and Uber
 * then sends that store's orders to Seramet. No Uber keys are typed by the restaurant.
 */
export function UberEatsConnect({ centre }: { centre: ReturnType<typeof useSetupCentre> }) {
  const { platformState, activeTenantId } = useAppContext();
  const branches = centre.structure.branches;
  const channels = useMemo(
    () =>
      platformState.orderChannels
        .filter(
          (channel) =>
            channel.tenantId === activeTenantId &&
            channel.enabled &&
            channel.channelType === "MARKETPLACE",
        )
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [activeTenantId, platformState.orderChannels],
  );
  const connections = centre.integrations.filter((row) => row.providerId === uberProviderId);
  const [branchId, setBranchId] = useState("");
  const [environment, setEnvironment] = useState<Environment>("SANDBOX");
  const [orderChannelId, setOrderChannelId] = useState("");
  const [ticket, setTicket] = useState("");
  const [stores, setStores] = useState<StoreChoice[]>([]);
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [branchId, branches]);
  useEffect(() => {
    if (!orderChannelId) {
      const uber = channels.find((channel) => /uber/i.test(channel.displayName));
      if (uber) setOrderChannelId(uber.id);
    }
  }, [channels, orderChannelId]);

  // Uber's redirect returns here with the sealed sign-in in the URL fragment. It is read once
  // and removed from the address bar so it is not kept in history or shared by copy and paste.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const sealed = hash.get("uberLink");
    const error = hash.get("uberError");
    if (!sealed && !error) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (error) {
      setMessage({ tone: "error", text: signInErrors[error] ?? signInErrors.uber! });
      return;
    }
    setBusy(true);
    centre
      .send<{
        stores: StoreChoice[];
        branchId: string;
        environment: Environment;
        orderChannelId?: string;
      }>("/api/seramet/setup/uber-eats/stores", { ticket: sealed })
      .then((result) => {
        setTicket(sealed!);
        setStores(result.stores);
        setStoreId(result.stores.length === 1 ? result.stores[0]!.storeId : "");
        setBranchId(result.branchId);
        setEnvironment(result.environment);
        if (result.orderChannelId) setOrderChannelId(result.orderChannelId);
        setMessage(
          result.stores.length
            ? null
            : { tone: "error", text: "This Uber account has no stores Seramet can manage." },
        );
      })
      .catch((reason: unknown) =>
        setMessage({
          tone: "error",
          text: reason instanceof Error ? reason.message : String(reason),
        }),
      )
      .finally(() => setBusy(false));
    // Runs once on arrival; `centre.send` is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await centre.send<{ url: string }>("/api/seramet/setup/uber-eats/authorize", {
        branchId,
        environment,
        ...(orderChannelId ? { orderChannelId } : {}),
      });
      window.location.assign(result.url);
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : String(reason),
      });
      setBusy(false);
    }
  };

  const link = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await centre.send<{ store: StoreChoice }>(
        "/api/seramet/setup/uber-eats/link",
        {
          ticket,
          storeId,
          ...(orderChannelId ? { orderChannelId } : {}),
        },
      );
      setTicket("");
      setStores([]);
      setMessage({
        tone: "ok",
        text: `${result.store.name} is linked. New Uber orders come here.`,
      });
      await centre.refresh();
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusy(false);
    }
  };

  const branchName = (id?: string) =>
    branches.find((branch) => branch.id === id)?.name ?? id ?? "All branches";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Panel>
        <PanelHead
          title="Uber Eats"
          sub={`${connections.length} linked`}
          right={<Link2 className="h-4 w-4 text-muted-foreground" />}
        />
        {connections.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">
            No Uber Eats store linked yet. Sign in to Uber with the account that manages your store,
            then choose the store.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <TH>Branch</TH>
                  <TH>Mode</TH>
                  <TH>Status</TH>
                  <TH>Health</TH>
                </tr>
              </thead>
              <tbody>
                {connections.map((row) => (
                  <tr key={row.connectionId}>
                    <TD>{branchName(row.branchId)}</TD>
                    <TD>{row.environment === "SANDBOX" ? "Testing" : "Live"}</TD>
                    <TD>
                      <Status>{row.status}</Status>
                    </TD>
                    <TD>
                      <Status>{row.health}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel>
        <PanelHead
          title={stores.length ? "Choose your Uber store" : "Link an Uber Eats store"}
          sub={environment === "SANDBOX" ? "Testing: Uber test stores only" : "Live orders"}
        />
        <div className="grid gap-3 p-4">
          {stores.length ? (
            <label className={labelClass}>
              Uber store
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className={inputClass}
              >
                <option value="">Select the store</option>
                {stores.map((store) => (
                  <option key={store.storeId} value={store.storeId}>
                    {store.name}
                    {store.address ? ` - ${store.address}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className={labelClass}>
                Branch
                <select
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  className={inputClass}
                >
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
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value as Environment)}
                  className={inputClass}
                >
                  <option value="SANDBOX">Testing (Uber test store)</option>
                  <option value="PRODUCTION">Live</option>
                </select>
              </label>
            </>
          )}
          <label className={labelClass}>
            Order channel for Uber orders
            <select
              value={orderChannelId}
              onChange={(event) => setOrderChannelId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select the delivery-app channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.displayName}
                </option>
              ))}
            </select>
          </label>
          {!channels.length && (
            <p className="text-[12px] text-muted-foreground">
              Add Uber Eats as a delivery-app order channel in Settings first.
            </p>
          )}
          {message && (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={
                message.tone === "error" ? "text-[13px] text-danger" : "text-[13px] text-success"
              }
            >
              {message.text}
            </p>
          )}
          {stores.length ? (
            <div className="flex flex-wrap gap-2">
              <Btn
                variant="primary"
                disabled={busy || !storeId || !orderChannelId}
                onClick={() => void link()}
              >
                Link store
              </Btn>
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStores([]);
                  setTicket("");
                }}
              >
                Cancel
              </Btn>
            </div>
          ) : (
            <Btn
              variant="primary"
              disabled={busy || !branchId || !orderChannelId}
              onClick={() => void signIn()}
            >
              Sign in to Uber
            </Btn>
          )}
        </div>
      </Panel>
    </div>
  );
}
