import type { InstalledPrintBridgeConfig } from "@/lib/print-bridge-client-config";

export type DiscoveredPrinter = { name: string; driver: string; physicalStatus: "UNKNOWN" };
export async function discoverInstalledPrinters(
  config: InstalledPrintBridgeConfig,
  tenantId: string,
  branchId: string,
  signal?: AbortSignal,
) {
  const endpoint = new URL(config.endpoint);
  if (
    !config.enabled ||
    config.token.length < 32 ||
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Connect this computer first: choose Connect this PC.");
  const response = await fetch(new URL("/printers", endpoint), {
    headers: { Authorization: `Bearer ${config.token}` },
    credentials: "omit",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
    cache: "no-store",
  });
  if (response.status === 401)
    throw Object.assign(
      new Error(
        "This computer is connected to another browser or restaurant. Choose Reconnect this PC.",
      ),
      { code: "BRIDGE_PAIRED_ELSEWHERE" },
    );
  if (!response.ok)
    throw new Error(
      "Couldn't list the printers on this computer. Check that the Seramet Print Bridge is running, then try again.",
    );
  const body = await response.json();
  if (
    body.tenantId !== tenantId ||
    body.branchId !== branchId ||
    typeof body.bridgeId !== "string" ||
    !body.bridgeId
  )
    throw Object.assign(
      new Error(
        "This computer is set up for a different restaurant or branch. Choose Reconnect this PC.",
      ),
      { code: "BRIDGE_PAIRED_ELSEWHERE" },
    );
  if (
    !Array.isArray(body.printers) ||
    body.printers.length > 256 ||
    body.printers.some(
      (printer: DiscoveredPrinter) =>
        !printer ||
        typeof printer.name !== "string" ||
        !printer.name.trim() ||
        printer.name.length > 512 ||
        [...printer.name].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        typeof printer.driver !== "string" ||
        printer.driver.length > 512,
    )
  )
    throw new Error(
      "The print bridge sent an unexpected printer list. Update the print bridge, then try again.",
    );
  return {
    bridgeId: body.bridgeId as string,
    printers: body.printers.map((printer: DiscoveredPrinter) => ({
      name: printer.name,
      driver: printer.driver,
      physicalStatus: "UNKNOWN" as const,
    })),
  };
}
