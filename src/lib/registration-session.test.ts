import { describe, expect, it } from "vitest";
import { registrationSessionDestination } from "@/lib/registration-session";

describe("registration session routing", () => {
  it("shows account creation only on initial unauthenticated entry", () => {
    expect(registrationSessionDestination({ authenticated: false, restaurants: [] })).toEqual({
      kind: "ACCOUNT",
    });
  });

  it("preserves the verification screen when a returning tab has no session", () => {
    expect(
      registrationSessionDestination(
        { authenticated: false, restaurants: [] },
        "VERIFICATION_PENDING",
      ),
    ).toEqual({ kind: "VERIFY" });
  });

  it("routes an email-verified user without a session to sign in, not signup", () => {
    expect(
      registrationSessionDestination(
        { authenticated: false, restaurants: [] },
        "VERIFICATION_CONFIRMED",
      ),
    ).toEqual({ kind: "SIGN_IN" });
  });

  it("shows restaurant creation for a verified session with no linked restaurants", () => {
    expect(registrationSessionDestination({ authenticated: true, restaurants: [] })).toEqual({
      kind: "RESTAURANT",
    });
    expect(
      registrationSessionDestination(
        { authenticated: true, restaurants: [] },
        "VERIFICATION_CONFIRMED",
      ),
    ).toEqual({ kind: "RESTAURANT" });
  });

  it("enters the only linked restaurant", () => {
    expect(
      registrationSessionDestination({
        authenticated: true,
        restaurants: [{ tenantId: "tenant-one", slug: "one", name: "One" }],
      }),
    ).toEqual({ kind: "ENTER_RESTAURANT", tenantId: "tenant-one" });
  });

  it("offers restaurant selection for multiple linked restaurants", () => {
    expect(
      registrationSessionDestination({
        authenticated: true,
        restaurants: [
          { tenantId: "one", slug: "one", name: "One" },
          { tenantId: "two", slug: "two", name: "Two" },
        ],
      }),
    ).toEqual({ kind: "CHOOSE_RESTAURANT" });
  });

  it("does not infer authentication from stale restaurant metadata", () => {
    expect(
      registrationSessionDestination({
        authenticated: false,
        restaurants: [{ tenantId: "stale", slug: "stale", name: "Stale" }],
      }),
    ).toEqual({ kind: "ACCOUNT" });
  });
});
