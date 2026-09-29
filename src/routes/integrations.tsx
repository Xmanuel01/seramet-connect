import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { getProviderRegistry } from "@/integrations/provider-registry";
import { useAppContext } from "@/lib/app-context";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { ProviderCategory, ProviderCapability } from "@/platform/types";
import { IntegrationOperations } from "@/components/integrations/IntegrationOperations";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations - Seramet" },
      { name: "description", content: "Provider registry and tenant connection configuration." },
    ],
  }),
  component: Integrations,
});

const providerCategories: ProviderCategory[] = [
  "PAYMENT",
  "DELIVERY",
  "ACCOUNTING",
  "MESSAGING",
  "IDENTITY",
  "OTHER",
];

function Integrations() {
  const {
    activeTenantId,
    branchId,
    branchRecords,
    canSwitchBranch,
    platformState,
    currentUser,
    refreshConfiguration,
  } = useAppContext();
  const repository = getConfigurationRepository();
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerName, setProviderName] = useState("");
  const [providerCode, setProviderCode] = useState("");
  const [providerCategory, setProviderCategory] = useState<ProviderCategory>("PAYMENT");
  const [connectionName, setConnectionName] = useState("");
  const [connectionProviderId, setConnectionProviderId] = useState(
    platformState.providers[0]?.id ?? "",
  );
  const [connectionBranchId, setConnectionBranchId] = useState(branchId);
  const [credentialReference, setCredentialReference] = useState("");
  const [notice, setNotice] = useState(
    "Credentials stay server-side; this screen stores only an opaque secret reference.",
  );
  const registeredAdapters = getProviderRegistry().list();
  const providers = platformState.providers
    .filter((provider) => provider.enabled)
    .map(
      (provider) =>
        registeredAdapters.find((adapter) => adapter.definition.id === provider.id)?.definition ??
        provider,
    );
  const connections = platformState.connections.filter(
    (connection) => connection.tenantId === activeTenantId,
  );
  const registeredProviderIds = new Set(registeredAdapters.map((adapter) => adapter.definition.id));

  const addProvider = () => {
    const displayName = providerName.trim();
    const code = providerCode.trim().toUpperCase();
    if (!displayName || !code) {
      setNotice("Provider name and code are required.");
      return;
    }
    repository.upsertProvider({
      id: `provider-${slug(code)}-${Date.now().toString(36)}`,
      code,
      displayName,
      category: providerCategory,
      version: "unimplemented",
      capabilities: [] as ProviderCapability[],
      configurationSchema: {},
      secretFields: [],
      enabled: true,
    });
    refreshConfiguration();
    setProviderName("");
    setProviderCode("");
    setShowProviderForm(false);
    setNotice(
      `${displayName} metadata added. Register its adapter before enabling live operations.`,
    );
  };

  const addConnection = () => {
    const displayName = connectionName.trim();
    if (!displayName || !connectionProviderId || !connectionBranchId) {
      setNotice("Connection name, provider and branch are required.");
      return;
    }
    const now = new Date().toISOString();
    repository.upsertConnection(activeTenantId, {
      id: `connection-${slug(displayName)}-${Date.now().toString(36)}`,
      tenantId: activeTenantId,
      branchId: connectionBranchId,
      providerId: connectionProviderId,
      environment: "SANDBOX",
      status: credentialReference.trim() ? "CONFIGURED" : "CREDENTIALS_REQUIRED",
      displayName,
      configuration: {},
      ...(credentialReference.trim() ? { secretReference: credentialReference.trim() } : {}),
      metadata: {},
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    });
    refreshConfiguration();
    setConnectionName("");
    setCredentialReference("");
    setNotice(`${displayName} saved in sandbox mode.`);
  };

  return (
    <AppShell
      title="Integrations"
      subtitle="Provider registry metadata, capabilities and tenant connections"
      actions={
        <Btn variant="primary" onClick={() => setShowProviderForm((value) => !value)}>
          Add provider
        </Btn>
      }
    >
      {showProviderForm && (
        <Panel className="mb-4 p-4">
          <PanelHead
            title="Provider definition"
            sub="Metadata does not invent or enable an unknown external API"
          />
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label="Provider name" value={providerName} onChange={setProviderName} />
            <Field label="Provider code" value={providerCode} onChange={setProviderCode} />
            <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              Category
              <select
                value={providerCategory}
                onChange={(event) => setProviderCategory(event.target.value as ProviderCategory)}
                className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
              >
                {providerCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <Btn className="self-end" onClick={addProvider}>
              Save definition
            </Btn>
          </div>
        </Panel>
      )}

      <Panel className="mb-4 p-4">
        <PanelHead title="New connection" sub="Connections are tenant and branch scoped" />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Connection name" value={connectionName} onChange={setConnectionName} />
          <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
            Provider
            <select
              value={connectionProviderId}
              onChange={(event) => setConnectionProviderId(event.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-foreground"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
            Branch
            <select
              value={connectionBranchId}
              disabled={!canSwitchBranch}
              onChange={(event) => setConnectionBranchId(event.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-foreground disabled:opacity-70"
            >
              {branchRecords.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Server secret reference"
            value={credentialReference}
            onChange={setCredentialReference}
            placeholder="secret://vault/path"
          />
          <Btn className="self-end" onClick={addConnection}>
            Save connection
          </Btn>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">{notice}</p>
      </Panel>

      <IntegrationOperations
        connections={connections}
        providers={providers}
        branches={branchRecords}
        userId={currentUser.id}
        tenantId={activeTenantId}
        onConnectionChanged={(connection) => {
          repository.upsertConnection(activeTenantId, connection);
          refreshConfiguration();
        }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {providerCategories.map((category) => {
          const categoryProviders = providers.filter((provider) => provider.category === category);
          if (!categoryProviders.length) return null;
          return (
            <Panel key={category}>
              <PanelHead
                title={category.replaceAll("_", " ")}
                sub={`${categoryProviders.length} provider definition(s)`}
              />
              <ul className="divide-y divide-border">
                {categoryProviders.map((provider) => {
                  const providerConnections = connections.filter(
                    (connection) => connection.providerId === provider.id,
                  );
                  const adapterInstalled = registeredProviderIds.has(provider.id);
                  return (
                    <li key={provider.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-semibold">{provider.displayName}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {provider.code} - {provider.version}
                          </div>
                        </div>
                        <Status>{adapterInstalled ? "Adapter ready" : "Metadata only"}</Status>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {provider.capabilities.length ? (
                          provider.capabilities.map((capability) => (
                            <span
                              key={capability}
                              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {capability}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            No capabilities registered
                          </span>
                        )}
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {providerConnections.map((connection) => (
                          <div
                            key={connection.id}
                            className="flex items-center justify-between rounded-md bg-secondary/50 px-2.5 py-2 text-[12px]"
                          >
                            <span>{connection.displayName}</span>
                            <Status>{connection.status}</Status>
                          </div>
                        ))}
                        {providerConnections.length === 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            Provider connection incomplete
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })}
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
