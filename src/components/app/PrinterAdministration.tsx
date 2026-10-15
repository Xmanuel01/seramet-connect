import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Pencil, RefreshCw, Printer } from "lucide-react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import {
  loadInstalledPrintBridgeConfig,
  saveInstalledPrintBridgeConfig,
} from "@/lib/print-bridge-client-config";
import { SerametLocalPrintBridge, type PrintJob } from "@/lib/seramet-print-service";
import type { PrinterConfiguration } from "@/printing/printer-configuration";
import { Btn, Panel, PanelHead } from "@/components/app/ui";

type SavedPrinter = PrinterConfiguration & { id: string };
const inputClass = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const roleOptions = [
  "BILL",
  "RECEIPT",
  "INVOICE",
  "KITCHEN",
  "BAR",
  "DISPATCH",
  "REPORT",
  "FRONT",
] as const;
function blank(branchId: string): PrinterConfiguration {
  return {
    branchId,
    name: "",
    bridgeId: "",
    transport: "WINDOWS",
    osPrinterName: "",
    port: 9100,
    paperWidth: "80mm",
    encoding: "ascii",
    cutter: "none",
    emphasis: false,
    roles: ["BILL", "RECEIPT"],
    stations: [],
    copies: 1,
    enabled: true,
  };
}

export function PrinterAdministration() {
  const { activeTenantId, branchId, hasPermission, refreshConfiguration } = useAppContext();
  const mayManage = hasPermission(permissions.settingsHardwareManage);
  const [printers, setPrinters] = useState<SavedPrinter[]>([]);
  const [draft, setDraft] = useState(() => blank(branchId));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bridge, setBridge] = useState(loadInstalledPrintBridgeConfig);
  const [attempts, setAttempts] = useState<
    Array<{ id: string; stage: string; outcome: string; updated_at: string }>
  >([]);
  const inspectQueue = async () => {
    try {
      const endpoint = new URL(bridge.endpoint);
      if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname))
        throw new Error("Invalid loopback bridge endpoint");
      const response = await fetch(`${bridge.endpoint.replace(/\/+$/, "")}/jobs`, {
        headers: { Authorization: `Bearer ${bridge.token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Bridge queue unavailable");
      setAttempts((await response.json()).jobs);
    } catch {
      setNotice("Bridge queue unavailable; no delivery outcome can be assumed");
    }
  };
  const stations = getConfigurationRepository()
    .snapshot()
    .stations.filter(
      (station) =>
        station.tenantId === activeTenantId && station.branchId === branchId && station.active,
    );
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-seramet-branch-id": branchId,
      "x-seramet-tenant-id": activeTenantId,
      ...(getSerametAccessToken() ? { Authorization: `Bearer ${getSerametAccessToken()}` } : {}),
    }),
    [branchId, activeTenantId],
  );
  const refresh = useCallback(async () => {
    const response = await authenticatedFetch("/api/seramet/printing/printers", {
      headers: headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Printer configuration could not be loaded");
    setPrinters((await response.json()).printers);
  }, [headers]);
  useEffect(() => {
    void refresh().catch(() => setNotice("Printer configuration unavailable"));
  }, [branchId, refresh]);
  const save = async (printer: PrinterConfiguration) => {
    setBusy(true);
    try {
      const response = await authenticatedFetch("/api/seramet/printing/printers", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...printer, branchId }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error("Printer save rejected. Check permissions and required endpoint fields.");
      await refreshConfiguration();
      await refresh();
      setOpen(false);
      setNotice("Printer configuration saved. Transport status remains unknown until tested.");
      window.dispatchEvent(
        new CustomEvent("seramet:hardware-profile-change", { detail: { branchId } }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Printer save failed");
    } finally {
      setBusy(false);
    }
  };
  const testPrinter = async (
    printer: SavedPrinter,
    documentType: "BILL" | "RECEIPT" | "FOOD_KOT",
  ) => {
    setBusy(true);
    try {
      const diagnostic: PrintJob = {
        id: crypto.randomUUID(),
        orderId: "#PRINT-TEST",
        branch: branchId,
        branchId,
        tenantId: activeTenantId,
        documentType,
        printerId: printer.id,
        destination: "FRONT",
        createdAt: new Date().toISOString(),
        requestedBy: "Diagnostic",
        copies: 1,
        status: "Queued",
        retryCount: 0,
        template: printer.paperWidth,
        content: "Server-generated diagnostic",
        duplicateKey: crypto.randomUUID(),
      };
      const result = await SerametLocalPrintBridge.submitToInstalledBridge(
        diagnostic,
        bridge.token,
        bridge.endpoint,
      );
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Diagnostic delivery uncertain");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="mb-4">
      <PanelHead
        title="Configured printers"
        sub="Active branch"
        right={
          <div className="flex gap-2">
            <Btn
              onClick={() => void refresh().catch(() => setNotice("Refresh failed"))}
              title="Refresh printers"
            >
              <RefreshCw className="h-4 w-4" />
            </Btn>
            {mayManage && (
              <Btn
                onClick={() => {
                  setDraft(blank(branchId));
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add printer
              </Btn>
            )}
          </div>
        }
      />
      <div className="space-y-4 p-4">
        {notice && (
          <div role="status" className="text-sm">
            {notice}
          </div>
        )}
        <Btn disabled={!bridge.enabled || busy} onClick={() => void inspectQueue()}>
          <RefreshCw className="h-4 w-4" />
          Inspect bridge queue
        </Btn>
        {attempts.length > 0 && (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Stage</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="max-w-64 break-all py-2">{attempt.id}</td>
                    <td>{attempt.stage}</td>
                    <td>{attempt.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Transport</th>
                <th>Paper</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {printers.map((printer) => (
                <tr key={printer.id} className="border-t border-border">
                  <td className="py-3">{printer.name}</td>
                  <td>{printer.transport}</td>
                  <td>{printer.paperWidth}</td>
                  <td>{printer.enabled ? "Unknown" : "Disabled"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {mayManage && (
                        <>
                          <Btn
                            disabled={busy}
                            onClick={() => {
                              setDraft(printer);
                              setOpen(true);
                            }}
                            title="Edit printer"
                          >
                            <Pencil className="h-4 w-4" />
                          </Btn>
                          <Btn
                            disabled={busy}
                            onClick={() => void save({ ...printer, enabled: !printer.enabled })}
                          >
                            {printer.enabled ? "Disable" : "Enable"}
                          </Btn>
                          {(["BILL", "RECEIPT", "FOOD_KOT"] as const).map((kind) => (
                            <Btn
                              key={kind}
                              disabled={busy || !printer.enabled}
                              onClick={() => void testPrinter(printer, kind)}
                            >
                              <Printer className="h-4 w-4" />
                              Test {kind === "FOOD_KOT" ? "KOT" : kind.toLowerCase()}
                            </Btn>
                          ))}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mayManage && open && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(draft);
            }}
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
          >
            <label>
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              Enrolled bridge ID
              <input
                required
                minLength={8}
                value={draft.bridgeId}
                onChange={(e) => setDraft({ ...draft, bridgeId: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              Transport
              <select
                className={inputClass}
                value={draft.transport}
                onChange={(e) =>
                  setDraft({ ...draft, transport: e.target.value as "WINDOWS" | "TCP" })
                }
              >
                <option value="WINDOWS">Windows spooler (including installed USB)</option>
                <option value="TCP">Network TCP ESC/POS</option>
              </select>
            </label>
            {draft.transport === "WINDOWS" ? (
              <label>
                Installed printer name
                <input
                  required
                  value={draft.osPrinterName ?? ""}
                  onChange={(e) => setDraft({ ...draft, osPrinterName: e.target.value })}
                  className={inputClass}
                />
              </label>
            ) : (
              <>
                <label>
                  Printer host
                  <input
                    required
                    value={draft.host ?? ""}
                    onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label>
                  TCP port
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    required
                    value={draft.port}
                    onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>
              </>
            )}
            <label>
              Paper
              <select
                value={draft.paperWidth}
                onChange={(e) =>
                  setDraft({ ...draft, paperWidth: e.target.value as "58mm" | "80mm" })
                }
                className={inputClass}
              >
                <option>58mm</option>
                <option>80mm</option>
              </select>
            </label>
            <label>
              Cutter
              <select
                value={draft.cutter}
                onChange={(e) =>
                  setDraft({ ...draft, cutter: e.target.value as PrinterConfiguration["cutter"] })
                }
                className={inputClass}
              >
                <option value="none">None</option>
                <option value="partial">Partial cut</option>
                <option value="full">Full cut</option>
              </select>
            </label>
            <label>
              Copies
              <input
                type="number"
                min={1}
                max={3}
                value={draft.copies}
                onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value) })}
                className={inputClass}
              />
            </label>
            <label>
              Approved fallback
              <select
                value={draft.fallbackPrinterId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, fallbackPrinterId: e.target.value || undefined })
                }
                className={inputClass}
              >
                <option value="">None</option>
                {printers
                  .filter((item) => item.id !== draft.id && item.enabled)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <fieldset>
              <legend>Document roles</legend>
              <div className="flex flex-wrap gap-3">
                {roleOptions.map((role) => (
                  <label key={role} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.roles.includes(role)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          roles: e.target.checked
                            ? [...draft.roles, role]
                            : draft.roles.filter((value) => value !== role),
                        })
                      }
                    />
                    {role}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Production stations</legend>
              <div className="flex flex-wrap gap-3">
                {stations.map((station) => (
                  <label key={station.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.stations.includes(station.code)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          stations: e.target.checked
                            ? [...draft.stations, station.code]
                            : draft.stations.filter((value) => value !== station.code),
                        })
                      }
                    />
                    {station.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.emphasis}
                onChange={(e) => setDraft({ ...draft, emphasis: e.target.checked })}
              />
              Emphasized heading
            </label>
            <div className="flex gap-2">
              <Btn type="submit" disabled={busy}>
                <Save className="h-4 w-4" />
                Save printer
              </Btn>
              <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            </div>
          </form>
        )}
        {mayManage && (
          <form
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveInstalledPrintBridgeConfig(bridge);
              setNotice("Local bridge connection saved.");
            }}
          >
            <label>
              Local bridge endpoint
              <input
                required
                type="url"
                value={bridge.endpoint}
                onChange={(e) => setBridge({ ...bridge, endpoint: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              Local bridge token
              <input
                required
                type="password"
                autoComplete="off"
                minLength={32}
                value={bridge.token}
                onChange={(e) => setBridge({ ...bridge, token: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bridge.enabled}
                onChange={(e) => setBridge({ ...bridge, enabled: e.target.checked })}
              />
              Enable installed bridge
            </label>
            <Btn type="submit">
              <Save className="h-4 w-4" />
              Save local connection
            </Btn>
          </form>
        )}
      </div>
    </Panel>
  );
}
