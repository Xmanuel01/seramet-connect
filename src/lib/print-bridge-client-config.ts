export type InstalledPrintBridgeConfig = {
  enabled: boolean;
  endpoint: string;
  token: string;
};

export const printBridgeConfigStorageKey = "seramet.print-bridge.client.v1";

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
