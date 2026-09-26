import { createFileRoute } from "@tanstack/react-router";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useSetupCentre } from "@/onboarding/use-setup-centre";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations - Seramet" },
      {
        name: "description",
        content: "Authoritative provider connection status and restaurant configuration.",
      },
    ],
  }),
  component: Integrations,
});

function Integrations() {
  const centre = useSetupCentre();

  return (
    <AppShell
      title="Integrations"
      subtitle="Authoritative restaurant connections and provider health"
      actions={
        <Btn onClick={() => void centre.refresh()} disabled={centre.status === "loading"}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-card p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">Credentials stay outside restaurant screens</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Restaurant-specific merchant, store and branch settings are configured in Setup Centre.
            Provider keys, webhook secrets and OAuth credentials are managed by the Seramet platform
            and are never returned to this browser.
          </p>
        </div>
      </div>

      {centre.error ? (
        <div role="alert" className="mb-4 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          Integration status could not be loaded: {centre.error}
        </div>
      ) : null}

      <Panel>
        <PanelHead
          title="Connection status"
          sub={`${centre.integrations.length} authoritative connection(s)`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <TH>Connection</TH>
                <TH>Category</TH>
                <TH>Environment</TH>
                <TH>Status</TH>
                <TH>Health</TH>
                <TH className="text-right">Pending</TH>
                <TH className="text-right">Dead letters</TH>
              </tr>
            </thead>
            <tbody>
              {centre.integrations.map((connection) => (
                <tr key={connection.connectionId}>
                  <TD>
                    <div className="font-semibold">{connection.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {connection.branchId ? "Branch scoped" : "Restaurant scoped"}
                    </div>
                  </TD>
                  <TD>{connection.category}</TD>
                  <TD>{connection.environment}</TD>
                  <TD>
                    <Status>{connectionLabel(connection.status)}</Status>
                  </TD>
                  <TD>
                    <Status>{connectionLabel(connection.health)}</Status>
                  </TD>
                  <TD className="num text-right">{connection.pendingQueue}</TD>
                  <TD className="num text-right">{connection.deadLetters}</TD>
                </tr>
              ))}
              {centre.status === "loading" ? (
                <tr>
                  <TD colSpan={7} className="py-12 text-center text-muted-foreground">
                    Loading authoritative connection status...
                  </TD>
                </tr>
              ) : null}
              {centre.status !== "loading" && centre.integrations.length === 0 ? (
                <tr>
                  <TD colSpan={7} className="py-12 text-center text-muted-foreground">
                    No restaurant connections have been configured. Use Setup Centre to add
                    restaurant-specific merchant or store details.
                  </TD>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}

function connectionLabel(value: string) {
  if (value === "CONNECTED" || value === "HEALTHY") return "Connected";
  if (value === "PENDING_VERIFICATION" || value === "UNKNOWN") return "Awaiting verification";
  if (value === "DISABLED" || value === "NOT_CONFIGURED") return "Not connected";
  return "Action needed";
}
