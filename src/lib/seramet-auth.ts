import type { AppRole } from "@/lib/app-context";
import type { ProviderRuntimeEnv } from "@/integrations/runtime-env";
import { LOCAL_PILOT_TENANT_ID, LOCAL_PILOT_USER_ID } from "@/platform/pilot-defaults";
import { mutationPermission, permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { BranchScope, PermissionCode } from "@/platform/types";
import type { D1Database } from "@/server/database/d1";
import {
  isLocalDevelopmentRequest,
  resolveRuntimeConfiguration,
  type ProductionRuntimeEnv,
} from "@/server/environment";
import { verifyExternalIdentity } from "@/server/identity/supabase-identity";

export type ServerActor = {
  id: string;
  name: string;
  tenantId: string;
  sessionId?: string;
  deviceId?: string;
  roleIds: string[];
  permissions: PermissionCode[];
  assignedBranchIds: string[];
  assignedBranches: Array<{ id: string; name: string; isPrimary?: boolean }>;
  primaryBranchId?: string;
  branchScope: BranchScope;
  branchId: string;
  role: AppRole;
  branch: string;
  tokenId?: string;
};

export type SerametEnv = ProviderRuntimeEnv &
  ProductionRuntimeEnv & {
    SERAMET_DB?: D1Database;
  };

export class SerametHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type JwtClaims = {
  sub: string;
  tid: string;
  sid: string;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  deviceId?: string;
};

type SessionIdentityRow = {
  tenant_id: string;
  session_id: string;
  user_id: string;
  user_name: string;
  session_device_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  token_version: number;
  password_version: number;
};

export async function authenticateSerametRequest(
  request: Request,
  env: SerametEnv,
): Promise<ServerActor> {
  const runtime = resolveRuntimeConfiguration(env);
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? readCookie(request, "seramet_access");
  if (token) {
    if (!env.SERAMET_DB)
      throw new SerametHttpError(503, "Authoritative identity store unavailable");
    return authenticateBearer(token, request, env.SERAMET_DB, runtime, env);
  }

  if (
    runtime.environment === "development" &&
    runtime.devAuthEnabled &&
    isLocalDevelopmentRequest(request, env) &&
    request.headers.get("x-seramet-dev-auth") === "enabled"
  ) {
    return authenticateDevelopmentRequest(request);
  }

  throw new SerametHttpError(401, "Bearer authentication required");
}

export function authorizeSerametMutation(
  actor: ServerActor,
  action: string,
  tenantIdOrBranchId?: string,
  branchIdInput?: string,
) {
  const requiredPermission = mutationPermission[action];
  if (!requiredPermission) throw new SerametHttpError(400, `Unknown transaction action: ${action}`);
  if (!actor.permissions.includes(requiredPermission)) {
    throw new SerametHttpError(403, `Permission ${requiredPermission} is required`);
  }

  const tenantId = branchIdInput ? tenantIdOrBranchId : actor.tenantId;
  const branchIdOrName = branchIdInput ?? tenantIdOrBranchId;
  if (tenantId && tenantId !== actor.tenantId) {
    throw new SerametHttpError(403, "Cross-tenant mutation denied");
  }
  if (!branchIdOrName) return;
  const branchId = resolveActorBranchId(actor, branchIdOrName);
  if (branchId === actor.branchId) return;
  const canSwitchBranch = actor.permissions.includes(permissions.branchSwitch);
  if (!canSwitchBranch || !actor.assignedBranchIds.includes(branchId)) {
    throw new SerametHttpError(403, "Actor cannot mutate records outside the active branch");
  }
}

export function authorizeBranchRead(
  actor: ServerActor,
  tenantIdOrBranchId?: string,
  branchIdInput?: string,
) {
  const tenantId = branchIdInput ? tenantIdOrBranchId : actor.tenantId;
  const branchIdOrName = branchIdInput ?? tenantIdOrBranchId;
  if (tenantId && tenantId !== actor.tenantId) {
    throw new SerametHttpError(403, "Cross-tenant read denied");
  }
  if (!branchIdOrName || actor.branchScope.type === "ALL") return;
  const branchId = resolveActorBranchId(actor, branchIdOrName);
  if (branchId === actor.branchId) return;
  if (
    actor.permissions.includes(permissions.branchSwitch) &&
    actor.assignedBranchIds.includes(branchId)
  ) {
    return;
  }
  throw new SerametHttpError(403, "Actor cannot read records outside the active branch");
}

async function authenticateBearer(
  token: string,
  request: Request,
  db: D1Database,
  runtime: ReturnType<typeof resolveRuntimeConfiguration>,
  env: SerametEnv,
) {
  if (env.SERAMET_IDENTITY_PROVIDER === "supabase") {
    let identity;
    try {
      identity = await verifyExternalIdentity(token, env);
    } catch {
      throw new SerametHttpError(401, "Supabase session is invalid or expired");
    }
    const requestedTenantId =
      request.headers.get("x-seramet-tenant-id")?.trim() ||
      new URL(request.url).searchParams.get("tenant")?.trim();
    const links = await db
      .prepare(
        `SELECT i.tenant_id,i.user_id,u.name AS user_name,u.password_version
         FROM identity_accounts i
         JOIN users u ON u.tenant_id=i.tenant_id AND u.id=i.user_id AND u.active=1
         WHERE i.provider=? AND i.subject=?
           AND (CAST(? AS text) IS NULL OR i.tenant_id=CAST(? AS text))
         ORDER BY i.tenant_id LIMIT 2`,
      )
      .bind(
        identity.provider,
        identity.subject,
        requestedTenantId ?? null,
        requestedTenantId ?? null,
      )
      .all<{
        tenant_id: string;
        user_id: string;
        user_name: string;
        password_version: number;
      }>();
    const memberships = links.results ?? [];
    if (!memberships.length) throw new SerametHttpError(403, "Identity is not linked to Seramet");
    if (!requestedTenantId && memberships.length > 1) {
      throw new SerametHttpError(409, "Tenant selection is required for this identity");
    }
    const membership = memberships[0]!;
    const stamp = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO auth_sessions
            (tenant_id,id,user_id,device_id,issued_at,expires_at,revoked_at,last_seen_at,
             token_version,ip_hash,metadata_json)
           VALUES (?,?,?,?,?,?,NULL,?,?,NULL,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
        )
        .bind(
          membership.tenant_id,
          identity.sessionId,
          membership.user_id,
          null,
          new Date(identity.issuedAt * 1000).toISOString(),
          new Date(identity.expiresAt * 1000).toISOString(),
          stamp,
          membership.password_version,
          JSON.stringify({ provider: identity.provider }),
        ),
      db
        .prepare(
          `UPDATE identity_accounts SET last_authenticated_at=?
           WHERE tenant_id=? AND user_id=? AND provider=? AND subject=?`,
        )
        .bind(stamp, membership.tenant_id, membership.user_id, identity.provider, identity.subject),
    ]);
    return authenticateStoredSession(request, db, {
      tenantId: membership.tenant_id,
      sessionId: identity.sessionId,
      userId: membership.user_id,
      ...(identity.tokenId ? { tokenId: identity.tokenId } : {}),
    });
  }

  const secret = runtime.jwtSecret;
  if (!secret || !runtime.jwtIssuer || !runtime.jwtAudience) {
    throw new SerametHttpError(503, "Production identity configuration is incomplete");
  }
  const claims = await verifyJwt(token, secret, runtime.jwtIssuer, runtime.jwtAudience);
  return authenticateStoredSession(request, db, {
    tenantId: claims.tid,
    sessionId: claims.sid,
    userId: claims.sub,
    ...(claims.deviceId ? { deviceId: claims.deviceId } : {}),
    ...(claims.jti ? { tokenId: claims.jti } : {}),
  });
}

async function authenticateStoredSession(
  request: Request,
  db: D1Database,
  identity: {
    tenantId: string;
    sessionId: string;
    userId: string;
    deviceId?: string;
    tokenId?: string;
  },
) {
  const session = await db
    .prepare(
      `SELECT s.tenant_id, s.id AS session_id, s.user_id, u.name AS user_name,
              s.device_id AS session_device_id, s.expires_at, s.revoked_at,
              s.token_version, u.password_version
       FROM auth_sessions s
       JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
       WHERE s.tenant_id = ? AND s.id = ? AND s.user_id = ? AND u.active = 1`,
    )
    .bind(identity.tenantId, identity.sessionId, identity.userId)
    .first<SessionIdentityRow>();
  if (!session || session.revoked_at)
    throw new SerametHttpError(401, "Session is invalid or revoked");
  if (Date.parse(session.expires_at) <= Date.now())
    throw new SerametHttpError(401, "Session expired");
  if (session.token_version !== session.password_version) {
    throw new SerametHttpError(401, "Session was invalidated by a credential change");
  }

  const tokenDeviceId = identity.deviceId ?? session.session_device_id ?? undefined;
  if (session.session_device_id && identity.deviceId !== session.session_device_id) {
    throw new SerametHttpError(401, "Token device does not match the session device");
  }
  if (tokenDeviceId) {
    const device = await db
      .prepare(
        `SELECT id FROM hardware_devices
         WHERE tenant_id = ? AND id = ? AND trust_status = 'ACTIVE' AND revoked_at IS NULL`,
      )
      .bind(session.tenant_id, tokenDeviceId)
      .first<{ id: string }>();
    if (!device) throw new SerametHttpError(401, "Device is not active");
  }

  const [rolesResult, permissionsResult, branchesResult] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.name FROM user_roles ur
         JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
         WHERE ur.tenant_id = ? AND ur.user_id = ? AND r.active = 1`,
      )
      .bind(session.tenant_id, session.user_id)
      .all<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT DISTINCT rp.permission_code FROM user_roles ur
         JOIN role_permissions rp ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
         WHERE ur.tenant_id = ? AND ur.user_id = ?`,
      )
      .bind(session.tenant_id, session.user_id)
      .all<{ permission_code: string }>(),
    db
      .prepare(
        `SELECT b.id, b.name,
                CASE WHEN pb.branch_id=b.id THEN 1 ELSE 0 END AS is_primary
         FROM user_branches ub
         JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id
         LEFT JOIN user_primary_branches pb
           ON pb.tenant_id=ub.tenant_id AND pb.user_id=ub.user_id
         WHERE ub.tenant_id = ? AND ub.user_id = ? AND b.active = 1
         ORDER BY is_primary DESC,b.name,b.id`,
      )
      .bind(session.tenant_id, session.user_id)
      .all<{ id: string; name: string; is_primary: number }>(),
  ]);

  const assignedBranches = branchesResult.results ?? [];
  if (!assignedBranches.length)
    throw new SerametHttpError(403, "User has no active branch assignment");
  const normalizedBranches = assignedBranches.map((candidate, index) => ({
    id: candidate.id,
    name: candidate.name,
    isPrimary:
      candidate.is_primary === 1 ||
      (!assignedBranches.some((row) => row.is_primary === 1) && index === 0),
  }));
  const primaryBranch = normalizedBranches.find((candidate) => candidate.isPrimary)!;
  const actorPermissions = (permissionsResult.results ?? []).map((row) => row.permission_code);
  const requestedBranchId = request.headers.get("x-seramet-branch-id")?.trim();
  const canUseAllScope = actorPermissions.includes(permissions.tenantScopeAllBranches);
  const canSwitchBranch = actorPermissions.includes(permissions.branchSwitch);
  const requestedBranch = requestedBranchId
    ? normalizedBranches.find((candidate) => candidate.id === requestedBranchId)
    : undefined;
  if (requestedBranchId && !requestedBranch) {
    throw new SerametHttpError(403, "Requested branch is not assigned to this user");
  }
  if (requestedBranch && requestedBranch.id !== primaryBranch.id && !canSwitchBranch) {
    throw new SerametHttpError(403, "Branch switching permission is required");
  }
  const branch = requestedBranch ?? primaryBranch;
  const wantsAll = request.headers.get("x-seramet-branch-scope") === "ALL";
  if (wantsAll && (!canUseAllScope || !canSwitchBranch)) {
    throw new SerametHttpError(403, "All-branch scope requires branch switching authority");
  }
  await db
    .prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE tenant_id = ? AND id = ?")
    .bind(new Date().toISOString(), session.tenant_id, session.session_id)
    .run();

  return {
    id: session.user_id,
    name: session.user_name,
    tenantId: session.tenant_id,
    sessionId: session.session_id,
    ...(tokenDeviceId ? { deviceId: tokenDeviceId } : {}),
    roleIds: (rolesResult.results ?? []).map((role) => role.id),
    permissions: actorPermissions,
    assignedBranchIds: normalizedBranches.map((candidate) => candidate.id),
    assignedBranches: normalizedBranches,
    primaryBranchId: primaryBranch.id,
    branchScope: wantsAll
      ? { type: "ALL" as const }
      : { type: "BRANCH" as const, branchId: branch.id },
    branchId: branch.id,
    role: rolesResult.results?.[0]?.name ?? "Configured user",
    branch: branch.name,
    ...(identity.tokenId ? { tokenId: identity.tokenId } : {}),
  };
}

function authenticateDevelopmentRequest(request: Request): ServerActor {
  const repository = getConfigurationRepository();
  const state = repository.snapshot();
  const tenantId =
    request.headers.get("x-seramet-tenant-id") ??
    state.tenants.find((tenant) => tenant.active)?.id ??
    LOCAL_PILOT_TENANT_ID;
  const userId =
    request.headers.get("x-seramet-user-id") ??
    state.users.find((user) => user.tenantId === tenantId && user.active)?.id ??
    LOCAL_PILOT_USER_ID;
  const session = repository.getUserSession(tenantId, userId);
  const assignedBranches = session.assignedBranchIds.map((id) => ({
    id,
    name: repository.getBranch(tenantId, id).name,
    isPrimary: id === (session.primaryBranchId ?? session.assignedBranchIds[0]),
  }));
  const primaryBranch =
    assignedBranches.find((candidate) => candidate.isPrimary) ?? assignedBranches[0];
  const requestedBranchId = request.headers.get("x-seramet-branch-id")?.trim();
  const canUseAllScope = session.permissions.includes(permissions.tenantScopeAllBranches);
  const canSwitchBranch = session.permissions.includes(permissions.branchSwitch);
  const requestedBranch = requestedBranchId
    ? assignedBranches.find((candidate) => candidate.id === requestedBranchId)
    : undefined;
  if (!primaryBranch) throw new SerametHttpError(403, "User has no assigned branch");
  if (requestedBranchId && !requestedBranch) {
    throw new SerametHttpError(403, "Requested branch is not assigned to this user");
  }
  if (requestedBranch && requestedBranch.id !== primaryBranch.id && !canSwitchBranch) {
    throw new SerametHttpError(403, "Branch switching permission is required");
  }
  const branch = requestedBranch ?? primaryBranch;
  const wantsAll = request.headers.get("x-seramet-branch-scope") === "ALL";
  if (wantsAll && (!canUseAllScope || !canSwitchBranch)) {
    throw new SerametHttpError(403, "All-branch scope requires branch switching authority");
  }
  return {
    id: session.id,
    name: session.name,
    tenantId,
    roleIds: session.roleIds,
    permissions: session.permissions,
    assignedBranchIds: session.assignedBranchIds,
    assignedBranches,
    primaryBranchId: primaryBranch.id,
    branchScope: wantsAll ? { type: "ALL" } : { type: "BRANCH", branchId: branch.id },
    branchId: branch.id,
    role: session.roleNames[0] ?? "Configured user",
    branch: branch.name,
  };
}

async function verifyJwt(token: string, secret: string, issuer: string, audience: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SerametHttpError(401, "Malformed bearer token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  let header: { alg?: string; typ?: string };
  let claims: Partial<JwtClaims>;
  try {
    header = JSON.parse(decodeBase64UrlText(encodedHeader)) as { alg?: string; typ?: string };
    claims = JSON.parse(decodeBase64UrlText(encodedPayload)) as Partial<JwtClaims>;
  } catch {
    throw new SerametHttpError(401, "Malformed bearer token");
  }
  if (header.alg !== "HS256") throw new SerametHttpError(401, "Unsupported token algorithm");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new SerametHttpError(401, "Invalid bearer token signature");
  if (!claims.sub || !claims.tid || !claims.sid || !claims.iss || !claims.aud || !claims.exp) {
    throw new SerametHttpError(401, "Bearer token claims are incomplete");
  }
  if (claims.iss !== issuer) throw new SerametHttpError(401, "Bearer token issuer mismatch");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience))
    throw new SerametHttpError(401, "Bearer token audience mismatch");
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new SerametHttpError(401, "Bearer token expired");
  if (claims.nbf && claims.nbf > now + 30)
    throw new SerametHttpError(401, "Bearer token not active");
  return claims as JwtClaims;
}

function resolveActorBranchId(actor: ServerActor, branchIdOrName: string) {
  const input = branchIdOrName.trim();
  const branch = actor.assignedBranches.find(
    (candidate) => candidate.id === input || candidate.name.toLowerCase() === input.toLowerCase(),
  );
  if (branch) return branch.id;
  if (actor.permissions.includes(permissions.tenantScopeAllBranches)) {
    try {
      return getConfigurationRepository().resolveBranch(actor.tenantId, input).id;
    } catch {
      return input;
    }
  }
  return input;
}

function decodeBase64UrlText(value: string) {
  return new TextDecoder().decode(decodeBase64Url(value));
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}
