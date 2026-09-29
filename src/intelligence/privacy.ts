const blockedKeyParts = [
  "secret",
  "password",
  "passkey",
  "token",
  "authorization",
  "cookie",
  "credential",
  "cvv",
  "pin",
  "fullpan",
  "trackdata",
  "bearer",
];

const phonePattern = /(?<!\d)(?:\+?254|0)7\d{8}(?!\d)/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const paymentReferencePattern = /\b[A-Z0-9]{9,12}\b/g;

export function minimizeEvidenceForProvider<T>(value: T): T {
  return redact(value, "") as T;
}

export function sanitizeUntrustedText(value: string, maxLength = 500) {
  return stripControlCharacters(value)
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(paymentReferencePattern, "[REDACTED_REFERENCE]")
    .replace(
      /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?\b/gi,
      "[UNTRUSTED_INSTRUCTION_TEXT]",
    )
    .replace(
      /\b(?:reveal|print|show)\s+(?:the\s+)?(?:system prompt|developer message|secret|credentials?|api key)\b/gi,
      "[UNTRUSTED_INSTRUCTION_TEXT]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function containsSecretLikeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretLikeKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => isSensitiveKey(key) || containsSecretLikeKey(child),
  );
}

function redact(value: unknown, parentKey: string): unknown {
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => redact(item, parentKey));
  if (typeof value === "string") {
    if (isStructuredControlKey(parentKey)) {
      return stripControlCharacters(value).trim().slice(0, 200);
    }
    if (/name$/i.test(parentKey) && /(customer|employee|staff|payer|payee)/i.test(parentKey)) {
      return "[REDACTED_IDENTITY]";
    }
    return sanitizeUntrustedText(value);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, child]) => [key, redact(child, key)]),
  );
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return blockedKeyParts.some((part) => normalized.includes(part));
}

function isStructuredControlKey(key: string) {
  return /^(?:classification|quality|intent|dimension|currency|unit|status|risk|route|toolKey|sourceKey|dataType|aggregation|periodKey|businessDate)$/i.test(
    key,
  );
}

function stripControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? " "
      : character;
  }).join("");
}
