import { SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

export type UserBranchAssignmentInput = {
  userId: string;
  assignedBranchIds: string[];
  primaryBranchId: string;
  reason: string;
};

export async function replaceUserBranchAssignments(
  db: D1Database,
  actor: ServerActor,
  input: UserBranchAssignmentInput,
) {
  requireAssignmentAuthority(actor);
  const userId = input.userId.trim();
  const reason = input.reason.trim();
  const assignedBranchIds = [...new Set(input.assignedBranchIds.map((id) => id.trim()))].filter(
    Boolean,
  );
  if (!userId) throw new SerametHttpError(400, "User ID is required");
  if (!assignedBranchIds.length || assignedBranchIds.length > 100) {
    throw new SerametHttpError(400, "One to 100 assigned branches are required");
  }
  if (!assignedBranchIds.includes(input.primaryBranchId)) {
    throw new SerametHttpError(400, "Primary branch must be included in assigned branches");
  }
  if (reason.length < 3 || reason.length > 500) {
    throw new SerametHttpError(400, "A transfer reason between 3 and 500 characters is required");
  }
  if (userId === actor.id && !actor.permissions.includes(permissions.enterpriseAccessManage)) {
    throw new SerametHttpError(403, "Self-assignment changes require enterprise access authority");
  }

  const user = await db
    .prepare("SELECT id,name FROM users WHERE tenant_id=? AND id=? AND active=1")
    .bind(actor.tenantId, userId)
    .first<{ id: string; name: string }>();
  if (!user) throw new SerametHttpError(404, "User not found");

  const placeholders = assignedBranchIds.map(() => "?").join(",");
  const branchRows = await db
    .prepare(
      `SELECT id,name FROM branches
       WHERE tenant_id=? AND active=1 AND id IN (${placeholders}) ORDER BY name,id`,
    )
    .bind(actor.tenantId, ...assignedBranchIds)
    .all<{ id: string; name: string }>();
  const branches = branchRows.results ?? [];
  if (branches.length !== assignedBranchIds.length) {
    throw new SerametHttpError(400, "Branch assignment contains an unknown or inactive branch");
  }
  if (!actor.permissions.includes(permissions.tenantScopeAllBranches)) {
    const outsideAuthority = assignedBranchIds.filter(
      (branchId) => !actor.assignedBranchIds.includes(branchId),
    );
    if (outsideAuthority.length) {
      throw new SerametHttpError(403, "Cannot assign branches outside the actor's scope");
    }
  }

  const [currentRows, currentPrimary] = await Promise.all([
    db
      .prepare(
        "SELECT branch_id FROM user_branches WHERE tenant_id=? AND user_id=? ORDER BY branch_id",
      )
      .bind(actor.tenantId, userId)
      .all<{ branch_id: string }>(),
    db
      .prepare("SELECT branch_id FROM user_primary_branches WHERE tenant_id=? AND user_id=?")
      .bind(actor.tenantId, userId)
      .first<{ branch_id: string }>(),
  ]);
  const previousBranchIds = (currentRows.results ?? []).map((row) => row.branch_id);
  const unchanged =
    currentPrimary?.branch_id === input.primaryBranchId &&
    sameValues(previousBranchIds, assignedBranchIds);
  if (unchanged) {
    return assignmentResult(db, actor.tenantId, userId, input.primaryBranchId, branches, true);
  }

  const stamp = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db
      .prepare("DELETE FROM user_primary_branches WHERE tenant_id=? AND user_id=?")
      .bind(actor.tenantId, userId),
    db
      .prepare("DELETE FROM user_branches WHERE tenant_id=? AND user_id=?")
      .bind(actor.tenantId, userId),
  ];
  for (const branchId of assignedBranchIds) {
    statements.push(
      db
        .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
        .bind(actor.tenantId, userId, branchId),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO user_primary_branches
          (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(actor.tenantId, userId, input.primaryBranchId, actor.id, stamp, reason),
    db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
           correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,'USER_BRANCH_ASSIGNMENT_CHANGED','USER',?,?,?,?,?,?)`,
      )
      .bind(
        actor.tenantId,
        crypto.randomUUID(),
        actor.branchId,
        actor.id,
        actor.deviceId ?? null,
        userId,
        reason,
        crypto.randomUUID(),
        actor.sessionId ?? null,
        JSON.stringify({
          userName: user.name,
          previousPrimaryBranchId: currentPrimary?.branch_id ?? null,
          primaryBranchId: input.primaryBranchId,
          previousBranchIds,
          assignedBranchIds,
        }),
        stamp,
      ),
  );
  await db.batch(statements);
  return assignmentResult(db, actor.tenantId, userId, input.primaryBranchId, branches, false);
}

function requireAssignmentAuthority(actor: ServerActor) {
  if (
    !actor.permissions.includes(permissions.usersManage) &&
    !actor.permissions.includes(permissions.settingsRoleManage) &&
    !actor.permissions.includes(permissions.enterpriseAccessManage)
  ) {
    throw new SerametHttpError(403, "User branch assignment management is not authorized");
  }
}

async function assignmentResult(
  db: D1Database,
  tenantId: string,
  userId: string,
  primaryBranchId: string,
  branches: Array<{ id: string; name: string }>,
  unchanged: boolean,
) {
  const revision = await db
    .prepare("SELECT revision FROM access_control_revisions WHERE tenant_id=?")
    .bind(tenantId)
    .first<{ revision: number }>();
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  return {
    userId,
    primaryBranchId,
    assignedBranches: [...byId.values()].map((branch) => ({
      ...branch,
      isPrimary: branch.id === primaryBranchId,
    })),
    accessRevision: Number(revision?.revision ?? 0),
    unchanged,
  };
}

function sameValues(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((value) => values.has(value));
}
