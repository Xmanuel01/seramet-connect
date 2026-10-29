import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyExternalIdentity } from "./supabase-identity";

const baseUrl = "https://account-name-fixture.supabase.co";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicKey: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  keys = await generateKeyPair("ES256");
  publicKey = await exportJWK(keys.publicKey);
});

afterEach(() => vi.restoreAllMocks());

async function accountIdentity(displayName: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/.well-known/jwks.json")) {
      return Response.json({ keys: [{ ...publicKey, alg: "ES256", kid: "account-name" }] });
    }
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "account-owner",
        email: "owner@example.test",
        email_confirmed_at: "2026-01-01T00:00:00Z",
        user_metadata: { display_name: displayName },
      });
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  });
  const token = await new SignJWT({
    session_id: "account-session",
    user_metadata: { display_name: "Stale token name", role: "SUPER_ADMIN" },
  })
    .setProtectedHeader({ alg: "ES256", kid: "account-name" })
    .setIssuer(`${baseUrl}/auth/v1`)
    .setAudience("authenticated")
    .setSubject("account-owner")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
  return verifyExternalIdentity(token, {
    SERAMET_IDENTITY_PROVIDER: "supabase",
    SERAMET_SUPABASE_URL: baseUrl,
    SERAMET_SUPABASE_PUBLISHABLE_KEY: "disposable-publishable-fixture",
  });
}

describe("verified account display name", () => {
  it("reads the saved name from the current user response, not token metadata", async () => {
    const identity = await accountIdentity("  Saved Account Owner  ");
    expect(identity).toMatchObject({
      provider: "supabase",
      subject: "account-owner",
      sessionId: "supabase:account-session",
      emailVerified: true,
      displayName: "Saved Account Owner",
    });
    expect(identity).not.toHaveProperty("role");
    expect(identity).not.toHaveProperty("permissions");
  });

  it.each([undefined, null, 42, "", "  ", "x", "x".repeat(101), { role: "OWNER" }])(
    "leaves missing or malformed names available for manual entry: %j",
    async (value) => {
      expect(await accountIdentity(value)).not.toHaveProperty("displayName");
    },
  );
});
