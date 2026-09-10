import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/app/Logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <Link to="/login" className="mb-7 inline-flex" aria-label="Seramet sign in">
          <Logo />
        </Link>
        <section className="rounded-xl border border-border bg-card p-5 shadow-card sm:p-6">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </section>
        <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>
      </div>
    </main>
  );
}

export const authInputClass =
  "mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export const authButtonClass =
  "inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";
