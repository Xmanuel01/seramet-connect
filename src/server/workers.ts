import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import type { SerametEnv } from "@/lib/seramet-auth";
import type { DurableQueueBatch, DurableQueueMessage } from "@/server/environment";
import { structuredServerLog } from "@/server/logging";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { allPermissionCodes } from "@/platform/permissions";
import { IntelligenceService } from "@/intelligence/intelligence-service";
import { CrmAnalyticsService } from "@/crm/crm-analytics";
import { CrmService } from "@/crm/crm-service";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import { CampaignService } from "@/crm/campaign-service";
import {
  capabilityForChannel,
  getCampaignProviderRegistry,
} from "@/crm/campaign-provider-registry";
import type { CommunicationChannel } from "@/crm/types";
import type { D1PreparedStatement } from "@/server/database/d1";
import { EnterpriseService } from "@/enterprise/enterprise-service";

export type SerametWorkerMessage =
  | {
      kind: "integration-outbox";
      tenantId: string;
      recordId: string;
      correlationId: string;
    }
  | {
      kind: "worker-job";
      tenantId: string;
      jobId: string;
      correlationId: string;
    };

type WorkerJobRow = {
  tenant_id: string;
  id: string;
  branch_id: string | null;
  job_type: string;
  payload_json: string;
  correlation_id: string;
  attempt_count: number;
  max_attempts: number;
};

export async function handleWorkerQueue(
  batch: DurableQueueBatch<SerametWorkerMessage>,
  env: SerametEnv,
) {
  if (!env.SERAMET_DB) throw new Error("Durable worker requires authoritative database");
  await hydrateAuthoritativeConfiguration(env.SERAMET_DB, env);
  for (const message of batch.messages) {
    try {
      await processMessage(message, env);
    } catch (error) {
      structuredServerLog({
        environment: env.SERAMET_ENVIRONMENT ?? "production",
        operation: `worker:${message.body.kind}`,
        result: "failed",
        correlationId: message.body.correlationId,
        tenantId: message.body.tenantId,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      const retry = await recordWorkerFailure(env, message.body, error);
      if (retry) message.retry({ delaySeconds: retryDelay(message.attempts) });
      else message.ack();
    }
  }
}

export async function runGuestLifecycleMaintenance(env: SerametEnv, tenantId: string) {
  const db = env.SERAMET_DB!;
  const stamp = new Date().toISOString();
  const expiredDepositReservations = await db
    .prepare(
      `SELECT r.id,r.branch_id,d.id AS deposit_id
       FROM reservations r
       JOIN reservation_deposits d ON d.tenant_id=r.tenant_id AND d.reservation_id=r.id
       JOIN reservation_policies p ON p.tenant_id=r.tenant_id AND p.branch_id=r.branch_id AND p.active=1
       WHERE r.tenant_id=? AND r.status='PENDING' AND d.status IN ('REQUIRED','PENDING','FAILED')
         AND datetime(r.created_at,'+' || p.hold_minutes || ' minutes')<=?
       ORDER BY r.created_at LIMIT 500`,
    )
    .bind(tenantId, stamp)
    .all<{ id: string; branch_id: string; deposit_id: string }>();
  await db.batch([
    db
      .prepare(
        "UPDATE reservation_holds SET status='EXPIRED',updated_at=? WHERE tenant_id=? AND status='ACTIVE' AND expires_at<=?",
      )
      .bind(stamp, tenantId, stamp),
    db
      .prepare(
        "DELETE FROM reservation_capacity_locks WHERE tenant_id=? AND owner_type='HOLD' AND expires_at IS NOT NULL AND expires_at<=?",
      )
      .bind(tenantId, stamp),
    db
      .prepare(
        "UPDATE guest_sessions SET status='EXPIRED' WHERE tenant_id=? AND status='ACTIVE' AND expires_at<=?",
      )
      .bind(tenantId, stamp),
    db
      .prepare(
        `UPDATE waitlist_entries SET status='EXPIRED',updated_at=?
       WHERE tenant_id=? AND status IN ('WAITING','NOTIFIED') AND expires_at IS NOT NULL AND expires_at<=?`,
      )
      .bind(stamp, tenantId, stamp),
  ]);
  const statements: D1PreparedStatement[] = [];
  for (const reservation of expiredDepositReservations.results ?? []) {
    statements.push(
      db
        .prepare(
          `UPDATE reservations SET status='CANCELLED',cancellation_reason='Reservation deposit window expired',updated_at=?
           WHERE tenant_id=? AND id=? AND status='PENDING'`,
        )
        .bind(stamp, tenantId, reservation.id),
      db
        .prepare(
          `UPDATE reservation_deposits SET status='FAILED',updated_at=?
           WHERE tenant_id=? AND id=? AND status IN ('REQUIRED','PENDING')`,
        )
        .bind(stamp, tenantId, reservation.deposit_id),
      db
        .prepare(
          "DELETE FROM reservation_capacity_locks WHERE tenant_id=? AND owner_type='RESERVATION' AND owner_id=?",
        )
        .bind(tenantId, reservation.id),
      db
        .prepare(
          `INSERT OR IGNORE INTO reservation_events
            (tenant_id,id,branch_id,reservation_id,event_type,actor_id,metadata_json,created_at)
           VALUES (?,?,?,?,'DEPOSIT_HOLD_EXPIRED','system:guest-lifecycle','{}',?)`,
        )
        .bind(
          tenantId,
          `reservation-deposit-expired:${reservation.deposit_id}`,
          reservation.branch_id,
          reservation.id,
          stamp,
        ),
    );
  }
  for (let index = 0; index < statements.length; index += 200) {
    await db.batch(statements.slice(index, index + 200));
  }
}

async function dispatchGuestNotifications(env: SerametEnv, tenantId: string) {
  const db = env.SERAMET_DB!;
  const stamp = new Date().toISOString();
  const reminderStart = new Date(Date.now() + 23 * 3_600_000).toISOString();
  const reminderEnd = new Date(Date.now() + 25 * 3_600_000).toISOString();
  const reservations = await db
    .prepare(
      `SELECT id,branch_id,guest_session_id,customer_id,contact_email,contact_phone,starts_at,status
     FROM reservations WHERE tenant_id=? AND status='CONFIRMED'
       AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
       AND (updated_at>=? OR starts_at BETWEEN ? AND ?)
     ORDER BY starts_at LIMIT 500`,
    )
    .bind(tenantId, new Date(Date.now() - 5 * 60_000).toISOString(), reminderStart, reminderEnd)
    .all<{
      id: string;
      branch_id: string;
      guest_session_id: string | null;
      customer_id: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      starts_at: string;
    }>();
  const inserts = [];
  for (const reservation of reservations.results ?? []) {
    const channel: CommunicationChannel = reservation.contact_email ? "EMAIL" : "SMS";
    if (Date.parse(reservation.starts_at) >= Date.parse(reminderStart)) {
      inserts.push(
        db
          .prepare(
            `INSERT INTO guest_notification_events
          (tenant_id,id,branch_id,guest_session_id,customer_id,purpose,channel,template_key,destination_hash,
           source_type,source_id,status,attempts,idempotency_key,scheduled_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'RESERVATION_REMINDER',?,'reservation-reminder',?,'RESERVATION',?,'QUEUED',0,?,?,?,?)
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
          )
          .bind(
            tenantId,
            crypto.randomUUID(),
            reservation.branch_id,
            reservation.guest_session_id,
            reservation.customer_id,
            channel,
            await sha256(reservation.contact_email ?? reservation.contact_phone ?? ""),
            reservation.id,
            `reservation-reminder:${reservation.id}:${reservation.starts_at}`,
            stamp,
            stamp,
            stamp,
          ),
      );
    }
    inserts.push(
      db
        .prepare(
          `INSERT INTO guest_notification_events
        (tenant_id,id,branch_id,guest_session_id,customer_id,purpose,channel,template_key,destination_hash,
         source_type,source_id,status,attempts,idempotency_key,scheduled_at,created_at,updated_at)
       VALUES (?,?,?,?,?,'RESERVATION_CONFIRMATION',?,'reservation-confirmation',?,'RESERVATION',?,'QUEUED',0,?,?,?,?)
       ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          tenantId,
          crypto.randomUUID(),
          reservation.branch_id,
          reservation.guest_session_id,
          reservation.customer_id,
          channel,
          await sha256(reservation.contact_email ?? reservation.contact_phone ?? ""),
          reservation.id,
          `reservation-confirmation:${reservation.id}`,
          stamp,
          stamp,
          stamp,
        ),
    );
  }
  if (inserts.length) {
    for (let index = 0; index < inserts.length; index += 200)
      await db.batch(inserts.slice(index, index + 200));
  }

  const configs = await db
    .prepare(
      `SELECT id,provider_key,capabilities_json,batch_size,max_attempts
     FROM communication_provider_configs WHERE tenant_id=? AND status='CONFIGURED' ORDER BY id`,
    )
    .bind(tenantId)
    .all<{
      id: string;
      provider_key: string;
      capabilities_json: string;
      batch_size: number;
      max_attempts: number;
    }>();
  const configRows = configs.results ?? [];
  const due = await db
    .prepare(
      `SELECT n.id,n.channel,n.purpose,n.source_id,n.idempotency_key,n.attempts,r.guest_name,
            r.contact_email,r.contact_phone,r.starts_at,p.public_name
     FROM guest_notification_events n
     JOIN reservations r ON r.tenant_id=n.tenant_id AND r.id=n.source_id
     JOIN public_branch_profiles p ON p.tenant_id=n.tenant_id AND p.branch_id=n.branch_id
     WHERE n.tenant_id=? AND n.status IN ('QUEUED','FAILED') AND n.scheduled_at<=?
     ORDER BY n.scheduled_at LIMIT 200`,
    )
    .bind(tenantId, stamp)
    .all<{
      id: string;
      channel: CommunicationChannel;
      purpose: string;
      source_id: string;
      idempotency_key: string;
      attempts: number;
      guest_name: string;
      contact_email: string | null;
      contact_phone: string | null;
      starts_at: string;
      public_name: string;
    }>();
  for (const notification of due.results ?? []) {
    const capability = capabilityForChannel(notification.channel);
    const config = configRows.find((candidate) =>
      parsePayload<string[]>(candidate.capabilities_json, []).includes(capability),
    );
    if (!config) continue;
    let adapter;
    try {
      adapter = getCampaignProviderRegistry().get(config.provider_key);
    } catch {
      continue;
    }
    if (!adapter.capabilities.has(capability)) continue;
    const destination =
      notification.channel === "EMAIL" ? notification.contact_email : notification.contact_phone;
    if (!destination) continue;
    const result = await adapter.send({
      tenantId,
      deliveryId: notification.id,
      channel: notification.channel,
      destination,
      subject:
        notification.purpose === "RESERVATION_REMINDER"
          ? "Reservation reminder"
          : "Reservation confirmation",
      body: `${notification.public_name}: ${notification.guest_name}, your reservation is scheduled for ${new Date(notification.starts_at).toISOString()}.`,
      idempotencyKey: notification.idempotency_key,
    });
    const nextAttempts = notification.attempts + 1;
    const dead = result.status !== "SENT" && nextAttempts >= config.max_attempts;
    await db
      .prepare(
        `UPDATE guest_notification_events SET status=?,provider_reference=?,attempts=?,last_error=?,
         sent_at=CASE WHEN ?='SENT' THEN ? ELSE sent_at END,updated_at=?
       WHERE tenant_id=? AND id=? AND status IN ('QUEUED','FAILED')`,
      )
      .bind(
        result.status === "SENT" ? "SENT" : dead ? "DEAD_LETTER" : "FAILED",
        result.providerMessageId ?? null,
        nextAttempts,
        result.errorCode ?? null,
        result.status,
        stamp,
        stamp,
        tenantId,
        notification.id,
      )
      .run();
  }
}

export async function scheduleDurableWork(env: SerametEnv, at = new Date()) {
  if (!env.SERAMET_DB || !env.SERAMET_WORK_QUEUE) {
    throw new Error("Scheduled work requires authoritative database and durable queue");
  }
  await hydrateAuthoritativeConfiguration(env.SERAMET_DB, env);
  const tenants = await env.SERAMET_DB.prepare("SELECT id FROM tenants WHERE active = 1").all<{
    id: string;
  }>();
  const minute = at.toISOString().slice(0, 16);
  const messages: Array<{ body: SerametWorkerMessage; contentType: "json" }> = [];
  for (const tenant of tenants.results ?? []) {
    const jobs = [
      { type: "SCHEDULED_ORDER_RELEASE", interval: "minute" },
      { type: "INTEGRATION_OUTBOX_RECOVERY", interval: "minute" },
      { type: "EOD_AGGREGATION", interval: at.getUTCMinutes() === 5 ? "hour" : null },
      {
        type: "INVENTORY_INTELLIGENCE_RECALCULATION",
        interval: at.getUTCMinutes() === 10 ? "hour" : null,
      },
      {
        type: "MANAGEMENT_INTELLIGENCE_RECALCULATION",
        interval: at.getUTCMinutes() === 20 ? "hour" : null,
      },
      {
        type: "SETUP_READINESS_RECALCULATION",
        interval: at.getUTCMinutes() === 30 ? "hour" : null,
      },
      {
        type: "INTELLIGENCE_SCHEDULED_BRIEFS",
        interval: at.getUTCMinutes() === 40 ? "hour" : null,
      },
      {
        type: "INTELLIGENCE_RETENTION",
        interval: minute.endsWith("00:45") ? "day" : null,
      },
      {
        type: "CRM_METRICS_RECALCULATION",
        interval: at.getUTCMinutes() === 25 ? "hour" : null,
      },
      { type: "CRM_CAMPAIGN_DISPATCH", interval: "minute" },
      { type: "GUEST_LIFECYCLE_MAINTENANCE", interval: "minute" },
      { type: "GUEST_NOTIFICATION_DISPATCH", interval: "minute" },
      {
        type: "ENTERPRISE_READINESS_RECALCULATION",
        interval: at.getUTCMinutes() === 55 ? "hour" : null,
      },
      {
        type: "ENTERPRISE_POLICY_MAINTENANCE",
        interval: at.getUTCMinutes() === 50 ? "hour" : null,
      },
      {
        type: "ENTERPRISE_FRANCHISE_COMPLIANCE_RECALCULATION",
        interval: at.getUTCMinutes() === 52 ? "hour" : null,
      },
      {
        type: "CRM_LOYALTY_MAINTENANCE",
        interval: minute.endsWith("00:35") ? "day" : null,
      },
      {
        type: "CRM_STORED_VALUE_EXPIRY",
        interval: minute.endsWith("00:50") ? "day" : null,
      },
      { type: "INVENTORY_EXPIRY_ALERTS", interval: minute.endsWith("00:15") ? "day" : null },
    ].filter((job) => job.interval);
    for (const job of jobs) {
      const idempotencyKey = `${job.type}:${tenant.id}:${job.interval === "hour" ? minute.slice(0, 13) : minute}`;
      const jobId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const stamp = at.toISOString();
      const result = await env.SERAMET_DB.prepare(
        `INSERT INTO worker_jobs
            (tenant_id, id, job_type, payload_json, idempotency_key, correlation_id,
             status, attempt_count, max_attempts, scheduled_at, created_at, updated_at)
           VALUES (?, ?, ?, '{}', ?, ?, 'PENDING', 0, 8, ?, ?, ?)
           ON CONFLICT(tenant_id, idempotency_key) DO NOTHING`,
      )
        .bind(tenant.id, jobId, job.type, idempotencyKey, correlationId, stamp, stamp, stamp)
        .run();
      if ((result.meta?.changes ?? 0) > 0) {
        messages.push({
          body: { kind: "worker-job", tenantId: tenant.id, jobId, correlationId },
          contentType: "json",
        });
      }
    }
  }
  const pending = await env.SERAMET_DB.prepare(
    `SELECT tenant_id,id,correlation_id FROM worker_jobs
     WHERE status IN ('PENDING','RETRY_PENDING') AND scheduled_at<=?
     ORDER BY scheduled_at LIMIT 500`,
  )
    .bind(at.toISOString())
    .all<{ tenant_id: string; id: string; correlation_id: string }>();
  const known = new Set(
    messages.map(
      (message) =>
        `${message.body.tenantId}:${message.body.kind === "worker-job" ? message.body.jobId : message.body.recordId}`,
    ),
  );
  for (const row of pending.results ?? []) {
    const key = `${row.tenant_id}:${row.id}`;
    if (known.has(key)) continue;
    messages.push({
      body: {
        kind: "worker-job",
        tenantId: row.tenant_id,
        jobId: row.id,
        correlationId: row.correlation_id,
      },
      contentType: "json",
    });
    known.add(key);
  }
  if (messages.length) {
    if (env.SERAMET_WORK_QUEUE.sendBatch) await env.SERAMET_WORK_QUEUE.sendBatch(messages);
    else for (const message of messages) await env.SERAMET_WORK_QUEUE.send(message.body, message);
  }
  return { queued: messages.length };
}

async function processMessage(message: DurableQueueMessage<SerametWorkerMessage>, env: SerametEnv) {
  const started = Date.now();
  const body = message.body;
  if (body.kind === "integration-outbox") {
    const claimed = await claimOutbox(env, body);
    if (claimed === "done") return message.ack();
    if (!claimed) return message.retry({ delaySeconds: 30 });
    const record = await createIntegrationRuntime(env).processOutboxRecord(
      body.tenantId,
      body.recordId,
    );
    if (record.status === "PROCESSED" || record.status === "DEAD_LETTER") message.ack();
    else message.retry({ delaySeconds: retryDelay(message.attempts) });
  } else {
    const job = await claimWorkerJob(env, body);
    if (job === "done") return message.ack();
    if (!job) return message.retry({ delaySeconds: 30 });
    await executeWorkerJob(env, job);
    await completeWorkerJob(env, job, Date.now() - started);
    message.ack();
  }
  structuredServerLog({
    environment: env.SERAMET_ENVIRONMENT ?? "production",
    operation: `worker:${body.kind}`,
    result: "succeeded",
    correlationId: body.correlationId,
    tenantId: body.tenantId,
    durationMs: Date.now() - started,
  });
}

async function claimOutbox(
  env: SerametEnv,
  body: Extract<SerametWorkerMessage, { kind: "integration-outbox" }>,
) {
  const db = env.SERAMET_DB!;
  const existing = await db
    .prepare("SELECT status FROM integration_outbox WHERE tenant_id = ? AND id = ?")
    .bind(body.tenantId, body.recordId)
    .first<{ status: string }>();
  if (!existing || ["SUCCEEDED", "DEAD_LETTER"].includes(existing.status)) return "done" as const;
  const now = new Date();
  const result = await db
    .prepare(
      `UPDATE integration_outbox
       SET status = 'CLAIMED', lease_owner = ?, lease_expires_at = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?
         AND status IN ('PENDING', 'RETRY_PENDING', 'CLAIMED')
         AND next_attempt_at <= ?
         AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
    )
    .bind(
      `queue:${body.correlationId}`,
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
      body.tenantId,
      body.recordId,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function claimWorkerJob(
  env: SerametEnv,
  body: Extract<SerametWorkerMessage, { kind: "worker-job" }>,
) {
  const db = env.SERAMET_DB!;
  const current = await db
    .prepare("SELECT status FROM worker_jobs WHERE tenant_id = ? AND id = ?")
    .bind(body.tenantId, body.jobId)
    .first<{ status: string }>();
  if (!current || ["SUCCEEDED", "DEAD_LETTER"].includes(current.status)) return "done" as const;
  const now = new Date();
  const claimed = await db
    .prepare(
      `UPDATE worker_jobs
       SET status = 'RUNNING', lease_owner = ?, lease_expires_at = ?, started_at = ?,
           attempt_count = attempt_count + 1, updated_at = ?
       WHERE tenant_id = ? AND id = ?
         AND status IN ('PENDING', 'RETRY_PENDING', 'CLAIMED', 'RUNNING')
         AND scheduled_at <= ?
         AND (lease_expires_at IS NULL OR lease_expires_at < ?)
       RETURNING tenant_id, id, branch_id, job_type, payload_json, correlation_id,
                 attempt_count, max_attempts`,
    )
    .bind(
      `queue:${body.correlationId}`,
      new Date(now.getTime() + 120_000).toISOString(),
      now.toISOString(),
      now.toISOString(),
      body.tenantId,
      body.jobId,
      now.toISOString(),
      now.toISOString(),
    )
    .first<WorkerJobRow>();
  return claimed;
}

async function executeWorkerJob(env: SerametEnv, job: WorkerJobRow) {
  const runtime = createIntegrationRuntime(env);
  switch (job.job_type) {
    case "SCHEDULED_ORDER_RELEASE":
      await runtime.releaseDueScheduledOrders(job.tenant_id);
      return;
    case "INTEGRATION_OUTBOX_RECOVERY":
      await requeueDueOutbox(env, job.tenant_id);
      return;
    case "EOD_AGGREGATION":
      await aggregateEod(env, job.tenant_id);
      return;
    case "INVENTORY_INTELLIGENCE_RECALCULATION":
      await recalculateInventoryIntelligence(env, job);
      return;
    case "INVENTORY_EXPIRY_ALERTS":
      await refreshInventoryExpiryAlerts(env, job.tenant_id);
      return;
    case "MANAGEMENT_INTELLIGENCE_RECALCULATION":
      await recalculateManagementIntelligence(env, job);
      return;
    case "SETUP_READINESS_RECALCULATION":
      await recalculateSetupReadiness(env, job);
      return;
    case "INTELLIGENCE_BRIEF_GENERATION":
      await generateIntelligenceBrief(env, job);
      return;
    case "INTELLIGENCE_SCHEDULED_BRIEFS":
      await refreshScheduledIntelligenceBriefs(env, job);
      return;
    case "INTELLIGENCE_RETENTION":
      await expireIntelligenceData(env, job);
      return;
    case "CRM_METRICS_RECALCULATION":
      await recalculateCrmMetrics(env, job);
      return;
    case "CRM_CAMPAIGN_DISPATCH":
      await dispatchCrmCampaigns(env, job);
      return;
    case "CRM_LOYALTY_MAINTENANCE":
      await maintainCrmLoyalty(env, job);
      return;
    case "CRM_STORED_VALUE_EXPIRY":
      await expireCrmStoredValue(env, job);
      return;
    case "CRM_PRIVACY_EXPORT":
      await generateCrmPrivacyExport(env, job);
      return;
    case "CRM_CUSTOMER_IMPORT_COMMIT":
      await commitCrmCustomerImport(env, job);
      return;
    case "GUEST_LIFECYCLE_MAINTENANCE":
      await runGuestLifecycleMaintenance(env, job.tenant_id);
      return;
    case "GUEST_NOTIFICATION_DISPATCH":
      await dispatchGuestNotifications(env, job.tenant_id);
      return;
    case "SUPPORT_DIAGNOSTIC_EXPORT":
      await generateSupportDiagnostics(env, job);
      return;
    case "TENANT_DATA_EXPORT":
      await generateTenantDataExport(env, job);
      return;
    case "DEMO_TENANT_RESET":
      await resetDemoTenant(env, job);
      return;
    case "SETUP_IMPORT_COMMIT":
      await commitSetupImport(env, job);
      return;
    case "ENTERPRISE_ROLLOUT_EXECUTION":
      await executeEnterpriseRollout(env, job);
      return;
    case "ENTERPRISE_FRANCHISE_FEE_RECALCULATION":
      await recalculateEnterpriseFranchiseFee(env, job);
      return;
    case "ENTERPRISE_READINESS_RECALCULATION":
      await recalculateEnterpriseReadiness(env, job);
      return;
    case "ENTERPRISE_POLICY_MAINTENANCE":
      await maintainEnterprisePolicies(env, job);
      return;
    case "ENTERPRISE_FRANCHISE_COMPLIANCE_RECALCULATION":
      await recalculateEnterpriseFranchiseCompliance(env, job);
      return;
    case "ENTERPRISE_EXPORT_GENERATION":
      await generateEnterpriseExport(env, job);
      return;
    default:
      throw new Error(`No live worker implementation exists for ${job.job_type}`);
  }
}

export async function enqueueInventoryRecalculation(
  env: SerametEnv,
  input: { tenantId: string; branchId?: string; idempotencyKey: string; correlationId?: string },
) {
  if (!env.SERAMET_DB || !env.SERAMET_WORK_QUEUE) {
    throw new Error("Inventory recalculation requires authoritative database and durable queue");
  }
  const jobId = crypto.randomUUID();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const stamp = new Date().toISOString();
  const result = await env.SERAMET_DB.prepare(
    `INSERT INTO worker_jobs
      (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,
       status,attempt_count,max_attempts,scheduled_at,created_at,updated_at)
     VALUES (?,?,?,'INVENTORY_INTELLIGENCE_RECALCULATION',?,?,?,?,0,8,?,?,?)
     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
  )
    .bind(
      input.tenantId,
      jobId,
      input.branchId ?? null,
      JSON.stringify({ branchId: input.branchId ?? null }),
      input.idempotencyKey,
      correlationId,
      "PENDING",
      stamp,
      stamp,
      stamp,
    )
    .run();
  if ((result.meta?.changes ?? 0) > 0) {
    await env.SERAMET_WORK_QUEUE.send(
      { kind: "worker-job", tenantId: input.tenantId, jobId, correlationId },
      { contentType: "json" },
    );
  }
  return { jobId, correlationId, duplicate: (result.meta?.changes ?? 0) === 0 };
}

export async function enqueueManagementRecalculation(
  env: SerametEnv,
  input: {
    tenantId: string;
    branchId?: string;
    businessDate?: string;
    idempotencyKey: string;
    correlationId?: string;
  },
) {
  if (!env.SERAMET_DB || !env.SERAMET_WORK_QUEUE) {
    throw new Error("Management recalculation requires authoritative database and durable queue");
  }
  const jobId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const stamp = new Date().toISOString();
  const payload = JSON.stringify({
    branchId: input.branchId ?? null,
    businessDate: input.businessDate ?? null,
  });
  const [jobResult] = await env.SERAMET_DB.batch([
    env.SERAMET_DB.prepare(
      `INSERT INTO worker_jobs
        (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,
         status,attempt_count,max_attempts,scheduled_at,created_at,updated_at)
       VALUES (?,?,?,'MANAGEMENT_INTELLIGENCE_RECALCULATION',?,?,?,?,0,8,?,?,?)
       ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
    ).bind(
      input.tenantId,
      jobId,
      input.branchId ?? null,
      payload,
      input.idempotencyKey,
      correlationId,
      "PENDING",
      stamp,
      stamp,
      stamp,
    ),
    env.SERAMET_DB.prepare(
      `INSERT INTO management_recalculation_events
        (tenant_id,id,branch_id,event_type,entity_type,entity_id,idempotency_key,status,
         correlation_id,payload_json,created_at)
       VALUES (?,?,?,'RECALCULATION_REQUESTED','WORKER_JOB',?,?, 'PENDING',?,?,?)
       ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
    ).bind(
      input.tenantId,
      eventId,
      input.branchId ?? null,
      jobId,
      input.idempotencyKey,
      correlationId,
      payload,
      stamp,
    ),
  ]);
  if (!jobResult) throw new Error("Management worker job insert returned no result");
  const duplicate = (jobResult.meta?.changes ?? 0) === 0;
  if (!duplicate) {
    await env.SERAMET_WORK_QUEUE.send(
      { kind: "worker-job", tenantId: input.tenantId, jobId, correlationId },
      { contentType: "json" },
    );
  }
  return { jobId, correlationId, duplicate };
}

export async function enqueueIntelligenceBrief(
  env: SerametEnv,
  input: {
    tenantId: string;
    briefId: string;
    branchId?: string;
    idempotencyKey: string;
    correlationId?: string;
  },
) {
  if (!env.SERAMET_DB || !env.SERAMET_WORK_QUEUE) {
    throw new Error("Intelligence brief generation requires authoritative database and queue");
  }
  const jobId = crypto.randomUUID();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const stamp = new Date().toISOString();
  const result = await env.SERAMET_DB.prepare(
    `INSERT INTO worker_jobs
      (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,
       status,attempt_count,max_attempts,scheduled_at,created_at,updated_at)
     VALUES (?,?,?,'INTELLIGENCE_BRIEF_GENERATION',?,?,?,?,0,8,?,?,?)
     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
  )
    .bind(
      input.tenantId,
      jobId,
      input.branchId ?? null,
      JSON.stringify({ briefId: input.briefId }),
      input.idempotencyKey,
      correlationId,
      "PENDING",
      stamp,
      stamp,
      stamp,
    )
    .run();
  const duplicate = (result.meta?.changes ?? 0) === 0;
  if (!duplicate) {
    await env.SERAMET_WORK_QUEUE.send(
      { kind: "worker-job", tenantId: input.tenantId, jobId, correlationId },
      { contentType: "json" },
    );
  }
  return { jobId, correlationId, duplicate };
}

const crmWorkerTypes = new Set([
  "CRM_METRICS_RECALCULATION",
  "CRM_CAMPAIGN_DISPATCH",
  "CRM_LOYALTY_MAINTENANCE",
  "CRM_STORED_VALUE_EXPIRY",
  "CRM_PRIVACY_EXPORT",
  "CRM_CUSTOMER_IMPORT_COMMIT",
]);

const enterpriseWorkerTypes = new Set([
  "ENTERPRISE_ROLLOUT_EXECUTION",
  "ENTERPRISE_FRANCHISE_FEE_RECALCULATION",
  "ENTERPRISE_READINESS_RECALCULATION",
  "ENTERPRISE_POLICY_MAINTENANCE",
  "ENTERPRISE_FRANCHISE_COMPLIANCE_RECALCULATION",
  "ENTERPRISE_EXPORT_GENERATION",
]);

export async function enqueueEnterpriseWork(
  env: SerametEnv,
  input: {
    tenantId: string;
    jobType: string;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
    correlationId?: string;
    scheduledAt?: string;
  },
) {
  if (!enterpriseWorkerTypes.has(input.jobType))
    throw new Error("Enterprise worker type is not allowlisted");
  if (!env.SERAMET_DB || !env.SERAMET_WORK_QUEUE)
    throw new Error("Enterprise work requires authoritative database and durable queue");
  const jobId = crypto.randomUUID();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const stamp = new Date().toISOString();
  const result = await env.SERAMET_DB.prepare(
    `INSERT INTO worker_jobs
      (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,
       attempt_count,max_attempts,scheduled_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'PENDING',0,8,?,?,?)
     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
  )
    .bind(
      input.tenantId,
      jobId,
      input.jobType,
      JSON.stringify(input.payload ?? {}),
      input.idempotencyKey,
      correlationId,
      input.scheduledAt ?? stamp,
      stamp,
      stamp,
    )
    .run();
  const duplicate = (result.meta?.changes ?? 0) === 0;
  if (!duplicate) {
    await env.SERAMET_WORK_QUEUE.send(
      { kind: "worker-job", tenantId: input.tenantId, jobId, correlationId },
      { contentType: "json" },
    );
  }
  return { jobId, correlationId, duplicate };
}

export async function enqueueCrmWork(
  env: SerametEnv,
  input: {
    tenantId: string;
    branchId?: string;
    jobType: string;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
    correlationId?: string;
    scheduledAt?: string;
  },
) {
  if (!crmWorkerTypes.has(input.jobType)) throw new Error("CRM worker type is not allowlisted");
  if (!env.SERAMET_DB || !env.SERAMET_WORK_QUEUE) {
    throw new Error("CRM work requires authoritative database and durable queue");
  }
  const jobId = crypto.randomUUID();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const stamp = new Date().toISOString();
  const scheduledAt = input.scheduledAt ?? stamp;
  const result = await env.SERAMET_DB.prepare(
    `INSERT INTO worker_jobs
      (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,
       status,attempt_count,max_attempts,scheduled_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'PENDING',0,8,?,?,?)
     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
  )
    .bind(
      input.tenantId,
      jobId,
      input.branchId ?? null,
      input.jobType,
      JSON.stringify(input.payload ?? {}),
      input.idempotencyKey,
      correlationId,
      scheduledAt,
      stamp,
      stamp,
    )
    .run();
  const duplicate = (result.meta?.changes ?? 0) === 0;
  if (!duplicate) {
    await env.SERAMET_WORK_QUEUE.send(
      { kind: "worker-job", tenantId: input.tenantId, jobId, correlationId },
      { contentType: "json" },
    );
  }
  return { jobId, correlationId, duplicate };
}

async function recalculateInventoryIntelligence(env: SerametEnv, job: WorkerJobRow) {
  const payload = JSON.parse(job.payload_json || "{}") as { branchId?: string | null };
  const actor = systemInventoryActor(job.tenant_id, payload.branchId ?? job.branch_id ?? undefined);
  const result = await new InventoryIntelligenceService(env.SERAMET_DB!, actor).recalculateTenant(
    payload.branchId ?? job.branch_id ?? undefined,
  );
  await queueInventoryAvailabilityChanges(env, job.tenant_id, payload.branchId ?? job.branch_id);
  await enqueueManagementRecalculation(env, {
    tenantId: job.tenant_id,
    ...((payload.branchId ?? job.branch_id)
      ? { branchId: String(payload.branchId ?? job.branch_id) }
      : {}),
    idempotencyKey: `inventory-management:${job.tenant_id}:${job.id}`,
    correlationId: job.correlation_id,
  });
  const stamp = new Date().toISOString();
  await env
    .SERAMET_DB!.prepare(
      `UPDATE inventory_recalculation_events SET status='PROCESSED',processed_at=?
     WHERE tenant_id=? AND status IN ('PENDING','CLAIMED')
       AND (? IS NULL OR branch_id=? OR branch_id IS NULL)`,
    )
    .bind(stamp, job.tenant_id, payload.branchId ?? null, payload.branchId ?? null)
    .run();
  return result;
}

async function recalculateManagementIntelligence(env: SerametEnv, job: WorkerJobRow) {
  const payload = JSON.parse(job.payload_json || "{}") as {
    branchId?: string | null;
    businessDate?: string | null;
  };
  const branchId = payload.branchId ?? job.branch_id ?? undefined;
  const actor = systemInventoryActor(job.tenant_id, branchId);
  return new ManagementIntelligenceService(env.SERAMET_DB!, actor).recalculateTenant(
    branchId,
    payload.businessDate ?? undefined,
  );
}

async function recalculateSetupReadiness(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ branchId?: string | null; reason?: string }>(job.payload_json);
  const branchId = payload.branchId ?? job.branch_id ?? undefined;
  const service = new OnboardingService(
    env.SERAMET_DB!,
    systemSetupActor(job.tenant_id, branchId),
    env,
  );
  const result = await service.recalculateReadiness(branchId, true);
  const stamp = new Date().toISOString();
  await env
    .SERAMET_DB!.prepare(
      `UPDATE setup_recalculation_events SET status='COMPLETED',processed_at=?
     WHERE tenant_id=? AND status IN ('PENDING','PROCESSING')
       AND (? IS NULL OR branch_id=? OR branch_id IS NULL)`,
    )
    .bind(stamp, job.tenant_id, branchId ?? null, branchId ?? null)
    .run();
  return result;
}

async function generateIntelligenceBrief(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ briefId?: string }>(job.payload_json);
  if (!payload.briefId) throw new Error("Intelligence brief job has no briefId");
  const actor = await systemIntelligenceActor(env, job.tenant_id, job.branch_id ?? undefined);
  return new IntelligenceService(env.SERAMET_DB!, actor, env).generateBrief(payload.briefId);
}

async function refreshScheduledIntelligenceBriefs(env: SerametEnv, job: WorkerJobRow) {
  const config = await env
    .SERAMET_DB!.prepare(
      `SELECT allowed_features_json FROM intelligence_provider_configs
       WHERE tenant_id=? AND enabled=1 AND status IN ('CONFIGURED','DEGRADED')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(job.tenant_id)
    .first<{ allowed_features_json: string }>();
  if (!config) return { scheduled: 0 };
  const enabled = new Set(parsePayload<string[]>(config.allowed_features_json, []));
  const scheduleEnabled = ["SCHEDULED_MORNING", "SCHEDULED_EOD", "SCHEDULED_OWNER"].some((key) =>
    enabled.has(key),
  );
  if (!scheduleEnabled) return { scheduled: 0 };
  const actor = await systemIntelligenceActor(env, job.tenant_id);
  const service = new IntelligenceService(env.SERAMET_DB!, actor, env);
  const branches = await env
    .SERAMET_DB!.prepare(
      `SELECT id,timezone,business_day_cutoff_minutes FROM branches
       WHERE tenant_id=? AND active=1 ORDER BY id`,
    )
    .bind(job.tenant_id)
    .all<{ id: string; timezone: string; business_day_cutoff_minutes: number }>();
  let scheduled = 0;
  for (const branch of branches.results ?? []) {
    const localHour = localHourInTimezone(new Date(), branch.timezone);
    const candidates: Array<"MORNING" | "EOD"> = [];
    if (enabled.has("SCHEDULED_MORNING") && localHour === 7) candidates.push("MORNING");
    if (
      enabled.has("SCHEDULED_EOD") &&
      localHour === Math.floor(branch.business_day_cutoff_minutes / 60)
    ) {
      candidates.push("EOD");
    }
    for (const briefType of candidates) {
      const brief = await service.prepareBrief({ briefType, branchId: branch.id });
      if (!brief.id) continue;
      await enqueueIntelligenceBrief(env, {
        tenantId: job.tenant_id,
        briefId: String(brief.id),
        branchId: branch.id,
        idempotencyKey: `intelligence-brief:${String(brief.id)}`,
        correlationId: String(brief.correlation_id),
      });
      scheduled += brief.duplicate ? 0 : 1;
    }
  }
  if (enabled.has("SCHEDULED_OWNER") && branches.results?.[0]) {
    const branch = branches.results[0];
    if (localHourInTimezone(new Date(), branch.timezone) === 8) {
      const brief = await service.prepareBrief({ briefType: "OWNER" });
      if (brief.id) {
        await enqueueIntelligenceBrief(env, {
          tenantId: job.tenant_id,
          briefId: String(brief.id),
          idempotencyKey: `intelligence-brief:${String(brief.id)}`,
          correlationId: String(brief.correlation_id),
        });
        scheduled += brief.duplicate ? 0 : 1;
      }
    }
  }
  return { scheduled };
}

async function expireIntelligenceData(env: SerametEnv, job: WorkerJobRow) {
  const actor = await systemIntelligenceActor(env, job.tenant_id);
  return new IntelligenceService(env.SERAMET_DB!, actor, env).expireRetainedData();
}

async function generateSupportDiagnostics(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ exportId?: string }>(job.payload_json);
  if (!payload.exportId) throw new Error("Diagnostic export job has no exportId");
  const claimed = await env
    .SERAMET_DB!.prepare(
      `UPDATE support_diagnostic_exports SET status='RUNNING'
     WHERE tenant_id=? AND id=? AND status='PENDING'`,
    )
    .bind(job.tenant_id, payload.exportId)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    const existing = await env
      .SERAMET_DB!.prepare(
        "SELECT status FROM support_diagnostic_exports WHERE tenant_id=? AND id=?",
      )
      .bind(job.tenant_id, payload.exportId)
      .first<{ status: string }>();
    if (existing?.status === "READY") return;
    throw new Error("Diagnostic export cannot be claimed");
  }
  const service = new OnboardingService(env.SERAMET_DB!, systemSetupActor(job.tenant_id), env);
  const diagnostics = redactSensitive(await service.diagnostics());
  const stamp = new Date().toISOString();
  await env
    .SERAMET_DB!.prepare(
      `UPDATE support_diagnostic_exports SET status='READY',redacted_payload_json=?,completed_at=?,expires_at=?
     WHERE tenant_id=? AND id=? AND status='RUNNING'`,
    )
    .bind(
      JSON.stringify(diagnostics),
      stamp,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      job.tenant_id,
      payload.exportId,
    )
    .run();
}

const exportSpecifications: Record<
  string,
  { table: string; orderColumn: string; dateColumn?: string }
> = {
  menu: { table: "menu_catalog_items", orderColumn: "updated_at", dateColumn: "updated_at" },
  inventory: { table: "inventory_items", orderColumn: "updated_at", dateColumn: "updated_at" },
  suppliers: { table: "suppliers", orderColumn: "updated_at", dateColumn: "updated_at" },
  customers: { table: "customers", orderColumn: "updated_at", dateColumn: "updated_at" },
  staff: { table: "employees", orderColumn: "updated_at", dateColumn: "updated_at" },
  orders: { table: "orders", orderColumn: "created_at", dateColumn: "created_at" },
  invoices: { table: "invoices", orderColumn: "created_at", dateColumn: "created_at" },
  payments: {
    table: "payment_transactions",
    orderColumn: "occurred_at",
    dateColumn: "occurred_at",
  },
  journals: { table: "journal_entries", orderColumn: "created_at", dateColumn: "created_at" },
  audit: { table: "audit_events", orderColumn: "created_at", dateColumn: "created_at" },
  historicalSales: {
    table: "historical_sales_records",
    orderColumn: "imported_at",
    dateColumn: "business_date",
  },
};

async function generateTenantDataExport(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ exportId?: string }>(job.payload_json);
  if (!payload.exportId) throw new Error("Tenant export job has no exportId");
  const exportJob = await env
    .SERAMET_DB!.prepare(
      `UPDATE tenant_data_export_jobs SET status='RUNNING'
     WHERE tenant_id=? AND id=? AND status='PENDING'
     RETURNING entity_types_json,period_start,period_end,row_limit`,
    )
    .bind(job.tenant_id, payload.exportId)
    .first<{
      entity_types_json: string;
      period_start: string | null;
      period_end: string | null;
      row_limit: number;
    }>();
  if (!exportJob) {
    const existing = await env
      .SERAMET_DB!.prepare("SELECT status FROM tenant_data_export_jobs WHERE tenant_id=? AND id=?")
      .bind(job.tenant_id, payload.exportId)
      .first<{ status: string }>();
    if (existing?.status === "READY") return;
    throw new Error("Tenant export cannot be claimed");
  }
  const entityTypes = parsePayload<string[]>(exportJob.entity_types_json, []);
  const result: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  let remaining = exportJob.row_limit;
  for (const entityType of entityTypes) {
    const specification = exportSpecifications[entityType];
    if (!specification || remaining <= 0) continue;
    const dateClauses = specification.dateColumn
      ? `${exportJob.period_start ? ` AND ${specification.dateColumn}>=?` : ""}${exportJob.period_end ? ` AND ${specification.dateColumn}<?` : ""}`
      : "";
    const values: unknown[] = [job.tenant_id];
    if (exportJob.period_start) values.push(exportJob.period_start);
    if (exportJob.period_end) values.push(nextDate(exportJob.period_end));
    values.push(remaining);
    const rows = await env
      .SERAMET_DB!.prepare(
        `SELECT * FROM ${specification.table} WHERE tenant_id=?${dateClauses}
       ORDER BY ${specification.orderColumn} LIMIT ?`,
      )
      .bind(...values)
      .all<Record<string, unknown>>();
    const safeRows = (rows.results ?? []).map((row) => redactSensitive(row));
    result[entityType] = safeRows;
    counts[entityType] = safeRows.length;
    remaining -= safeRows.length;
  }
  const stamp = new Date().toISOString();
  const exportPayload = {
    tenantId: job.tenant_id,
    generatedAt: stamp,
    periodStart: exportJob.period_start,
    periodEnd: exportJob.period_end,
    entities: result,
  };
  const manifest = {
    counts,
    requestedLimit: exportJob.row_limit,
    exportedRows: Object.values(counts).reduce((sum, value) => sum + value, 0),
    truncated: remaining === 0,
    checksum: await sha256(JSON.stringify(exportPayload)),
    excluded: ["provider secrets", "password material", "sessions", "tokens", "card data"],
  };
  await env.SERAMET_DB!.batch([
    env
      .SERAMET_DB!.prepare(
        `INSERT INTO authoritative_records
        (tenant_id,entity_type,entity_id,status,payload_json,version,created_at,updated_at)
       VALUES (?,'setup:tenant-data-export',?,'READY',?,1,?,?)
       ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET
         status='READY',payload_json=excluded.payload_json,version=authoritative_records.version+1,
         updated_at=excluded.updated_at`,
      )
      .bind(job.tenant_id, payload.exportId, JSON.stringify(exportPayload), stamp, stamp),
    env
      .SERAMET_DB!.prepare(
        `UPDATE tenant_data_export_jobs SET status='READY',result_reference=?,manifest_json=?,
         completed_at=?,expires_at=? WHERE tenant_id=? AND id=? AND status='RUNNING'`,
      )
      .bind(
        `authoritative://setup:tenant-data-export/${payload.exportId}`,
        JSON.stringify(manifest),
        stamp,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        job.tenant_id,
        payload.exportId,
      ),
  ]);
}

async function resetDemoTenant(env: SerametEnv, job: WorkerJobRow) {
  const runtime = env.SERAMET_ENVIRONMENT ?? "production";
  if (!["development", "test"].includes(runtime)) {
    throw new Error("Demo reset is blocked outside development and test");
  }
  const profile = await env
    .SERAMET_DB!.prepare(
      "SELECT demo_mode,demo_reset_allowed FROM tenant_onboarding_profiles WHERE tenant_id=?",
    )
    .bind(job.tenant_id)
    .first<{ demo_mode: number; demo_reset_allowed: number }>();
  if (!profile?.demo_mode || !profile.demo_reset_allowed) {
    throw new Error("Demo reset target is not an explicitly resettable demo tenant");
  }
  const stamp = new Date().toISOString();
  await env.SERAMET_DB!.batch([
    env
      .SERAMET_DB!.prepare(
        `DELETE FROM setup_import_rows WHERE tenant_id=? AND import_id IN
        (SELECT id FROM setup_imports WHERE tenant_id=?)`,
      )
      .bind(job.tenant_id, job.tenant_id),
    env.SERAMET_DB!.prepare("DELETE FROM setup_imports WHERE tenant_id=?").bind(job.tenant_id),
    env.SERAMET_DB!.prepare("DELETE FROM setup_test_runs WHERE tenant_id=?").bind(job.tenant_id),
    env
      .SERAMET_DB!.prepare("DELETE FROM setup_readiness_results WHERE tenant_id=?")
      .bind(job.tenant_id),
    env
      .SERAMET_DB!.prepare("DELETE FROM setup_stage_snapshots WHERE tenant_id=?")
      .bind(job.tenant_id),
    env
      .SERAMET_DB!.prepare(
        "UPDATE provider_connections SET status='DISABLED',updated_at=? WHERE tenant_id=?",
      )
      .bind(stamp, job.tenant_id),
    env
      .SERAMET_DB!.prepare(
        "UPDATE tenant_onboarding_profiles SET go_live_state='SETUP',updated_at=? WHERE tenant_id=?",
      )
      .bind(stamp, job.tenant_id),
    env
      .SERAMET_DB!.prepare(
        `INSERT INTO audit_events
        (tenant_id,id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
       VALUES (?,?,?,'DEMO_RESET_COMPLETED','TENANT',?,'Controlled demo reset',?,'{}',?)`,
      )
      .bind(
        job.tenant_id,
        crypto.randomUUID(),
        "system:setup-worker",
        job.tenant_id,
        job.correlation_id,
        stamp,
      ),
  ]);
}

async function commitSetupImport(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ importId?: string; commitKey?: string }>(job.payload_json);
  if (!payload.importId || !payload.commitKey) {
    throw new Error("Setup import worker is missing its import identity");
  }
  const service = new OnboardingService(
    env.SERAMET_DB!,
    systemSetupActor(job.tenant_id, job.branch_id ?? undefined),
    env,
  );
  return service.commitImport(payload.importId, payload.commitKey, { worker: true });
}

export async function queueInventoryAvailabilityChanges(
  env: SerametEnv,
  tenantId: string,
  branchId?: string | null,
  enqueue: (input: {
    tenantId: string;
    branchId: string;
    internalItemId: string;
    available: boolean;
    quantityAvailable: number;
  }) => Promise<unknown> = (input) => createIntegrationRuntime(env).queueAvailabilitySync(input),
) {
  const changes = await env
    .SERAMET_DB!.prepare(
      `SELECT branch_id,menu_item_id,available,available_portions
     FROM menu_inventory_availability WHERE tenant_id=? AND sync_status='PENDING'
       AND (? IS NULL OR branch_id=?) ORDER BY calculated_at LIMIT 250`,
    )
    .bind(tenantId, branchId ?? null, branchId ?? null)
    .all<{
      branch_id: string;
      menu_item_id: string;
      available: number;
      available_portions: number;
    }>();
  for (const change of changes.results ?? []) {
    await enqueue({
      tenantId,
      branchId: change.branch_id,
      internalItemId: change.menu_item_id,
      available: change.available === 1,
      quantityAvailable: change.available_portions,
    });
    await env
      .SERAMET_DB!.prepare(
        `UPDATE menu_inventory_availability SET sync_status='QUEUED',last_queued_at=?
       WHERE tenant_id=? AND branch_id=? AND menu_item_id=? AND sync_status='PENDING'`,
      )
      .bind(new Date().toISOString(), tenantId, change.branch_id, change.menu_item_id)
      .run();
  }
}

async function refreshInventoryExpiryAlerts(env: SerametEnv, tenantId: string) {
  const stamp = new Date().toISOString();
  const lots = await env
    .SERAMET_DB!.prepare(
      `SELECT branch_id,id,inventory_item_id,expiry_date,quantity_remaining_minor
     FROM inventory_lots WHERE tenant_id=? AND status='AVAILABLE' AND expiry_date IS NOT NULL
       AND expiry_date<=date('now','+3 day') LIMIT 500`,
    )
    .bind(tenantId)
    .all<{
      branch_id: string;
      id: string;
      inventory_item_id: string;
      expiry_date: string;
      quantity_remaining_minor: number;
    }>();
  const statements = (lots.results ?? []).map((lot) =>
    env
      .SERAMET_DB!.prepare(
        `INSERT INTO authoritative_records
        (tenant_id,entity_type,entity_id,branch_id,status,payload_json,version,created_at,updated_at)
       VALUES (?,'system:manager-action',?,?,'OPEN',?,1,?,?)
       ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET
         status='OPEN',payload_json=excluded.payload_json,
         version=authoritative_records.version+1,updated_at=excluded.updated_at`,
      )
      .bind(
        tenantId,
        `inventory-expiry:${lot.id}`,
        lot.branch_id,
        JSON.stringify({
          type: "NEAR_EXPIRY_INVENTORY",
          inventoryItemId: lot.inventory_item_id,
          lotId: lot.id,
          expiryDate: lot.expiry_date,
          quantityRemainingMicro: lot.quantity_remaining_minor,
        }),
        stamp,
        stamp,
      ),
  );
  if (statements.length) await env.SERAMET_DB!.batch(statements);
  return { alerts: statements.length };
}

async function recalculateCrmMetrics(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ branchId?: string | null }>(job.payload_json);
  const branchId = payload.branchId ?? job.branch_id ?? undefined;
  const actor = systemCrmActor(job.tenant_id, branchId);
  const metrics = await new CrmAnalyticsService(env.SERAMET_DB!, actor).recalculateMetrics(
    branchId,
  );
  const segments = await env
    .SERAMET_DB!.prepare(
      "SELECT id FROM crm_segments WHERE tenant_id=? AND status='ACTIVE' ORDER BY id",
    )
    .bind(job.tenant_id)
    .all<{ id: string }>();
  const campaignService = new CampaignService(env.SERAMET_DB!, actor);
  for (const segment of segments.results ?? []) {
    await campaignService.buildSegmentSnapshot(segment.id, branchId);
  }
  return { ...metrics, segmentSnapshots: segments.results?.length ?? 0 };
}

async function dispatchCrmCampaigns(env: SerametEnv, job: WorkerJobRow) {
  const actor = systemCrmActor(job.tenant_id, job.branch_id ?? undefined);
  const rows = await env
    .SERAMET_DB!.prepare(
      `SELECT id FROM campaigns WHERE tenant_id=?
       AND status IN ('SCHEDULED','ACTIVE')
       AND (schedule_at IS NULL OR schedule_at<=?)
       AND (starts_at IS NULL OR starts_at<=?)
       AND (ends_at IS NULL OR ends_at>?)
       ORDER BY COALESCE(schedule_at,created_at),id LIMIT 100`,
    )
    .bind(
      job.tenant_id,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .all<{ id: string }>();
  const service = new CampaignService(env.SERAMET_DB!, actor);
  let sent = 0;
  let failed = 0;
  for (const campaign of rows.results ?? []) {
    const result = await service.processCampaign(campaign.id);
    sent += result.sent;
    failed += result.failed;
  }
  return { campaigns: rows.results?.length ?? 0, sent, failed };
}

async function maintainCrmLoyalty(env: SerametEnv, job: WorkerJobRow) {
  const service = new LoyaltyValueService(
    env.SERAMET_DB!,
    systemCrmActor(job.tenant_id, job.branch_id ?? undefined),
  );
  const expired = await service.expirePoints();
  const tiers = await service.recalculateTiers();
  await service.expireVouchers();
  return { expired, tiers };
}

async function expireCrmStoredValue(env: SerametEnv, job: WorkerJobRow) {
  return new LoyaltyValueService(
    env.SERAMET_DB!,
    systemCrmActor(job.tenant_id, job.branch_id ?? undefined),
  ).expireStoredValue();
}

async function generateCrmPrivacyExport(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ requestId?: string }>(job.payload_json);
  if (!payload.requestId) throw new Error("CRM privacy export has no requestId");
  const request = await env
    .SERAMET_DB!.prepare(
      `UPDATE customer_privacy_requests SET status='PROCESSING'
       WHERE tenant_id=? AND id=? AND request_type IN ('ACCESS','EXPORT')
         AND status IN ('REQUESTED','VERIFIED')
       RETURNING customer_id`,
    )
    .bind(job.tenant_id, payload.requestId)
    .first<{ customer_id: string }>();
  if (!request) {
    const existing = await env
      .SERAMET_DB!.prepare(
        "SELECT status FROM customer_privacy_requests WHERE tenant_id=? AND id=?",
      )
      .bind(job.tenant_id, payload.requestId)
      .first<{ status: string }>();
    if (existing?.status === "COMPLETED") return { duplicate: true };
    throw new Error("CRM privacy export could not be claimed");
  }
  const actor = systemCrmActor(job.tenant_id, job.branch_id ?? undefined);
  const profile = await new CrmService(env.SERAMET_DB!, actor).customerProfile(request.customer_id);
  const stamp = new Date().toISOString();
  const resultReference = `authoritative://crm:privacy-export/${payload.requestId}`;
  await env.SERAMET_DB!.batch([
    env
      .SERAMET_DB!.prepare(
        `INSERT INTO authoritative_records
          (tenant_id,entity_type,entity_id,status,payload_json,version,created_at,updated_at)
         VALUES (?,'crm:privacy-export',?,'READY',?,1,?,?)
         ON CONFLICT(tenant_id,entity_type,entity_id) DO NOTHING`,
      )
      .bind(job.tenant_id, payload.requestId, JSON.stringify(profile), stamp, stamp),
    env
      .SERAMET_DB!.prepare(
        `UPDATE customer_privacy_requests SET status='COMPLETED',completed_at=?,completed_by=?
         WHERE tenant_id=? AND id=? AND status='PROCESSING'`,
      )
      .bind(stamp, actor.id, job.tenant_id, payload.requestId),
    env
      .SERAMET_DB!.prepare(
        `INSERT INTO customer_privacy_events
          (tenant_id,id,request_id,event_type,actor_id,payload_json,created_at)
         VALUES (?,?,?,'EXPORT_READY',?,?,?)`,
      )
      .bind(
        job.tenant_id,
        crypto.randomUUID(),
        payload.requestId,
        actor.id,
        JSON.stringify({ resultReference }),
        stamp,
      ),
  ]);
  return { resultReference, duplicate: false };
}

async function commitCrmCustomerImport(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ importId?: string }>(job.payload_json);
  if (!payload.importId) throw new Error("CRM import worker has no importId");
  return new CrmService(
    env.SERAMET_DB!,
    systemCrmActor(job.tenant_id, job.branch_id ?? undefined),
    await crmPhonePolicy(env, job.tenant_id),
  ).commitCustomerImport(payload.importId);
}

async function crmPhonePolicy(env: SerametEnv, tenantId: string) {
  const row = await env
    .SERAMET_DB!.prepare(
      "SELECT configuration_json FROM feature_flags WHERE tenant_id=? AND key='crm.enabled'",
    )
    .bind(tenantId)
    .first<{ configuration_json: string }>();
  const configuration = parsePayload<Record<string, unknown>>(row?.configuration_json ?? "{}", {});
  return {
    defaultCallingCode:
      typeof configuration["phoneDefaultCallingCode"] === "string"
        ? String(configuration["phoneDefaultCallingCode"])
        : "",
    nationalPrefix:
      typeof configuration["phoneNationalPrefix"] === "string"
        ? String(configuration["phoneNationalPrefix"])
        : "0",
    minNationalDigits: 8,
    maxNationalDigits: 15,
  };
}

function systemCrmActor(tenantId: string, branchId?: string): ServerActor {
  return {
    id: "system:crm-worker",
    name: "CRM worker",
    tenantId,
    roleIds: ["system:crm-worker"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: branchId ? [branchId] : [],
    assignedBranches: [],
    branchScope: { type: "ALL" },
    branchId: branchId ?? "system",
    role: "System CRM worker",
    branch: branchId ?? "All branches",
  };
}

async function executeEnterpriseRollout(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ rolloutId?: string }>(job.payload_json);
  if (!payload.rolloutId) throw new Error("Enterprise rollout worker requires rolloutId");
  const actor = await systemEnterpriseActor(env, job.tenant_id);
  await new EnterpriseService(env.SERAMET_DB!, actor).executeRollout(payload.rolloutId);
}

async function recalculateEnterpriseFranchiseFee(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{
    feeDefinitionId?: string;
    periodStart?: string;
    periodEnd?: string;
  }>(job.payload_json);
  if (!payload.feeDefinitionId || !payload.periodStart || !payload.periodEnd) {
    throw new Error("Enterprise franchise fee worker payload is incomplete");
  }
  const actor = await systemEnterpriseActor(env, job.tenant_id);
  await new EnterpriseService(env.SERAMET_DB!, actor).calculateFranchiseFee({
    feeDefinitionId: payload.feeDefinitionId,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
  });
}

async function recalculateEnterpriseReadiness(env: SerametEnv, job: WorkerJobRow) {
  const db = env.SERAMET_DB!;
  const stamp = new Date().toISOString();
  const branches = await db
    .prepare(
      `SELECT n.id node_id,n.branch_id,b.active,p.go_live_state,
              (SELECT COUNT(*) FROM setup_account_mappings a
                WHERE a.tenant_id=n.tenant_id AND (a.branch_id IS NULL OR a.branch_id=n.branch_id)) account_mappings,
              (SELECT COUNT(*) FROM hardware_devices d
                WHERE d.tenant_id=n.tenant_id AND d.branch_id=n.branch_id AND d.trust_status='ACTIVE') active_devices,
              (SELECT COUNT(*) FROM provider_connections c
                WHERE c.tenant_id=n.tenant_id AND (c.branch_id IS NULL OR c.branch_id=n.branch_id)
                  AND c.status IN ('ACTIVE','SANDBOX')) active_providers
       FROM enterprise_nodes n
       JOIN branches b ON b.tenant_id=n.tenant_id AND b.id=n.branch_id
       LEFT JOIN tenant_onboarding_profiles p ON p.tenant_id=n.tenant_id
       WHERE n.tenant_id=? AND n.node_type='BRANCH'`,
    )
    .bind(job.tenant_id)
    .all<{
      node_id: string;
      branch_id: string;
      active: number;
      go_live_state: string | null;
      account_mappings: number;
      active_devices: number;
      active_providers: number;
    }>();
  const statements: D1PreparedStatement[] = [];
  for (const branch of branches.results ?? []) {
    const checks = [
      {
        code: "BRANCH_LIFECYCLE",
        status: branch.active ? "READY" : "BLOCKED",
        severity: branch.active ? "INFO" : "CRITICAL",
        message: branch.active ? "Branch is active" : "Branch is not active",
        evidence: { active: Boolean(branch.active) },
        action: branch.active ? null : "Review branch lifecycle status",
      },
      {
        code: "FINANCE_MAPPINGS",
        status: branch.account_mappings > 0 ? "READY" : "BLOCKED",
        severity: branch.account_mappings > 0 ? "INFO" : "CRITICAL",
        message:
          branch.account_mappings > 0
            ? "Finance mappings are present"
            : "Finance mappings are missing",
        evidence: { configuredMappings: branch.account_mappings },
        action: branch.account_mappings > 0 ? null : "Configure branch accounting mappings",
      },
      {
        code: "DEVICE_EVIDENCE",
        status: branch.active_devices > 0 ? "READY" : "UNKNOWN",
        severity: branch.active_devices > 0 ? "INFO" : "WARNING",
        message:
          branch.active_devices > 0
            ? "An active device is registered"
            : "No active device evidence is available",
        evidence: { activeDevices: branch.active_devices },
        action: branch.active_devices > 0 ? null : "Register and test required devices",
      },
      {
        code: "PROVIDER_EVIDENCE",
        status: branch.active_providers > 0 ? "READY" : "UNKNOWN",
        severity: branch.active_providers > 0 ? "INFO" : "WARNING",
        message:
          branch.active_providers > 0
            ? "Configured provider evidence is available"
            : "Provider readiness is unknown",
        evidence: { activeProviders: branch.active_providers },
        action: branch.active_providers > 0 ? null : "Review provider requirements for this branch",
      },
    ];
    for (const check of checks) {
      statements.push(
        db
          .prepare(
            `INSERT INTO enterprise_readiness_results
            (tenant_id,id,scope_node_id,branch_id,check_code,status,severity,message,
             evidence_json,recommended_action,source,calculated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,scope_node_id,branch_id,check_code) DO UPDATE SET
             status=excluded.status,severity=excluded.severity,message=excluded.message,
             evidence_json=excluded.evidence_json,recommended_action=excluded.recommended_action,
             source=excluded.source,calculated_at=excluded.calculated_at`,
          )
          .bind(
            job.tenant_id,
            `readiness-${branch.node_id}-${check.code.toLowerCase()}`,
            branch.node_id,
            branch.branch_id,
            check.code,
            check.status,
            check.severity,
            check.message,
            JSON.stringify(check.evidence),
            check.action,
            "ENTERPRISE_READINESS_WORKER",
            stamp,
          ),
      );
      const conditionKey = `enterprise-readiness:${branch.node_id}:${check.code}`;
      if (check.status === "BLOCKED" || check.status === "WARNING") {
        statements.push(
          db
            .prepare(
              `INSERT INTO management_actions
              (tenant_id,id,branch_id,action_type,severity,status,source_type,source_id,condition_key,
               metric_value,threshold_value,value_unit,evidence_json,first_detected_at,last_detected_at,
               correlation_id,created_at,updated_at)
             VALUES (?,?,?,?,?,'OPEN','ENTERPRISE_READINESS',?,?,1,0,'CHECK',?,?,?,?,?,?)
             ON CONFLICT(tenant_id,condition_key) DO UPDATE SET
               severity=excluded.severity,status=CASE WHEN management_actions.status IN ('RESOLVED','DISMISSED') THEN 'OPEN' ELSE management_actions.status END,
               evidence_json=excluded.evidence_json,last_detected_at=excluded.last_detected_at,
               correlation_id=excluded.correlation_id,version=management_actions.version+1,updated_at=excluded.updated_at`,
            )
            .bind(
              job.tenant_id,
              conditionKey,
              branch.branch_id,
              "ENTERPRISE_READINESS_BLOCKER",
              check.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
              `readiness-${branch.node_id}-${check.code.toLowerCase()}`,
              conditionKey,
              JSON.stringify({
                checkCode: check.code,
                message: check.message,
                evidence: check.evidence,
              }),
              stamp,
              stamp,
              job.correlation_id,
              stamp,
              stamp,
            ),
        );
      } else {
        statements.push(
          db
            .prepare(
              `UPDATE management_actions SET status='RESOLVED',resolved_at=?,resolution_actor_id=?,
               resolution_note='Enterprise readiness evidence recovered',version=version+1,updated_at=?
             WHERE tenant_id=? AND condition_key=? AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
            )
            .bind(stamp, "system:enterprise-worker", stamp, job.tenant_id, conditionKey),
        );
      }
    }
  }
  if (statements.length) await db.batch(statements);
}

async function maintainEnterprisePolicies(env: SerametEnv, job: WorkerJobRow) {
  const actor = await systemEnterpriseActor(env, job.tenant_id);
  const service = new EnterpriseService(env.SERAMET_DB!, actor);
  await service.expirePolicyExceptions();
  const due = await env
    .SERAMET_DB!.prepare(
      `SELECT id FROM enterprise_rollouts
       WHERE tenant_id=? AND status='SCHEDULED' AND confirmed_at IS NOT NULL
         AND scheduled_at IS NOT NULL AND scheduled_at<=?
         AND (requires_approval=0 OR approved_by IS NOT NULL)
       ORDER BY scheduled_at,id LIMIT 100`,
    )
    .bind(job.tenant_id, new Date().toISOString())
    .all<{ id: string }>();
  for (const rollout of due.results ?? []) await service.executeRollout(rollout.id);
}

async function generateEnterpriseExport(env: SerametEnv, job: WorkerJobRow) {
  const payload = parsePayload<{ exportId?: string }>(job.payload_json);
  if (!payload.exportId) throw new Error("Enterprise export worker requires exportId");
  const exportJob = await env
    .SERAMET_DB!.prepare(
      "SELECT requested_by FROM enterprise_export_jobs WHERE tenant_id=? AND id=?",
    )
    .bind(job.tenant_id, payload.exportId)
    .first<{ requested_by: string }>();
  if (!exportJob) throw new Error("Enterprise export job not found");
  const actor = await enterpriseActorForUser(env, job.tenant_id, exportJob.requested_by);
  await new EnterpriseService(env.SERAMET_DB!, actor).runEnterpriseExport(payload.exportId);
}

async function recalculateEnterpriseFranchiseCompliance(env: SerametEnv, job: WorkerJobRow) {
  const db = env.SERAMET_DB!;
  const stamp = new Date().toISOString();
  const rows = await db
    .prepare(
      `SELECT r.id relationship_id,b.branch_id,br.active,
         COUNT(rr.id) readiness_count,
         SUM(CASE WHEN rr.status='BLOCKED' THEN 1 ELSE 0 END) blocked_count
       FROM franchise_relationships r
       JOIN franchise_branch_assignments b ON b.tenant_id=r.tenant_id AND b.franchise_relationship_id=r.id
       JOIN branches br ON br.tenant_id=b.tenant_id AND br.id=b.branch_id
       LEFT JOIN enterprise_readiness_results rr ON rr.tenant_id=b.tenant_id AND rr.branch_id=b.branch_id
       WHERE r.tenant_id=? AND r.status IN ('ONBOARDING','ACTIVE','SUSPENDED')
       GROUP BY r.id,b.branch_id,br.active ORDER BY r.id,b.branch_id`,
    )
    .bind(job.tenant_id)
    .all<{
      relationship_id: string;
      branch_id: string;
      active: number;
      readiness_count: number;
      blocked_count: number;
    }>();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results ?? []) {
    const checks = [
      {
        code: "BRANCH_STATUS",
        status: row.active ? "COMPLIANT" : "NON_COMPLIANT",
        message: row.active ? "Branch is active" : "Branch is inactive",
        evidence: { active: Boolean(row.active) },
      },
      {
        code: "ENTERPRISE_READINESS",
        status:
          row.readiness_count === 0 ? "UNKNOWN" : row.blocked_count > 0 ? "WARNING" : "COMPLIANT",
        message:
          row.readiness_count === 0
            ? "Readiness evidence is unavailable"
            : row.blocked_count > 0
              ? "Readiness blockers require review"
              : "Readiness checks have no blockers",
        evidence: { readinessChecks: row.readiness_count, blockedChecks: row.blocked_count },
      },
    ];
    for (const check of checks) {
      const resultId = `franchise-compliance:${row.relationship_id}:${row.branch_id}:${check.code}`;
      statements.push(
        db
          .prepare(
            `INSERT INTO franchise_compliance_results
            (tenant_id,id,franchise_relationship_id,branch_id,check_code,status,evidence_json,message,calculated_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,franchise_relationship_id,branch_id,check_code) DO UPDATE SET
             status=excluded.status,evidence_json=excluded.evidence_json,message=excluded.message,
             calculated_at=excluded.calculated_at`,
          )
          .bind(
            job.tenant_id,
            resultId,
            row.relationship_id,
            row.branch_id,
            check.code,
            check.status,
            JSON.stringify(check.evidence),
            check.message,
            stamp,
          ),
      );
      const conditionKey = `franchise-compliance:${row.relationship_id}:${row.branch_id}:${check.code}`;
      if (check.status === "NON_COMPLIANT" || check.status === "WARNING") {
        statements.push(
          db
            .prepare(
              `INSERT INTO management_actions
              (tenant_id,id,branch_id,action_type,severity,status,source_type,source_id,condition_key,
               metric_value,threshold_value,value_unit,evidence_json,first_detected_at,last_detected_at,
               correlation_id,created_at,updated_at)
             VALUES (?,?,?,?,?,'OPEN','FRANCHISE_COMPLIANCE',?,?,1,0,'CHECK',?,?,?,?,?,?)
             ON CONFLICT(tenant_id,condition_key) DO UPDATE SET
               severity=excluded.severity,status=CASE WHEN management_actions.status IN ('RESOLVED','DISMISSED') THEN 'OPEN' ELSE management_actions.status END,
               evidence_json=excluded.evidence_json,last_detected_at=excluded.last_detected_at,
               correlation_id=excluded.correlation_id,version=management_actions.version+1,updated_at=excluded.updated_at`,
            )
            .bind(
              job.tenant_id,
              conditionKey,
              row.branch_id,
              "FRANCHISE_COMPLIANCE_EXCEPTION",
              check.status === "NON_COMPLIANT" ? "CRITICAL" : "HIGH",
              resultId,
              conditionKey,
              JSON.stringify(check.evidence),
              stamp,
              stamp,
              job.correlation_id,
              stamp,
              stamp,
            ),
        );
      } else if (check.status === "COMPLIANT") {
        statements.push(
          db
            .prepare(
              `UPDATE management_actions SET status='RESOLVED',resolved_at=?,resolution_actor_id=?,
               resolution_note='Compliance evidence recovered',version=version+1,updated_at=?
             WHERE tenant_id=? AND condition_key=? AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
            )
            .bind(stamp, "system:enterprise-worker", stamp, job.tenant_id, conditionKey),
        );
      }
    }
  }
  if (statements.length) await db.batch(statements);
}

async function enterpriseActorForUser(
  env: SerametEnv,
  tenantId: string,
  userId: string,
): Promise<ServerActor> {
  const db = env.SERAMET_DB!;
  const user = await db
    .prepare("SELECT id,name,active FROM users WHERE tenant_id=? AND id=?")
    .bind(tenantId, userId)
    .first<{ id: string; name: string; active: number }>();
  if (!user?.active) throw new Error("Enterprise export requester is no longer active");
  const [roles, permissionRows, branches] = await Promise.all([
    db
      .prepare(
        `SELECT r.id,r.name FROM user_roles ur JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id
      WHERE ur.tenant_id=? AND ur.user_id=? AND r.active=1`,
      )
      .bind(tenantId, userId)
      .all<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp
      ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id WHERE ur.tenant_id=? AND ur.user_id=?`,
      )
      .bind(tenantId, userId)
      .all<{ permission_code: string }>(),
    db
      .prepare(
        `SELECT b.id,b.name FROM user_branches ub JOIN branches b
      ON b.tenant_id=ub.tenant_id AND b.id=ub.branch_id WHERE ub.tenant_id=? AND ub.user_id=? AND b.active=1`,
      )
      .bind(tenantId, userId)
      .all<{ id: string; name: string }>(),
  ]);
  const assignedBranches = branches.results ?? [];
  const actorPermissions = (permissionRows.results ?? []).map((row) => row.permission_code);
  return {
    id: user.id,
    name: user.name,
    tenantId,
    roleIds: (roles.results ?? []).map((role) => role.id),
    permissions: actorPermissions,
    assignedBranchIds: assignedBranches.map((branch) => branch.id),
    assignedBranches,
    branchScope: actorPermissions.includes("tenant.scope.all_branches")
      ? { type: "ALL" }
      : { type: "BRANCH", branchId: assignedBranches[0]?.id ?? "unassigned" },
    branchId: assignedBranches[0]?.id ?? "unassigned",
    role: roles.results?.[0]?.name ?? "Configured enterprise user",
    branch: assignedBranches[0]?.name ?? "Authorized enterprise scope",
  };
}

async function systemEnterpriseActor(env: SerametEnv, tenantId: string): Promise<ServerActor> {
  const branches = await env
    .SERAMET_DB!.prepare(
      "SELECT id,name FROM branches WHERE tenant_id=? AND active=1 ORDER BY name",
    )
    .bind(tenantId)
    .all<{ id: string; name: string }>();
  const assignedBranches = branches.results ?? [];
  return {
    id: "system:enterprise-worker",
    name: "Enterprise worker",
    tenantId,
    roleIds: ["system:enterprise-worker"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: assignedBranches.map((branch) => branch.id),
    assignedBranches,
    branchScope: { type: "ALL" },
    branchId: assignedBranches[0]?.id ?? "system",
    role: "System enterprise worker",
    branch: "Authorized enterprise scope",
  };
}

function systemInventoryActor(tenantId: string, branchId?: string): ServerActor {
  return {
    id: "system:inventory-worker",
    name: "Inventory worker",
    tenantId,
    roleIds: ["system"],
    permissions: [],
    assignedBranchIds: branchId ? [branchId] : [],
    assignedBranches: [],
    branchScope: { type: "ALL" },
    branchId: branchId ?? "system",
    role: "System",
    branch: branchId ?? "All branches",
  };
}

function systemSetupActor(tenantId: string, branchId?: string): ServerActor {
  return {
    id: "system:setup-worker",
    name: "Setup worker",
    tenantId,
    roleIds: ["system"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: branchId ? [branchId] : [],
    assignedBranches: [],
    branchScope: { type: "ALL" },
    branchId: branchId ?? "system",
    role: "System",
    branch: branchId ?? "All branches",
  };
}

async function systemIntelligenceActor(
  env: SerametEnv,
  tenantId: string,
  preferredBranchId?: string,
): Promise<ServerActor> {
  const user = await env
    .SERAMET_DB!.prepare(
      `SELECT id,name FROM users WHERE tenant_id=? AND active=1 ORDER BY created_at,id LIMIT 1`,
    )
    .bind(tenantId)
    .first<{ id: string; name: string }>();
  if (!user) throw new Error("Scheduled intelligence requires an active tenant user");
  const branches = await env
    .SERAMET_DB!.prepare("SELECT id,name FROM branches WHERE tenant_id=? AND active=1 ORDER BY id")
    .bind(tenantId)
    .all<{ id: string; name: string }>();
  const assignedBranches = branches.results ?? [];
  const branch =
    assignedBranches.find((item) => item.id === preferredBranchId) ?? assignedBranches[0];
  if (!branch) throw new Error("Scheduled intelligence requires an active branch");
  return {
    id: user.id,
    name: `Scheduled intelligence (${user.name})`,
    tenantId,
    roleIds: ["system:intelligence-worker"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: assignedBranches.map((item) => item.id),
    assignedBranches,
    branchScope: { type: "ALL" },
    branchId: branch.id,
    role: "System intelligence worker",
    branch: branch.name,
  };
}

async function requeueDueOutbox(env: SerametEnv, tenantId: string) {
  const due = await env
    .SERAMET_DB!.prepare(
      `SELECT id, correlation_id FROM integration_outbox
       WHERE tenant_id = ? AND status IN ('PENDING', 'RETRY_PENDING') AND next_attempt_at <= ?
       ORDER BY next_attempt_at LIMIT 100`,
    )
    .bind(tenantId, new Date().toISOString())
    .all<{ id: string; correlation_id: string }>();
  for (const row of due.results ?? []) {
    await env.SERAMET_WORK_QUEUE!.send(
      { kind: "integration-outbox", tenantId, recordId: row.id, correlationId: row.correlation_id },
      { contentType: "json" },
    );
  }
}

async function aggregateEod(env: SerametEnv, tenantId: string) {
  const stamp = new Date().toISOString();
  const count = await env
    .SERAMET_DB!.prepare(
      `SELECT COUNT(*) AS count FROM authoritative_records
       WHERE tenant_id = ? AND entity_type IN ('state:bills', 'payments:transactions')`,
    )
    .bind(tenantId)
    .first<{ count: number }>();
  await env
    .SERAMET_DB!.prepare(
      `INSERT INTO authoritative_records
        (tenant_id, entity_type, entity_id, status, payload_json, version, created_at, updated_at)
       VALUES (?, 'system:eod-aggregate', ?, 'READY', ?, 1, ?, ?)
       ON CONFLICT(tenant_id, entity_type, entity_id) DO UPDATE SET
         payload_json = excluded.payload_json, version = authoritative_records.version + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(
      tenantId,
      stamp.slice(0, 13),
      JSON.stringify({ generatedAt: stamp, sourceRecords: count?.count ?? 0 }),
      stamp,
      stamp,
    )
    .run();
}

async function completeWorkerJob(env: SerametEnv, job: WorkerJobRow, durationMs: number) {
  const stamp = new Date().toISOString();
  await env
    .SERAMET_DB!.prepare(
      `UPDATE worker_jobs SET status = 'SUCCEEDED', finished_at = ?, duration_ms = ?,
       lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE tenant_id = ? AND id = ? AND status = 'RUNNING'`,
    )
    .bind(stamp, durationMs, stamp, job.tenant_id, job.id)
    .run();
}

async function recordWorkerFailure(env: SerametEnv, body: SerametWorkerMessage, error: unknown) {
  if (body.kind !== "worker-job") return true;
  const row = await env
    .SERAMET_DB!.prepare(
      "SELECT attempt_count, max_attempts FROM worker_jobs WHERE tenant_id = ? AND id = ?",
    )
    .bind(body.tenantId, body.jobId)
    .first<{ attempt_count: number; max_attempts: number }>();
  if (!row) return false;
  const retry = row.attempt_count < row.max_attempts;
  const stamp = new Date().toISOString();
  await env
    .SERAMET_DB!.prepare(
      `UPDATE worker_jobs SET status = ?, scheduled_at = ?, lease_owner = NULL,
       lease_expires_at = NULL, last_error = ?, finished_at = CASE WHEN ? = 0 THEN ? ELSE NULL END,
       updated_at = ? WHERE tenant_id = ? AND id = ?`,
    )
    .bind(
      retry ? "RETRY_PENDING" : "DEAD_LETTER",
      new Date(Date.now() + retryDelay(row.attempt_count) * 1000).toISOString(),
      error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      retry ? 1 : 0,
      stamp,
      stamp,
      body.tenantId,
      body.jobId,
    )
    .run();
  if (!retry) {
    const job = await env
      .SERAMET_DB!.prepare(
        "SELECT job_type,payload_json FROM worker_jobs WHERE tenant_id=? AND id=?",
      )
      .bind(body.tenantId, body.jobId)
      .first<{ job_type: string; payload_json: string }>();
    const payload = parsePayload<{ exportId?: string; briefId?: string }>(
      job?.payload_json ?? "{}",
    );
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
    if (payload.exportId && job?.job_type === "SUPPORT_DIAGNOSTIC_EXPORT") {
      await env
        .SERAMET_DB!.prepare(
          `UPDATE support_diagnostic_exports SET status='FAILED',redacted_payload_json=?,completed_at=?
         WHERE tenant_id=? AND id=?`,
        )
        .bind(JSON.stringify({ error: message }), stamp, body.tenantId, payload.exportId)
        .run();
    }
    if (payload.exportId && job?.job_type === "TENANT_DATA_EXPORT") {
      await env
        .SERAMET_DB!.prepare(
          `UPDATE tenant_data_export_jobs SET status='FAILED',manifest_json=?,completed_at=?
         WHERE tenant_id=? AND id=?`,
        )
        .bind(JSON.stringify({ error: message }), stamp, body.tenantId, payload.exportId)
        .run();
    }
    if (payload.briefId && job?.job_type === "INTELLIGENCE_BRIEF_GENERATION") {
      await env
        .SERAMET_DB!.prepare(
          `UPDATE intelligence_briefs SET status='FAILED',updated_at=?
           WHERE tenant_id=? AND id=? AND status IN ('PENDING','GENERATING')`,
        )
        .bind(stamp, body.tenantId, payload.briefId)
        .run();
    }
  }
  return retry;
}

function retryDelay(attempts: number) {
  return Math.min(900, Math.max(5, 2 ** Math.min(attempts, 9)));
}

function parsePayload<T>(value: string, fallback: T = {} as T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey(key))
      .map(([key, child]) => [key, redactSensitive(child)]),
  );
}

function sensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "secret",
    "password",
    "passkey",
    "token",
    "authorization",
    "cookie",
    "credential",
    "cvv",
    "pin",
    "fullpan",
    "trackdata",
  ].some((candidate) => normalized.includes(candidate));
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function localHourInTimezone(at: Date, timezone: string) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return Number(hour);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
