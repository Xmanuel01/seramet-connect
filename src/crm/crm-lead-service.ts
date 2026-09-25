import { CrmDomainError, CrmServiceBase } from "@/crm/service-base";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";

export const leadStages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export type LeadStage = (typeof leadStages)[number];

export type LeadCreate = {
  branchId: string;
  customerId?: string;
  contactName: string;
  companyName?: string;
  contactPhone?: string;
  contactEmail?: string;
  source: string;
  estimatedValueMinor: number;
  nextAction?: string;
  dueAt?: string;
  requestKey: string;
};

export type LeadUpdate = {
  stage: LeadStage;
  expectedVersion: number;
  requestKey: string;
  nextAction?: string;
  dueAt?: string | null;
  reason?: string;
};

type LeadRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  customer_id: string | null;
  contact_name: string;
  company_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  source: string;
  owner_actor_id: string;
  owner_display_name: string;
  estimated_value_minor: number;
  currency: string;
  stage: LeadStage;
  next_action: string | null;
  due_at: string | null;
  version: number;
  request_key: string;
  create_payload_json: string;
  last_mutation_key: string;
  created_at: string;
  updated_at: string;
};

const transitions: Record<LeadStage, ReadonlyArray<LeadStage>> = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "LOST"],
  QUALIFIED: ["PROPOSAL", "LOST"],
  PROPOSAL: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

function safeCursor(raw: string) {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new CrmDomainError("VALIDATION_FAILED", "Invalid lead pagination cursor");
  }
  if (
    !Array.isArray(data) ||
    data.length !== 2 ||
    data.some((item) => typeof item !== "string" || item.length < 1 || item.length > 128)
  ) {
    throw new CrmDomainError("VALIDATION_FAILED", "Invalid lead pagination cursor");
  }
  return data as [string, string];
}

function canonicalCreatePayload(input: LeadCreate) {
  return JSON.stringify({
    branchId: input.branchId,
    customerId: input.customerId ?? null,
    contactName: input.contactName.trim(),
    companyName: input.companyName?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    contactEmail: input.contactEmail?.trim().toLowerCase() || null,
    source: input.source,
    estimatedValueMinor: input.estimatedValueMinor,
    nextAction: input.nextAction?.trim() || null,
    dueAt: input.dueAt ?? null,
  });
}

function canonicalUpdatePayload(input: LeadUpdate) {
  return JSON.stringify({
    stage: input.stage,
    expectedVersion: input.expectedVersion,
    nextAction: input.nextAction === undefined ? "__UNCHANGED__" : input.nextAction.trim(),
    dueAt: input.dueAt === undefined ? "__UNCHANGED__" : input.dueAt,
    reason: input.reason?.trim() || null,
  });
}

export class CrmLeadService extends CrmServiceBase {
  constructor(db: D1Database, actor: ServerActor) {
    super(db, actor);
  }

  private publicRow(row: LeadRow) {
    const contactAccess = this.actor.permissions.includes(permissions.crmCustomerContactView);
    return {
      id: row.id,
      branchId: row.branch_id,
      customerId: row.customer_id,
      contactName: row.contact_name,
      companyName: row.company_name,
      ...(contactAccess
        ? { contactPhone: row.contact_phone, contactEmail: row.contact_email }
        : {}),
      source: row.source,
      ownerActorId: row.owner_actor_id,
      ownerName: row.owner_display_name,
      estimatedValueMinor: row.estimated_value_minor,
      currency: row.currency,
      stage: row.stage,
      nextAction: row.next_action,
      dueAt: row.due_at,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async list(input: { branchId?: string; stage?: LeadStage; cursor?: string; limit?: number }) {
    this.require(permissions.crmView);
    const branchId = input.branchId || this.actor.branchId;
    if (!branchId) throw new CrmDomainError("VALIDATION_FAILED", "Select a branch");
    this.branch(branchId);
    const limit = input.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CrmDomainError("VALIDATION_FAILED", "Lead page size must be 1–100");
    }
    const cursor = input.cursor ? safeCursor(input.cursor) : null;
    const results = await this.db
      .prepare(
        `SELECT * FROM crm_leads
         WHERE tenant_id=? AND branch_id=? AND (? IS NULL OR stage=?)
           AND (? IS NULL OR created_at<? OR (created_at=? AND id<?))
         ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .bind(
        this.actor.tenantId,
        branchId,
        input.stage ?? null,
        input.stage ?? null,
        cursor?.[0] ?? null,
        cursor?.[0] ?? null,
        cursor?.[0] ?? null,
        cursor?.[1] ?? null,
        limit + 1,
      )
      .all<LeadRow>();
    const page = (results.results ?? []).slice(0, limit);
    const hasMore = (results.results ?? []).length > limit;
    const last = page[page.length - 1];
    return {
      leads: page.map((row) => this.publicRow(row)),
      nextCursor: hasMore && last ? JSON.stringify([last.created_at, last.id]) : null,
    };
  }

  async summary(branchId?: string) {
    this.require(permissions.crmView);
    const selectedBranch = branchId || this.actor.branchId;
    if (!selectedBranch) throw new CrmDomainError("VALIDATION_FAILED", "Select a branch");
    this.branch(selectedBranch);
    const [stages, overdue] = await Promise.all([
      this.db
        .prepare(
          `SELECT currency,stage,COUNT(*) AS lead_count,
                  COALESCE(SUM(estimated_value_minor),0) AS estimated_value_minor
           FROM crm_leads WHERE tenant_id=? AND branch_id=?
           GROUP BY currency,stage ORDER BY currency,stage`,
        )
        .bind(this.actor.tenantId, selectedBranch)
        .all<{
          currency: string;
          stage: LeadStage;
          lead_count: number;
          estimated_value_minor: number;
        }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS due_count FROM crm_leads
           WHERE tenant_id=? AND branch_id=? AND stage NOT IN ('WON','LOST')
             AND due_at IS NOT NULL AND due_at<?`,
        )
        .bind(this.actor.tenantId, selectedBranch, new Date().toISOString())
        .first<{ due_count: number }>(),
    ]);
    return { stages: stages.results ?? [], overdueCount: overdue?.due_count ?? 0 };
  }

  private async scopedLead(id: string) {
    const row = await this.db
      .prepare("SELECT * FROM crm_leads WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<LeadRow>();
    if (!row) throw new CrmDomainError("NOT_FOUND", "Lead not found");
    this.branch(row.branch_id);
    return row;
  }

  async history(id: string) {
    this.require(permissions.crmView);
    await this.scopedLead(id);
    const rows = await this.db
      .prepare(
        `SELECT id,from_stage,to_stage,note,action_by,created_at FROM crm_lead_events
         WHERE tenant_id=? AND lead_id=? ORDER BY created_at DESC,id DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, id)
      .all();
    return rows.results ?? [];
  }

  async create(input: LeadCreate) {
    this.require(permissions.crmCustomerManage);
    this.branch(input.branchId);
    if (!Number.isSafeInteger(input.estimatedValueMinor) || input.estimatedValueMinor < 0) {
      throw new CrmDomainError("VALIDATION_FAILED", "Lead value must be an integer minor amount");
    }
    const existing = await this.db
      .prepare("SELECT * FROM crm_leads WHERE tenant_id=? AND request_key=?")
      .bind(this.actor.tenantId, input.requestKey)
      .first<LeadRow>();
    if (existing) return this.replay(input, existing);
    if (input.customerId) {
      const customer = await this.db
        .prepare(
          `SELECT id FROM customers c WHERE c.tenant_id=? AND c.id=? AND
           (c.preferred_branch_id IS NULL OR c.preferred_branch_id=? OR EXISTS(
             SELECT 1 FROM customer_transaction_links l WHERE l.tenant_id=c.tenant_id
               AND l.customer_id=c.id AND l.branch_id=?
           )) AND c.status='ACTIVE'`,
        )
        .bind(this.actor.tenantId, input.customerId, input.branchId, input.branchId)
        .first();
      if (!customer) {
        throw new CrmDomainError("PERMISSION_DENIED", "Customer is unavailable to this branch");
      }
    }
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string }>();
    if (!tenant) throw new CrmDomainError("NOT_FOUND", "Tenant not found");

    const stamp = new Date().toISOString();
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO crm_leads
           (tenant_id,id,branch_id,customer_id,contact_name,company_name,contact_phone,contact_email,
            source,owner_actor_id,owner_display_name,estimated_value_minor,currency,stage,
            next_action,due_at,version,request_key,create_payload_json,last_mutation_key,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'NEW',?,?,1,?,?,?,?,?)
           ON CONFLICT(tenant_id,request_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.customerId ?? null,
          input.contactName.trim(),
          input.companyName?.trim() || null,
          input.contactPhone?.trim() || null,
          input.contactEmail?.trim().toLowerCase() || null,
          input.source,
          this.actor.id,
          this.actor.name,
          input.estimatedValueMinor,
          tenant.default_currency,
          input.nextAction?.trim() || null,
          input.dueAt ?? null,
          input.requestKey,
          canonicalCreatePayload(input),
          input.requestKey,
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO crm_lead_events
           (tenant_id,id,lead_id,request_key,from_stage,to_stage,note,action_by,created_at)
           SELECT ?,?,?,?,NULL,'NEW',NULL,?,? FROM crm_leads
           WHERE tenant_id=? AND id=? AND request_key=?`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          id,
          input.requestKey,
          this.actor.id,
          stamp,
          this.actor.tenantId,
          id,
          input.requestKey,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_events
           (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
            reason,correlation_id,session_id,metadata_json,created_at)
           SELECT ?,?,branch_id,?,?,'CRM_LEAD_CREATED','CRM_LEAD',id,NULL,?,?, '{}',?
           FROM crm_leads WHERE tenant_id=? AND id=? AND request_key=?`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          this.actor.id,
          this.actor.deviceId ?? null,
          crypto.randomUUID(),
          this.actor.sessionId ?? null,
          stamp,
          this.actor.tenantId,
          id,
          input.requestKey,
        ),
    ]);
    const row = await this.db
      .prepare("SELECT * FROM crm_leads WHERE tenant_id=? AND request_key=?")
      .bind(this.actor.tenantId, input.requestKey)
      .first<LeadRow>();
    if (!row) throw new CrmDomainError("INVALID_STATE", "Lead was not saved");
    if (row.id !== id) return this.replay(input, row);
    return { lead: this.publicRow(row), duplicate: false };
  }

  private replay(input: LeadCreate, row: LeadRow) {
    if (row.create_payload_json !== canonicalCreatePayload(input)) {
      throw new CrmDomainError("CONFLICT", "Lead creation key was reused with different data");
    }
    this.branch(row.branch_id);
    return { lead: this.publicRow(row), duplicate: true };
  }

  async update(id: string, input: LeadUpdate) {
    this.require(permissions.crmCustomerManage);
    const row = await this.scopedLead(id);
    const previous = await this.db
      .prepare(
        "SELECT id,request_payload_json FROM crm_lead_events WHERE tenant_id=? AND lead_id=? AND request_key=?",
      )
      .bind(this.actor.tenantId, id, input.requestKey)
      .first<{ id: string; request_payload_json: string }>();
    if (previous) {
      if (previous.request_payload_json !== canonicalUpdatePayload(input)) {
        throw new CrmDomainError("CONFLICT", "Lead change key was reused for a different change");
      }
      return { lead: this.publicRow(row), duplicate: true };
    }
    if (row.version !== input.expectedVersion) {
      throw new CrmDomainError("CONFLICT", "Lead changed; reload and retry");
    }
    if (row.stage === "WON" || row.stage === "LOST") {
      throw new CrmDomainError("INVALID_STATE", "A closed lead cannot be modified");
    }
    if (input.stage !== row.stage && !transitions[row.stage].includes(input.stage)) {
      throw new CrmDomainError("INVALID_STATE", "Invalid pipeline stage transition");
    }
    if (
      ["WON", "LOST"].includes(input.stage) &&
      (!input.reason || input.reason.trim().length < 4)
    ) {
      throw new CrmDomainError("VALIDATION_FAILED", "A recorded closure reason is required");
    }
    if (input.stage === row.stage && input.nextAction === undefined && input.dueAt === undefined) {
      throw new CrmDomainError("VALIDATION_FAILED", "Nothing to update");
    }
    const stamp = new Date().toISOString();
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE crm_leads SET stage=?,next_action=COALESCE(?,next_action),
           due_at=CASE WHEN ?=1 THEN ? ELSE due_at END,
           version=version+1,last_mutation_key=?,updated_at=?
           WHERE tenant_id=? AND id=? AND stage=? AND version=?`,
        )
        .bind(
          input.stage,
          input.nextAction?.trim() ?? null,
          input.dueAt === undefined ? 0 : 1,
          input.dueAt ?? null,
          input.requestKey,
          stamp,
          this.actor.tenantId,
          id,
          row.stage,
          row.version,
        ),
      this.db
        .prepare(
          `INSERT INTO crm_lead_events
           (tenant_id,id,lead_id,request_key,request_payload_json,from_stage,to_stage,note,action_by,created_at)
           SELECT ?,?,?,?,?,?,?,?,?,? FROM crm_leads
           WHERE tenant_id=? AND id=? AND last_mutation_key=? AND version=?`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          id,
          input.requestKey,
          canonicalUpdatePayload(input),
          row.stage,
          input.stage,
          input.reason?.trim() || null,
          this.actor.id,
          stamp,
          this.actor.tenantId,
          id,
          input.requestKey,
          row.version + 1,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_events
           (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
            reason,correlation_id,session_id,metadata_json,created_at)
           SELECT ?,?,branch_id,?,?,'CRM_LEAD_UPDATED','CRM_LEAD',id,?,?,?, ?,?
           FROM crm_leads
           WHERE tenant_id=? AND id=? AND last_mutation_key=? AND version=?`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          this.actor.id,
          this.actor.deviceId ?? null,
          input.reason?.trim() || null,
          crypto.randomUUID(),
          this.actor.sessionId ?? null,
          JSON.stringify({ from: row.stage, to: input.stage }),
          stamp,
          this.actor.tenantId,
          id,
          input.requestKey,
          row.version + 1,
        ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      throw new CrmDomainError("CONFLICT", "Lead changed; reload and retry");
    }
    return { lead: this.publicRow(await this.scopedLead(id)), duplicate: false };
  }
}
