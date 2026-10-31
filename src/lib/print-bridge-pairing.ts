import { defaultInstalledPrintBridgeConfig } from "@/lib/print-bridge-client-config";

export type LocalBridgeProbe =
  | { state: "missing" }
  | { state: "blocked" }
  | { state: "unpaired"; machineName: string; version: string }
  | { state: "paired"; machineName: string; version: string; bridgeId: string };

export type BridgeEnrollment = {
  bridgeId: string;
  tenantId: string;
  branchId: string;
  signingKey: string;
  authorizationEndpoint: string;
};

const endpointUrl = (endpoint: string, path: string) =>
  new URL(path, `${endpoint.replace(/\/+$/, "")}/`);

export async function probeLocalBridge(
  endpoint = defaultInstalledPrintBridgeConfig.endpoint,
  signal?: AbortSignal,
): Promise<LocalBridgeProbe> {
  let response: Response;
  try {
    response = await fetch(endpointUrl(endpoint, "health"), {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
        : AbortSignal.timeout(3000),
    });
  } catch {
    return { state: "missing" };
  }
  if (response.status === 403) return { state: "blocked" };
  if (!response.ok) return { state: "missing" };
  const body = (await response.json().catch(() => null)) as {
    paired?: boolean;
    machineName?: string;
    version?: string;
    bridgeId?: string;
  } | null;
  const machineName = typeof body?.machineName === "string" ? body.machineName.slice(0, 64) : "";
  const version = typeof body?.version === "string" ? body.version.slice(0, 32) : "unknown";
  // Bridges before 3.1 cannot pair from the browser; treat them as needing the new installer.
  if (typeof body?.paired !== "boolean") return { state: "missing" };
  if (body.paired && typeof body.bridgeId === "string" && body.bridgeId)
    return { state: "paired", machineName, version, bridgeId: body.bridgeId };
  return { state: "unpaired", machineName, version };
}

export async function pairLocalBridge({
  endpoint = defaultInstalledPrintBridgeConfig.endpoint,
  enrollment,
  token,
  currentToken,
}: {
  endpoint?: string;
  enrollment: BridgeEnrollment;
  token: string;
  currentToken?: string;
}) {
  const response = await fetch(endpointUrl(endpoint, "pair"), {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    },
    body: JSON.stringify({ ...enrollment, token }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.ok) return;
  const code = ((await response.json().catch(() => null)) as { code?: string } | null)?.code;
  if (code === "JOBS_IN_PROGRESS")
    throw new Error(
      "This computer is still sending print jobs for another branch. Wait for them to finish, " +
        "then click Connect this PC again.",
    );
  if (code === "ALREADY_PAIRED")
    throw Object.assign(
      new Error(
        "This computer's print bridge is connected from another browser. To move it here, open " +
          "Windows Settings > Apps, uninstall Seramet Print Bridge, run the installer again, " +
          "then click Connect this PC.",
      ),
      { code },
    );
  throw new Error("The print bridge did not accept the connection.");
}

// The token a pairing attempt sends is kept until the attempt is confirmed, so a
// pairing whose response was lost can still be taken over by the next attempt.
const pendingTokenKey = "seramet.print-bridge.pending-token.v1";

export function readPendingBridgeToken() {
  try {
    return window.localStorage.getItem(pendingTokenKey) ?? "";
  } catch {
    return "";
  }
}

export function writePendingBridgeToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(pendingTokenKey, token);
    else window.localStorage.removeItem(pendingTokenKey);
  } catch {
    /* Without storage a lost pairing response needs a reinstall, as before. */
  }
}

export function randomBridgeToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
