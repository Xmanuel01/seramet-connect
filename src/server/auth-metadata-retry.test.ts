import { afterEach, describe, expect, it, vi } from "vitest";
import { retryAuthMetadata } from "./auth-metadata-retry";
import { DatabaseSerializationError, ServerOperationError, publicError } from "./errors";

afterEach(() => vi.useRealTimers());

describe("authentication metadata contention", () => {
  it("retries rolled-back serialization conflicts and returns the committed result", async () => {
    vi.useFakeTimers();
    const write = vi
      .fn()
      .mockRejectedValueOnce(new DatabaseSerializationError())
      .mockResolvedValue("committed");
    const result = retryAuthMetadata(write);
    const assertion = expect(result).resolves.toBe("committed");
    await vi.runAllTimersAsync();
    await assertion;
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("stops after five attempts and exposes the failure", async () => {
    vi.useFakeTimers();
    const error = new DatabaseSerializationError();
    const write = vi.fn().mockRejectedValue(error);
    const assertion = expect(retryAuthMetadata(write)).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;
    expect(write).toHaveBeenCalledTimes(5);
  });

  it.each([
    new ServerOperationError("CONFLICT", 409, "Business conflict"),
    new ServerOperationError("SESSION_REVOKED", 401, "Revoked"),
    new Error("Connection lost; commit outcome unknown"),
  ])("does not retry other failures: %s", async (error) => {
    const write = vi.fn().mockRejectedValue(error);
    await expect(retryAuthMetadata(write)).rejects.toBe(error);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("preserves the public transaction conflict response", () => {
    expect(publicError(new DatabaseSerializationError(), "test")).toEqual({
      status: 409,
      body: {
        ok: false,
        code: "CONFLICT",
        message: "The data changed during this operation. Reload and retry.",
        correlationId: "test",
      },
    });
  });
});
