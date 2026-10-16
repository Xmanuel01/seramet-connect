import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Btn } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";

type Delivery = {
  revision: number;
  recipientUserId: string;
  status: "QUEUED" | "CONFIGURATION_REQUIRED" | "DELIVERY_FAILED" | "PROVIDER_ACCEPTED";
};
export function ClosingDeliveryStatus({
  tenantId,
  branchId,
  dayId,
  revision,
}: {
  tenantId: string;
  branchId: string;
  dayId: string;
  revision: number;
}) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const token = getSerametAccessToken();
    void fetch(
      `/api/seramet/daily-closing/notifications/${encodeURIComponent(dayId)}?revision=${revision}`,
      {
        signal: controller.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "x-seramet-tenant-id": tenantId,
          "x-seramet-branch-id": branchId,
        },
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Notification status unavailable");
        const body = (await response.json()) as { deliveries: Delivery[] };
        if (!controller.signal.aborted) {
          setDeliveries(body.deliveries);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [tenantId, branchId, dayId, revision, refresh]);
  const labels = {
    QUEUED: "Email queued",
    CONFIGURATION_REQUIRED: "Email requires provider configuration",
    DELIVERY_FAILED: "Email delivery failed - review required",
    PROVIDER_ACCEPTED: "Email accepted by provider; inbox delivery unconfirmed",
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
      {failed
        ? "Email status unavailable"
        : deliveries === null
          ? "Checking email status..."
          : deliveries.length
            ? deliveries.map((d) => (
                <span key={`${d.revision}:${d.recipientUserId}`}>
                  Revision {d.revision}: {labels[d.status]}
                </span>
              ))
            : "No email recipients configured for this close"}
      <Btn
        aria-label="Refresh email status"
        title="Refresh email status"
        onClick={() => setRefresh((value) => value + 1)}
      >
        <RefreshCcw className="h-3 w-3" />
      </Btn>
    </div>
  );
}
