import type { CustomerIdentifierType, PhoneNormalizationPolicy } from "@/crm/types";

export function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase().normalize("NFKC");
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Email address is invalid");
  }
  return normalized;
}

export function normalizePhone(value: string, policy: PhoneNormalizationPolicy) {
  const source = value.trim();
  if (!source) throw new Error("Phone number is required");
  const hasInternationalPrefix = source.startsWith("+");
  let digits = source.replace(/\D/g, "");
  if (source.startsWith("00")) {
    digits = source.slice(2).replace(/\D/g, "");
  } else if (!hasInternationalPrefix) {
    if (!policy.defaultCallingCode.replace(/\D/g, "")) {
      throw new Error("Tenant phone calling-code configuration is required");
    }
    const prefix = policy.nationalPrefix ?? "0";
    if (prefix && digits.startsWith(prefix)) digits = digits.slice(prefix.length);
    digits = `${policy.defaultCallingCode.replace(/\D/g, "")}${digits}`;
  }
  const min = policy.minNationalDigits ?? 8;
  const max = policy.maxNationalDigits ?? 15;
  if (digits.length < min || digits.length > max || digits.startsWith("0")) {
    throw new Error("Phone number is invalid for the configured region");
  }
  return `+${digits}`;
}

export function normalizeIdentifier(
  type: CustomerIdentifierType,
  value: string,
  phonePolicy: PhoneNormalizationPolicy,
) {
  if (type === "PHONE") return normalizePhone(value, phonePolicy);
  if (type === "EMAIL") return normalizeEmail(value);
  const normalized = value.trim().normalize("NFKC");
  if (!normalized || normalized.length > 256) throw new Error("Customer identifier is invalid");
  return normalized;
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generatePublicToken(
  prefix: string,
  random = crypto.getRandomValues(new Uint8Array(24)),
) {
  const body = [...random]
    .map((byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${prefix}-${body}`;
}

export function maskContact(value: string | null | undefined, canView: boolean) {
  if (!value) return undefined;
  if (canView) return value;
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name?.slice(0, 1) ?? "*"}***@${domain ?? "***"}`;
  }
  const digits = value.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}
