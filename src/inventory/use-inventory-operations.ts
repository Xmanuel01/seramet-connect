import { useCallback, useMemo } from "react";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";

export function useInventoryOperations(enabled = true) {
  const { activeTenantId, branchId, branchRecords, isAllBranches, currentUser, role } =
    useAppContext();
  const branchIds = useMemo(
    () => (isAllBranches ? branchRecords.map((branch) => branch.id) : [branchId]),
    [branchId, branchRecords, isAllBranches],
  );

  const headers = useMemo<Record<string, string>>(() => {
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

  const request = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      if (!enabled) throw new Error("Authoritative inventory operations are unavailable offline");
      const response = await fetch(path, {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers ?? {}),
        },
      });
      const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Inventory operation failed (${response.status})`,
        );
      }
      return payload;
    },
    [enabled, headers],
  );

  const post = useCallback(
    async <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    [request],
  );

  return { branchIds, headers, request, post };
}
