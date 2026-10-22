import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function InventoryActionLink({
  to,
  primary = false,
  children,
}: {
  to: "/receiving" | "/purchase-orders" | "/requisitions" | "/supplier-performance";
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border bg-card hover:bg-secondary",
      )}
    >
      {children}
    </Link>
  );
}
