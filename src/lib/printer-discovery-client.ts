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
    throw new Error("Save and enable this device's enrolled local bridge connection first.");
  const response = await fetch(new URL("/printers", endpoint), {
    headers: { Authorization: `Bearer ${config.token}` },
    credentials: "omit",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(7000)])
      : AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "Installed printers could not be detected. Check the local bridge and Windows printer setup.",
    );
  const body = await response.json();
  if (
    body.tenantId !== tenantId ||
    body.branchId !== branchId ||
    typeof body.bridgeId !== "string" ||
    !body.bridgeId
  )
    throw new Error("This bridge is not enrolled for the selected restaurant and branch.");
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
    throw new Error("The bridge returned an invalid printer inventory.");
  return {
    bridgeId: body.bridgeId as string,
    printers: body.printers.map((printer: DiscoveredPrinter) => ({
      name: printer.name,
      driver: printer.driver,
      physicalStatus: "UNKNOWN" as const,
    })),
  };
}
