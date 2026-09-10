import { AlertTriangle, Database, LoaderCircle } from "lucide-react";
import { Panel, Status } from "@/components/app/ui";
import type { AnalyticsQuality, FinancialQuality } from "@/management/types";
import { formatMinor as formatMoneyMinor } from "@/payments/money";
import type { Tenant } from "@/platform/types";

export function ManagementReadModelState({
  status,
  error,
  empty,
}: {
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  empty?: boolean;
}) {
  if (status === "ready" && !empty) return null;
  const loading = status === "loading" || status === "idle";
  return (
    <Panel className="p-5">
      <div className="flex items-start gap-3">
        {loading ? (
          <LoaderCircle className="mt-0.5 h-5 w-5 animate-spin text-primary" />
        ) : status === "error" ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
        ) : (
          <Database className="mt-0.5 h-5 w-5 text-muted-foreground" />
        )}
        <div>
          <div className="text-[14px] font-semibold">
            {loading
              ? "Loading authoritative metrics"
              : status === "error"
                ? "Management metrics unavailable"
                : "No calculated metrics for this period"}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {status === "error"
              ? error
              : loading
                ? "Reading server-side management models."
                : "Run the durable recalculation after source transactions are available."}
          </p>
        </div>
      </div>
    </Panel>
  );
}

export function QualityStatus({ quality }: { quality: AnalyticsQuality | FinancialQuality }) {
  const label = quality.replaceAll("_", " ").toLowerCase();
  return <Status>{quality === "HIGH" || quality === "COMPLETE" ? "Healthy" : label}</Status>;
}

export function formatMinor(amountMinor: number, currency: string) {
  return formatMoneyMinor(amountMinor, currency);
}

export function configuredTenantCurrency(
  tenants: readonly Pick<Tenant, "id" | "defaultCurrency">[],
  tenantId: string,
) {
  const currency = tenants.find((tenant) => tenant.id === tenantId)?.defaultCurrency;
  if (!currency) throw new Error("The active tenant has no configured currency");
  return currency;
}

export function formatBps(value: number) {
  return `${(value / 100).toFixed(1)}%`;
}

export function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Unavailable";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function severityLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}
