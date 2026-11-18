import { useCallback, useEffect, useRef, useState } from "react";
import { discoverInstalledPrinters, type DiscoveredPrinter } from "@/lib/printer-discovery-client";
import {
  Plus,
  Save,
  Pencil,
  RefreshCw,
  Printer,
  Download,
  Link2,
  Monitor,
  Trash2,
} from "lucide-react";
import { useAppContext } from "@/lib/app-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getSerametAccessToken } from "@/lib/access-token";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import {
  bridgeIdForMachine,
  loadInstalledPrintBridgeConfig,
  latestPrintBridgeVersion,
  printBridgeDownloadUrl,
  printBridgeUpdateAvailable,
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
import { Btn, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import {
  bridgeStageLabel,
  connectionLabel,
  kitchenModeLabels,
  printerRoleHints,
  printerRoleLabels,
} from "@/lib/printer-labels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    cutter: "full",
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
  // Technical printer settings start folded away, unless a required one (the
  // print bridge ID) still needs filling in.
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  // The form renders below the printer table, often off-screen; bring it into view
  // whenever a Configure/Edit button opens it.
  const openForm = (next: PrinterConfiguration) => {
    setDraft(next);
    setMoreSettingsOpen(!next.bridgeId);
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
  const [deleting, setDeleting] = useState<SavedPrinter | null>(null);
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
            ? "Found these printers on this computer. Set one up, then print a test page to check it works."
            : "No printers are installed in Windows on this computer. Install the printer in Windows, then try again.",
        );
      } catch (error) {
        if (inventoryScopeRef.current === requestedScope && !signal?.aborted) {
          setInventory(null);
          setPairedElsewhere(
            (error as { code?: string } | null)?.code === "BRIDGE_PAIRED_ELSEWHERE",
          );
          setDiscoveryNotice(
            error instanceof Error ? error.message : "Couldn't look for printers on this computer.",
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
  const updateAvailable =
    thisPc !== "checking" &&
    (thisPc.state === "unpaired" || thisPc.state === "paired") &&
    printBridgeUpdateAvailable(thisPc.version);
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
      setNotice(
        "Couldn't read the print queue. Check that the Seramet Print Bridge is running on this computer.",
      );
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
    if (!response.ok) throw new Error("Couldn't load your printers");
    setPrinters((await response.json()).printers);
  }, [headers]);
  useEffect(() => {
    void refresh().catch(() => setNotice("Couldn't load your printers. Try refreshing the page."));
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
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(
          body?.message || "Couldn't save this printer. Check its details and try again.",
        );
      }
      await refreshConfiguration();
      await refresh();
      setOpen(false);
      setNotice("Printer saved. Print a test page to check it works.");
      window.dispatchEvent(
        new CustomEvent("seramet:hardware-profile-change", { detail: { branchId } }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save this printer.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (printer: SavedPrinter) => {
    setBusy(true);
    try {
      const response = await authenticatedFetch(
        `/api/seramet/printing/printers/${encodeURIComponent(printer.id)}`,
        { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(10000) },
      );
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Couldn't delete this printer.");
      setNotice(`${printer.name} was deleted.`);
      await refresh();
      // The printer is gone on the server; a failed settings refresh must not undo that message.
      await refreshConfiguration().catch(() => undefined);
      window.dispatchEvent(
        new CustomEvent("seramet:hardware-profile-change", { detail: { branchId } }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't delete this printer.");
    } finally {
      setDeleting(null);
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
      if (!response.ok) throw new Error("You don't have permission to set up this print bridge.");
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
      setNotice("Print bridge setup file downloaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't download the setup file.");
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
      setNotice(
        error instanceof Error
          ? error.message
          : "The test page may not have printed. Check the printer.",
      );
    } finally {
      setBusy(false);
    }
  };
  const roleOptionLabel = (role: (typeof roleOptions)[number]) => printerRoleLabels[role];
  const whereLabel = (printer: SavedPrinter) =>
    !printer.enabled
      ? "Turned off"
      : printer.bridgeId === thisPcBridgeId
        ? "On this computer"
        : "Not on this computer";
  return (
    <Panel className="mb-4">
      <PanelHead
        title="Your printers"
        sub="Add the printers for this branch and choose what each one prints."
        right={
          <div className="flex gap-2">
            <Btn
              onClick={() =>
                void refresh().catch(() => setNotice("Couldn't refresh your printers."))
              }
              title="Refresh printers"
            >
              <RefreshCw className="h-4 w-4" />
            </Btn>
            {mayManage && (
              <Btn onClick={() => openForm({ ...blank(branchId), bridgeId: thisPcBridgeId ?? "" })}>
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
                      ? "Checking whether this computer can print..."
                      : thisPc.state === "missing"
                        ? "To print from this computer, install the Seramet Print Bridge app."
                        : thisPc.state === "blocked"
                          ? "The Seramet Print Bridge on this computer is blocking this website. Reinstall it from the download below."
                          : thisPc.state === "unpaired"
                            ? `The Seramet Print Bridge is installed on ${thisPc.machineName}. Connect it to start printing.`
                            : !installedBridge.enabled ||
                                installedBridge.token.length < 32 ||
                                pairedElsewhere
                              ? `${thisPc.machineName} is connected to a different restaurant or branch. Reconnect it here.`
                              : detected
                                ? `${thisPc.machineName} is ready to print.`
                                : discovering
                                  ? `${thisPc.machineName} is connected. Looking for its printers...`
                                  : `${thisPc.machineName} is connected, but its printers couldn't be listed. See the message below.`}
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
                {updateAvailable && (
                  <a
                    href={printBridgeDownloadUrl}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
                  >
                    <Download className="h-4 w-4" />
                    Update to {latestPrintBridgeVersion}
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
                <li>Download the app and open SerametPrintBridge.exe on this computer.</li>
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
            {updateAvailable && (
              <p className="text-muted-foreground">
                A newer version of the print bridge is available. Download it and open it: it
                updates in place and stays connected. Then choose Check again.
              </p>
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
              {discovering ? "Looking for printers..." : "Find printers on this computer"}
            </Btn>
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
                </div>
                {(() => {
                  const existing = printers.find(
                    (saved) =>
                      saved.transport === "WINDOWS" && saved.osPrinterName === printer.name,
                  );
                  if (existing?.bridgeId === detected.bridgeId)
                    return <span className="text-muted-foreground">Already set up</span>;
                  return (
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        openForm(
                          existing
                            ? { ...existing, bridgeId: detected.bridgeId }
                            : {
                                ...blank(branchId),
                                name: printer.name,
                                osPrinterName: printer.name,
                                bridgeId: detected.bridgeId,
                              },
                        )
                      }
                    >
                      <Plus className="h-4 w-4" />
                      {existing ? "Use with this PC" : "Set up this printer"}
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
        {printers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No printers yet.{" "}
            {mayManage
              ? "Use Find printers on this computer, or Add printer for a network printer."
              : "Ask a manager to add one."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Your printers" className="w-full text-left text-sm">
              <thead>
                <tr>
                  <TH>Name</TH>
                  <TH>Connection</TH>
                  <TH>Paper</TH>
                  <TH>Prints</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </tr>
              </thead>
              <tbody>
                {printers.map((printer) => (
                  <tr key={printer.id} className="align-top">
                    <TD className="font-semibold">{printer.name}</TD>
                    <TD>{connectionLabel(printer.transport)}</TD>
                    <TD>{printer.paperWidth}</TD>
                    <TD>
                      {printer.roles
                        .map((role) =>
                          role in printerRoleLabels
                            ? printerRoleLabels[role as keyof typeof printerRoleLabels]
                            : role,
                        )
                        .join(", ") || "Nothing yet"}
                    </TD>
                    <TD>{whereLabel(printer)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-2">
                        {mayManage && (
                          <>
                            {(["RECEIPT", "BILL", "FOOD_KOT"] as const).map((kind) => (
                              <Btn
                                key={kind}
                                disabled={busy || !printer.enabled}
                                onClick={() => void testPrinter(printer, kind)}
                              >
                                <Printer className="h-4 w-4" />
                                {kind === "FOOD_KOT"
                                  ? "Test kitchen ticket"
                                  : `Test ${kind.toLowerCase()}`}
                              </Btn>
                            ))}
                            <Btn
                              disabled={busy}
                              onClick={() => openForm(printer)}
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
                            <Btn
                              disabled={busy}
                              onClick={() => setDeleting(printer)}
                              title="Delete printer"
                              aria-label={`Delete ${printer.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Btn>
                          </>
                        )}
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mayManage && open && (
          <form
            ref={formRef}
            onSubmit={(event) => {
              event.preventDefault();
              void save(draft);
            }}
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
          >
            <h3 className="text-sm font-bold sm:col-span-2">
              {draft.id ? `Edit ${draft.name || "printer"}` : "Add a printer"}
            </h3>
            <label>
              Name
              <input
                required
                value={draft.name}
                placeholder="For example: Front counter"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              How it connects
              <select
                className={inputClass}
                value={draft.transport}
                onChange={(e) =>
                  setDraft({ ...draft, transport: e.target.value as "WINDOWS" | "TCP" })
                }
              >
                <option value="WINDOWS">USB, or installed in Windows on a computer</option>
                <option value="TCP">Network (has its own IP address)</option>
              </select>
            </label>
            {draft.transport === "WINDOWS" ? (
              <div>
                <label>
                  Windows printer name
                  <input
                    required
                    value={draft.osPrinterName ?? ""}
                    onChange={(e) => setDraft({ ...draft, osPrinterName: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Exactly as it appears in Windows Printers &amp; scanners.
                </p>
              </div>
            ) : (
              <>
                <label>
                  Printer IP address
                  <input
                    required
                    value={draft.host ?? ""}
                    placeholder="For example: 192.168.1.50"
                    onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <div>
                  <label>
                    Port
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    Usually 9100. Leave it unless your printer's manual says otherwise.
                  </p>
                </div>
              </>
            )}
            <label>
              Paper width
              <select
                value={draft.paperWidth}
                onChange={(e) =>
                  setDraft({ ...draft, paperWidth: e.target.value as "58mm" | "80mm" })
                }
                className={inputClass}
              >
                <option value="58mm">58mm (narrow)</option>
                <option value="80mm">80mm (standard)</option>
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
                <option value="full">Full cut</option>
                <option value="partial">Partial cut (leaves a small tab)</option>
                <option value="none">No cutter (tear by hand)</option>
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
            <fieldset className="sm:col-span-2">
              <legend>What does this printer print?</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {roleOptions.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2"
                    title={printerRoleHints[role]}
                  >
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
                    {roleOptionLabel(role)}
                  </label>
                ))}
              </div>
            </fieldset>
            {stations.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend>Which kitchen or bar stations?</legend>
                <p className="text-xs text-muted-foreground">
                  Tick a station to send its tickets to this printer.
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
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
            )}
            <div className="sm:col-span-2">
              <label>
                This branch sends kitchen orders to
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
                  {(
                    Object.entries(kitchenModeLabels) as [
                      PrinterConfiguration["kitchenMode"],
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Applies to the whole branch, not just this printer.
              </p>
            </div>
            <details
              className="rounded-md border border-border p-3 sm:col-span-2"
              open={moreSettingsOpen}
              onToggle={(event) => setMoreSettingsOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer font-semibold">More printer settings</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label>
                    Print bridge ID
                    <input
                      required
                      minLength={8}
                      value={draft.bridgeId}
                      onChange={(e) => setDraft({ ...draft, bridgeId: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The computer that sends jobs to this printer. Filled in for you when you set up
                    a printer found on this computer.
                  </p>
                </div>
                <div>
                  <label>
                    Backup printer
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used if this printer can't be reached.
                  </p>
                </div>
                <label>
                  Print style
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
                    <option value="TEXT_ESC_POS">Text (works on most printers)</option>
                    <option value="RASTER_ESC_POS" disabled={draft.transport !== "TCP"}>
                      Image (network printers only)
                    </option>
                  </select>
                </label>
                {draft.renderingMode !== "RASTER_ESC_POS" && (
                  <label>
                    Table lines
                    <select
                      className={inputClass}
                      value={draft.ruleStyle ?? "SOLID"}
                      onChange={(event) =>
                        setDraft({ ...draft, ruleStyle: event.target.value as "SOLID" | "ASCII" })
                      }
                    >
                      <option value="SOLID">Solid lines</option>
                      <option value="ASCII">
                        Plain characters (+ - |), if lines print as symbols
                      </option>
                    </select>
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.emphasis}
                    onChange={(e) => setDraft({ ...draft, emphasis: e.target.checked })}
                  />
                  Bold heading
                </label>
                {draft.renderingMode === "RASTER_ESC_POS" && draft.raster && (
                  <details className="sm:col-span-2">
                    <summary className="cursor-pointer">
                      Image print settings (for technicians)
                    </summary>
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
                              raster: {
                                ...draft.raster!,
                                dpi: Number(e.target.value) as 203 | 300,
                              },
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
              </div>
            </details>
            <div className="flex gap-2 sm:col-span-2">
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
              Troubleshooting (for technicians)
            </summary>
            <div className="mt-3 space-y-4">
              <section className="space-y-2">
                <h3 className="font-semibold">Print queue on this computer</h3>
                <Btn disabled={!bridge.enabled || busy} onClick={() => void inspectQueue()}>
                  <RefreshCw className="h-4 w-4" />
                  Check print queue
                </Btn>
                {attempts.length > 0 && (
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          <th>Updated</th>
                          <th>Status</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((attempt) => (
                          <tr key={attempt.id} title={`Job ${attempt.id}`}>
                            <td className="py-2">
                              {Number.isNaN(Date.parse(attempt.updated_at))
                                ? attempt.updated_at
                                : new Date(attempt.updated_at).toLocaleString()}
                            </td>
                            <td>{bridgeStageLabel(attempt.stage)}</td>
                            <td className="text-muted-foreground">{attempt.outcome}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              {printers.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-semibold">Extra tests and setup files</h3>
                  {printers.map((printer) => (
                    <div
                      key={printer.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                    >
                      <span>{printer.name}</span>
                      <div className="flex flex-wrap gap-2">
                        <Btn
                          disabled={busy || !printer.enabled}
                          onClick={() => void testPrinter(printer, "BILL", "TEXT_ESC_POS")}
                        >
                          <Printer className="h-4 w-4" />
                          Test text print
                        </Btn>
                        {printer.transport === "TCP" && printer.raster && (
                          <Btn
                            disabled={busy || !printer.enabled}
                            onClick={() => void testPrinter(printer, "BILL", "RASTER_ESC_POS")}
                          >
                            <Printer className="h-4 w-4" />
                            Test image print
                          </Btn>
                        )}
                        <Btn
                          disabled={busy || !printer.enabled}
                          onClick={() => void enroll(printer)}
                          title="Download a setup file for a print bridge installed by hand"
                        >
                          <Download className="h-4 w-4" />
                          Bridge setup file
                        </Btn>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <section className="space-y-2">
                <h3 className="font-semibold">Connect the print bridge by hand</h3>
                <p className="text-muted-foreground">
                  Only needed if Connect this PC doesn't work.
                </p>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveInstalledPrintBridgeConfig(bridge);
                    setNotice("Print bridge connection saved.");
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
              </section>
            </div>
          </details>
        )}
      </div>
      <Dialog open={!!deleting} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              It stops receiving bills, receipts and kitchen tickets and is removed from this list.
              Past print history is kept. To use it again, add it as a new printer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Btn disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Btn>
            <Btn
              variant="danger"
              disabled={busy || !deleting}
              onClick={() => deleting && void remove(deleting)}
            >
              <Trash2 className="h-4 w-4" />
              {busy ? "Deleting..." : "Delete printer"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
