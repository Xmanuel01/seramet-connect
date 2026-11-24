import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, X, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

export type OrderIslandKind = "placed" | "saved" | "failed";

export interface OrderIslandNotice {
  /** Bumped for every new result so the same outcome twice still animates again. */
  id: number;
  kind: OrderIslandKind;
  detail?: string;
  /** Link the detail to Printers & Devices (printer and routing problems only). */
  linkToPrinters?: boolean;
}

const TITLES: Record<OrderIslandKind, string> = {
  placed: "Order placed",
  // The order is safely saved but no kitchen ticket printed: never tell the cashier
  // "not placed" here, or the order would be entered a second time.
  saved: "Order saved · not printed",
  failed: "Order not placed",
};

const HIDE_AFTER_MS: Record<OrderIslandKind, number> = {
  placed: 2_600,
  saved: 6_000,
  failed: 6_000,
};

/**
 * A compact pill at the top centre of the screen, in the style of the iPhone Dynamic
 * Island, that reports the result of sending an order to the kitchen. It grows out of
 * a small black capsule, shows the outcome, and shrinks away on its own.
 */
export function OrderIsland({
  notice,
  onDismiss,
}: {
  notice: OrderIslandNotice | null;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setExpanded(false);
    const open = window.requestAnimationFrame(() => setExpanded(true));
    const close = window.setTimeout(() => setExpanded(false), HIDE_AFTER_MS[notice.kind]);
    const remove = window.setTimeout(onDismiss, HIDE_AFTER_MS[notice.kind] + 450);
    return () => {
      window.cancelAnimationFrame(open);
      window.clearTimeout(close);
      window.clearTimeout(remove);
    };
  }, [notice, onDismiss]);

  if (!notice) return null;
  const { kind, detail, linkToPrinters } = notice;
  const Icon = kind === "placed" ? Check : kind === "saved" ? Printer : X;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3">
      <div
        role={kind === "placed" ? "status" : "alert"}
        aria-live={kind === "placed" ? "polite" : "assertive"}
        onClick={() => setExpanded(false)}
        className={cn(
          "pointer-events-auto flex items-center overflow-hidden rounded-full bg-black text-white",
          "shadow-[0_10px_30px_-8px_rgba(0,0,0,0.55)] transition-all ease-[cubic-bezier(0.2,0.9,0.25,1.15)]",
          expanded
            ? "max-w-[min(92vw,420px)] gap-3 py-2 pl-2 pr-5 opacity-100 duration-500"
            : "max-w-[120px] gap-0 py-1.5 pl-1.5 pr-1.5 opacity-0 duration-300",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            kind === "placed" ? "bg-emerald-500" : kind === "saved" ? "bg-amber-500" : "bg-red-500",
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={3} />
        </span>
        <span
          className={cn(
            "min-w-0 transition-opacity duration-300",
            expanded ? "opacity-100 delay-150" : "opacity-0",
          )}
        >
          <span className="block whitespace-nowrap text-[14px] font-semibold leading-tight">
            {TITLES[kind]}
          </span>
          {detail ? (
            <span className="line-clamp-2 block max-w-[320px] whitespace-normal text-[11.5px] leading-tight text-white/65">
              {linkToPrinters ? (
                <Link to="/seramet-printers" className="underline decoration-white/40">
                  {detail}
                </Link>
              ) : (
                detail
              )}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
