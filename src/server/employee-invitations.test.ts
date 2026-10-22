import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import {
  createEmployeeInvitation,
  acceptEmployeeInvitation,
  revokeEmployeeInvitation,
} from "@/server/employee-invitations";
describe("verified employee account invitations", () => {
  let db: SqliteD1TestDatabase, actor: ServerActor, env: SerametEnv;
  const tenant = "tenant-demo-mona",
    branch = "branch-demo-westlands";
  let employee: string;
  beforeEach(() => {
    db = createDemoFixtureDatabase();
    employee = crypto.randomUUID();
    const owner = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? LIMIT 1")
      .get(tenant) as { id: string };
    db.sqlite
      .prepare(
        "INSERT INTO users(tenant_id,id,name,email,employment_status,active,created_at,updated_at) VALUES(?,?,?,'disposable@example.invalid','ACTIVE',1,?,?)",
      )
      .run(
        tenant,
        employee,
        "Disposable invited employee",
        new Date().toISOString(),
        new Date().toISOString(),
      );
    db.sqlite.prepare("INSERT INTO user_branches VALUES(?,?,?)").run(tenant, employee, branch);
    db.sqlite
      .prepare(
        "INSERT INTO user_primary_branches(tenant_id,user_id,branch_id,assigned_at) VALUES(?,?,?,?)",
      )
      .run(tenant, employee, branch, new Date().toISOString());
    actor = {
      id: owner.id,
      name: "Owner",
      tenantId: tenant,
      branchId: branch,
      branch: "Westlands",
      authLevel: "FULL",
      role: "Owner",
      roleIds: [],
      permissions: allPermissionCodes,
      assignedBranches: [{ id: branch, name: "Westlands" }],
      assignedBranchIds: [branch],
      branchScope: { type: "BRANCH", branchId: branch },
    };
    env = {
      SERAMET_DB: db,
      SERAMET_IDENTITY_PROVIDER: "supabase",
      SERAMET_SUPABASE_URL: "https://identity.example.invalid",
      SERAMET_PUBLIC_ORIGIN: "https://pilot.example.invalid",
      SERAMET_SUPABASE_PUBLISHABLE_KEY: "disposable-public-key",
      SERAMET_SUPABASE_INVITATION_SECRET: "disposable-server-only-secret",
      SERAMET_IDENTITY_VERIFIER: {
        verify: async () => ({
          provider: "supabase",
          subject: "provider-disposable-subject",
          sessionId: "verified-session",
          email: "disposable@example.invalid",
          emailVerified: true,
          issuedAt: 0,
          expiresAt: 9999999999,
        }),
      },
    } as SerametEnv;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/invite")
          ? Response.json({
              id: "provider-disposable-subject",
              email: "disposable@example.invalid",
            })
          : Response.json({ id: "provider-disposable-subject" }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });
  const request = (body: unknown) =>
    new Request("https://pilot.example.invalid/api", {
      method: "POST",
      body: JSON.stringify(body),
    });
  async function invite(key = crypto.randomUUID()) {
    const response = await createEmployeeInvitation(
      request({ idempotencyKey: key }),
      env,
      actor,
      employee,
    );
    return {
      response,
      body: (await response.json()) as { id: string; status: string; repeated?: boolean },
    };
  }
  it("invites once and links only after exact verified provider identity and fresh sign-in", async () => {
    const key = crypto.randomUUID(),
      first = await invite(key);
    expect(first.response.status).toBe(202);
    expect((await invite(key)).body.repeated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      db.sqlite
        .prepare("SELECT * FROM identity_accounts WHERE tenant_id=? AND user_id=?")
        .get(tenant, employee),
    ).toBeUndefined();
    const activation = {
      invitationId: first.body.id,
      accessToken: "disposable-verification-token",
      password: "Disposable-password-672!",
    };
    const result = await acceptEmployeeInvitation(request(activation), env);
    expect(await result.json()).toMatchObject({ reauthenticationRequired: true });
    expect(
      db.sqlite
        .prepare("SELECT user_id,subject FROM identity_accounts WHERE tenant_id=? AND user_id=?")
        .get(tenant, employee),
    ).toEqual({ user_id: employee, subject: "provider-disposable-subject" });
    await acceptEmployeeInvitation(request(activation), env);
    expect(fetch).toHaveBeenCalledTimes(2);
    const events = db.sqlite.prepare("SELECT details_json FROM staff_access_events").all();
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain(activation.password);
    expect(result.headers.has("set-cookie")).toBe(false);
  });
  it("rejects missing provider configuration without emailing and denies unprivileged administrators", async () => {
    await expect(
      createEmployeeInvitation(
        request({ idempotencyKey: crypto.randomUUID() }),
        { ...env, SERAMET_SUPABASE_INVITATION_SECRET: undefined },
        actor,
        employee,
      ),
    ).rejects.toThrow(/not configured/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      createEmployeeInvitation(
        request({ idempotencyKey: crypto.randomUUID() }),
        env,
        { ...actor, authLevel: "POS_PIN" },
        employee,
      ),
    ).rejects.toThrow();
    await expect(
      createEmployeeInvitation(
        request({ idempotencyKey: crypto.randomUUID() }),
        env,
        { ...actor, permissions: [] },
        employee,
      ),
    ).rejects.toThrow(/permission/);
  });
  it("rejects wrong, revoked, unverified, expired and suspended invitations without identity writes", async () => {
    const first = await invite();
    const activation = {
      invitationId: first.body.id,
      accessToken: "disposable-verification-token",
      password: "Disposable-password-672!",
    };
    const valid = env.SERAMET_IDENTITY_VERIFIER!;
    await expect(
      acceptEmployeeInvitation(request(activation), {
        ...env,
        SERAMET_IDENTITY_VERIFIER: {
          verify: async () => ({ ...(await valid.verify("")), subject: "someone-else" }),
        },
      }),
    ).rejects.toThrow(/does not authorize/);
    await expect(
      acceptEmployeeInvitation(request(activation), {
        ...env,
        SERAMET_IDENTITY_VERIFIER: {
          verify: async () => ({ ...(await valid.verify("")), emailVerified: false }),
        },
      }),
    ).rejects.toThrow(/Verify/);
    db.sqlite
      .prepare("UPDATE users SET employment_status='SUSPENDED' WHERE tenant_id=? AND id=?")
      .run(actor.tenantId, employee);
    await expect(acceptEmployeeInvitation(request(activation), env)).rejects.toThrow(
      /does not authorize/,
    );
    db.sqlite
      .prepare("UPDATE users SET employment_status='ACTIVE' WHERE tenant_id=? AND id=?")
      .run(actor.tenantId, employee);
    db.sqlite
      .prepare(
        "UPDATE employee_account_invitations SET expires_at='2000-01-01T00:00:00Z' WHERE id=?",
      )
      .run(first.body.id);
    await expect(acceptEmployeeInvitation(request(activation), env)).rejects.toThrow(/expired/);
    await revokeEmployeeInvitation(env, actor, employee);
    await expect(acceptEmployeeInvitation(request(activation), env)).rejects.toThrow(
      /unavailable|expired/,
    );
    expect(
      db.sqlite.prepare("SELECT * FROM identity_accounts WHERE user_id=?").get(employee),
    ).toBeUndefined();
  });
  it("keeps ambiguous provider failures visible without automatic resending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("provider-specific sensitive message");
      }),
    );
    const key = crypto.randomUUID();
    await expect(invite(key)).rejects.toThrow(/unconfirmed/);
    expect((await invite(key)).body.status).toBe("FAILED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
