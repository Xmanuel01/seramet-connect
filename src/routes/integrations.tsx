import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { IntegrationOperations } from "@/components/integrations/IntegrationOperations";
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
      actions={
        <Link
          to="/seramet-setup"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-semibold hover:bg-secondary"
        >
          <Settings2 className="h-4 w-4" /> Connect an app
        </Link>
      }
    >
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
