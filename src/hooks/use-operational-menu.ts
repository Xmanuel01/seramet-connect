import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import type { Product } from "@/lib/menu-product";
import { majorFromMinor } from "@/payments/money";
import {
  createOperationalMenuCache,
  getOperationalMenuRevision,
  getSavedMenuEpoch,
  readSavedOperationalMenu,
  removeSavedOperationalMenu,
  savedMenuKey,
  subscribeOperationalMenu,
  writeSavedOperationalMenu,
} from "./operational-menu-cache";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

/** How often an open POS re-reads the menu in the background, and on returning to the tab. */
const BACKGROUND_REFRESH_MS = 120_000;

/** A saved menu is used only when it has the shape the POS reads; anything else is ignored. */
function isMenuData(value: unknown): value is MenuData {
  if (!value || typeof value !== "object") return false;
  const { items, pricingRules } = value as Partial<MenuData>;
  return (
    Array.isArray(items) &&
    Array.isArray(pricingRules) &&
    items.every(
      (item) =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.category === "string" &&
        Number.isFinite(item.price) &&
        Number.isFinite(item.priceMinor),
    ) &&
    pricingRules.every(
      (rule) => Boolean(rule) && typeof rule.id === "string" && Number.isFinite(rule.rate_bps),
    )
  );
}

type CatalogRow = {
  id: string;
  code: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  category_code: string;
  description: string | null;
  selling_price_minor: number;
  effective_price_minor: number;
  online_price_minor?: number | null;
  currency: string;
  tax_rule_id: string | null;
  service_charge_applicable: number;
  station_code: string | null;
  available: number;
  image_url?: string | null;
};

export type OperationalPricingRule = {
  id: string;
  code: string;
  rule_type: "TAX" | "SERVICE_CHARGE";
  rate_bps: number;
  calculation_mode: "INCLUSIVE" | "EXCLUSIVE";
};

type MenuData = { items: Product[]; pricingRules: OperationalPricingRule[] };
type ViewState = MenuData & {
  key: string;
  status: "loading" | "ready" | "error";
  /** False while showing a saved or older menu until the current one arrives. */
  fresh: boolean;
  error: string;
};

/* Module scoped: survives route changes, never persists across a page/tab session. */
const menuCache = createOperationalMenuCache<MenuData>();

export function useOperationalMenu(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  userName: string;
  role: string;
}) {
  const token = getSerametAccessToken();
  const revision = useSyncExternalStore(
    subscribeOperationalMenu,
    getOperationalMenuRevision,
    () => 0,
  );
  const key = JSON.stringify([
    input.tenantId,
    input.branchId,
    input.userId,
    input.role,
    token,
    revision,
  ]);
  const headers = useMemo(
    () => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": input.userId,
      "x-seramet-user": input.userName,
      "x-seramet-role": input.role,
      "x-seramet-tenant-id": input.tenantId,
      "x-seramet-branch-id": input.branchId,
    }),
    [input.branchId, input.role, input.tenantId, input.userId, input.userName, token],
  );
  // A saved copy is tied to the menu access this person has now: someone who can no longer
  // sell never sees a priced copy, and someone with no menu access sees none at all.
  const { currentUser } = useAppContext();
  const access = currentUser.permissions.includes(permissions.ordersCreate)
    ? ("SELL" as const)
    : currentUser.permissions.includes(permissions.kitchenView)
      ? ("KITCHEN" as const)
      : null;
  const savedKey = access ? savedMenuKey({ ...input, access }) : null;
  // What can be shown before the current menu arrives: this tab's copy, else the copy saved on
  // this device for the same restaurant, branch, person, role and menu access.
  const initialView = (): ViewState => {
    const existing = menuCache.get(key);
    if (existing)
      return { key, ...existing.value, status: "ready", fresh: !existing.revalidate, error: "" };
    const saved = savedKey ? readSavedOperationalMenu(savedKey, isMenuData) : null;
    if (saved) return { key, ...saved, status: "ready", fresh: false, error: "" };
    return { key, items: [], pricingRules: [], status: "loading", fresh: false, error: "" };
  };
  const [view, setView] = useState<ViewState>(initialView);

  useEffect(() => {
    let active = true;
    // The previous branch's items must never appear during a context switch: the shown menu
    // always comes from this exact scope.
    const shown = initialView();
    setView(shown);
    // Reads the current menu. A background refresh of an already current menu never blocks
    // ordering and keeps the menu on screen if it fails; only the first read can.
    const refresh = (background: boolean) => {
      const startedAtEpoch = getSavedMenuEpoch();
      void menuCache
        .load(key, async () => {
          const response = await fetch(
            `/api/seramet/menu/catalog?branchId=${encodeURIComponent(input.branchId)}`,
            { headers, cache: "no-store" },
          );
          const body = (await response.json().catch(() => ({}))) as {
            items?: CatalogRow[];
            pricingRules?: OperationalPricingRule[];
            message?: string;
            error?: string;
          };
          if (!response.ok)
            throw Object.assign(
              new Error(body.message ?? body.error ?? `Menu request failed (${response.status})`),
              { httpStatus: response.status },
            );
          const items = (body.items ?? []).map<Product>((row) => ({
            id: row.id,
            itemCode: row.code,
            ...(row.sku ? { sku: row.sku } : {}),
            ...(row.barcode ? { barcode: row.barcode } : {}),
            name: row.name,
            category: row.category_code.replaceAll("_", " "),
            price: majorFromMinor(row.effective_price_minor, row.currency),
            priceMinor: row.effective_price_minor,
            ...(row.online_price_minor != null ? { onlinePriceMinor: row.online_price_minor } : {}),
            currency: row.currency,
            ...(row.tax_rule_id ? { taxRuleId: row.tax_rule_id } : {}),
            serviceChargeApplicable: row.service_charge_applicable === 1,
            prep: 0,
            out: !row.available,
            productionStation: row.station_code ?? "NONE",
            ...(row.image_url ? { imageUrl: row.image_url } : {}),
            importSource: "menu-import",
          }));
          const value = { items, pricingRules: body.pricingRules ?? [] };
          menuCache.set(key, value);
          return value;
        })
        .then((data) => {
          if (!active) return;
          // Saved only by a request still current here and begun before any sign-out since.
          if (savedKey) writeSavedOperationalMenu(savedKey, data, startedAtEpoch);
          setView({ key, ...data, status: "ready", fresh: true, error: "" });
        })
        .catch((cause: unknown) => {
          menuCache.clear(key);
          const status = (cause as { httpStatus?: number } | null)?.httpStatus;
          const refused = status === 401 || status === 403;
          // Access was refused: the saved copy goes and nothing stays on screen.
          if (refused && savedKey) removeSavedOperationalMenu(savedKey);
          if (!active || (background && !refused)) return;
          // Otherwise a shown older menu stays visible to browse, never treated as current.
          setView({
            key,
            items: refused ? [] : shown.items,
            pricingRules: refused ? [] : shown.pricingRules,
            status: "error",
            fresh: false,
            error: cause instanceof Error ? cause.message : "Authoritative menu is unavailable",
          });
        });
    };
    // Navigating back within 12 seconds does not fetch 345 items again.
    if (!shown.fresh) refresh(false);
    // An open POS keeps prices current: every two minutes, and on returning to the tab once the
    // menu is more than 12 seconds old.
    const timer = window.setInterval(() => refresh(true), BACKGROUND_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && menuCache.get(key)?.revalidate !== false)
        refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // initialView reads only key and savedKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, input.branchId, key, savedKey]);

  if (view.key !== key) {
    return {
      items: [] as Product[],
      pricingRules: [] as OperationalPricingRule[],
      status: "loading" as const,
      fresh: false,
      error: "",
    };
  }
  return {
    items: view.items,
    pricingRules: view.pricingRules,
    status: view.status,
    fresh: view.fresh,
    error: view.error,
  };
}
