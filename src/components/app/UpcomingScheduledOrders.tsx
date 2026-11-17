import { CalendarClock } from "lucide-react";
import type { TransactionOrder } from "@/lib/transaction-engine";
import { upcomingScheduledOrders } from "@/orders/scheduled-orders";

/**
 * Scheduled delivery-app orders still waiting for the kitchen, so staff can plan prep before
 * a rush of pre-orders. Each one reaches the kitchen by itself at its kitchen time.
 */
export function UpcomingScheduledOrders({
  orders,
  branchId,
  timeZone,
}: {
  orders: TransactionOrder[];
  branchId: string;
  timeZone: string;
}) {
  const upcoming = upcomingScheduledOrders(orders, branchId);
  if (!upcoming.length) return null;
  const time = (value?: string) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          timeZone,
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : "—";
  return (
    <section
      aria-label="Upcoming scheduled orders"
      className="mb-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-[12px] text-info"
    >
      <h2 className="flex items-center gap-1.5 font-bold">
        <CalendarClock size={14} aria-hidden />
        Upcoming scheduled orders ({upcoming.length})
      </h2>
      <ul className="mt-1.5 grid gap-1">
        {upcoming.slice(0, 8).map((order) => {
          const source = order.externalSource!;
          const items = order.lines.reduce((sum, line) => sum + line.quantity, 0);
          return (
            <li key={order.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold">
                {order.channel} {source.providerDisplayReference ?? source.externalOrderId}
              </span>
              <span className="text-muted-foreground">
                {items} item{items === 1 ? "" : "s"}
              </span>
              <span>Kitchen {time(source.scheduledReleaseAt)}</span>
              <span>Ready {time(source.scheduledReadyAt)}</span>
              {source.scheduledFor && <span>Customer {time(source.scheduledFor)}</span>}
            </li>
          );
        })}
      </ul>
      {upcoming.length > 8 && (
        <p className="mt-1 text-muted-foreground">And {upcoming.length - 8} more later.</p>
      )}
    </section>
  );
}
