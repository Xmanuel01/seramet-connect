const encoder = new TextEncoder();
const maxClockSkewSeconds = 60;

export type ScannerAuthHeaders = {
  timestamp: string;
  nonce: string;
  signature: string;
};

export async function signScannerRequest(input: {
  secret: string;
  method: string;
  pathname: string;
  body: string;
  timestamp?: string;
  nonce?: string;
}): Promise<ScannerAuthHeaders> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonce ?? crypto.randomUUID();
  const bodyDigest = await sha256(input.body);
  const canonical = [input.method.toUpperCase(), input.pathname, timestamp, nonce, bodyDigest].join(
    "\n",
  );
  return {
    timestamp,
    nonce,
    signature: await hmac(input.secret, canonical),
  };
}

export async function verifyScannerRequest(input: {
  secret?: string;
  method: string;
  pathname: string;
  body: string;
  timestamp?: string | null;
  nonce?: string | null;
  signature?: string | null;
  nowSeconds?: number;
}) {
  if (!input.secret || input.secret.length < 32) return false;
  if (!input.timestamp || !input.nonce || !input.signature) return false;
  if (!/^[a-zA-Z0-9-]{16,128}$/.test(input.nonce)) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > maxClockSkewSeconds) {
    return false;
  }
  const expected = await signScannerRequest({
    secret: input.secret,
    method: input.method,
    pathname: input.pathname,
    body: input.body,
    timestamp: input.timestamp,
    nonce: input.nonce,
  });
  return constantTimeEqual(expected.signature, input.signature);
}

export function scannerAuthRequestHeaders(auth: ScannerAuthHeaders) {
  return {
    "x-seramet-scanner-timestamp": auth.timestamp,
    "x-seramet-scanner-nonce": auth.nonce,
    "x-seramet-scanner-signature": auth.signature,
  };
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return hex(signature);
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function hex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
