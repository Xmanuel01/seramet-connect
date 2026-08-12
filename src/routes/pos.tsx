import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Minus, Plus, Search, Wifi, Clock, Flame } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Status } from "@/components/app/ui";
import { ksh, posCategories, products } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "Seramet POS — Fast counter & table service" },
      { name: "description", content: "Touch-optimised point of sale for dine-in, take away and delivery orders." },
      { property: "og:title", content: "Seramet POS" },
      { property: "og:description", content: "Touch-optimised point of sale built for speed." },
    ],
  }),
  component: POS,
});

function POS() {
  const [cat, setCat] = useState("Popular");
  const [lines, setLines] = useState<Record<string, number>>({ p1: 2, p6: 1, p8: 2 });

  const visible = products.filter((p) => (cat === "Popular" ? p.popular : p.category === cat));
  const items = Object.entries(lines)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p && l.qty > 0);
  const subtotal = items.reduce((s, l) => s + l.p.price * l.qty, 0);
  const tax = Math.round(subtotal * 0.16);

  const bump = (id: string, d: number) =>
    setLines((l) => ({ ...l, [id]: Math.max(0, (l[id] ?? 0) + d) }));

  return (
    <AppShell bare>
      <div className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[13px] font-extrabold uppercase tracking-[0.14em]">Seramet POS</span>
          <Status>Occupied</Status>
          <span className="text-[13px] text-muted-foreground">Westlands · Cashier Amina W.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Status>Present</Status>
          <span className="rounded-md bg-secondary px-2 py-1 text-[12px] font-semibold">Table 08</span>
          <span className="rounded-md bg-secondary px-2 py-1 text-[12px] font-semibold">Dine-In</span>
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Wifi className="h-3.5 w-3.5" /> Online</span>
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Clock className="h-3.5 w-3.5" /> 12:46</span>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[132px_minmax(0,1fr)_360px]">
        <nav className="flex gap-1.5 overflow-x-auto border-b border-border bg-card p-2 lg:h-[calc(100vh-8rem)] lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {posCategories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors lg:w-full",
                cat === c ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </nav>

        <div className="min-w-0 p-4">
          <div className="mb-3 flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input placeholder="Search dishes or scan barcode" className="w-full bg-transparent text-[13px] outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((p) => (
              <button
                key={p.id}
                disabled={p.out}
                onClick={() => bump(p.id, 1)}
                className={cn(
                  "rounded-xl border border-border bg-card p-3 text-left shadow-card transition-all",
                  p.out ? "opacity-50" : "hover:-translate-y-0.5 hover:border-primary",
                  lines[p.id] ? "border-primary ring-1 ring-primary/25" : "",
                )}
              >
                <div className="mb-2 grid h-20 place-items-center rounded-lg bg-accent/60 text-2xl">🍽</div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{p.category}</span>
                  {p.popular && <Flame className="ml-auto h-3 w-3 text-warning" />}
                </div>
                <div className="truncate text-[13px] font-semibold">{p.name}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="num text-[13px] font-bold">{ksh(p.price)}</span>
                  <span className="text-[11px] text-muted-foreground">{p.out ? "86'd" : `${p.prep} min`}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <aside className="flex flex-col border-t border-border bg-card lg:h-[calc(100vh-8rem)] lg:border-l lg:border-t-0">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-bold">Order #1844</div>
                <div className="text-[12px] text-muted-foreground">Table 08 · Joan A. · 2 guests</div>
              </div>
              <Status>New</Status>
            </div>
          </div>
          <div className="flex-1 divide-y divide-border overflow-y-auto">
            {items.length === 0 && (
              <p className="p-6 text-center text-[13px] text-muted-foreground">Tap a dish to start the order.</p>
            )}
            {items.map((l) => (
              <div key={l.p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{l.p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{ksh(l.p.price)} each</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => bump(l.p.id, -1)} className="grid h-7 w-7 place-items-center rounded-md border border-border">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="num w-5 text-center text-[13px] font-bold">{l.qty}</span>
                  <button onClick={() => bump(l.p.id, 1)} className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <span className="num w-16 text-right text-[13px] font-bold">{ksh(l.p.price * l.qty)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-4">
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between text-muted-foreground">
                <dt>Subtotal</dt>
                <dd className="num">{ksh(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>VAT 16%</dt>
                <dd className="num">{ksh(tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-[16px] font-bold">
                <dt>Total</dt>
                <dd className="num">{ksh(subtotal + tax)}</dd>
              </div>
            </dl>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Btn>Hold</Btn>
              <Btn>Discount</Btn>
              <Btn>More</Btn>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1.4fr] gap-2">
              <Btn>Send kitchen</Btn>
              <Btn variant="primary" className="h-11 text-[15px]">Pay {ksh(subtotal + tax)}</Btn>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {["M-Pesa", "Cash", "Card", "Bank", "Customer account", "Split"].map((m) => (
                <span key={m} className="rounded border border-border px-1.5 py-0.5">{m}</span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}