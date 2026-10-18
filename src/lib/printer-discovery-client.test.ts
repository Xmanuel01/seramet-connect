import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverInstalledPrinters } from "./printer-discovery-client";
const config = { enabled: true, endpoint: "http://127.0.0.1:48777", token: "x".repeat(32) };
afterEach(() => vi.unstubAllGlobals());
describe("scoped local printer inventory", () => {
  it("requires a protected loopback connection before sending the bearer token", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    for (const endpoint of [
      "https://example.test",
      "http://127.0.0.1/other",
      "http://user:pass@localhost",
      "http://localhost?x=1",
    ])
      await expect(discoverInstalledPrinters({ ...config, endpoint }, "t", "b")).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts installed names without claiming physical connectivity", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        tenantId: "t",
        branchId: "b",
        bridgeId: "bridge",
        printers: [{ name: "Thermal A", driver: "Windows", physicalStatus: "UNKNOWN" }],
      }),
    );
    vi.stubGlobal("fetch", request);
    expect((await discoverInstalledPrinters(config, "t", "b")).printers[0]!.name).toBe("Thermal A");
    expect(request.mock.calls[0]![1]).toMatchObject({ credentials: "omit", redirect: "error" });
  });
  it("rejects another branch and malformed or unavailable discovery", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    request.mockResolvedValueOnce(
      Response.json({ tenantId: "t", branchId: "other", bridgeId: "bridge", printers: [] }),
    );
    await expect(discoverInstalledPrinters(config, "t", "b")).rejects.toThrow(/not enrolled/);
    request.mockResolvedValueOnce(
      Response.json({
        tenantId: "t",
        branchId: "b",
        bridgeId: "bridge",
        printers: [{ name: "bad\nprinter", driver: "x" }],
      }),
    );
    await expect(discoverInstalledPrinters(config, "t", "b")).rejects.toThrow(/invalid/);
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(discoverInstalledPrinters(config, "t", "b")).rejects.toThrow(
      /could not be detected/,
    );
  });
});
