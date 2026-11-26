// Test-only stand-in for Supabase Auth (GoTrue), so the full-day journey can
// create a real owner account against a disposable local Seramet. It speaks the
// endpoints Seramet calls, signs RS256 access tokens published through JWKS,
// and holds sign-ups unconfirmed until the test "clicks" the email link.
// Never used outside local journey runs.
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export async function startFakeSupabaseAuth({ port, keyFile, certFile }) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "journey", alg: "RS256", use: "sig" };
  const base = `https://127.0.0.1:${port}`;
  const issuer = `${base}/auth/v1`;
  const users = new Map(); // email -> user
  const sessions = new Map(); // access or refresh token -> { userId, sessionId }
  const outbox = []; // emails Supabase would have sent

  const publicUser = (user) => ({
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: user.confirmedAt,
    user_metadata: user.metadata,
  });
  async function issue(user) {
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({
      email: user.email,
      session_id: sessionId,
      role: "authenticated",
    })
      .setProtectedHeader({ alg: "RS256", kid: "journey" })
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setJti(randomUUID())
      .sign(privateKey);
    const refreshToken = randomUUID();
    sessions.set(accessToken, { userId: user.id, sessionId });
    sessions.set(refreshToken, { userId: user.id, sessionId });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: 3600,
      user: publicUser(user),
    };
  }
  const byId = (id) => [...users.values()].find((user) => user.id === id);
  const read = (request) =>
    new Promise((resolve) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = createServer(
    { key: readFileSync(keyFile), cert: readFileSync(certFile) },
    async (request, response) => {
      const url = new URL(request.url, base);
      const send = (status, value) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(value === undefined ? "" : JSON.stringify(value));
      };
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const body = request.method === "POST" ? await read(request) : {};
      try {
        if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [jwk] });
        if (url.pathname === "/auth/v1/signup") {
          const email = String(body.email ?? "").toLowerCase();
          if (users.has(email)) return send(422, { msg: "User already registered" });
          const user = {
            id: randomUUID(),
            email,
            password: body.password,
            confirmedAt: null,
            metadata: body.data ?? {},
          };
          users.set(email, user);
          outbox.push({ kind: "confirm", email, redirect: url.searchParams.get("redirect_to") });
          return send(200, publicUser(user)); // no session until the email is confirmed
        }
        if (url.pathname === "/auth/v1/token") {
          const grant = url.searchParams.get("grant_type");
          if (grant === "password") {
            const user = users.get(String(body.email ?? "").toLowerCase());
            if (!user || user.password !== body.password)
              return send(400, { error: "invalid_grant", error_description: "Invalid login" });
            if (!user.confirmedAt)
              return send(400, {
                error: "email_not_confirmed",
                error_description: "Email not confirmed",
              });
            return send(200, await issue(user));
          }
          if (grant === "refresh_token") {
            const session = sessions.get(body.refresh_token);
            const user = session && byId(session.userId);
            if (!user) return send(400, { error: "invalid_grant" });
            sessions.delete(body.refresh_token);
            return send(200, await issue(user));
          }
          return send(400, { error: "unsupported_grant_type" });
        }
        if (url.pathname === "/auth/v1/user") {
          const session = bearer && sessions.get(bearer);
          const user = session && byId(session.userId);
          return user ? send(200, publicUser(user)) : send(401, { msg: "Invalid token" });
        }
        if (url.pathname === "/auth/v1/logout") {
          if (bearer) sessions.delete(bearer);
          return send(204);
        }
        if (url.pathname === "/auth/v1/invite" || url.pathname === "/auth/v1/otp") {
          outbox.push({ kind: url.pathname.slice(9), email: body.email, data: body.data ?? {} });
          return send(200, {});
        }
        // Test controls: what was "emailed", and following the confirmation link.
        if (url.pathname === "/__journey/outbox") return send(200, outbox);
        if (url.pathname === "/__journey/confirm") {
          const user = users.get(String(body.email ?? "").toLowerCase());
          if (!user) return send(404, { msg: "No such user" });
          user.confirmedAt = new Date().toISOString();
          return send(200, publicUser(user));
        }
        return send(404, { msg: `Not handled: ${url.pathname}` });
      } catch (error) {
        return send(500, { msg: String(error) });
      }
    },
  );
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  return { base, close: () => new Promise((done) => server.close(() => done())) };
}
