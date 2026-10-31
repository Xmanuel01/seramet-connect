export type InstalledPrintBridgeConfig = {
  enabled: boolean;
  endpoint: string;
  token: string;
};

export const printBridgeConfigStorageKey = "seramet.print-bridge.client.v1";

export const printBridgeDownloadUrl =
  "https://github.com/Xmanuel01/seramet-connect/releases/download/print-bridge-v3.1.0/SerametPrintBridge.exe";

// The machine identity "Connect this PC" generates, e.g. "front-desk-3f2a9c".
export const pairableBridgeId = /^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$/;

export function bridgeIdForMachine(
  machineName: string,
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(3)),
) {
  const name =
    machineName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "pc";
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${name}-${suffix}`;
}

export const defaultInstalledPrintBridgeConfig: InstalledPrintBridgeConfig = {
  enabled: false,
  endpoint: "http://127.0.0.1:48777",
  token: "",
};

export function loadInstalledPrintBridgeConfig(): InstalledPrintBridgeConfig {
  if (typeof window === "undefined") return defaultInstalledPrintBridgeConfig;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(printBridgeConfigStorageKey) ?? "null",
    ) as Partial<InstalledPrintBridgeConfig> | null;
    return {
      enabled: parsed?.enabled === true,
      endpoint:
        typeof parsed?.endpoint === "string" && parsed.endpoint.trim()
          ? parsed.endpoint.trim().replace(/\/+$/, "")
          : defaultInstalledPrintBridgeConfig.endpoint,
      token: typeof parsed?.token === "string" ? parsed.token : "",
    };
  } catch {
    return defaultInstalledPrintBridgeConfig;
  }
}

export function saveInstalledPrintBridgeConfig(config: InstalledPrintBridgeConfig) {
  if (typeof window === "undefined") return;
  const url = new URL(config.endpoint);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("An HTTP loopback bridge endpoint is required");
  }
  const next: InstalledPrintBridgeConfig = {
    enabled: config.enabled,
    endpoint:
      config.endpoint.trim().replace(/\/+$/, "") || defaultInstalledPrintBridgeConfig.endpoint,
    token: config.token.trim(),
  };
  window.localStorage.setItem(printBridgeConfigStorageKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("seramet:print-bridge-config-change", { detail: next }));
}

export function bridgeConfigReady(config: InstalledPrintBridgeConfig) {
  return config.enabled && /^https?:\/\//i.test(config.endpoint) && config.token.length >= 16;
}
