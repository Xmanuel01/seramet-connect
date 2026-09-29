import { useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import type { Product } from "@/lib/menu-product";
import { majorFromMinor } from "@/payments/money";
import { createOperationalMenuCache } from "./operational-menu-cache";

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
  currency: string;
  tax_rule_id: string | null;
  service_charge_applicable: number;
  station_code: string | null;
  available: number;
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
  const key = JSON.stringify([input.tenantId, input.branchId, input.userId, input.role, token]);
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
  const [view, setView] = useState<ViewState>(() => {
    const existing = menuCache.get(key);
    return {
      key,
      items: existing?.value.items ?? [],
      pricingRules: existing?.value.pricingRules ?? [],
      status: existing ? "ready" : "loading",
      error: "",
    };
  });

  useEffect(() => {
    let active = true;
    const existing = menuCache.get(key);
    // The previous branch's items must never appear during a context switch.
    if (!existing) {
      setView({ key, items: [], pricingRules: [], status: "loading", error: "" });
    } else {
      setView({ key, ...existing.value, status: "ready", error: "" });
      // Navigating back within 12 seconds does not fetch 345 items again.
      if (!existing.revalidate)
        return () => {
          active = false;
        };
    }

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
          throw new Error(body.message ?? body.error ?? `Menu request failed (${response.status})`);
        const items = (body.items ?? []).map<Product>((row) => ({
          id: row.id,
          itemCode: row.code,
          ...(row.sku ? { sku: row.sku } : {}),
          ...(row.barcode ? { barcode: row.barcode } : {}),
          name: row.name,
          category: row.category_code.replaceAll("_", " "),
          price: majorFromMinor(row.effective_price_minor, row.currency),
          priceMinor: row.effective_price_minor,
          currency: row.currency,
          ...(row.tax_rule_id ? { taxRuleId: row.tax_rule_id } : {}),
          serviceChargeApplicable: row.service_charge_applicable === 1,
          prep: 0,
          out: !row.available,
          productionStation: row.station_code ?? "NONE",
          importSource: "menu-import",
        }));
        const value = { items, pricingRules: body.pricingRules ?? [] };
        menuCache.set(key, value);
        return value;
      })
      .then((data) => {
        if (active) setView({ key, ...data, status: "ready", error: "" });
      })
      .catch((cause: unknown) => {
        menuCache.clear(key);
        if (!active) return;
        setView({
          key,
          items: [],
          pricingRules: [],
          status: "error",
          error: cause instanceof Error ? cause.message : "Authoritative menu is unavailable",
        });
      });
    return () => {
      active = false;
    };
  }, [headers, input.branchId, key]);

  if (view.key !== key) {
    return {
      items: [] as Product[],
      pricingRules: [] as OperationalPricingRule[],
      status: "loading" as const,
      error: "",
    };
  }
  return {
    items: view.items,
    pricingRules: view.pricingRules,
    status: view.status,
    error: view.error,
  };
}
