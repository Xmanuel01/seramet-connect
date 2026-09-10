import { useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import type { Product } from "@/lib/menu-product";
import { majorFromMinor } from "@/payments/money";

type CatalogRow = {
  id: string;
  code: string;
  sku: string | null;
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

export function useOperationalMenu(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  userName: string;
  role: string;
}) {
  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": input.userId,
      "x-seramet-user": input.userName,
      "x-seramet-role": input.role,
      "x-seramet-tenant-id": input.tenantId,
      "x-seramet-branch-id": input.branchId,
    };
  }, [input.branchId, input.role, input.tenantId, input.userId, input.userName]);
  const [items, setItems] = useState<Product[]>([]);
  const [pricingRules, setPricingRules] = useState<OperationalPricingRule[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError("");
    void fetch(`/api/seramet/menu/catalog?branchId=${encodeURIComponent(input.branchId)}`, {
      headers,
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          items?: CatalogRow[];
          pricingRules?: OperationalPricingRule[];
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.message ?? body.error ?? `Menu request failed (${response.status})`);
        }
        const catalog = (body.items ?? []).map<Product>((row) => ({
          id: row.id,
          itemCode: row.code,
          ...(row.sku ? { sku: row.sku } : {}),
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
        setItems(catalog);
        setPricingRules(body.pricingRules ?? []);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Authoritative menu is unavailable");
        setItems([]);
        setPricingRules([]);
        setStatus("error");
      });
    return () => controller.abort();
  }, [headers, input.branchId]);

  return { items, pricingRules, status, error };
}
