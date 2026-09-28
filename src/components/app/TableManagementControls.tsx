import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Btn, Panel, PanelHead } from "@/components/app/ui";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAppContext } from "@/lib/app-context";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { PlatformState, RestaurantTable, ServiceArea } from "@/platform/types";

type TableResponse = {
  ok: boolean;
  areas: ServiceArea[];
  tables: RestaurantTable[];
};

async function api<T>(path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown) {
  const response = await authenticatedFetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(result.message || `Table service error (HTTP ${response.status})`);
  return result;
}

export function TableManagementControls() {
  const { activeTenantId, branchId, hasPermission, refreshConfiguration } = useAppContext();
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [areaName, setAreaName] = useState("");
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState(2);
  const [serviceAreaId, setServiceAreaId] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = hasPermission("table.manage");
  const branchAreas = useMemo(() => areas.filter((area) => area.active), [areas]);
  const selected = tables.find((table) => table.id === selectedId);
  const proposedCode = useMemo(() => {
    const used = new Set(tables.map((table) => table.code.toUpperCase()));
    for (let n = 1; n <= 999; n += 1) {
      const value = String(n).padStart(2, "0");
      if (!used.has(value)) return value;
    }
    return "";
  }, [tables]);

  const load = useCallback(async () => {
    const result = await api<TableResponse>(
      `/api/seramet/table-management?branchId=${encodeURIComponent(branchId)}`,
    );
    setAreas(result.areas);
    setTables(result.tables);
    return result;
  }, [branchId]);

  useEffect(() => {
    if (!canManage) return;
    let mounted = true;
    setLoading(true);
    setError("");
    void load()
      .catch((failure: unknown) => {
        if (mounted) setError(failure instanceof Error ? failure.message : "Unable to load tables");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [canManage, load]);

  const synchronize = async () => {
    await load();
    // Replace the client read cache; do NOT invoke its broad configuration-import writer.
    const response = await api<{ configuration: PlatformState }>("/api/seramet/configuration");
    if (!response.configuration) throw new Error("Authoritative configuration was not returned");
    getConfigurationRepository().replaceState(response.configuration);
    refreshConfiguration();
  };

  const submit = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await synchronize();
      setNotice(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Table operation failed");
    } finally {
      setBusy(false);
    }
  };

  const createArea = (event: FormEvent) => {
    event.preventDefault();
    const name = areaName.trim();
    if (!name) return;
    void submit(async () => {
      await api("/api/seramet/table-management/areas", "POST", { branchId, name });
      setAreaName("");
    }, `${name} area added.`);
  };

  const createTable = (event: FormEvent) => {
    event.preventDefault();
    const tableCode = code.trim().toUpperCase() || proposedCode;
    if (!serviceAreaId || !tableCode) {
      setError("Select a dining area and table number");
      return;
    }
    void submit(async () => {
      await api("/api/seramet/table-management/tables", "POST", {
        branchId, serviceAreaId, code: tableCode, seats,
      });
      setCode("");
    }, `Table ${tableCode} added to this branch.`);
  };

  const selectEdit = (id: string) => {
    const table = tables.find((row) => row.id === id);
    setSelectedId(id);
    if (table) {
      setSeats(table.seats);
      setServiceAreaId(table.serviceAreaId ?? "");
      setActive(table.active);
    }
  };

  const saveChanges = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    void submit(async () => {
      await api(`/api/seramet/table-management/tables/${encodeURIComponent(selected.id)}`, "PATCH", {
        branchId,serviceAreaId,seats,active,
      });
    }, `Table ${selected.code} updated.`);
  };

  if (!canManage) return null;

  return (
    <Panel className="mb-4">
      <PanelHead title="Manage dining tables" sub="Authorized changes are saved to this branch's database" />
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <form onSubmit={createArea} className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">1. Dining areas</h3>
          <label htmlFor="new-area" className="block text-xs text-muted-foreground">New area name</label>
          <input id="new-area" required minLength={2} maxLength={60}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={areaName} onChange={(event) => setAreaName(event.target.value)}
            placeholder="Dining, Terrace, VIP" disabled={busy} />
          <Btn type="submit" variant="primary" disabled={busy || loading}>Add area</Btn>
        </form>
        <form onSubmit={createTable} className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">2. Add table</h3>
          <label htmlFor="table-code" className="block text-xs text-muted-foreground">Table number</label>
          <input id="table-code" required={!proposedCode} maxLength={16} pattern="[a-zA-Z0-9_-]{1,16}"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder={proposedCode || "01"} value={code} onChange={(event) => setCode(event.target.value)}
            disabled={busy} />
          <label htmlFor="new-table-area" className="block text-xs text-muted-foreground">Area</label>
          <select id="new-table-area" required value={selectedId ? "" : serviceAreaId}
            onChange={(event) => { setSelectedId("");setServiceAreaId(event.target.value); }}
            disabled={busy || !branchAreas.length}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Select area</option>
            {branchAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
          <label htmlFor="new-table-seats" className="block text-xs text-muted-foreground">Seats</label>
          <input id="new-table-seats" type="number" min={1} max={24} required value={selectedId ? 2 : seats}
            onChange={(event) => {setSelectedId("");setSeats(Number(event.target.value));}}
            disabled={busy}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <Btn type="submit" variant="primary" disabled={busy || loading || !branchAreas.length}>Create table</Btn>
        </form>
        <form onSubmit={saveChanges} className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">3. Edit table</h3>
          <label htmlFor="edit-table" className="block text-xs text-muted-foreground">Select existing table</label>
          <select id="edit-table" value={selectedId} onChange={(event) => selectEdit(event.target.value)}
            disabled={busy} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Select table</option>
            {tables.map((table) => <option key={table.id} value={table.id}>Table {table.code}{table.active ? "" : " (Inactive)"}</option>)}
          </select>
          <label htmlFor="edit-area" className="block text-xs text-muted-foreground">Dining area</label>
          <select id="edit-area" value={selectedId ? serviceAreaId : ""}
            disabled={!selected || busy} required onChange={(event) => setServiceAreaId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Select area</option>
            {branchAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
          <label htmlFor="edit-seats" className="block text-xs text-muted-foreground">Seats</label>
          <input id="edit-seats" type="number" min={1} max={24} required disabled={!selected || busy}
            value={selectedId ? seats : 2} onChange={(event) => setSeats(Number(event.target.value))}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!selected || busy} checked={selectedId ? active : true}
              onChange={(event) => setActive(event.target.checked)} />
            Active and selectable in POS
          </label>
          <Btn type="submit" variant="primary" disabled={!selected || busy}>Save changes</Btn>
        </form>
      </div>
      <div aria-live="polite" className="px-4 pb-4 text-xs">
        {loading && <p className="text-muted-foreground">Loading authoritative tables...</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {notice && <p className="text-success">{notice}</p>}
        <p className="mt-2 text-muted-foreground">
          Branch: {branchId}. {tables.filter((table) => table.active).length} active tables.
          Changes are tenant- and branch-scoped and audited.
        </p>
      </div>
    </Panel>
  );
}
