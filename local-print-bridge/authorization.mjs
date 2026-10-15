import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyPrintAuthorization(authorization, config, now = Date.now()) {
  if (
    !config.signingKey ||
    config.signingKey.length < 32 ||
    !authorization ||
    typeof authorization.payload !== "string" ||
    authorization.payload.length > 256000 ||
    !/^[a-f0-9]{64}$/.test(authorization.signature ?? "")
  )
    throw new Error("AUTHORIZATION_REQUIRED");
  const signature = createHmac("sha256", config.signingKey).update(authorization.payload).digest();
  if (!timingSafeEqual(signature, Buffer.from(authorization.signature, "hex")))
    throw new Error("INVALID_AUTHORIZATION");
  const job = JSON.parse(Buffer.from(authorization.payload, "base64url").toString("utf8"));
  if (
    job.v !== 1 ||
    job.bridgeId !== config.bridgeId ||
    job.tenantId !== config.tenantId ||
    job.branchId !== config.branchId ||
    !Number.isSafeInteger(job.expiresAt) ||
    job.expiresAt <= now ||
    job.expiresAt > now + 120000 ||
    typeof job.id !== "string" ||
    job.id.length > 300 ||
    !job.target?.id ||
    !["TCP", "WINDOWS"].includes(job.target.transport) ||
    typeof job.content !== "string" ||
    !job.content.trim() ||
    job.content.length > 128000 ||
    !["BILL", "RECEIPT", "INVOICE", "FOOD_KOT", "BAR_TICKET", "DISPATCH_TICKET", "TEST"].includes(
      job.documentType,
    )
  ) {
    throw new Error("AUTHORIZATION_SCOPE_DENIED");
  }
  return job;
}
