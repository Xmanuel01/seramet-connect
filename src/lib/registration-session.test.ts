import { describe, expect, it } from "vitest";
import { registrationSessionDestination } from "@/lib/registration-session";

describe("registration session routing", () => {
  it("shows account creation only for an unauthenticated session", () => {
    expect(registrationSessionDestination({ authenticated: false, restaurants: [] })).toEqual({
      kind: "ACCOUNT",
    });
  });

  it("shows restaurant creation for a verified session with no linked restaurants", () => {
    expect(registrationSessionDestination({ authenticated: true, restaurants: [] })).toEqual({
      kind: "RESTAURANT",
    });
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
