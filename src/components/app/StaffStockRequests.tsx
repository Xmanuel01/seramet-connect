import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
type Data = {
  warehouses: { id: string; name: string }[];
  items: { id: string; name: string; unitId: string; unit: string }[];
  requests: { id: string; reference: string; status: string }[];
};
export function StaffStockRequests() {
  const { activeTenantId, branchId, branchLabel, currentUser, sessionId } = useAppContext();
  const scope = JSON.stringify([activeTenantId, branchId, currentUser.id, sessionId]);
  const active = useRef(scope);
  const [data, setData] = useState<Data | null>(null),
    [warehouse, setWarehouse] = useState(""),
    [item, setItem] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [notes, setNotes] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const lock = useRef(false);
  const headers = () => {
    const token = getSerametAccessToken();
    return {
      "content-type": "application/json",
      "x-seramet-tenant-id": activeTenantId,
      "x-seramet-branch-id": branchId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };
  const storage = "seramet.attendance.stock-request." + scope;
  async function load(signal?: AbortSignal) {
    const response = await fetch(
      `/api/seramet/procurement/requisition-workspace?branchId=${encodeURIComponent(branchId)}`,
      { headers: headers(), signal: signal ?? AbortSignal.timeout(15000) },
    );
    const body = (await response.json()) as Data & { message?: string };
    if (!response.ok) throw Error(body.message ?? "Stock requests unavailable.");
    if (active.current === scope) setData(body);
    return body;
  }
  useEffect(() => {
    active.current = scope;
    setData(null);
    setWarehouse("");
    setItem("");
    setQuantity("1");
    setNotes("");
    setMessage("");
    lock.current = false;
    setBusy(false);
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) ?? "null") as {
        at: number;
        payload: Record<string, unknown>;
      } | null;
      setPending(
        saved && Date.now() - saved.at < 8 * 3600000 && saved.at <= Date.now()
          ? saved.payload
          : null,
      );
    } catch {
      setPending(null);
    }
    const controller = new AbortController();
    void load(controller.signal).catch((error) => {
      if (!controller.signal.aborted && active.current === scope)
        setMessage(error instanceof Error ? error.message : "Stock requests unavailable.");
    });
    return () => {
      active.current = "";
      controller.abort();
    };
    // Exact identity scope controls request lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  async function submit() {
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    let payload = pending;
    try {
      if (payload) {
        const latest = await load();
        if (latest.requests.some((row) => row.id === payload!.id)) {
          setPending(null);
          try {
            sessionStorage.removeItem(storage);
          } catch {
            /* Storage is optional. */
          }
          setMessage("The server confirmed your previous stock request.");
          return;
        }
      } else {
        const selected = data.items.find((row) => row.id === item);
        if (!selected || !warehouse || !/^\d+(\.\d{1,6})?$/.test(quantity))
          throw Error(
            "Select a warehouse and item, and enter a positive quantity with at most six decimals.",
          );
        const [whole, fraction = ""] = quantity.split(".");
        const micro = Number(whole) * 1000000 + Number(fraction.padEnd(6, "0"));
        if (!Number.isSafeInteger(micro) || micro <= 0)
          throw Error("Enter a positive supported quantity.");
        payload = {
          id: crypto.randomUUID(),
          branchId,
          warehouseId: warehouse,
          sourceType: "MANUAL_REQUEST",
          lines: [
            {
              inventoryItemId: item,
              requestedQuantityMicro: micro,
              unitId: selected.unitId,
              notes: notes.trim(),
            },
          ],
        };
        setPending(payload);
        try {
          sessionStorage.setItem(storage, JSON.stringify({ at: Date.now(), payload }));
        } catch {
          /* In-memory retry remains available. */
        }
      }
      const response = await fetch("/api/seramet/procurement/requisitions", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        if ([400, 403, 404, 422].includes(response.status) && active.current === scope) {
          setPending(null);
          try {
            sessionStorage.removeItem(storage);
          } catch {
            /* Storage is optional. */
          }
        }
        throw Error(
          result.message ??
            "Stock request not confirmed. Check the original request before retrying.",
        );
      }
      if (active.current !== scope) return;
      setPending(null);
      try {
        sessionStorage.removeItem(storage);
      } catch {
        /* No stored draft. */
      }
      setNotes("");
      setMessage(
        "Stock request submitted for purchasing review. No purchase or stock deduction was made.",
      );
      await load();
    } catch (error) {
      if (active.current === scope)
        setMessage(error instanceof Error ? error.message : "Stock request unavailable.");
    } finally {
      if (active.current === scope) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <AppShell title="Stock requests" subtitle={branchLabel}>
      <Panel>
        <PanelHead title="Request replenishment" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="grid gap-1">
            Warehouse
            <select
              className="min-h-10 rounded border bg-background px-2"
              required
              disabled={busy || !!pending}
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              <option value="">Select warehouse</option>
              {data?.warehouses.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Stock item
            <select
              className="min-h-10 rounded border bg-background px-2"
              required
              disabled={busy || !!pending}
              value={item}
              onChange={(e) => setItem(e.target.value)}
            >
              <option value="">Select item</option>
              {data?.items.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Quantity
            <input
              className="min-h-10 rounded border px-2"
              required
              inputMode="decimal"
              value={quantity}
              disabled={busy || !!pending}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            Request notes
            <textarea
              className="rounded border p-2"
              maxLength={500}
              value={notes}
              disabled={busy || !!pending}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {pending ? (
            <Btn disabled={busy} onClick={() => void submit()}>
              Check / retry stock request
            </Btn>
          ) : (
            <Btn type="submit" variant="primary" disabled={busy || !data}>
              Submit stock request
            </Btn>
          )}
          {message && (
            <p role="status" className="sm:col-span-2">
              {message}
            </p>
          )}
        </form>
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="My requests" />
        <div className="space-y-2 p-4">
          {data?.requests.map((row) => (
            <div key={row.id} className="flex justify-between gap-3 text-sm">
              <span>{row.reference}</span>
              <Status>{row.status}</Status>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
