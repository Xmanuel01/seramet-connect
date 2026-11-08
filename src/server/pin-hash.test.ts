import { afterEach, describe, expect, it, vi } from "vitest";
import { derivePin, verifyPin } from "@/server/pos-auth-service";

// Cloudflare Workers throws "iteration counts above 100000 are not supported" in production,
// although local workerd and Node accept more, so the limit is checked here directly.
const WORKERS_PBKDF2_LIMIT = 100_000;

afterEach(() => vi.restoreAllMocks());

describe("PIN hashing on Workers", () => {
  it("never asks PBKDF2 for more rounds than a Worker allows", async () => {
    const deriveBits = vi.spyOn(crypto.subtle, "deriveBits");
    const credential = await derivePin("602947");
    const rounds = deriveBits.mock.calls.map(([params]) => (params as Pbkdf2Params).iterations);
    expect(rounds.length).toBeGreaterThan(1);
    expect(Math.max(...rounds)).toBeLessThanOrEqual(WORKERS_PBKDF2_LIMIT);
    expect(rounds.reduce((sum, value) => sum + value, 0)).toBe(credential.iterations);
    // The table requires at least 310,000 rounds in total.
    expect(credential.iterations).toBeGreaterThanOrEqual(310_000);
    expect(credential.algorithmVersion).toBe(2);
  });

  it("verifies the right PIN and rejects a wrong one", async () => {
    const credential = await derivePin("602947");
    const stored = {
      algorithm: "PBKDF2-SHA256",
      algorithm_version: credential.algorithmVersion,
      iterations: credential.iterations,
      salt_base64: credential.salt,
      hash_base64: credential.hash,
    };
    expect(await verifyPin("602947", stored)).toBe(true);
    expect(await verifyPin("602948", stored)).toBe(false);
    expect(await verifyPin("602947", { ...stored, algorithm_version: 9 })).toBe(false);
  });
});
