import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type CookbookMethodStep = {
  id?: string;
  title?: string;
  instruction: string;
  timerMinutes?: number;
  temperatureC?: number;
  stationNote?: string;
};

export type CookbookMedia = {
  id?: string;
  kind: "IMAGE" | "VIDEO" | "DOCUMENT";
  url: string;
  caption?: string;
};

export type CookbookContent = {
  id: string;
  recipeId: string;
  recipeVersionId: string;
  revision: number;
  status: "DRAFT" | "PUBLISHED";
  prepMinutes: number;
  cookMinutes: number;
  portionLabel: string | null;
  imageUrl: string | null;
  chefNotes: string | null;
  method: CookbookMethodStep[];
  media: CookbookMedia[];
  sourceDocument: string | null;
  sourceReference: string | null;
  changeSummary: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
};

export type CookbookOverviewRecipe = {
  id: string;
  name: string | null;
  menu_item_id: string;
  production_item_id: string | null;
  branch_override_id: string | null;
  current_version_id: string;
  version: number;
  yield_quantity_minor: number;
  yield_unit_id: string;
  yield_unit_symbol: string | null;
  menu_item_code: string | null;
  menu_item_name: string | null;
  production_item_code: string | null;
  production_item_name: string | null;
  target_name: string;
  target_code: string;
  published: CookbookContent | null;
  draft: CookbookContent | null;
  has_unpublished_changes: boolean;
  publication_status: "PUBLISHED" | "DRAFT_CHANGES" | "DRAFT_ONLY" | "MISSING";
};

export type CookbookComponent = {
  id: string;
  inventory_item_id: string | null;
  sub_recipe_id: string | null;
  quantity_minor: number;
  unit_id: string;
  waste_factor_bps: number;
  optional: number;
  station_id: string | null;
  unit_symbol: string | null;
  inventory_item_code: string | null;
  inventory_item_name: string | null;
  sub_recipe_name: string | null;
};

export type CookbookDetail = {
  branchId: string;
  recipe: {
    id: string;
    name: string | null;
    menu_item_id: string;
    production_item_id: string | null;
    branch_override_id: string | null;
    current_version_id: string;
    version: number;
    yield_quantity_minor: number;
    yield_unit_id: string;
    yield_unit_symbol: string | null;
    menu_item_code: string | null;
    menu_item_name: string | null;
    production_item_code: string | null;
    production_item_name: string | null;
    target_name: string;
    target_code: string;
  };
  components: CookbookComponent[];
  draft: CookbookContent | null;
  published: CookbookContent | null;
  previousPublished: CookbookContent | null;
  history: Array<{
    id: string;
    revision: number;
    status: "DRAFT" | "PUBLISHED";
    changeSummary: string | null;
    createdBy: string;
    createdByName: string | null;
    createdAt: string;
  }>;
};

export function useCookbook(enabled: boolean) {
  const { activeTenantId, branchId, currentUser, role } = useAppContext();
  const [recipes, setRecipes] = useState<CookbookOverviewRecipe[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-seramet-user-id": currentUser.id,
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
    };
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, role]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRecipes([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(
        `/api/seramet/cookbook?branchId=${encodeURIComponent(branchId)}`,
        { headers },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        cookbook?: { recipes?: CookbookOverviewRecipe[] };
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? `Cookbook query failed (${response.status})`);
      }
      setRecipes(payload.cookbook?.recipes ?? []);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cookbook query failed");
      setStatus("error");
    }
  }, [branchId, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const detail = useCallback(
    async (recipeId: string) => {
      if (!enabled) throw new Error("Cookbook requires the authoritative server");
      const response = await fetch(
        `/api/seramet/cookbook/recipes/${encodeURIComponent(recipeId)}?branchId=${encodeURIComponent(branchId)}`,
        { headers },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        cookbook?: CookbookDetail;
        error?: string;
        message?: string;
      };
      if (!response.ok || !payload.cookbook) {
        throw new Error(payload.message ?? payload.error ?? `Cookbook detail failed (${response.status})`);
      }
      return payload.cookbook;
    },
    [branchId, enabled, headers],
  );

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!enabled) throw new Error("Cookbook commands require the authoritative server");
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? `Cookbook command failed (${response.status})`);
      }
      await refresh();
      return payload;
    },
    [enabled, headers, refresh],
  );

  return { recipes, status, error, refresh, detail, command };
}
