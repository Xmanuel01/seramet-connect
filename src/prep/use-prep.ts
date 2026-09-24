import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type PrepMethodStep = {
  step?: number;
  title?: string;
  instruction?: string;
  durationMinutes?: number;
  temperature?: string;
  checkpoint?: string;
};

export type PrepTask = {
  id: string;
  branchId: string;
  businessDate: string;
  recipeId: string;
  recipeName: string;
  recipeVersionId: string;
  recipeVersion: number;
  currentRecipeVersionId: string | null;
  outputItemId: string;
  outputItemName: string;
  defaultWarehouseId: string | null;
  yieldQuantityMicro: number;
  yieldUnitId: string;
  yieldUnitSymbol: string | null;
  forecastRequiredMicro: number;
  preparedAvailableMicro: number;
  safetyBufferMicro: number;
  recommendedBatchMicro: number;
  targetQuantityMicro: number | null;
  effectiveTargetMicro: number;
  dueAt: string | null;
  stationId: string | null;
  stationName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  productionBatchId: string | null;
  productionStatus: string | null;
  actualOutputQuantityMicro: number | null;
  status: "RECOMMENDED" | "ADJUSTED" | "APPROVED" | "STARTED" | "COMPLETED" | "DISMISSED";
  quality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
  explanation: Record<string, unknown>;
  adjustmentReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  dismissedBy: string | null;
  dismissedAt: string | null;
  dismissalReason: string | null;
  revision: number;
  generatedAt: string;
  updatedAt: string;
  recipeVersionCurrent: boolean;
  cookbookPublished: boolean;
  cookbook: {
    id: string;
    revision: number;
    prepMinutes: number;
    cookMinutes: number;
    portionLabel: string | null;
    imageUrl: string | null;
    chefNotes: string | null;
    method: PrepMethodStep[];
    sourceDocument: string | null;
    sourceReference: string | null;
    changeSummary: string | null;
    publishedAt: string;
  } | null;
  ingredients: Array<{
    id: string;
    inventoryItemId: string | null;
    subRecipeId: string | null;
    name: string;
    recipeQuantityMicro: number;
    scaledQuantityMicro: number;
    requiredWithWasteMicro: number;
    unitId: string;
    unitSymbol: string | null;
    wasteFactorBps: number;
    optional: boolean;
  }>;
};

export type PrepWarehouse = { id: string; code: string; name: string };
export type PrepStation = { id: string; code: string; name: string; station_type: string };

export type PrepLibrary = {
  branchId: string;
  businessDate: string;
  tasks: PrepTask[];
  warehouses: PrepWarehouse[];
  stations: PrepStation[];
  generatedAt: string;
};

export function usePrep(enabled: boolean) {
  const { activeTenantId, branchId, currentUser, role } = useAppContext();
  const [data, setData] = useState<PrepLibrary | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const headers = useMemo(() => {
    const token = getSerametAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "x-seramet-user-id": currentUser.id,
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      "x-seramet-user": currentUser.name,
      "x-seramet-role": role,
    };
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, role]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      setData(null);
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(
        "/api/seramet/prep/library?branchId=" + encodeURIComponent(branchId),
        { headers },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        prep?: PrepLibrary;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "Prep query failed (" + response.status + ")",
        );
      }
      setData(payload.prep ?? null);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Prep query failed");
      setStatus("error");
    }
  }, [branchId, enabled, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!enabled) throw new Error("Prep commands require the authoritative Seramet server");
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "Prep command failed (" + response.status + ")",
        );
      }
      await refresh();
      return payload;
    },
    [enabled, headers, refresh],
  );

  const regenerate = useCallback(async () => {
    if (!enabled) throw new Error("Prep regeneration requires the authoritative server");
    const response = await fetch("/api/seramet/prep/regenerate", {
      method: "POST",
      headers,
      body: JSON.stringify({ branchId }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.message ?? payload.error ?? "Prep regeneration could not be queued",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1400));
    await refresh();
  }, [branchId, enabled, headers, refresh]);

  return { data, status, error, refresh, command, regenerate };
}
