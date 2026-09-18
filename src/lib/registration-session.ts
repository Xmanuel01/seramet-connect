import type { AuthStatus } from "@/lib/auth-client";

export type RegistrationSessionDestination =
  | { kind: "ACCOUNT" }
  | { kind: "RESTAURANT" }
  | { kind: "ENTER_RESTAURANT"; tenantId: string }
  | { kind: "CHOOSE_RESTAURANT" };

/** Auth is established by the server, not the existence of an Auth user or local storage. */
export function registrationSessionDestination(
  status: Pick<AuthStatus, "authenticated" | "restaurants">,
): RegistrationSessionDestination {
  if (!status.authenticated) return { kind: "ACCOUNT" };
  if (status.restaurants.length === 0) return { kind: "RESTAURANT" };
  if (status.restaurants.length === 1) {
    return { kind: "ENTER_RESTAURANT", tenantId: status.restaurants[0]!.tenantId };
  }
  return { kind: "CHOOSE_RESTAURANT" };
}
