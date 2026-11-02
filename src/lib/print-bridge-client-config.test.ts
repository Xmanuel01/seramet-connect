import { describe, expect, it } from "vitest";
import {
  latestPrintBridgeVersion,
  printBridgeDownloadUrl,
  printBridgeUpdateAvailable,
} from "./print-bridge-client-config";
import { readFileSync } from "node:fs";

const BRIDGE_VERSION = /BRIDGE_VERSION = "([^"]+)"/.exec(
  readFileSync("local-print-bridge/server.mjs", "utf8"),
)![1];

describe("print bridge updates", () => {
  it("downloads the bridge version this repository builds", () => {
    expect(latestPrintBridgeVersion).toBe(BRIDGE_VERSION);
    expect(printBridgeDownloadUrl).toContain(`/print-bridge-v${BRIDGE_VERSION}/`);
  });

  it("offers an update only to older bridges", () => {
    const [major, minor, patch] = latestPrintBridgeVersion.split(".").map(Number);
    expect(printBridgeUpdateAvailable(`${major}.${minor - 1}.9`)).toBe(true);
    expect(printBridgeUpdateAvailable(`${major - 1}.99.99`)).toBe(true);
    expect(printBridgeUpdateAvailable(`${major}.${minor}.${patch}`)).toBe(false);
    expect(printBridgeUpdateAvailable(`${major}.${minor + 1}.0`)).toBe(false);
    expect(printBridgeUpdateAvailable("unknown")).toBe(false);
    expect(printBridgeUpdateAvailable(undefined)).toBe(false);
  });
});
