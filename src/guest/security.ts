const tokenBytes = 32;

export function createCapabilityToken(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(tokenBytes));
  const encoded = toBase64Url(bytes);
  return `${prefix}_${encoded}`;
}

export async function hashCapabilityToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashGuestPayload(value: unknown) {
  return hashCapabilityToken(stableJson(value));
}

export async function deriveCapabilityToken(prefix: string, secret: string, subject: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${prefix}:${subject}`),
  );
  return `${prefix}_${toBase64Url(new Uint8Array(signature))}`;
}

export function sanitizeGuestText(value: string | undefined, maximum = 280) {
  if (!value) return undefined;
  const normalized = value
    .replace(/[<>]/g, "")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}

export function publicReference(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  if (typeof btoa === "function") {
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }
  return Buffer.from(bytes).toString("base64url");
}
