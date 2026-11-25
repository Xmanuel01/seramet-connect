import { Check, RefreshCw, Settings, Store } from "lucide-react";
import { Btn, Status } from "./ui";
import type { IntegrationConnection, ProviderDefinition } from "@/platform/types";
import type {
  ExternalResourceMapping,
  IntegrationEvent,
  IntegrationHealthRecord,
  IntegrationOutbox,
} from "@/integrations/runtime/models";

export function MarketplaceConnections({
  connections,
  providers,
  diagnostics,
  working,
  canManage,
  onCheck,
  onMenu,
  timeZone,
}: {
  connections: IntegrationConnection[];
  providers: ProviderDefinition[];
  diagnostics: {
    mappings: ExternalResourceMapping[];
    events: IntegrationEvent[];
    health: IntegrationHealthRecord[];
    outbox: IntegrationOutbox[];
  };
  working: boolean;
  canManage: boolean;
  onCheck: (id: string) => void;
  onMenu: (id: string) => void;
  timeZone: string;
}) {
  return (
    <section className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Marketplace connections</h2>
        {canManage && (
          <a href="/integrations" className="inline-flex gap-2 text-primary">
            <Settings className="h-4 w-4" />
            Manage connections
          </a>
        )}
      </div>
      {!connections.length && (
        <p className="py-8 text-muted-foreground">No marketplace is linked to this branch.</p>
      )}
      {connections.map((connection) => {
        const health = diagnostics.health.find((row) => row.connectionId === connection.id);
        const mappings = diagnostics.mappings.filter((row) => row.connectionId === connection.id);
        const store = mappings.find(
          (row) => row.resourceType === "STORE" && row.status === "MAPPED",
        );
        const items = mappings.filter(
          (row) => row.resourceType === "ITEM" && ["MAPPED", "AUTO_MATCHED"].includes(row.status),
        );
        const latestOrder = diagnostics.events
          .filter((row) => row.connectionId === connection.id && row.eventType.includes("ORDER"))
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
        const latestMenu = diagnostics.outbox
          .filter(
            (row) =>
              row.connectionId === connection.id &&
              row.eventType === "MENU_SYNC" &&
              row.status === "PROCESSED",
          )
          .sort((a, b) =>
            (b.processedAt ?? b.createdAt).localeCompare(a.processedAt ?? a.createdAt),
          )[0];
        const provider = providers.find((row) => row.id === connection.providerId);
        const steps = [
          { label: "Connect account", done: health?.credentialValid === true },
          { label: "Select outlet", done: Boolean(store) },
          {
            label: "Map menu",
            done:
              items.length > 0 &&
              !mappings.some((row) => ["UNMAPPED", "CONFLICT"].includes(row.status)),
          },
          {
            label: "Verify order",
            done: diagnostics.events.some(
              (row) =>
                row.connectionId === connection.id &&
                row.eventType === "ORDER_CREATED" &&
                row.status === "PROCESSED" &&
                diagnostics.outbox.some(
                  (action) =>
                    action.connectionId === connection.id &&
                    action.resourceId === row.externalResourceId &&
                    action.eventType === "ORDER_ACCEPTED" &&
                    action.status === "PROCESSED",
                ),
            ),
          },
          {
            label: "Activate",
            done: connection.environment === "PRODUCTION" && connection.status === "ACTIVE",
          },
        ];
        return (
          <article key={connection.id} className="border-b border-border py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{connection.displayName}</h3>
                <p className="text-sm text-muted-foreground">
                  {provider?.displayName} ·{" "}
                  {connection.environment === "SANDBOX" ? "Test connection" : "Live connection"}
                </p>
              </div>
              <Status>
                {health?.status === "HEALTHY"
                  ? "Connection healthy"
                  : (health?.status ?? "Not checked")}
              </Status>
            </div>
            <ol className="my-4 grid gap-3 sm:grid-cols-5">
              {steps.map((step, index) => (
                <li key={step.label} className="flex gap-2 items-center text-sm">
                  {step.done ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <span className="text-muted-foreground">{index + 1}.</span>
                  )}
                  {step.label}
                </li>
              ))}
            </ol>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Outlet</dt>
                <dd className="break-all">{store?.externalId ?? "Not linked"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Latest order received</dt>
                <dd>
                  {latestOrder
                    ? new Date(latestOrder.receivedAt).toLocaleString(undefined, { timeZone })
                    : "None received"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last menu published</dt>
                <dd>
                  {latestMenu
                    ? new Date(latestMenu.processedAt ?? latestMenu.createdAt).toLocaleString(
                        undefined,
                        { timeZone },
                      )
                    : "Not verified"}
                </dd>
              </div>
            </dl>
            {health?.message && <p className="mt-3 text-sm break-words">{health.message}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {canManage && (
                <Btn disabled={working} onClick={() => onCheck(connection.id)}>
                  <RefreshCw className="h-4 w-4" />
                  Check connection
                </Btn>
              )}
              <Btn onClick={() => onMenu(connection.id)}>
                <Store className="h-4 w-4" />
                Review menu
              </Btn>
            </div>
          </article>
        );
      })}
    </section>
  );
}
