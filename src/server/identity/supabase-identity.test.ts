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

describe("Supabase user confirmation", () => {
  const env = {
    SERAMET_IDENTITY_PROVIDER: "supabase",
    SERAMET_SUPABASE_URL: baseUrl,
    SERAMET_SUPABASE_PUBLISHABLE_KEY: "disposable-publishable-fixture",
  } as const;

  function signedToken() {
    return new SignJWT({ session_id: "confirmation-session" })
      .setProtectedHeader({ alg: "ES256", kid: "account-name" })
      .setIssuer(`${baseUrl}/auth/v1`)
      .setAudience("authenticated")
      .setSubject("account-owner")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);
  }

  function supabaseAuth(userResponses: Array<() => Response>) {
    const userRequests = { count: 0 };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/.well-known/jwks.json")) {
        return Response.json({ keys: [{ ...publicKey, alg: "ES256", kid: "account-name" }] });
      }
      if (url.pathname === "/auth/v1/user") {
        const respond = userResponses[Math.min(userRequests.count, userResponses.length - 1)]!;
        userRequests.count += 1;
        return respond();
      }
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    });
    return userRequests;
  }

  const confirmed = () => Response.json({ id: "account-owner" });

  it("asks Supabase once for a burst of requests with the same token", async () => {
    const userRequests = supabaseAuth([confirmed]);
    const token = await signedToken();
    await Promise.all([1, 2, 3].map(() => verifyExternalIdentity(token, env)));
    await verifyExternalIdentity(token, env);
    expect(userRequests.count).toBe(1);
  });

  it("asks again once the confirmation window has passed", async () => {
    const userRequests = supabaseAuth([confirmed]);
    const token = await signedToken();
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    await verifyExternalIdentity(token, env);
    clock.mockReturnValue(start + 31_000);
    await verifyExternalIdentity(token, env);
    expect(userRequests.count).toBe(2);
  });

  it("never remembers a rejected token", async () => {
    const userRequests = supabaseAuth([() => new Response(null, { status: 401 }), confirmed]);
    const token = await signedToken();
    await expect(verifyExternalIdentity(token, env)).rejects.toThrow();
    await expect(verifyExternalIdentity(token, env)).resolves.toMatchObject({
      subject: "account-owner",
    });
    expect(userRequests.count).toBe(2);
  });
});
