import { Link, useRouterState } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAppContext } from "@/lib/app-context";
import { canAccessPath } from "@/platform/module-access-registry";

export function RouteAccessBoundary({ children }: { children: ReactNode }) {
  const path = useRouterState({
    select: (state: { location: { pathname: string } }) => state.location.pathname,
  });
  const { moduleAccess } = useAppContext();
  if (canAccessPath(moduleAccess, path)) return children;

  const dashboardAllowed = canAccessPath(moduleAccess, "/");
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-danger/10 text-danger">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-base font-semibold">Access denied</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your current permissions, organizational scope, entitlement, or policy do not allow
              this page.
            </p>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-secondary"
          >
            Go back
          </button>
          {dashboardAllowed && (
            <Link
              to="/"
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Dashboard
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
