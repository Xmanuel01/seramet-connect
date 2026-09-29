import type { AuthStatus } from "@/lib/auth-client";

export type RegistrationSessionPhase =
  "INITIAL" | "VERIFICATION_PENDING" | "VERIFICATION_CONFIRMED";

export type RegistrationSessionDestination =
  | { kind: "ACCOUNT" }
  | { kind: "VERIFY" }
  | { kind: "SIGN_IN" }
  | { kind: "RESTAURANT" }
  | { kind: "ENTER_RESTAURANT"; tenantId: string }
  | { kind: "CHOOSE_RESTAURANT" };

/** The server session, not a confirmed email or browser storage, establishes authentication. */
export function registrationSessionDestination(
  status: Pick<AuthStatus, "authenticated" | "restaurants">,
  phase: RegistrationSessionPhase = "INITIAL",
): RegistrationSessionDestination {
  if (!status.authenticated) {
    if (phase === "VERIFICATION_PENDING") return { kind: "VERIFY" };
    if (phase === "VERIFICATION_CONFIRMED") return { kind: "SIGN_IN" };
    return { kind: "ACCOUNT" };
  }
  if (status.restaurants.length === 0) return { kind: "RESTAURANT" };
  if (status.restaurants.length === 1) {
    return { kind: "ENTER_RESTAURANT", tenantId: status.restaurants[0]!.tenantId };
  }
  return { kind: "CHOOSE_RESTAURANT" };
}
