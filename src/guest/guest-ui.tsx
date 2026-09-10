import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronLeft,
  Clock3,
  MapPin,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Utensils,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { formatMinor } from "@/payments/money";
import type { PublicBranchProfile } from "@/guest/types";

export function GuestShell({
  children,
  profile,
}: {
  children: ReactNode;
  profile?: PublicBranchProfile;
}) {
  const primary = profile?.branding["primary"] ?? "#147d64";
  const accent = profile?.branding["accent"] ?? "#d89b2b";
  return (
    <div
      className="min-h-screen bg-[#f8f7f3] text-[#1c2522]"
      style={{ "--guest-primary": primary, "--guest-accent": accent } as CSSProperties}
    >
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/guest/$restaurant"
            params={{ restaurant: profile?.restaurantSlug ?? "restaurant" }}
            className="min-w-0"
          >
            <div className="truncate text-[16px] font-extrabold">
              {profile?.publicName ?? "Restaurant"}
            </div>
            {profile && (
              <div className="truncate text-[11px] text-black/55">{profile.branchName}</div>
            )}
          </Link>
          {profile && (
            <nav className="flex items-center gap-1" aria-label="Guest navigation">
              <Link
                to="/guest/$restaurant/reserve"
                params={{ restaurant: profile.restaurantSlug }}
                search={{ branch: profile.branchSlug }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-black/5"
                aria-label="Reserve a table"
                title="Reserve a table"
              >
                <CalendarDays className="h-5 w-5" />
              </Link>
              <Link
                to="/guest/$restaurant/account"
                params={{ restaurant: profile.restaurantSlug }}
                search={{ branch: profile.branchSlug }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-black/5"
                aria-label="Orders and receipts"
                title="Orders and receipts"
              >
                <ReceiptText className="h-5 w-5" />
              </Link>
            </nav>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

export function GuestLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6 text-center">
      <div>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-black/10 border-t-[var(--guest-primary)]" />
        <p className="mt-3 text-sm text-black/55">{label}</p>
      </div>
    </div>
  );
}

export function GuestError({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md items-center px-5 text-center">
      <div className="w-full rounded-lg border border-red-200 bg-white p-6">
        <h1 className="text-lg font-bold">This page is not available</h1>
        <p className="mt-2 text-sm text-black/60">{message}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

export function GuestButton({
  children,
  secondary,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return (
    <button
      {...props}
      className={`${
        secondary
          ? "border border-black/15 bg-white text-[#1c2522] hover:bg-black/[0.03]"
          : "bg-[var(--guest-primary)] text-white hover:brightness-95"
      } inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function GuestField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm font-semibold">
      <span>{label}</span>
      <input
        {...props}
        className="mt-1.5 h-11 w-full rounded-md border border-black/15 bg-white px-3 text-base outline-none transition focus:border-[var(--guest-primary)] focus:ring-2 focus:ring-[color:var(--guest-primary)]/15"
      />
    </label>
  );
}

export function GuestBack({
  restaurant,
  label = "Back to menu",
  branch,
}: {
  restaurant: string;
  label?: string;
  branch?: string;
}) {
  return (
    <Link
      to="/guest/$restaurant/menu"
      params={{ restaurant }}
      search={branch ? { branch } : {}}
      className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[var(--guest-primary)]"
    >
      <ChevronLeft className="h-4 w-4" /> {label}
    </Link>
  );
}

export function BranchFacts({ profile }: { profile: PublicBranchProfile }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/90">
      <span className="inline-flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5" />
        {profile.address}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock3 className="h-3.5 w-3.5" />
        {profile.status.replaceAll("_", " ")}
      </span>
    </div>
  );
}

export function MenuSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search the menu"
        aria-label="Search the menu"
        className="h-11 w-full rounded-md border border-black/10 bg-white pl-10 pr-3 text-base outline-none focus:border-[var(--guest-primary)]"
      />
    </label>
  );
}

export function QuantityControl({
  quantity,
  onChange,
}: {
  quantity: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid h-10 grid-cols-[40px_32px_40px] items-center overflow-hidden rounded-md border border-black/10 bg-white">
      <button
        onClick={() => onChange(Math.max(0, quantity - 1))}
        aria-label="Remove one"
        className="flex h-10 items-center justify-center hover:bg-black/5"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="text-center text-sm font-bold tabular-nums">{quantity}</span>
      <button
        onClick={() => onChange(quantity + 1)}
        aria-label="Add one"
        className="flex h-10 items-center justify-center hover:bg-black/5"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function EmptyGuestState({ type }: { type: "menu" | "cart" | "orders" | "reservations" }) {
  const Icon =
    type === "cart"
      ? ShoppingBag
      : type === "orders"
        ? ReceiptText
        : type === "reservations"
          ? CalendarDays
          : Utensils;
  const copy =
    type === "cart"
      ? "Your order is empty"
      : type === "orders"
        ? "No recent orders on this device"
        : type === "reservations"
          ? "No reservations linked to this account"
          : "No menu items are available";
  return (
    <div className="py-12 text-center text-black/50">
      <Icon className="mx-auto h-7 w-7" />
      <p className="mt-2 text-sm">{copy}</p>
    </div>
  );
}

export function GuestMoney({ amount, currency }: { amount: number; currency: string }) {
  return <span className="tabular-nums">{formatMinor(amount, currency)}</span>;
}
