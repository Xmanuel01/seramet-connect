import { z } from "zod";
import {
  authorizeBranchRead,
  SerametHttpError,
  type ServerActor,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { requireFullAuthentication } from "@/server/pos-auth-service";
import { verifyExternalIdentity } from "@/server/identity/supabase-identity";
import { DatabaseRateLimiter } from "@/server/rate-limit";

const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
function fail(status: number, message: string): never {
  throw new SerametHttpError(status, message);
}
function setup(env: SerametEnv) {
  if (
    env.SERAMET_IDENTITY_PROVIDER !== "supabase" ||
    !env.SERAMET_SUPABASE_INVITATION_SECRET ||
    !env.SERAMET_SUPABASE_PUBLISHABLE_KEY ||
    !env.SERAMET_SUPABASE_URL ||
    !env.SERAMET_PUBLIC_ORIGIN
  )
    fail(503, "Staff invitations are not configured. No invitation was sent.");
  const url = new URL(env.SERAMET_SUPABASE_URL),
    origin = new URL(env.SERAMET_PUBLIC_ORIGIN);
  if (
    url.protocol !== "https:" ||
    origin.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  )
    fail(503, "Staff invitation configuration is invalid.");
  return { base: url.origin, origin: origin.origin };
}
export async function createEmployeeInvitation(
  request: Request,
  env: SerametEnv,
  actor: ServerActor,
  userId: string,
) {
  requireFullAuthentication(actor);
  if (
    !actor.permissions.includes(permissions.usersManage) ||
    !actor.permissions.includes(permissions.employeeCredentialsManage)
  )
    fail(403, "Employee administration permission is required.");
  const body = z
    .object({ idempotencyKey: z.string().uuid() })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success) fail(400, "Invalid invitation request.");
  const db = env.SERAMET_DB!;
  const employee = await db
    .prepare(
      "SELECT u.id,u.email,p.branch_id primary_branch_id FROM users u JOIN user_primary_branches p ON p.tenant_id=u.tenant_id AND p.user_id=u.id WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND u.employment_status='ACTIVE' AND (u.effective_from IS NULL OR u.effective_from<=?) AND (u.effective_until IS NULL OR u.effective_until>?)",
    )
    .bind(actor.tenantId, userId, new Date().toISOString(), new Date().toISOString())
    .first<{ id: string; email: string | null; primary_branch_id: string }>();
  if (!employee) fail(404, "Active employee not found.");
  authorizeBranchRead(actor, actor.tenantId, employee.primary_branch_id);
  const email = z.string().email().max(254).safeParse(employee.email);
  if (!email.success)
    fail(422, "An individual verified email address is required for phone access.");
  const prior = await db
    .prepare(
      "SELECT id,user_id,status,email FROM employee_account_invitations WHERE tenant_id=? AND actor_id=? AND request_key=?",
    )
    .bind(actor.tenantId, actor.id, body.data.idempotencyKey)
    .first<{ id: string; user_id: string; status: string; email: string }>();
  if (prior) {
    if (prior.user_id !== userId || prior.email !== email.data.toLowerCase())
      fail(409, "Invitation key was used with different employee details.");
    return response({ ok: true, id: prior.id, status: prior.status, repeated: true });
  }
  const config = setup(env);
  const assignmentRows = await db
    .prepare(
      "SELECT branch_id FROM user_branches WHERE tenant_id=? AND user_id=? ORDER BY branch_id",
    )
    .bind(actor.tenantId, userId)
    .all<{ branch_id: string }>();
  const branches = JSON.stringify({
    primary: employee.primary_branch_id,
    assigned: (assignmentRows.results ?? []).map((row) => row.branch_id),
  });
  await new DatabaseRateLimiter(db).consume(`employee-invite:${actor.tenantId}:${actor.id}`, {
    bucket: "staff-invite",
    limit: 10,
    windowSeconds: 3600,
  });
  const link = await db
    .prepare(
      "SELECT subject FROM identity_accounts WHERE tenant_id=? AND user_id=? AND provider='supabase'",
    )
    .bind(actor.tenantId, userId)
    .first();
  if (link)
    fail(
      409,
      "This employee already has a linked account. Use the existing account; do not relink by email.",
    );
  const pending = await db
    .prepare(
      "SELECT id FROM employee_account_invitations WHERE tenant_id=? AND user_id=? AND status IN ('PREPARING','PENDING','ACCEPTING')",
    )
    .bind(actor.tenantId, userId)
    .first();
  if (pending) fail(409, "An invitation is outstanding. Revoke it before issuing another.");
  const id = crypto.randomUUID(),
    stamp = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO employee_account_invitations(tenant_id,id,user_id,actor_id,email,request_key,branches_json,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'PREPARING',?,?)",
        )
        .bind(
          actor.tenantId,
          id,
          userId,
          actor.id,
          email.data.toLowerCase(),
          body.data.idempotencyKey,
          branches,
          stamp,
          new Date(Date.now() + 86400000).toISOString(),
        ),
      db
        .prepare(
          "INSERT INTO staff_access_events(tenant_id,id,entity_type,entity_id,version,actor_id,branch_id,event_type,at,details_json) VALUES(?,?,'INVITATION',?,0,?,?,'INVITATION_PREPARING',?,?)",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          id,
          actor.id,
          employee.primary_branch_id,
          stamp,
          JSON.stringify({ employeeId: userId }),
        ),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|unique constraint/.test(error.message))
      fail(409, "Another invitation is already being prepared.");
    throw error;
  }
  try {
    const provider = await fetch(
      `${config.base}/auth/v1/invite?redirect_to=${encodeURIComponent(`${config.origin}/staff-login?invitation=${id}`)}`,
      {
        method: "POST",
        headers: {
          apikey: env.SERAMET_SUPABASE_INVITATION_SECRET!,
          authorization: `Bearer ${env.SERAMET_SUPABASE_INVITATION_SECRET!}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: email.data.toLowerCase() }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!provider.ok)
      fail(
        502,
        "The invitation provider did not accept this request. Existing accounts require explicit linking review.",
      );
    const user = (await provider.json()) as { id?: string; email?: string };
    if (!user.id || user.email?.toLowerCase() !== email.data.toLowerCase())
      fail(502, "The invitation response could not be verified.");
    const result = await db.batch([
      db
        .prepare(
          "UPDATE employee_account_invitations SET provider_subject=?,status='PENDING' WHERE tenant_id=? AND id=? AND status='PREPARING'",
        )
        .bind(user.id, actor.tenantId, id),
      db
        .prepare(
          "INSERT INTO staff_access_events(tenant_id,id,entity_type,entity_id,version,actor_id,branch_id,event_type,at,details_json) SELECT ?,?,'INVITATION',?,1,?,?,'INVITATION_PROVIDER_ACCEPTED',?,'{}' WHERE EXISTS(SELECT 1 FROM employee_account_invitations WHERE tenant_id=? AND id=? AND status='PENDING')",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          id,
          actor.id,
          employee.primary_branch_id,
          new Date().toISOString(),
          actor.tenantId,
          id,
        ),
    ]);
    if (result[0]?.meta?.changes !== 1) fail(409, "Invitation was revoked while being prepared.");
    return response({ ok: true, id, status: "PENDING", providerAccepted: true }, 202);
  } catch (error) {
    // The provider may have sent the message before a timeout. Never automatically resend.
    await db
      .prepare(
        "UPDATE employee_account_invitations SET status='FAILED' WHERE tenant_id=? AND id=? AND status='PREPARING'",
      )
      .bind(actor.tenantId, id)
      .run();
    if (error instanceof SerametHttpError) throw error;
    fail(
      503,
      "Invitation delivery is unconfirmed. Review its status before issuing another invitation.",
    );
  }
}
export async function acceptEmployeeInvitation(request: Request, env: SerametEnv) {
  const body = z
    .object({
      invitationId: z.string().uuid(),
      accessToken: z.string().min(20).max(20000),
      password: z.string().min(10).max(200),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success) fail(400, "Invalid account activation details.");
  const config = setup(env),
    db = env.SERAMET_DB!;
  const identity = await verifyExternalIdentity(body.data.accessToken, env).catch(() =>
    fail(401, "The invitation verification has expired. Request a new invitation."),
  );
  if (!identity.emailVerified || !identity.email)
    fail(403, "Verify your invitation email before activating staff access.");
  const record = await db
    .prepare(
      `SELECT i.*,u.email current_email,p.branch_id,u.active,u.employment_status,u.effective_from,u.effective_until
    FROM employee_account_invitations i JOIN users u ON u.tenant_id=i.tenant_id AND u.id=i.user_id JOIN user_primary_branches p ON p.tenant_id=u.tenant_id AND p.user_id=u.id WHERE i.id=?`,
    )
    .bind(body.data.invitationId)
    .first<{
      tenant_id: string;
      id: string;
      user_id: string;
      branch_id: string;
      provider_subject: string;
      status: string;
      email: string;
      current_email: string;
      active: number;
      employment_status: string;
      expires_at: string;
      effective_from: string | null;
      effective_until: string | null;
      branches_json: string;
    }>();
  const now = new Date().toISOString();
  if (
    !record ||
    identity.subject !== record.provider_subject ||
    identity.email.toLowerCase() !== record.email ||
    record.current_email?.toLowerCase() !== record.email ||
    !record.active ||
    record.employment_status !== "ACTIVE" ||
    (record.effective_from && record.effective_from > now) ||
    (record.effective_until && record.effective_until <= now)
  )
    fail(403, "This invitation does not authorize this employee account.");
  if (record.status === "ACCEPTED") return response({ ok: true, reauthenticationRequired: true });
  const assignments = await db
    .prepare(
      "SELECT branch_id FROM user_branches WHERE tenant_id=? AND user_id=? ORDER BY branch_id",
    )
    .bind(record.tenant_id, record.user_id)
    .all<{ branch_id: string }>();
  if (
    record.branches_json !==
    JSON.stringify({
      primary: record.branch_id,
      assigned: (assignments.results ?? []).map((row) => row.branch_id),
    })
  )
    fail(
      409,
      "Employee branch assignments changed. Ask an administrator to review the invitation.",
    );
  if (record.status !== "PENDING" || record.expires_at <= now)
    fail(409, "This invitation is unavailable or expired. Ask an administrator to review it.");
  await new DatabaseRateLimiter(db).consume(`invite-accept:${record.id}`, {
    bucket: "staff-invite-accept",
    limit: 5,
    windowSeconds: 900,
  });
  const claimed = await db
    .prepare(
      "UPDATE employee_account_invitations SET status='ACCEPTING' WHERE tenant_id=? AND id=? AND status='PENDING' AND expires_at>?",
    )
    .bind(record.tenant_id, record.id, now)
    .run();
  if (claimed.meta?.changes !== 1)
    fail(409, "Another activation is in progress. Sign in or ask an administrator to review it.");
  try {
    const update = await fetch(`${config.base}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: env.SERAMET_SUPABASE_PUBLISHABLE_KEY!,
        authorization: `Bearer ${body.data.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: body.data.password }),
      signal: AbortSignal.timeout(15000),
    });
    if (!update.ok) fail(502, "Account password setup was not confirmed.");
    const updated = (await update.json()) as { id?: string };
    if (updated.id !== record.provider_subject) fail(502, "Account setup identity mismatch.");
    // A concurrent revocation removes the pending row from both SELECTs: no link is created.
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO identity_accounts(tenant_id,user_id,provider,subject,email,email_verified,linked_at,metadata_json)
        SELECT tenant_id,user_id,'supabase',provider_subject,email,1,?,'{}' FROM employee_account_invitations WHERE tenant_id=? AND id=? AND status='ACCEPTING'`,
        )
        .bind(now, record.tenant_id, record.id),
      db
        .prepare(
          "UPDATE employee_account_invitations SET status='ACCEPTED',accepted_at=? WHERE tenant_id=? AND id=? AND status='ACCEPTING'",
        )
        .bind(now, record.tenant_id, record.id),
      db
        .prepare(
          "INSERT INTO staff_access_events(tenant_id,id,entity_type,entity_id,version,actor_id,branch_id,event_type,at,details_json) SELECT ?,?,'INVITATION',?,2,?,?,'INVITATION_ACCEPTED',?,'{}' WHERE EXISTS(SELECT 1 FROM employee_account_invitations WHERE tenant_id=? AND id=? AND status='ACCEPTED')",
        )
        .bind(
          record.tenant_id,
          crypto.randomUUID(),
          record.id,
          record.user_id,
          record.branch_id,
          now,
          record.tenant_id,
          record.id,
        ),
    ]);
    if (result[1]?.meta?.changes !== 1)
      fail(409, "Invitation was revoked before activation completed.");
  } catch (error) {
    await db
      .prepare(
        "UPDATE employee_account_invitations SET status='FAILED' WHERE tenant_id=? AND id=? AND status='ACCEPTING'",
      )
      .bind(record.tenant_id, record.id)
      .run();
    if (error instanceof SerametHttpError) throw error;
    fail(
      503,
      "Activation was not confirmed. Sign in with your chosen password or ask an administrator to review the invitation.",
    );
  }
  return response({ ok: true, reauthenticationRequired: true });
}
export async function revokeEmployeeInvitation(
  env: SerametEnv,
  actor: ServerActor,
  userId: string,
) {
  requireFullAuthentication(actor);
  if (
    !actor.permissions.includes(permissions.usersManage) ||
    !actor.permissions.includes(permissions.employeeCredentialsManage)
  )
    fail(403, "Employee administration permission is required.");
  const employee = await env
    .SERAMET_DB!.prepare(
      "SELECT branch_id primary_branch_id FROM user_primary_branches WHERE tenant_id=? AND user_id=?",
    )
    .bind(actor.tenantId, userId)
    .first<{ primary_branch_id: string }>();
  if (!employee) fail(404, "Employee not found.");
  authorizeBranchRead(actor, actor.tenantId, employee.primary_branch_id);
  const records = await env
    .SERAMET_DB!.prepare(
      "SELECT id FROM employee_account_invitations WHERE tenant_id=? AND user_id=? AND status IN ('PREPARING','PENDING','ACCEPTING','FAILED')",
    )
    .bind(actor.tenantId, userId)
    .all<{ id: string }>();
  await env.SERAMET_DB!.batch([
    env
      .SERAMET_DB!.prepare(
        "UPDATE employee_account_invitations SET status='REVOKED' WHERE tenant_id=? AND user_id=? AND status IN ('PREPARING','PENDING','ACCEPTING','FAILED')",
      )
      .bind(actor.tenantId, userId),
    ...(records.results ?? []).map((row) =>
      env
        .SERAMET_DB!.prepare(
          "INSERT INTO staff_access_events(tenant_id,id,entity_type,entity_id,version,actor_id,branch_id,event_type,at,details_json) VALUES(?,?,'INVITATION',?,4,?,?,'INVITATION_REVOKED',?,'{}') ON CONFLICT DO NOTHING",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          row.id,
          actor.id,
          employee.primary_branch_id,
          new Date().toISOString(),
        ),
    ),
  ]);
  return response({ ok: true });
}

export async function employeeInvitationStatus(
  env: SerametEnv,
  actor: ServerActor,
  userId: string,
) {
  requireFullAuthentication(actor);
  if (
    !actor.permissions.includes(permissions.usersManage) ||
    !actor.permissions.includes(permissions.employeeCredentialsManage)
  )
    fail(403, "Employee administration permission is required.");
  const primary = await env
    .SERAMET_DB!.prepare(
      "SELECT branch_id FROM user_primary_branches WHERE tenant_id=? AND user_id=?",
    )
    .bind(actor.tenantId, userId)
    .first<{ branch_id: string }>();
  if (!primary) fail(404, "Employee branch assignment not found.");
  authorizeBranchRead(actor, actor.tenantId, primary.branch_id);
  const invitation = await env
    .SERAMET_DB!.prepare(
      "SELECT status,created_at createdAt,expires_at expiresAt,accepted_at acceptedAt FROM employee_account_invitations WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(actor.tenantId, userId)
    .first<{ status: string; expiresAt: string }>();
  return response({
    ok: true,
    status: invitation?.status ?? "NONE",
    invitation: invitation ?? null,
    expired: !!invitation && invitation.expiresAt <= new Date().toISOString(),
  });
}
