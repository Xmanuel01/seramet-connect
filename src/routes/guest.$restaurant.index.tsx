import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, MapPin, ShoppingBag } from "lucide-react";
import { GuestError, GuestLoading, GuestShell } from "@/guest/guest-ui";
import type { PublicBranchProfile } from "@/guest/types";
import { useGuestQuery } from "@/guest/use-guest";

export const Route = createFileRoute("/guest/$restaurant/")({
  component: GuestRestaurant,
});

function GuestRestaurant() {
  const { restaurant } = Route.useParams();
  const query = useGuestQuery<{ restaurant: string; branches: PublicBranchProfile[] }>(
    `/api/seramet/guest/restaurants/${encodeURIComponent(restaurant)}`,
  );
  if (query.status === "loading")
    return (
      <GuestShell>
        <GuestLoading label="Finding open branches" />
      </GuestShell>
    );
  if (!query.data)
    return (
      <GuestShell>
        <GuestError message={query.error} />
      </GuestShell>
    );
  const branch = query.data.branches[0];
  return (
    <GuestShell {...(branch ? { profile: branch } : {})}>
      <main>
        <section className="relative min-h-[420px] overflow-hidden bg-black sm:min-h-[480px]">
          <img
            src={branch?.coverUrl ?? "/guest-cover.png"}
            alt="Restaurant menu selection"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/45" />
          <div className="relative mx-auto flex min-h-[420px] max-w-7xl flex-col justify-end px-5 pb-12 text-white sm:min-h-[480px] sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.12em]">
              Direct from the restaurant
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight sm:text-6xl">
              {query.data.restaurant}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/90 sm:text-base">
              Choose a branch to view its live menu, place an order, or reserve a table.
            </p>
          </div>
        </section>
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="text-xl font-extrabold">Choose a branch</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {query.data.branches.map((item) => (
              <article
                key={item.branchSlug}
                className="rounded-lg border border-black/10 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">{item.branchName}</h3>
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-black/55">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      {item.address}
                    </p>
                  </div>
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                    {item.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Link
                    to="/guest/$restaurant/menu"
                    params={{ restaurant }}
                    search={{ branch: item.branchSlug, service: "", qr: "" }}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--guest-primary)] px-3 text-sm font-bold text-white"
                  >
                    <ShoppingBag className="h-4 w-4" /> View menu
                  </Link>
                  <Link
                    to="/guest/$restaurant/reserve"
                    params={{ restaurant }}
                    search={{ branch: item.branchSlug }}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-3 text-sm font-bold"
                  >
                    <CalendarDays className="h-4 w-4" /> Reserve
                  </Link>
                </div>
                <Link
                  to="/guest/$restaurant/menu"
                  params={{ restaurant }}
                  search={{ branch: item.branchSlug, service: "", qr: "" }}
                  className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[var(--guest-primary)]"
                >
                  Branch details <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>
    </GuestShell>
  );
}
