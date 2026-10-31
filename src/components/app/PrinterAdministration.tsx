import { useCallback, useEffect, useRef, useState } from "react";
import { discoverInstalledPrinters, type DiscoveredPrinter } from "@/lib/printer-discovery-client";
import { Plus, Save, Pencil, RefreshCw, Printer, Download, Link2, Monitor } from "lucide-react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import {
  bridgeIdForMachine,
  loadInstalledPrintBridgeConfig,
  printBridgeDownloadUrl,
  saveInstalledPrintBridgeConfig,
} from "@/lib/print-bridge-client-config";
import {
  pairLocalBridge,
  probeLocalBridge,
  randomBridgeToken,
  readPendingBridgeToken,
  writePendingBridgeToken,
  type BridgeEnrollment,
  type LocalBridgeProbe,
} from "@/lib/print-bridge-pairing";
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
    kitchenMode: "PRINTER_ONLY",
  };
}

export function PrinterAdministration() {
  const { activeTenantId, branchId, hasPermission, refreshConfiguration } = useAppContext();
  const mayManage = hasPermission(permissions.settingsHardwareManage);
  const [printers, setPrinters] = useState<SavedPrinter[]>([]);
  const [draft, setDraft] = useState(() => blank(branchId));
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [formRequest, setFormRequest] = useState(0);
  // The form renders below the printer table, often off-screen; bring it into view
  // whenever a Configure/Edit button opens it.
  const openForm = () => {
    setOpen(true);
    setFormRequest((count) => count + 1);
  };
  useEffect(() => {
    if (!formRequest) return;
    const form = formRef.current;
    form?.scrollIntoView({ behavior: "smooth", block: "start" });
    form?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [formRequest]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bridge, setBridge] = useState(loadInstalledPrintBridgeConfig);
  const [installedBridge, setInstalledBridge] = useState(loadInstalledPrintBridgeConfig);
  useEffect(() => {
    const changed = () => setInstalledBridge(loadInstalledPrintBridgeConfig());
    window.addEventListener("seramet:print-bridge-config-change", changed);
    return () => window.removeEventListener("seramet:print-bridge-config-change", changed);
  }, []);
  const [inventory, setInventory] = useState<{
    scope: string;
    bridgeId: string;
    printers: DiscoveredPrinter[];
  } | null>(null);
  const [discoveryNotice, setDiscoveryNotice] = useState("");
  const [pairedElsewhere, setPairedElsewhere] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const inventoryScope = `${activeTenantId}:${branchId}:${installedBridge.endpoint}:${installedBridge.token}:${installedBridge.enabled}`;
  const inventoryScopeRef = useRef(inventoryScope);
  inventoryScopeRef.current = inventoryScope;
  const discover = useCallback(
    async (signal?: AbortSignal) => {
      const requestedScope = inventoryScope;
      if (!mayManage) return;
      setDiscovering(true);
      setDiscoveryNotice("");
      setPairedElsewhere(false);
      try {
        const result = await discoverInstalledPrinters(
          installedBridge,
          activeTenantId,
          branchId,
          signal,
        );
        if (inventoryScopeRef.current !== requestedScope || signal?.aborted) return;
        setInventory({ ...result, scope: requestedScope });
        setDiscoveryNotice(
          result.printers.length
            ? "Installed Windows printers detected. Physical availability has not been verified."
            : "Windows has no installed printers for the bridge's user account.",
        );
      } catch (error) {
        if (inventoryScopeRef.current === requestedScope && !signal?.aborted) {
          setInventory(null);
          setPairedElsewhere(
            (error as { code?: string } | null)?.code === "BRIDGE_PAIRED_ELSEWHERE",
          );
          setDiscoveryNotice(
            error instanceof Error ? error.message : "Printer discovery unavailable.",
          );
        }
      } finally {
        if (inventoryScopeRef.current === requestedScope && !signal?.aborted) setDiscovering(false);
      }
    },
    [activeTenantId, branchId, installedBridge, inventoryScope, mayManage],
  );
  useEffect(() => {
    if (!mayManage || !installedBridge.enabled || installedBridge.token.length < 32) {
      setDiscovering(false);
      return;
    }
    const controller = new AbortController();
    void discover(controller.signal);
    return () => controller.abort();
  }, [discover, mayManage, installedBridge.enabled, installedBridge.token]);
  const detected = inventory?.scope === inventoryScope ? inventory : null;
  const [thisPc, setThisPc] = useState<LocalBridgeProbe | "checking">("checking");
  const checkThisPc = useCallback(async (signal?: AbortSignal) => {
    setThisPc("checking");
    const probe = await probeLocalBridge(loadInstalledPrintBridgeConfig().endpoint, signal);
    if (!signal?.aborted) setThisPc(probe);
  }, []);
  useEffect(() => {
    if (!mayManage) return;
    const controller = new AbortController();
    void checkThisPc(controller.signal);
    return () => controller.abort();
  }, [checkThisPc, mayManage]);
  const thisPcBridgeId =
    thisPc !== "checking" && thisPc.state === "paired" ? thisPc.bridgeId : null;
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
  const save = async (printer: PrinterConfiguration, updateBranchMode = true) => {
    setBusy(true);
    try {
      const response = await authenticatedFetch("/api/seramet/printing/printers", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...printer, branchId, updateBranchMode }),
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
  const enroll = async (printer: SavedPrinter) => {
    setBusy(true);
    try {
      const response = await authenticatedFetch("/api/seramet/printing/enrollment", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ bridgeId: printer.bridgeId }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Bridge enrollment was not authorized");
      const enrollment = await response.json();
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const blob = new Blob(
        [
          JSON.stringify(
            {
              ...enrollment,
              token,
              host: "127.0.0.1",
              port: 48777,
              concurrency: 2,
              allowedOrigins: [window.location.origin],
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "config.local.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const local = { enabled: false, endpoint: "http://127.0.0.1:48777", token };
      setBridge(local);
      saveInstalledPrintBridgeConfig(local);
      setNotice("Scoped bridge enrollment downloaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Enrollment failed");
    } finally {
      setBusy(false);
    }
  };
  const requestEnrollment = async (bridgeId: string) => {
    const response = await authenticatedFetch("/api/seramet/printing/enrollment", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ bridgeId }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return (await response.json()) as BridgeEnrollment;
    // 403 can mean this bridge id is not allowed, so the caller may retry with a new one.
    if (response.status === 403) return null;
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || `Could not connect this PC (error ${response.status}).`);
  };
  const connectThisPc = async () => {
    setBusy(true);
    setNotice("");
    try {
      const endpoint = installedBridge.endpoint;
      const probe = await probeLocalBridge(endpoint);
      setThisPc(probe);
      if (probe.state === "missing" || probe.state === "blocked")
        throw new Error("Install and open the Seramet Print Bridge on this computer first.");
      // Keep an existing identity so printers already routed to this PC keep working.
      let enrollment = probe.state === "paired" ? await requestEnrollment(probe.bridgeId) : null;
      enrollment ??= await requestEnrollment(bridgeIdForMachine(probe.machineName));
      if (!enrollment) throw new Error("You do not have permission to connect printers here.");
      const token = randomBridgeToken();
      // The saved token, then the one a previous attempt may have committed before its
      // response was lost.
      const candidates = [
        ...new Set([installedBridge.token, readPendingBridgeToken()].filter((t) => t.length >= 32)),
      ];
      writePendingBridgeToken(token);
      for (let index = 0; ; index += 1) {
        try {
          await pairLocalBridge({ endpoint, enrollment, token, currentToken: candidates[index] });
          break;
        } catch (error) {
          const alreadyPaired = (error as { code?: string }).code === "ALREADY_PAIRED";
          if (!alreadyPaired || index + 1 >= candidates.length) throw error;
        }
      }
      const local = { enabled: true, endpoint, token };
      saveInstalledPrintBridgeConfig(local);
      writePendingBridgeToken(null);
      setBridge(local);
      await checkThisPc();
      setNotice("This computer is connected. Choose its printer below, then run a test receipt.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This computer could not be connected.");
    } finally {
      setBusy(false);
    }
  };
  const testPrinter = async (
    printer: SavedPrinter,
    documentType: "BILL" | "RECEIPT" | "FOOD_KOT",
    renderingMode?: "TEXT_ESC_POS" | "RASTER_ESC_POS",
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
        ...(renderingMode ? { diagnosticRenderingMode: renderingMode } : {}),
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
                  openForm();
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
        {mayManage && (
          <section
            aria-label="This computer"
            className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Monitor className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 break-words">
                  <strong>This computer</strong>
                  <p className="text-muted-foreground">
                    {thisPc === "checking"
                      ? "Looking for the Seramet Print Bridge..."
                      : thisPc.state === "missing"
                        ? "The Seramet Print Bridge is not installed or not running on this computer."
                        : thisPc.state === "blocked"
                          ? "This computer's print bridge does not accept this Seramet address."
                          : thisPc.state === "unpaired"
                            ? `Print bridge ${thisPc.version} is ready on ${thisPc.machineName}. Connect it to this restaurant.`
                            : !installedBridge.enabled ||
                                installedBridge.token.length < 32 ||
                                pairedElsewhere
                              ? `${thisPc.machineName} has a print bridge connected elsewhere. Reconnect it here.`
                              : detected
                                ? `Connected: ${thisPc.machineName} (${thisPc.bridgeId}).`
                                : discovering
                                  ? `Connected: ${thisPc.machineName}. Looking for its printers...`
                                  : `Connected: ${thisPc.machineName}, but its printers could not be listed. See the message below.`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {thisPc !== "checking" && thisPc.state === "missing" && (
                  <a
                    href={printBridgeDownloadUrl}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
                  >
                    <Download className="h-4 w-4" />
                    Download for Windows
                  </a>
                )}
                {thisPc !== "checking" &&
                  (thisPc.state === "unpaired" || thisPc.state === "paired") && (
                    <Btn disabled={busy} onClick={() => void connectThisPc()}>
                      <Link2 className="h-4 w-4" />
                      {thisPc.state === "unpaired" ? "Connect this PC" : "Reconnect this PC"}
                    </Btn>
                  )}
                <Btn disabled={thisPc === "checking"} onClick={() => void checkThisPc()}>
                  <RefreshCw className="h-4 w-4" />
                  Check again
                </Btn>
              </div>
            </div>
            {thisPc !== "checking" && thisPc.state === "missing" && (
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Download the bridge and open SerametPrintBridge.exe on this computer.</li>
                <li>
                  If Windows says &quot;Windows protected your PC&quot;, choose More info, then Run
                  anyway.
                </li>
                <li>
                  Come back here and choose Check again. If Chrome asks to access apps on this
                  device, choose Allow.
                </li>
              </ol>
            )}
          </section>
        )}
        {mayManage && (
          <div className="space-y-3 border-b border-border pb-4">
            <Btn
              disabled={
                discovering || !installedBridge.enabled || installedBridge.token.length < 32
              }
              onClick={() => void discover()}
            >
              <RefreshCw className="h-4 w-4" />
              {discovering ? "Detecting..." : "Detect installed printers"}
            </Btn>
            {!installedBridge.enabled && (
              <p className="text-sm text-muted-foreground">Local print bridge is not connected.</p>
            )}
            {discoveryNotice && (
              <p role="status" className="text-sm">
                {discoveryNotice}
              </p>
            )}
            {detected?.printers.map((printer) => (
              <div
                key={printer.name}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm"
              >
                <div className="min-w-0 break-words">
                  <strong>{printer.name}</strong>
                  <p className="text-xs text-muted-foreground">{printer.driver}</p>
                </div>
                {(() => {
                  const existing = printers.find(
                    (saved) =>
                      saved.transport === "WINDOWS" && saved.osPrinterName === printer.name,
                  );
                  if (existing?.bridgeId === detected.bridgeId)
                    return <span className="text-muted-foreground">Set up on this PC</span>;
                  return (
                    <Btn
                      disabled={busy}
                      onClick={() => {
                        setDraft(
                          existing
                            ? { ...existing, bridgeId: detected.bridgeId }
                            : {
                                ...blank(branchId),
                                name: printer.name,
                                osPrinterName: printer.name,
                                bridgeId: detected.bridgeId,
                              },
                        );
                        openForm();
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      {existing ? "Use with this PC" : "Configure printer"}
                    </Btn>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
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
                  <td>
                    {!printer.enabled
                      ? "Disabled"
                      : printer.bridgeId === thisPcBridgeId
                        ? "On this PC"
                        : "Unknown"}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {mayManage && (
                        <>
                          <Btn
                            disabled={busy || !printer.enabled}
                            onClick={() => void enroll(printer)}
                            title="Download scoped bridge enrollment"
                          >
                            <Download className="h-4 w-4" />
                          </Btn>
                          <Btn
                            disabled={busy}
                            onClick={() => {
                              setDraft(printer);
                              openForm();
                            }}
                            title="Edit printer"
                          >
                            <Pencil className="h-4 w-4" />
                          </Btn>
                          <Btn
                            disabled={busy}
                            onClick={() =>
                              void save({ ...printer, enabled: !printer.enabled }, false)
                            }
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
                          <Btn
                            disabled={busy || !printer.enabled}
                            onClick={() => void testPrinter(printer, "BILL", "TEXT_ESC_POS")}
                          >
                            <Printer className="h-4 w-4" />
                            Test text
                          </Btn>
                          {printer.transport === "TCP" && printer.raster && (
                            <Btn
                              disabled={busy || !printer.enabled}
                              onClick={() => void testPrinter(printer, "BILL", "RASTER_ESC_POS")}
                            >
                              <Printer className="h-4 w-4" />
                              Test raster
                            </Btn>
                          )}
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
            ref={formRef}
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
              Branch production delivery
              <select
                className={inputClass}
                value={draft.kitchenMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    kitchenMode: event.target.value as PrinterConfiguration["kitchenMode"],
                  })
                }
              >
                <option value="PRINTER_ONLY">Printer only</option>
                <option value="KDS_ONLY">KDS only</option>
                <option value="KDS_AND_PRINTER">KDS and printer</option>
                <option value="NO_DEDICATED_KITCHEN_SYSTEM">Assigned front printer</option>
              </select>
            </label>
            <label>
              Rendering mode
              <select
                className={inputClass}
                value={draft.renderingMode ?? "TEXT_ESC_POS"}
                onChange={(event) => {
                  const renderingMode = event.target.value as "TEXT_ESC_POS" | "RASTER_ESC_POS";
                  setDraft({
                    ...draft,
                    renderingMode,
                    ...(renderingMode === "RASTER_ESC_POS" && !draft.raster
                      ? {
                          emphasis: true,
                          raster: {
                            command: "GS_V_0",
                            printableWidthDots: draft.paperWidth === "58mm" ? 384 : 576,
                            dpi: 203,
                            maxBandHeight: 128,
                            maxHeightDots: 8192,
                            maxBytes: 524288,
                          },
                        }
                      : {}),
                  });
                }}
              >
                <option value="TEXT_ESC_POS">Text ESC/POS</option>
                <option value="RASTER_ESC_POS" disabled={draft.transport !== "TCP"}>
                  Raster ESC/POS (RAW TCP)
                </option>
              </select>
            </label>
            {draft.renderingMode === "RASTER_ESC_POS" && draft.raster && (
              <details className="sm:col-span-2">
                <summary>Raster capabilities</summary>
                <div className="grid gap-3 py-3 sm:grid-cols-2">
                  <label>
                    Raster command
                    <input readOnly className={inputClass} value="GS v 0" />
                  </label>
                  <label>
                    Resolution (DPI)
                    <select
                      className={inputClass}
                      value={draft.raster.dpi}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          raster: { ...draft.raster!, dpi: Number(e.target.value) as 203 | 300 },
                        })
                      }
                    >
                      <option value={203}>203</option>
                      <option value={300}>300</option>
                    </select>
                  </label>
                  {(
                    [
                      ["printableWidthDots", "Printable width (dots)", 256, 832, 8],
                      ["maxBandHeight", "Maximum band height (dots)", 16, 256, 1],
                      ["maxHeightDots", "Maximum document height (dots)", 256, 32768, 1],
                      ["maxBytes", "Maximum encoded bytes", 4096, 1048576, 1],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <label key={key}>
                      {label}
                      <input
                        className={inputClass}
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        required
                        value={draft.raster![key]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            raster: { ...draft.raster!, [key]: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
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
          <details className="border-t border-border pt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Advanced: manual bridge connection
            </summary>
            <form
              className="mt-3 grid gap-3 sm:grid-cols-2"
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
          </details>
        )}
      </div>
    </Panel>
  );
}
