import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { IntegrationOperations } from "@/components/integrations/IntegrationOperations";
import { Panel, PanelHead, Status } from "@/components/app/ui";
import { getProviderRegistry } from "@/integrations/provider-registry";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations - Seramet" },
      { name: "description", content: "Provider health and tenant connection operations." },
    ],
  }),
  component: Integrations,
});

function Integrations() {
  const { activeTenantId, branchRecords, platformState, currentUser } = useAppContext();
  const registeredAdapters = getProviderRegistry().list();
  const registeredById = new Map(
    registeredAdapters.map((adapter) => [adapter.definition.id, adapter.definition]),
  );
  const providers = platformState.providers
    .filter(
      (provider) =>
        provider.id === "provider-daraja" && provider.enabled && registeredById.has(provider.id),
    )
    .map((provider) => registeredById.get(provider.id) ?? provider);
  const connections = platformState.connections.filter(
    (connection) =>
      connection.tenantId === activeTenantId && connection.providerId === "provider-daraja",
  );

  return (
    <AppShell
      title="Integrations"
      subtitle="Connection health, mappings and recovery"
      actions={
        <Link
          to="/seramet-setup"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-semibold hover:bg-secondary"
        >
          <Settings2 className="h-4 w-4" /> Restaurant connections
        </Link>
      }
    >
      <Panel className="mb-4">
        <PanelHead
          title="Security boundary"
          sub="Provider credentials are provisioned as protected server secrets and are never entered or returned here."
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <Boundary label="Restaurant settings" value="Branch, Till or Paybill, store mapping" />
          <Boundary label="Platform secrets" value="Cloudflare protected environment" />
          <Boundary label="Pilot payment providers" value="Cash and M-Pesa sandbox" />
        </div>
      </Panel>

      <IntegrationOperations
        connections={connections}
        providers={providers}
        branches={branchRecords}
        userId={currentUser.id}
        tenantId={activeTenantId}
      />
    </AppShell>
  );
}

function Boundary({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-primary pl-3">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-[13px]">
        <Status>Controlled</Status>
        <span>{value}</span>
      </div>
    </div>
  );
}
