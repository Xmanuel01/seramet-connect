import { useEffect, useRef, useState } from "react";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import { Btn } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function EmployeeStationAccess({
  employeeId,
  name,
  onClose,
}: {
  employeeId: string;
  name: string;
  onClose: () => void;
}) {
  const { activeTenantId, branchId, platformState, currentUser, sessionId } = useAppContext();
  const [ids, setIds] = useState<string[]>([]),
    [version, setVersion] = useState(0),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const scope = JSON.stringify([activeTenantId, branchId, employeeId, currentUser.id, sessionId]);
  const active = useRef(scope);
  const stations = platformState.stations.filter(
    (s) => s.tenantId === activeTenantId && s.branchId === branchId && s.active,
  );
  const headers = () => {
    const token = getSerametAccessToken();
    return {
      "content-type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };
  useEffect(() => {
    active.current = scope;
    setReady(false);
    setIds([]);
    setMessage("");
    const controller = new AbortController();
    void fetch(
      `/api/seramet/employees/${encodeURIComponent(employeeId)}/stations?branchId=${encodeURIComponent(branchId)}`,
      { headers: headers(), signal: controller.signal },
    )
      .then(async (response) => {
        const body = (await response.json()) as {
          stationIds: string[];
          version: number;
          message?: string;
        };
        if (!response.ok) throw Error(body.message ?? "Station assignment unavailable.");
        if (active.current === scope) {
          setIds(body.stationIds);
          setVersion(body.version);
          setReady(true);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && active.current === scope)
          setMessage(error instanceof Error ? error.message : "Could not load stations.");
      });
    return () => {
      controller.abort();
      active.current = "";
    };
    // Header values are captured by the exact identity/branch scope above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/seramet/employees/${encodeURIComponent(employeeId)}/stations`,
        {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ branchId, stationIds: ids, expectedVersion: version }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const body = (await response.json()) as { version: number; message?: string };
      if (!response.ok) throw Error(body.message ?? "Station update was not confirmed.");
      if (active.current === scope) {
        setVersion(body.version);
        setMessage("Preparation station access saved.");
      }
    } catch (error) {
      if (active.current === scope)
        setMessage(error instanceof Error ? error.message : "Could not save stations.");
    } finally {
      if (active.current === scope) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Preparation stations: {name}</DialogTitle>
          <DialogDescription>
            Active branch only. No selected stations means no preparation-ticket access.
          </DialogDescription>
        </DialogHeader>
        {stations.map((station) => (
          <label key={station.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={!ready || busy}
              checked={ids.includes(station.id)}
              onChange={(e) =>
                setIds((current) =>
                  e.target.checked
                    ? [...current, station.id]
                    : current.filter((id) => id !== station.id),
                )
              }
            />
            {station.name} ({station.code})
          </label>
        ))}
        <Btn disabled={!ready || busy} onClick={() => void save()}>
          Save station access
        </Btn>
        {message && <p role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
