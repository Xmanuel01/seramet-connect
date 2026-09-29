import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

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
  method: Array<{
    step: number;
    title?: string;
    instruction: string;
    durationMinutes?: number;
    temperature?: string;
    checkpoint?: string;
  }>;
  media: Array<{
    type: "IMAGE" | "VIDEO" | "DOCUMENT" | "LINK";
    url: string;
    label?: string;
  }>;
  sourceDocument: string | null;
  sourceReference: string | null;
  changeSummary: string | null;
  createdBy: string;
  createdAt: string;
};

export type CookbookRecipe = {
  id: string;
  name: string;
  menu_item_id: string | null;
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
  latestContent: CookbookContent | null;
  publishedContent: CookbookContent | null;
  previousPublishedContent: CookbookContent | null;
  ingredients: Array<Record<string, unknown>>;
};

export function useCookbook(enabled: boolean) {
  const { activeTenantId, branchId, currentUser, role } = useAppContext();
  const [recipes, setRecipes] = useState<CookbookRecipe[]>([]);
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
    if (!enabled) return;
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(
        `/api/seramet/cookbook/library?branchId=${encodeURIComponent(branchId)}`,
        { headers },
      );
      const payload = (await response.json()) as {
        library?: { recipes?: CookbookRecipe[] };
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "Cookbook query failed");
      setRecipes(payload.library?.recipes ?? []);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cookbook query failed");
      setStatus("error");
    }
  }, [branchId, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body: unknown) => {
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Cookbook command failed");
      await refresh();
      return payload;
    },
    [headers, refresh],
  );

  return { recipes, status, error, refresh, command };
}
