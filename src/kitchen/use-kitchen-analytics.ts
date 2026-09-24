import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export type KitchenAnalyticsPeriod = 1 | 7 | 30;

export type KitchenAnalyticsOverview = {
  branchId: string;
  periodDays: KitchenAnalyticsPeriod;
  periodStart: string;
  periodEnd: string;
  summary: {
    ticketCount: number;
    completedCount: number;
    lateCount: number;
    completionBps: number;
    lateBps: number;
    averagePrepMs: number | null;
  };
  stations: Array<{
    stationId: string;
    stationName: string;
    ticketCount: number;
    completedCount: number;
    lateCount: number;
    completionBps: number;
    lateBps: number;
    averagePrepMs: number | null;
    averageReadyPickupMs: number | null;
    throughputPerHourMilli: number | null;
    timingWeight: number;
    quality: "HIGH" | "LOW" | "INSUFFICIENT_DATA";
  }>;
  daily: Array<{
    businessDate: string;
    ticketCount: number;
    completedCount: number;
    lateCount: number;
    lateBps: number;
    averagePrepMs: number | null;
  }>;
  production: {
    batchCount: number;
    completedCount: number;
    inProgressCount: number;
    cancelledCount: number;
    belowTargetCount: number;
    averageYieldVarianceBps: number | null;
    averageAbsoluteYieldVarianceBps: number | null;
  };
  prep: {
    taskCount: number;
    completedCount: number;
    startedCount: number;
    approvedCount: number;
    dismissedCount: number;
    awaitingApprovalCount: number;
    completionBps: number;
  };
  cookbook: {
    recipeCount: number;
    publishedCount: number;
    missingCount: number;
    coverageBps: number;
  };
  currentPrep: {
    blockerCount: number;
    blockers: Array<{
      id: string;
      recipeName: string;
      status: string;
      reasons: string[];
    }>;
  };
  generatedAt: string;
};

export function useKitchenAnalytics(enabled: boolean, periodDays: KitchenAnalyticsPeriod) {
  const { activeTenantId, branchId, currentUser, role } = useAppContext();
  const [overview, setOverview] = useState<KitchenAnalyticsOverview | null>(null);
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
      setOverview(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(
        `/api/seramet/kitchen-analytics/overview?branchId=${encodeURIComponent(
          branchId,
        )}&periodDays=${periodDays}`,
        { headers },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        overview?: KitchenAnalyticsOverview;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.overview) {
        throw new Error(
          payload.message ?? payload.error ?? `Kitchen analytics query failed (${response.status})`,
        );
      }
      setOverview(payload.overview);
      setStatus("ready");
    } catch (cause) {
      setOverview(null);
      setError(cause instanceof Error ? cause.message : "Kitchen analytics query failed");
      setStatus("error");
    }
  }, [branchId, enabled, headers, periodDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { overview, status, error, refresh };
}
