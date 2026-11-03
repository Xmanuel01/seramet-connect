import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestError, UserFacingError, reportError, userMessage } from "./user-facing-error";

const fallback = "Couldn't record the payment. Try again.";

afterEach(() => vi.unstubAllGlobals());

describe("what people see when something fails", () => {
  it("shows messages written for them as they are", () => {
    expect(
      userMessage(new UserFacingError("This invoice has no payment receipt yet."), fallback),
    ).toBe("This invoice has no payment receipt yet.");
  });

  it("explains sessions, permissions and rate limits in plain words", () => {
    expect(userMessage(new RequestError(401, "JWT expired"), fallback)).toBe(
      "Your session ended. Sign in again.",
    );
    expect(userMessage(new RequestError(403, "Permission required: finance.view"), fallback)).toBe(
      "You don't have access to this. Ask an owner or manager.",
    );
    expect(userMessage(new RequestError(429, ""), fallback)).toMatch(/Wait a moment/);
  });

  it("passes on business-rule messages from the server", () => {
    expect(userMessage(new RequestError(422, "This invoice is already paid."), fallback)).toBe(
      "This invoice is already paid.",
    );
    // Errors thrown by the till carry httpStatus instead of being RequestErrors.
    const tillError = Object.assign(new Error("The amount is more than the balance due."), {
      httpStatus: 409,
    });
    expect(userMessage(tillError, fallback)).toBe("The amount is more than the balance due.");
  });

  it("never shows technical text", () => {
    for (const message of [
      "Transaction command failed with status 500",
      "SQLITE_CONSTRAINT: UNIQUE constraint failed: payments.id",
      "Authoritative inventory commands require the server database",
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "Idempotency key reused with a different payload",
      "Unexpected token < in JSON at position 0",
      "",
    ]) {
      expect(userMessage(new RequestError(422, message), fallback)).toBe(fallback);
      expect(userMessage(new Error(message), fallback)).toBe(fallback);
    }
    expect(userMessage(new RequestError(500, "Seramet API failure"), fallback)).toBe(fallback);
    expect(userMessage("a string", fallback)).toBe(fallback);
    expect(userMessage(undefined, fallback)).toBe(fallback);
  });

  it("uses a separately attached server message over the logged one", () => {
    const error = Object.assign(
      new Error("Procurement overview query failed (422): Period is closed."),
      {
        httpStatus: 422,
        serverMessage: "Period is closed.",
      },
    );
    expect(userMessage(error, fallback)).toBe("Period is closed.");
  });

  it("says when the device is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(userMessage(new TypeError("Failed to fetch"), fallback)).toBe(
      "You're offline. Reconnect, then try again.",
    );
    // The fetch helper tags some network failures as 503.
    expect(userMessage(Object.assign(new Error("x"), { httpStatus: 503 }), fallback)).toBe(
      "You're offline. Reconnect, then try again.",
    );
    // Signing in again or asking for access still comes first.
    expect(userMessage(new RequestError(401, ""), fallback)).toBe(
      "Your session ended. Sign in again.",
    );
  });

  it("logs technical detail but not cancelled requests or written messages", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportError(new Error("boom"), fallback);
    reportError(Object.assign(new Error("aborted"), { name: "AbortError" }), fallback);
    reportError(new UserFacingError("Already paid."), fallback);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
