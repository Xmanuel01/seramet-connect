import {
  SerametHttpError,
  authenticateSerametRequest,
  authorizeSerametMutation,
  type SerametEnv,
} from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { offlineAllowedCommands, type OfflineCommand } from "@/offline/types";
import { ServerOperationError } from "@/server/errors";

type StoredCommandRow = {
  sync_status: OfflineCommand["syncStatus"];
  server_result_json: string | null;
  conflict_code: string | null;
};

export async function handleOfflineSyncApi(
  request: Request,
  env: SerametEnv,
  repository: TransactionRepository,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/seramet/offline/sync" || request.method !== "POST") return null;
  if (!env.SERAMET_DB || !repository.authoritative) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Offline synchronization requires authoritative server persistence",
    );
  }
  const actor = await authenticateSerametRequest(request, env);
  if (!actor.deviceId) {
    throw new ServerOperationError(
      "OFFLINE_OPERATION_NOT_ALLOWED",
      403,
      "A trusted device session is required for offline synchronization",
    );
  }
  const body = await readBody(request);
  const commands = body["commands"];
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > 50) {
    throw new SerametHttpError(400, "commands must contain between 1 and 50 records");
  }
  const parsedCommands = commands.map(parseCommand).sort((left, right) => {
    return left.clientSequence - right.clientSequence;
  });
  const sequenceOwners = new Map<number, string>();
  if (
    parsedCommands.some((command) => {
      const owner = sequenceOwners.get(command.clientSequence);
      sequenceOwners.set(command.clientSequence, command.id);
      return owner !== undefined && owner !== command.id;
    })
  ) {
    throw new SerametHttpError(400, "Offline command clientSequence values must be unique");
  }
  const results = [];
  let chainedRevision: number | undefined;
  let previousConflict = false;
  for (const command of parsedCommands) {
    assertCommandScope(command, actor);
    await assertOfflinePaymentPolicy(command, env);
    authorizeSerametMutation(actor, command.commandType, actor.tenantId, command.branchId);
    if (previousConflict) {
      results.push({
        id: command.id,
        status: "conflict",
        code: "PREVIOUS_COMMAND_CONFLICT",
        resolution: "MANAGER_REVIEW",
      });
      continue;
    }
    const result = await processCommand(
      command,
      actor,
      env,
      repository,
      chainedRevision ?? command.expectedRevision,
    );
    results.push(result);
    if (result.status === "conflict") {
      previousConflict = true;
    } else if ("revision" in result && typeof result.revision === "number") {
      chainedRevision = result.revision;
    }
  }
  return json({ ok: true, commands: results });
}

async function assertOfflinePaymentPolicy(command: OfflineCommand, env: SerametEnv) {
  if (command.commandType !== "applyConfiguredPayment") return;
  const payload = command.payload as Record<string, unknown>;
  const paymentMethodId =
    typeof payload?.["paymentMethodId"] === "string" ? payload["paymentMethodId"] : "";
  const method = await env
    .SERAMET_DB!.prepare(
      "SELECT category FROM payment_methods WHERE tenant_id = ? AND id = ? AND active = 1",
    )
    .bind(command.tenantId, paymentMethodId)
    .first<{ category: string }>();
  if (method?.category !== "CASH") {
    throw new ServerOperationError(
      "OFFLINE_OPERATION_NOT_ALLOWED",
      409,
      "Only configured cash collection may be synchronized from an offline POS",
    );
  }
}

async function processCommand(
  command: OfflineCommand,
  actor: Awaited<ReturnType<typeof authenticateSerametRequest>>,
  env: SerametEnv,
  repository: TransactionRepository,
  expectedRevision?: number,
) {
  const db = env.SERAMET_DB!;
  const receivedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO offline_commands
        (tenant_id, id, branch_id, device_id, actor_id, command_type, payload_json,
         client_created_at, client_sequence, idempotency_key, sync_status, correlation_id,
         received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCING', ?, ?)
       ON CONFLICT(tenant_id, idempotency_key) DO NOTHING`,
    )
    .bind(
      actor.tenantId,
      command.id,
      command.branchId,
      command.deviceId,
      actor.id,
      command.commandType,
      JSON.stringify(command),
      command.createdAt,
      command.clientSequence,
      command.idempotencyKey,
      command.correlationId,
      receivedAt,
    )
    .run();
  const stored = await db
    .prepare(
      `SELECT sync_status, server_result_json, conflict_code FROM offline_commands
       WHERE tenant_id = ? AND idempotency_key = ?`,
    )
    .bind(actor.tenantId, command.idempotencyKey)
    .first<StoredCommandRow>();
  if (stored?.sync_status === "SYNCED") {
    const result = stored.server_result_json ? JSON.parse(stored.server_result_json) : null;
    return {
      id: command.id,
      status: "duplicate",
      ...(typeof result?.revision === "number" ? { revision: result.revision } : {}),
      result,
    };
  }
  if (stored?.sync_status === "CONFLICT") {
    return { id: command.id, status: "conflict", code: stored.conflict_code };
  }

  try {
    const requestHash = await sha256(
      JSON.stringify({ type: command.commandType, payload: command.payload }),
    );
    const committed = await repository.commitMutation({
      actor,
      action: command.commandType,
      payload: command.payload,
      idempotencyKey: command.idempotencyKey,
      requestHash,
      correlationId: command.correlationId,
      expectedRevision,
      deviceId: command.deviceId,
    });
    const result = {
      revision: committed.revision,
      duplicate: committed.duplicate,
      printPolicy: command.localEffects?.kotPrinted ? "ALREADY_PRINTED_LOCAL" : "SERVER_DISPATCH",
    };
    await db
      .prepare(
        `UPDATE offline_commands SET sync_status = 'SYNCED', server_result_json = ?,
         processed_at = ? WHERE tenant_id = ? AND idempotency_key = ?`,
      )
      .bind(
        JSON.stringify(result),
        new Date().toISOString(),
        actor.tenantId,
        command.idempotencyKey,
      )
      .run();
    return { id: command.id, status: committed.duplicate ? "duplicate" : "accepted", ...result };
  } catch (error) {
    const conflict = error instanceof ServerOperationError && error.code === "CONFLICT";
    await db
      .prepare(
        `UPDATE offline_commands SET sync_status = ?, conflict_code = ?,
         conflict_details_json = ?, processed_at = ?
         WHERE tenant_id = ? AND idempotency_key = ?`,
      )
      .bind(
        conflict ? "CONFLICT" : "FAILED",
        conflict ? "SERVER_STATE_CHANGED" : "COMMAND_FAILED",
        JSON.stringify({ message: error instanceof Error ? error.message : "Command failed" }),
        new Date().toISOString(),
        actor.tenantId,
        command.idempotencyKey,
      )
      .run();
    if (conflict) {
      return {
        id: command.id,
        status: "conflict",
        code: "SERVER_STATE_CHANGED",
        resolution: "MANAGER_REVIEW",
      };
    }
    throw error;
  }
}

function assertCommandScope(
  command: OfflineCommand,
  actor: Awaited<ReturnType<typeof authenticateSerametRequest>>,
) {
  if (
    command.tenantId !== actor.tenantId ||
    command.actorId !== actor.id ||
    command.deviceId !== actor.deviceId
  ) {
    throw new ServerOperationError(
      "TENANT_SCOPE_VIOLATION",
      403,
      "Offline command identity does not match the authenticated session",
    );
  }
  if (!actor.assignedBranchIds.includes(command.branchId)) {
    throw new ServerOperationError(
      "TENANT_SCOPE_VIOLATION",
      403,
      "Offline command branch is not assigned to the authenticated actor",
    );
  }
}

function parseCommand(value: unknown): OfflineCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SerametHttpError(400, "Offline command must be an object");
  }
  const command = value as Partial<OfflineCommand>;
  const strings = [
    command.id,
    command.tenantId,
    command.branchId,
    command.deviceId,
    command.actorId,
    command.commandType,
    command.createdAt,
    command.idempotencyKey,
    command.correlationId,
  ];
  if (strings.some((entry) => typeof entry !== "string" || !entry)) {
    throw new SerametHttpError(400, "Offline command identity fields are incomplete");
  }
  if (!offlineAllowedCommands.has(command.commandType as never)) {
    throw new ServerOperationError(
      "OFFLINE_OPERATION_NOT_ALLOWED",
      409,
      `Operation ${command.commandType} cannot run offline`,
    );
  }
  if (!Number.isSafeInteger(command.clientSequence) || Number(command.clientSequence) <= 0) {
    throw new SerametHttpError(400, "clientSequence must be a positive safe integer");
  }
  if (
    command.expectedRevision !== undefined &&
    (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)
  ) {
    throw new SerametHttpError(400, "expectedRevision must be a non-negative safe integer");
  }
  return command as OfflineCommand;
}

async function readBody(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SerametHttpError(400, "Request body must be an object");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== "commands");
  if (unknown.length) throw new SerametHttpError(400, `Unknown fields: ${unknown.join(", ")}`);
  return record;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
