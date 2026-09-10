import { useCallback, useEffect, useMemo, useState } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import type {
  FoodCostBridge,
  ManagementControlCentre,
  OwnerControlCentre,
} from "@/management/types";

export function useManagementIntelligence(enabled = true) {
  const { activeTenantId, branchId, branchRecords, currentUser, isAllBranches, role } =
    useAppContext();
  const selectedBranchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );
  const branchKey = selectedBranchIds.join("|");
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
      ...(isAllBranches ? { "x-seramet-branch-scope": "ALL" } : {}),
    };
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, isAllBranches, role]);
  const [controls, setControls] = useState<ManagementControlCentre[]>([]);
  const [owner, setOwner] = useState<OwnerControlCentre | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const branchIds = branchKey.split("|").filter(Boolean);
      const [controlRows, ownerPayload] = await Promise.all([
        Promise.all(
          branchIds.map(async (selectedBranchId) => {
            const response = await fetch(
              `/api/seramet/management/control-centre?branchId=${encodeURIComponent(selectedBranchId)}&limit=100`,
              { headers },
            );
            const body = (await response.json().catch(() => ({}))) as {
              controlCentre?: ManagementControlCentre;
              message?: string;
              error?: string;
            };
            if (!response.ok || !body.controlCentre) {
              throw new Error(
                body.message ??
                  body.error ??
                  `Management read model unavailable (${response.status})`,
              );
            }
            return body.controlCentre;
          }),
        ),
        isAllBranches
          ? fetch("/api/seramet/management/owner", { headers }).then(async (response) => {
              const body = (await response.json().catch(() => ({}))) as {
                owner?: OwnerControlCentre;
                message?: string;
              };
              if (!response.ok || !body.owner) {
                throw new Error(
                  body.message ?? `Owner read model unavailable (${response.status})`,
                );
              }
              return body.owner;
            })
          : Promise.resolve(null),
      ]);
      setControls(controlRows);
      setOwner(ownerPayload);
      setStatus("ready");
    } catch (cause) {
      setControls([]);
      setOwner(null);
      setError(cause instanceof Error ? cause.message : "Management read model unavailable");
      setStatus("error");
    }
  }, [branchKey, enabled, headers, isAllBranches]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
      const payload = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Management command failed (${response.status})`,
        );
      }
      await refresh();
      return payload;
    },
    [headers, refresh],
  );

  const recalculate = useCallback(
    () =>
      command<{ queued: unknown }>("/api/seramet/management/recalculate", {
        ...(isAllBranches ? {} : { branchId }),
      }),
    [branchId, command, isAllBranches],
  );

  const transitionAction = useCallback(
    (
      actionId: string,
      nextStatus: "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED",
      note: string,
    ) =>
      command(`/api/seramet/management/actions/${encodeURIComponent(actionId)}/transition`, {
        status: nextStatus,
        note,
      }),
    [command],
  );

  const loadFoodCostBridge = useCallback(
    async (input: {
      branchId: string;
      currentStart: string;
      currentEnd: string;
      previousStart: string;
      previousEnd: string;
    }) => {
      const query = new URLSearchParams(input).toString();
      const response = await fetch(`/api/seramet/management/food-cost-bridge?${query}`, {
        headers,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        bridge?: FoodCostBridge;
        message?: string;
      };
      if (!response.ok || !payload.bridge) {
        throw new Error(payload.message ?? `Food-cost bridge unavailable (${response.status})`);
      }
      return payload.bridge;
    },
    [headers],
  );

  const combined = useMemo(
    () => ({
      netSalesMinor: controls.reduce((sum, row) => sum + (row.latest?.netSalesMinor ?? 0), 0),
      grossProfitMinor: controls.reduce((sum, row) => sum + (row.latest?.grossProfitMinor ?? 0), 0),
      orderCount: controls.reduce((sum, row) => sum + (row.latest?.orderCount ?? 0), 0),
      openActions: controls.reduce((sum, row) => sum + row.actions.length, 0),
    }),
    [controls],
  );

  return {
    controls,
    control: controls[0] ?? null,
    owner,
    combined,
    status,
    error,
    refresh,
    recalculate,
    transitionAction,
    loadFoodCostBridge,
  };
}
