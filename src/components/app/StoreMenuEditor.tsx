import { useEffect, useMemo, useState } from "react";
import { Btn, Panel, PanelHead } from "@/components/app/ui";
import { formatMoney } from "@/lib/currency";

type MenuItem = { id: string; name: string; category: string; price: number };
type StoreMenu = { items: MenuItem[]; selectedItemIds: string[] | null };

/**
 * Chooses which branch menu items one marketplace store sells. Each storefront on a branch
 * (for example two brands from one kitchen) keeps its own list; menu, price and availability
 * sync to that store send only these items.
 */
export function StoreMenuEditor({
  connectionId,
  storeName,
  headers,
  currency,
  canEdit,
  onSaved,
}: {
  connectionId: string;
  storeName: string;
  headers: Record<string, string>;
  currency: string;
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const [menu, setMenu] = useState<StoreMenu | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    setMenu(null);
    setMessage(null);
    void fetch(
      `/api/seramet/integrations/marketplace/store-menu?connectionId=${encodeURIComponent(connectionId)}`,
      { headers },
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          menu?: StoreMenu;
          message?: string;
        };
        if (!response.ok || !payload.menu)
          throw new Error(payload.message ?? "The store menu could not be loaded");
        if (!current) return;
        setMenu(payload.menu);
        setChosen(
          new Set(payload.menu.selectedItemIds ?? payload.menu.items.map((item) => item.id)),
        );
      })
      .catch((error: unknown) => {
        if (current)
          setMessage({
            tone: "error",
            text: error instanceof Error ? error.message : "The store menu could not be loaded",
          });
      });
    return () => {
      current = false;
    };
  }, [connectionId, headers]);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = (menu?.items ?? []).filter(
      (item) =>
        !term ||
        item.name.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term),
    );
    const byCategory = new Map<string, MenuItem[]>();
    for (const item of rows)
      byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [menu, search]);

  const toggle = (ids: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids)
        if (on) next.add(id);
        else next.delete(id);
      return next;
    });

  const save = async () => {
    if (!menu) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/seramet/integrations/marketplace/store-menu", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ connectionId, itemIds: [...chosen] }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "The store menu was not saved");
      setMenu({ ...menu, selectedItemIds: [...chosen] });
      setMessage({
        tone: "ok",
        text: `Saved: ${chosen.size} item(s). Send it to the app from Menu → Preview.`,
      });
      onSaved?.();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "The store menu was not saved",
      });
    } finally {
      setBusy(false);
    }
  };

  const total = menu?.items.length ?? 0;
  return (
    <Panel className="mt-4">
      <PanelHead
        title={`${storeName} menu`}
        sub={
          menu
            ? `${chosen.size} of ${total} branch items${menu.selectedItemIds ? "" : " (whole menu until you save)"}`
            : "Loading the branch menu"
        }
        right={
          canEdit ? (
            <Btn
              variant="primary"
              disabled={busy || !menu || chosen.size === 0}
              onClick={() => void save()}
            >
              Save store menu
            </Btn>
          ) : undefined
        }
      />
      <div className="grid gap-3 p-4">
        <p className="text-[12px] text-muted-foreground">Tick the items this store sells.</p>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search items or categories"
          className="h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
        />
        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error" ? "text-[13px] text-danger" : "text-[13px] text-success"
            }
          >
            {message.text}
          </p>
        )}
        {groups.map(([category, items]) => {
          const ids = items.map((item) => item.id);
          const selected = ids.filter((id) => chosen.has(id)).length;
          return (
            <section key={category} className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h3 className="text-[13px] font-semibold capitalize">
                  {category.toLowerCase()}{" "}
                  <span className="font-normal text-muted-foreground">
                    {selected}/{items.length}
                  </span>
                </h3>
                {canEdit && (
                  <div className="flex gap-1">
                    <Btn variant="ghost" onClick={() => toggle(ids, true)}>
                      All
                    </Btn>
                    <Btn variant="ghost" onClick={() => toggle(ids, false)}>
                      None
                    </Btn>
                  </div>
                )}
              </div>
              <ul className="grid gap-1 p-2 sm:grid-cols-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-secondary">
                      <input
                        type="checkbox"
                        checked={chosen.has(item.id)}
                        disabled={!canEdit}
                        onChange={(event) => toggle([item.id], event.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="text-muted-foreground">
                        {formatMoney(item.price, currency)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {menu && !groups.length && (
          <p className="text-[13px] text-muted-foreground">No branch menu items match.</p>
        )}
      </div>
    </Panel>
  );
}
