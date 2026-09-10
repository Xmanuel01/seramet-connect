import { generatePublicToken, sha256Hex } from "@/crm/contact-normalization";
import { assertMinorAmount, CrmDomainError, CrmServiceBase, safeJson } from "@/crm/service-base";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

type LoyaltyProgramRow = {
  id: string;
  name: string;
  status: string;
  scope_type: "TENANT" | "BRAND" | "BRANCH";
  brand_id: string | null;
  branch_id: string | null;
  effective_from: string;
  expires_at: string | null;
  earning_type: "SPEND" | "ITEM" | "CATEGORY" | "VISIT" | "BONUS";
  spend_minor_per_point: number | null;
  minimum_spend_minor: number;
  rounding_policy: "FLOOR" | "NEAREST" | "CEILING";
  expiry_type: "NONE" | "FIXED_DATE" | "DAYS_AFTER_EARN";
  expiry_days: number | null;
  expiry_date: string | null;
  negative_balance_allowed: number;
  eligible_branches_json: string;
  eligible_channels_json: string;
};

type VoucherRow = {
  definition_id: string;
  issue_id: string | null;
  issue_customer_id: string | null;
  issue_status: string | null;
  issue_expires_at: string | null;
  status: string;
  valid_from: string;
  valid_to: string | null;
  branch_scope_json: string;
  channel_scope_json: string;
  item_scope_json: string;
  category_scope_json: string;
  minimum_spend_minor: number;
  currency: string | null;
  discount_type: "FIXED_MINOR" | "PERCENT_BPS" | "FREE_ITEM" | "NON_FINANCIAL";
  discount_value: number;
  usage_cap: number | null;
  per_customer_cap: number | null;
  customer_specific: number;
  single_use: number;
  stacking_policy: "ALLOW" | "BLOCK" | "BEST_ONLY" | "PRIORITY_ORDER";
  stacking_priority: number;
};

export class LoyaltyValueService extends CrmServiceBase {
  constructor(db: D1Database, actor: ServerActor) {
    super(db, actor);
  }

  async listPrograms() {
    this.require(permissions.loyaltyView);
    const scopedBranch = this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : null;
    const rows = await this.db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM customer_loyalty_memberships m
                 WHERE m.tenant_id=p.tenant_id AND m.program_id=p.id AND m.status='ACTIVE') AS members,
                COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l
                 WHERE l.tenant_id=p.tenant_id AND l.program_id=p.id),0) AS outstanding_points
         FROM loyalty_programs p WHERE p.tenant_id=?
           AND (? IS NULL OR p.scope_type='TENANT'
             OR (p.scope_type='BRANCH' AND p.branch_id=?)
             OR (p.scope_type='BRAND' AND p.brand_id=(
               SELECT b.brand_id FROM branches b WHERE b.tenant_id=p.tenant_id AND b.id=?)))
         ORDER BY p.created_at DESC`,
      )
      .bind(this.actor.tenantId, scopedBranch, scopedBranch, scopedBranch)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async listTiers(programId?: string) {
    this.require(permissions.loyaltyView);
    const scopedBranch = this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : null;
    const rows = await this.db
      .prepare(
        `SELECT t.*,p.name AS program_name
         FROM loyalty_tiers t JOIN loyalty_programs p
           ON p.tenant_id=t.tenant_id AND p.id=t.program_id
         WHERE t.tenant_id=? AND (? IS NULL OR t.program_id=?)
           AND (? IS NULL OR p.scope_type='TENANT'
             OR (p.scope_type='BRANCH' AND p.branch_id=?)
             OR (p.scope_type='BRAND' AND p.brand_id=(
               SELECT b.brand_id FROM branches b WHERE b.tenant_id=p.tenant_id AND b.id=?)))
         ORDER BY p.name,t.rank,t.name`,
      )
      .bind(
        this.actor.tenantId,
        programId ?? null,
        programId ?? null,
        scopedBranch,
        scopedBranch,
        scopedBranch,
      )
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async listRewards(programId?: string) {
    this.require(permissions.loyaltyView);
    const scopedBranch = this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : null;
    const rows = await this.db
      .prepare(
        `SELECT r.*,p.name AS program_name
         FROM loyalty_rewards r JOIN loyalty_programs p
           ON p.tenant_id=r.tenant_id AND p.id=r.program_id
         WHERE r.tenant_id=? AND (? IS NULL OR r.program_id=?)
           AND (? IS NULL OR p.scope_type='TENANT'
             OR (p.scope_type='BRANCH' AND p.branch_id=?)
             OR (p.scope_type='BRAND' AND p.brand_id=(
               SELECT b.brand_id FROM branches b WHERE b.tenant_id=p.tenant_id AND b.id=?)))
         ORDER BY p.name,r.points_cost,r.name`,
      )
      .bind(
        this.actor.tenantId,
        programId ?? null,
        programId ?? null,
        scopedBranch,
        scopedBranch,
        scopedBranch,
      )
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async createProgram(input: {
    code: string;
    name: string;
    scopeType: "TENANT" | "BRAND" | "BRANCH";
    brandId?: string;
    branchId?: string;
    effectiveFrom: string;
    expiresAt?: string;
    earningType: "SPEND" | "ITEM" | "CATEGORY" | "VISIT" | "BONUS";
    spendMinorPerPoint?: number;
    minimumSpendMinor: number;
    roundingPolicy: "FLOOR" | "NEAREST" | "CEILING";
    expiryType: "NONE" | "FIXED_DATE" | "DAYS_AFTER_EARN";
    expiryDays?: number;
    expiryDate?: string;
    eligibleBranchIds: string[];
    eligibleChannels: string[];
    redemptionRules: Record<string, unknown>;
    receiptMessage?: string;
  }) {
    this.require(permissions.loyaltyManage);
    if (input.scopeType === "TENANT" && (input.brandId || input.branchId)) {
      throw new CrmDomainError(
        "VALIDATION_FAILED",
        "Tenant program cannot have brand or branch scope",
      );
    }
    if (input.scopeType === "BRAND" && (!input.brandId || input.branchId)) {
      throw new CrmDomainError("VALIDATION_FAILED", "Brand program requires only brandId");
    }
    if (input.scopeType === "BRANCH" && !input.branchId) {
      throw new CrmDomainError("VALIDATION_FAILED", "Branch program requires branchId");
    }
    if (input.branchId) this.branch(input.branchId);
    for (const branchId of input.eligibleBranchIds) this.branch(branchId);
    if (input.earningType === "SPEND" && !input.spendMinorPerPoint) {
      throw new CrmDomainError("VALIDATION_FAILED", "Spend earning requires spendMinorPerPoint");
    }
    if (input.expiryType === "DAYS_AFTER_EARN" && !input.expiryDays) {
      throw new CrmDomainError("VALIDATION_FAILED", "Expiry days are required");
    }
    if (input.expiryType === "FIXED_DATE" && !input.expiryDate) {
      throw new CrmDomainError("VALIDATION_FAILED", "Fixed expiry date is required");
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO loyalty_programs
            (tenant_id,id,code,name,status,scope_type,brand_id,branch_id,effective_from,expires_at,
             earning_type,spend_minor_per_point,minimum_spend_minor,rounding_policy,expiry_type,
             expiry_days,expiry_date,negative_balance_allowed,eligible_branches_json,
             eligible_channels_json,eligible_items_json,eligible_categories_json,exclusions_json,
             redemption_rules_json,receipt_message,created_by,created_at,updated_at)
           VALUES (?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,'[]','[]','{}',?,?,?, ?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.toUpperCase(),
          input.name,
          input.scopeType,
          input.brandId ?? null,
          input.branchId ?? null,
          input.effectiveFrom,
          input.expiresAt ?? null,
          input.earningType,
          input.spendMinorPerPoint ?? null,
          input.minimumSpendMinor,
          input.roundingPolicy,
          input.expiryType,
          input.expiryDays ?? null,
          input.expiryDate ?? null,
          JSON.stringify(input.eligibleBranchIds),
          JSON.stringify(input.eligibleChannels),
          JSON.stringify(input.redemptionRules),
          input.receiptMessage ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "LOYALTY_PROGRAM_CREATED",
        entityType: "LOYALTY_PROGRAM",
        entityId: id,
        at: stamp,
      }),
    ]);
    return { id, status: "ACTIVE" as const };
  }

  async createTier(input: {
    programId: string;
    code: string;
    name: string;
    rank: number;
    qualificationType: "ROLLING_SPEND" | "LIFETIME_SPEND" | "VISIT_COUNT" | "POINTS_EARNED";
    thresholdMinorOrPoints: number;
    qualificationWindowDays?: number;
    multiplierNumerator?: number;
    multiplierDenominator?: number;
    downgradePolicy?: "RECALCULATE" | "GRACE_PERIOD" | "NO_DOWNGRADE";
    gracePeriodDays?: number;
    benefits?: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string;
  }) {
    this.require(permissions.loyaltyManage);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO loyalty_tiers
            (tenant_id,id,program_id,code,name,rank,qualification_type,threshold_minor_or_points,
             qualification_window_days,points_multiplier_numerator,points_multiplier_denominator,
             downgrade_policy,grace_period_days,benefits_json,effective_from,effective_to,active,
             created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,1,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.programId,
          input.code.toUpperCase(),
          input.name,
          input.rank,
          input.qualificationType,
          input.thresholdMinorOrPoints,
          input.qualificationWindowDays ?? null,
          input.multiplierNumerator ?? 1,
          input.multiplierDenominator ?? 1,
          input.downgradePolicy ?? "RECALCULATE",
          input.gracePeriodDays ?? null,
          JSON.stringify(input.benefits ?? {}),
          input.effectiveFrom,
          input.effectiveTo ?? null,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "LOYALTY_TIER_CREATED",
        entityType: "LOYALTY_TIER",
        entityId: id,
        at: stamp,
      }),
    ]);
    return { id };
  }

  async createReward(input: {
    programId: string;
    code: string;
    name: string;
    rewardType:
      | "FIXED_DISCOUNT"
      | "PERCENTAGE_DISCOUNT"
      | "FREE_ITEM"
      | "FREE_CATEGORY_ITEM"
      | "POINTS_BONUS"
      | "FREE_DELIVERY"
      | "NON_FINANCIAL";
    pointsCost: number;
    valueMinor?: number;
    percentageBasisPoints?: number;
    itemId?: string;
    categoryCode?: string;
    minimumTierId?: string;
    eligibility?: Record<string, unknown>;
    validFrom: string;
    validTo?: string;
  }) {
    this.require(permissions.loyaltyManage);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO loyalty_rewards
            (tenant_id,id,program_id,code,name,reward_type,points_cost,value_minor,
             percentage_basis_points,item_id,category_code,minimum_tier_id,eligibility_json,
             valid_from,valid_to,active,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.programId,
          input.code.toUpperCase(),
          input.name,
          input.rewardType,
          input.pointsCost,
          input.valueMinor ?? null,
          input.percentageBasisPoints ?? null,
          input.itemId ?? null,
          input.categoryCode ?? null,
          input.minimumTierId ?? null,
          JSON.stringify(input.eligibility ?? {}),
          input.validFrom,
          input.validTo ?? null,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "LOYALTY_REWARD_CREATED",
        entityType: "LOYALTY_REWARD",
        entityId: id,
        at: stamp,
      }),
    ]);
    return { id };
  }

  async joinProgram(customerId: string, programId: string) {
    this.require(permissions.loyaltyManage);
    await this.customerExists(customerId);
    const token = generatePublicToken("MEM");
    const hash = await sha256Hex(token);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const firstTier = await this.db
      .prepare(
        `SELECT id FROM loyalty_tiers WHERE tenant_id=? AND program_id=? AND active=1
         ORDER BY rank LIMIT 1`,
      )
      .bind(this.actor.tenantId, programId)
      .first<{ id: string }>();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_loyalty_memberships
            (tenant_id,id,customer_id,program_id,member_number_hash,member_number_last_four,
             tier_id,tier_effective_at,status,joined_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'ACTIVE',?,?,?)
           ON CONFLICT(tenant_id,program_id,customer_id) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          customerId,
          programId,
          hash,
          token.slice(-4),
          firstTier?.id ?? null,
          stamp,
          stamp,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "LOYALTY_MEMBERSHIP_CREATED",
        entityType: "LOYALTY_MEMBERSHIP",
        entityId: id,
        at: stamp,
        metadata: { customerId, programId, memberNumberLastFour: token.slice(-4) },
      }),
    ]);
    return { id, memberToken: token, memberNumberLastFour: token.slice(-4) };
  }

  async loyaltyBalance(customerId: string, programId: string) {
    this.require(permissions.loyaltyView);
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(points),0) AS balance FROM loyalty_ledger
         WHERE tenant_id=? AND customer_id=? AND program_id=?`,
      )
      .bind(this.actor.tenantId, customerId, programId)
      .first<{ balance: number }>();
    return row?.balance ?? 0;
  }

  async earnForCompletedTransaction(input: {
    customerId: string;
    branchId: string;
    brandId?: string;
    channel: string;
    netSpendMinor: number;
    sourceType: "ORDER" | "INVOICE";
    sourceId: string;
    businessDate: string;
    occurredAt?: string;
    idempotencyPrefix: string;
  }) {
    this.require(permissions.loyaltyManage);
    this.branch(input.branchId);
    assertMinorAmount(input.netSpendMinor, true);
    const stamp = input.occurredAt ?? new Date().toISOString();
    const programs = await this.db
      .prepare(
        `SELECT * FROM loyalty_programs WHERE tenant_id=? AND status='ACTIVE'
         AND effective_from<=? AND (expires_at IS NULL OR expires_at>?)
         AND (scope_type='TENANT' OR (scope_type='BRAND' AND brand_id=?)
           OR (scope_type='BRANCH' AND branch_id=?))`,
      )
      .bind(this.actor.tenantId, stamp, stamp, input.brandId ?? "", input.branchId)
      .all<LoyaltyProgramRow>();
    const entries = [] as Array<{
      id: string;
      programId: string;
      points: number;
      duplicate: boolean;
    }>;
    for (const program of programs.results ?? []) {
      if (!eligible(program, input.branchId, input.channel)) continue;
      if (input.netSpendMinor < program.minimum_spend_minor) continue;
      const points = await this.calculatePoints(program, input.customerId, input.netSpendMinor);
      if (points <= 0) continue;
      const id = crypto.randomUUID();
      const idempotencyKey = `${input.idempotencyPrefix}:${program.id}`;
      const expiresAt = expiryFor(program, stamp);
      const result = await this.db
        .prepare(
          `INSERT INTO loyalty_ledger
            (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
             business_date,expires_at,reason,actor_id,correlation_id,idempotency_key,created_at)
           VALUES (?,?,?,?,?,'EARN',?,?,?,?,?,'Completed paid transaction',?,?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.customerId,
          program.id,
          input.branchId,
          points,
          input.sourceType,
          input.sourceId,
          input.businessDate,
          expiresAt,
          this.actor.id,
          crypto.randomUUID(),
          idempotencyKey,
          stamp,
        )
        .run();
      entries.push({
        id,
        programId: program.id,
        points,
        duplicate: (result.meta?.changes ?? 0) === 0,
      });
    }
    return entries;
  }

  async redeemPoints(input: {
    customerId: string;
    programId: string;
    branchId: string;
    channel: string;
    points: number;
    orderId: string;
    businessDate: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.loyaltyRedeem);
    this.branch(input.branchId);
    if (!Number.isSafeInteger(input.points) || input.points <= 0) {
      throw new CrmDomainError("VALIDATION_FAILED", "Points must be a positive integer");
    }
    const program = await this.program(input.programId);
    if (!eligible(program, input.branchId, input.channel)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Loyalty program is not eligible for this sale");
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO loyalty_ledger
            (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
             business_date,reason,actor_id,correlation_id,idempotency_key,created_at)
           SELECT ?,?,?,?,?,'REDEEM',?,'ORDER',?,?,'Points redeemed at checkout',?,?,?,?
           WHERE (SELECT COALESCE(SUM(points),0) FROM loyalty_ledger
                  WHERE tenant_id=? AND customer_id=? AND program_id=?) + ? >= 0
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.customerId,
          input.programId,
          input.branchId,
          -input.points,
          input.orderId,
          input.businessDate,
          this.actor.id,
          correlationId,
          input.idempotencyKey,
          stamp,
          this.actor.tenantId,
          input.customerId,
          input.programId,
          -input.points,
        ),
      auditIfExists(
        this.db,
        this.actor,
        "LOYALTY_POINTS_REDEEMED",
        "LOYALTY_LEDGER",
        id,
        input.branchId,
        correlationId,
        stamp,
      ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) === 0) {
      const replay = await this.db
        .prepare("SELECT id FROM loyalty_ledger WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (replay) return { id: replay.id, duplicate: true };
      throw new CrmDomainError("INSUFFICIENT_BALANCE", "Loyalty points balance is insufficient");
    }
    return { id, duplicate: false };
  }

  async adjustPoints(input: {
    customerId: string;
    programId: string;
    branchId?: string;
    points: number;
    reason: string;
    businessDate: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.loyaltyAdjust);
    if (input.branchId) this.branch(input.branchId);
    if (!Number.isSafeInteger(input.points) || input.points === 0) {
      throw new CrmDomainError("VALIDATION_FAILED", "Adjustment points must be a non-zero integer");
    }
    const program = await this.program(input.programId);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO loyalty_ledger
          (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
           business_date,reason,actor_id,correlation_id,idempotency_key,created_at)
         SELECT ?,?,?,?,?,'ADJUSTMENT',?,'MANUAL_ADJUSTMENT',?,?,?, ?,?,?,?
         WHERE ?=1 OR (SELECT COALESCE(SUM(points),0) FROM loyalty_ledger
           WHERE tenant_id=? AND customer_id=? AND program_id=?) + ? >= 0
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.customerId,
        input.programId,
        input.branchId ?? null,
        input.points,
        id,
        input.businessDate,
        input.reason,
        this.actor.id,
        crypto.randomUUID(),
        input.idempotencyKey,
        stamp,
        program.negative_balance_allowed,
        this.actor.tenantId,
        input.customerId,
        input.programId,
        input.points,
      )
      .run();
    if ((result.meta?.changes ?? 0) === 0) {
      const replay = await this.db
        .prepare("SELECT id FROM loyalty_ledger WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (replay) return { id: replay.id, duplicate: true };
      throw new CrmDomainError(
        "INSUFFICIENT_BALANCE",
        "Adjustment would create a negative balance",
      );
    }
    await this.db.batch([
      this.auditStatement({
        action: "LOYALTY_POINTS_ADJUSTED",
        entityType: "LOYALTY_LEDGER",
        entityId: id,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        reason: input.reason,
        metadata: { points: input.points },
      }),
    ]);
    return { id, duplicate: false };
  }

  async reverseTransactionPoints(input: {
    sourceId: string;
    branchId: string;
    businessDate: string;
    idempotencyPrefix: string;
    numerator?: number;
    denominator?: number;
  }) {
    this.require(permissions.loyaltyManage);
    this.branch(input.branchId);
    const numerator = input.numerator ?? 1;
    const denominator = input.denominator ?? 1;
    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      numerator <= 0 ||
      denominator <= 0 ||
      numerator > denominator
    ) {
      throw new CrmDomainError("VALIDATION_FAILED", "Refund ratio is invalid");
    }
    const earns = await this.db
      .prepare(
        `SELECT id,customer_id,program_id,points FROM loyalty_ledger
         WHERE tenant_id=? AND source_id=? AND entry_type='EARN'`,
      )
      .bind(this.actor.tenantId, input.sourceId)
      .all<{ id: string; customer_id: string; program_id: string; points: number }>();
    const results = [];
    for (const earn of earns.results ?? []) {
      const points = Math.floor((earn.points * numerator) / denominator);
      if (!points) continue;
      const id = crypto.randomUUID();
      const key = `${input.idempotencyPrefix}:${earn.id}`;
      const result = await this.db
        .prepare(
          `INSERT INTO loyalty_ledger
            (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,source_id,
             source_entry_id,business_date,reason,actor_id,correlation_id,idempotency_key,created_at)
           VALUES (?,?,?,?,?,'REVERSAL',?,'REFUND',?,?,?,'Refund reversal',?,?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          earn.customer_id,
          earn.program_id,
          input.branchId,
          -points,
          input.sourceId,
          earn.id,
          input.businessDate,
          this.actor.id,
          crypto.randomUUID(),
          key,
          new Date().toISOString(),
        )
        .run();
      results.push({ id, points: -points, duplicate: (result.meta?.changes ?? 0) === 0 });
    }
    return results;
  }

  async expirePoints(asOf = new Date()) {
    this.require(permissions.loyaltyManage);
    const stamp = asOf.toISOString();
    const rows = await this.db
      .prepare(
        `SELECT customer_id,program_id,
                SUM(CASE WHEN points>0 AND expires_at IS NOT NULL AND expires_at<=? THEN points ELSE 0 END) AS expired_earned,
                ABS(SUM(CASE WHEN entry_type='EXPIRE' THEN points ELSE 0 END)) AS already_expired,
                SUM(points) AS current_balance
         FROM loyalty_ledger WHERE tenant_id=? GROUP BY customer_id,program_id
         HAVING expired_earned>already_expired AND current_balance>0`,
      )
      .bind(stamp, this.actor.tenantId)
      .all<{
        customer_id: string;
        program_id: string;
        expired_earned: number;
        already_expired: number;
        current_balance: number;
      }>();
    let expiredEntries = 0;
    for (const row of rows.results ?? []) {
      const points = Math.min(row.expired_earned - row.already_expired, row.current_balance);
      if (points <= 0) continue;
      const businessDate = stamp.slice(0, 10);
      const key = `loyalty-expiry:${row.customer_id}:${row.program_id}:${businessDate}`;
      const result = await this.db
        .prepare(
          `INSERT INTO loyalty_ledger
            (tenant_id,id,customer_id,program_id,entry_type,points,source_type,source_id,
             business_date,reason,actor_id,correlation_id,idempotency_key,created_at)
           VALUES (?,?,?,?,'EXPIRE',?,'EXPIRY_WORKER',?,?, 'Configured points expiry',?,?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          row.customer_id,
          row.program_id,
          -points,
          key,
          businessDate,
          this.actor.id,
          crypto.randomUUID(),
          key,
          stamp,
        )
        .run();
      expiredEntries += result.meta?.changes ?? 0;
    }
    return { expiredEntries };
  }

  async recalculateTiers() {
    this.require(permissions.loyaltyManage);
    const memberships = await this.db
      .prepare(
        `SELECT m.id,m.customer_id,m.program_id,m.tier_id,
                COALESCE((SELECT SUM(points) FROM loyalty_ledger l WHERE l.tenant_id=m.tenant_id
                  AND l.customer_id=m.customer_id AND l.program_id=m.program_id AND l.points>0),0) AS points_earned,
                COALESCE((SELECT SUM(net_spend_minor) FROM customer_metric_snapshots s
                  WHERE s.tenant_id=m.tenant_id AND s.customer_id=m.customer_id
                    AND s.period_key='LIFETIME'),0) AS lifetime_spend,
                COALESCE((SELECT SUM(visit_count) FROM customer_metric_snapshots s
                  WHERE s.tenant_id=m.tenant_id AND s.customer_id=m.customer_id
                    AND s.period_key='LIFETIME'),0) AS visits
         FROM customer_loyalty_memberships m WHERE m.tenant_id=? AND m.status='ACTIVE'`,
      )
      .bind(this.actor.tenantId)
      .all<{
        id: string;
        customer_id: string;
        program_id: string;
        tier_id: string | null;
        points_earned: number;
        lifetime_spend: number;
        visits: number;
      }>();
    let changed = 0;
    const stamp = new Date().toISOString();
    for (const membership of memberships.results ?? []) {
      const tiers = await this.db
        .prepare(
          `SELECT id,qualification_type,threshold_minor_or_points FROM loyalty_tiers
           WHERE tenant_id=? AND program_id=? AND active=1 AND effective_from<=?
             AND (effective_to IS NULL OR effective_to>?) ORDER BY rank DESC`,
        )
        .bind(this.actor.tenantId, membership.program_id, stamp, stamp)
        .all<{ id: string; qualification_type: string; threshold_minor_or_points: number }>();
      const tier = (tiers.results ?? []).find((candidate) => {
        const metric =
          candidate.qualification_type === "VISIT_COUNT"
            ? membership.visits
            : candidate.qualification_type === "POINTS_EARNED"
              ? membership.points_earned
              : membership.lifetime_spend;
        return metric >= candidate.threshold_minor_or_points;
      });
      if (!tier || tier.id === membership.tier_id) continue;
      const result = await this.db
        .prepare(
          `UPDATE customer_loyalty_memberships SET tier_id=?,tier_effective_at=?,updated_at=?
           WHERE tenant_id=? AND id=? AND COALESCE(tier_id,'')=COALESCE(?,'')`,
        )
        .bind(tier.id, stamp, stamp, this.actor.tenantId, membership.id, membership.tier_id ?? null)
        .run();
      changed += result.meta?.changes ?? 0;
    }
    return { changed };
  }

  async listVouchers() {
    this.require(permissions.voucherView);
    const scopedBranch = this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : null;
    const rows = await this.db
      .prepare(
        `SELECT d.*,
                (SELECT COUNT(*) FROM voucher_issues i WHERE i.tenant_id=d.tenant_id
                  AND i.voucher_definition_id=d.id) AS issued,
                (SELECT COUNT(*) FROM voucher_redemptions r WHERE r.tenant_id=d.tenant_id
                  AND r.voucher_definition_id=d.id AND r.status='CONFIRMED') AS redeemed
         FROM voucher_definitions d WHERE d.tenant_id=?
           AND (? IS NULL OR d.branch_scope_json='[]' OR EXISTS (
             SELECT 1 FROM json_each(d.branch_scope_json) WHERE value=?))
         ORDER BY d.created_at DESC`,
      )
      .bind(this.actor.tenantId, scopedBranch, scopedBranch)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async createVoucherDefinition(input: {
    code: string;
    name: string;
    validFrom: string;
    validTo?: string;
    branchIds: string[];
    channels: string[];
    itemIds: string[];
    categoryCodes: string[];
    minimumSpendMinor: number;
    currency?: string;
    discountType: "FIXED_MINOR" | "PERCENT_BPS" | "FREE_ITEM" | "NON_FINANCIAL";
    discountValue: number;
    usageCap?: number;
    perCustomerCap?: number;
    customerSpecific: boolean;
    singleUse: boolean;
    stackingPolicy: "ALLOW" | "BLOCK" | "BEST_ONLY" | "PRIORITY_ORDER";
    stackingPriority: number;
    refundPolicy?: "KEEP_REDEMPTION" | "RESTORE_ON_FULL_REFUND";
  }) {
    this.require(permissions.voucherManage);
    for (const branchId of input.branchIds) this.branch(branchId);
    if (input.discountType === "PERCENT_BPS" && input.discountValue > 10_000) {
      throw new CrmDomainError("VALIDATION_FAILED", "Percentage discount cannot exceed 100%");
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO voucher_definitions
            (tenant_id,id,code,name,status,valid_from,valid_to,branch_scope_json,channel_scope_json,
             item_scope_json,category_scope_json,minimum_spend_minor,currency,discount_type,
             discount_value,usage_cap,per_customer_cap,customer_specific,single_use,
             stacking_policy,stacking_priority,refund_policy,created_by,created_at,updated_at)
           VALUES (?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.trim().toUpperCase(),
          input.name,
          input.validFrom,
          input.validTo ?? null,
          JSON.stringify(input.branchIds),
          JSON.stringify(input.channels),
          JSON.stringify(input.itemIds),
          JSON.stringify(input.categoryCodes),
          input.minimumSpendMinor,
          input.currency ?? null,
          input.discountType,
          input.discountValue,
          input.usageCap ?? null,
          input.perCustomerCap ?? null,
          Number(input.customerSpecific),
          Number(input.singleUse),
          input.stackingPolicy,
          input.stackingPriority,
          input.refundPolicy ?? "KEEP_REDEMPTION",
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "VOUCHER_DEFINITION_CREATED",
        entityType: "VOUCHER_DEFINITION",
        entityId: id,
        at: stamp,
      }),
    ]);
    return { id };
  }

  async issueVoucher(input: {
    voucherDefinitionId: string;
    customerId?: string;
    expiresAt?: string;
    sourceType: string;
    sourceId?: string;
  }) {
    this.require(permissions.voucherManage);
    if (input.customerId) await this.customerExists(input.customerId);
    const token = generatePublicToken("VCH");
    const hash = await sha256Hex(normalizeVoucherCode(token));
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO voucher_issues
            (tenant_id,id,voucher_definition_id,customer_id,code_hash,code_last_four,status,
             issued_by,issued_at,expires_at,source_type,source_id)
           VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.voucherDefinitionId,
          input.customerId ?? null,
          hash,
          token.slice(-4),
          this.actor.id,
          stamp,
          input.expiresAt ?? null,
          input.sourceType,
          input.sourceId ?? null,
        ),
      this.auditStatement({
        action: "VOUCHER_ISSUED",
        entityType: "VOUCHER_ISSUE",
        entityId: id,
        at: stamp,
        metadata: { codeLastFour: token.slice(-4), customerId: input.customerId ?? null },
      }),
    ]);
    return { id, code: token, codeLastFour: token.slice(-4) };
  }

  async validateVoucher(input: {
    code: string;
    customerId?: string;
    branchId: string;
    channel: string;
    subtotalMinor: number;
    eligibleItemSubtotalMinor?: number;
    lineItems?: Array<{ itemId?: string; categoryCode?: string; subtotalMinor: number }>;
    currency: string;
  }) {
    this.require(permissions.voucherView);
    this.branch(input.branchId);
    assertMinorAmount(input.subtotalMinor, true);
    const voucher = await this.resolveVoucher(input.code);
    const now = new Date().toISOString();
    if (!voucher || voucher.status !== "ACTIVE") {
      throw new CrmDomainError("NOT_FOUND", "Active voucher was not found");
    }
    if (voucher.valid_from > now || (voucher.valid_to && voucher.valid_to <= now)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher is outside its validity period");
    }
    if (voucher.issue_status && voucher.issue_status !== "ACTIVE") {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher issue is not active");
    }
    if (voucher.issue_expires_at && voucher.issue_expires_at <= now) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher issue has expired");
    }
    const branches = safeJson<string[]>(voucher.branch_scope_json, []);
    const channels = safeJson<string[]>(voucher.channel_scope_json, []);
    if (branches.length && !branches.includes(input.branchId)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher is not valid at this branch");
    }
    if (channels.length && !channels.includes(input.channel)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher is not valid for this channel");
    }
    if (voucher.currency && voucher.currency !== input.currency) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher currency does not match the order");
    }
    if (input.subtotalMinor < voucher.minimum_spend_minor) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Order does not meet voucher minimum spend");
    }
    if (
      voucher.customer_specific === 1 &&
      (!input.customerId || voucher.issue_customer_id !== input.customerId)
    ) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher belongs to another customer");
    }
    const usage = await this.voucherUsage(
      voucher.definition_id,
      voucher.issue_id,
      input.customerId,
    );
    if (voucher.usage_cap && usage.total >= voucher.usage_cap) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher usage cap has been reached");
    }
    if (voucher.per_customer_cap && usage.customer >= voucher.per_customer_cap) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Customer voucher usage cap has been reached");
    }
    if (voucher.single_use === 1 && voucher.issue_id && usage.issue > 0) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher has already been redeemed");
    }
    const scopedItemIds = safeJson<string[]>(voucher.item_scope_json, []);
    const scopedCategories = safeJson<string[]>(voucher.category_scope_json, []);
    let basis = input.subtotalMinor;
    if (scopedItemIds.length || scopedCategories.length) {
      if (!input.lineItems) {
        throw new CrmDomainError(
          "NOT_ELIGIBLE",
          "Voucher item or category scope requires authoritative order lines",
        );
      }
      basis = input.lineItems.reduce((sum, line) => {
        assertMinorAmount(line.subtotalMinor, true);
        const matchesItem = Boolean(line.itemId && scopedItemIds.includes(line.itemId));
        const matchesCategory = Boolean(
          line.categoryCode && scopedCategories.includes(line.categoryCode),
        );
        return sum + (matchesItem || matchesCategory ? line.subtotalMinor : 0);
      }, 0);
      if (basis <= 0) {
        throw new CrmDomainError("NOT_ELIGIBLE", "Order has no items eligible for this voucher");
      }
    } else if (input.eligibleItemSubtotalMinor !== undefined) {
      basis = Math.min(input.eligibleItemSubtotalMinor, input.subtotalMinor);
    }
    const discountMinor =
      voucher.discount_type === "FIXED_MINOR"
        ? Math.min(voucher.discount_value, input.subtotalMinor)
        : voucher.discount_type === "PERCENT_BPS"
          ? Math.min(Math.floor((basis * voucher.discount_value) / 10_000), input.subtotalMinor)
          : voucher.discount_type === "FREE_ITEM"
            ? Math.min(basis, input.subtotalMinor)
            : 0;
    return {
      voucherDefinitionId: voucher.definition_id,
      voucherIssueId: voucher.issue_id ?? undefined,
      discountMinor,
      stackingPolicy: voucher.stacking_policy,
      stackingPriority: voucher.stacking_priority,
      eligible: true,
    };
  }

  async redeemVoucher(input: {
    code: string;
    customerId?: string;
    branchId: string;
    orderId: string;
    invoiceId?: string;
    channel: string;
    subtotalMinor: number;
    eligibleItemSubtotalMinor?: number;
    currency: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.voucherManage);
    const replay = await this.db
      .prepare(
        "SELECT id,discount_minor FROM voucher_redemptions WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; discount_minor: number }>();
    if (replay) return { id: replay.id, discountMinor: replay.discount_minor, duplicate: true };
    const validation = await this.validateVoucher(input);
    const voucher = await this.resolveVoucher(input.code);
    if (!voucher) throw new CrmDomainError("NOT_FOUND", "Voucher was not found");
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO voucher_redemptions
            (tenant_id,id,voucher_definition_id,voucher_issue_id,customer_id,branch_id,order_id,
             invoice_id,channel,discount_minor,currency,status,actor_id,idempotency_key,
             correlation_id,redeemed_at)
           SELECT ?,?,?,?,?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?
           WHERE (? IS NULL OR (SELECT COUNT(*) FROM voucher_redemptions
             WHERE tenant_id=? AND voucher_definition_id=? AND status='CONFIRMED') < ?)
             AND (? IS NULL OR ? IS NULL OR (SELECT COUNT(*) FROM voucher_redemptions
               WHERE tenant_id=? AND voucher_definition_id=? AND customer_id=? AND status='CONFIRMED') < ?)
             AND (? IS NULL OR (SELECT COUNT(*) FROM voucher_redemptions
               WHERE tenant_id=? AND voucher_issue_id=? AND status='CONFIRMED')=0)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          validation.voucherDefinitionId,
          validation.voucherIssueId ?? null,
          input.customerId ?? null,
          input.branchId,
          input.orderId,
          input.invoiceId ?? null,
          input.channel,
          validation.discountMinor,
          input.currency,
          this.actor.id,
          input.idempotencyKey,
          correlationId,
          stamp,
          voucher.usage_cap,
          this.actor.tenantId,
          validation.voucherDefinitionId,
          voucher.usage_cap ?? 0,
          voucher.per_customer_cap,
          input.customerId ?? null,
          this.actor.tenantId,
          validation.voucherDefinitionId,
          input.customerId ?? "",
          voucher.per_customer_cap ?? 0,
          validation.voucherIssueId ?? null,
          this.actor.tenantId,
          validation.voucherIssueId ?? "",
        ),
      auditIfExists(
        this.db,
        this.actor,
        "VOUCHER_REDEEMED",
        "VOUCHER_REDEMPTION",
        id,
        input.branchId,
        correlationId,
        stamp,
      ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) === 0) {
      const concurrentReplay = await this.db
        .prepare(
          "SELECT id,discount_minor FROM voucher_redemptions WHERE tenant_id=? AND idempotency_key=?",
        )
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string; discount_minor: number }>();
      if (concurrentReplay) {
        return {
          id: concurrentReplay.id,
          discountMinor: concurrentReplay.discount_minor,
          duplicate: true,
        };
      }
      throw new CrmDomainError(
        "CONFLICT",
        "Voucher was redeemed concurrently or reached its usage cap",
      );
    }
    if (validation.voucherIssueId && voucher.single_use === 1) {
      await this.db
        .prepare(
          `UPDATE voucher_issues SET status='REDEEMED' WHERE tenant_id=? AND id=?
           AND EXISTS (SELECT 1 FROM voucher_redemptions WHERE tenant_id=? AND id=? AND status='CONFIRMED')`,
        )
        .bind(this.actor.tenantId, validation.voucherIssueId, this.actor.tenantId, id)
        .run();
    }
    return { id, discountMinor: validation.discountMinor, duplicate: false };
  }

  async reverseVoucherRedemption(redemptionId: string, reason: string, idempotencyKey: string) {
    this.require(permissions.voucherManage);
    const original = await this.db
      .prepare(
        "SELECT * FROM voucher_redemptions WHERE tenant_id=? AND id=? AND status='CONFIRMED'",
      )
      .bind(this.actor.tenantId, redemptionId)
      .first<Record<string, unknown>>();
    if (!original) throw new CrmDomainError("NOT_FOUND", "Voucher redemption was not found");
    const policy = await this.db
      .prepare("SELECT refund_policy FROM voucher_definitions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, original["voucher_definition_id"])
      .first<{ refund_policy: string }>();
    if (policy?.refund_policy !== "RESTORE_ON_FULL_REFUND") {
      throw new CrmDomainError("NOT_ELIGIBLE", "Voucher policy keeps redemption after refund");
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO voucher_redemptions
          (tenant_id,id,voucher_definition_id,voucher_issue_id,customer_id,branch_id,order_id,
           invoice_id,channel,discount_minor,currency,status,source_redemption_id,actor_id,
           idempotency_key,correlation_id,redeemed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'REVERSED',?,?,?,?,?)
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        this.actor.tenantId,
        id,
        original["voucher_definition_id"],
        original["voucher_issue_id"],
        original["customer_id"],
        original["branch_id"],
        original["order_id"],
        original["invoice_id"],
        original["channel"],
        original["discount_minor"],
        original["currency"],
        redemptionId,
        this.actor.id,
        idempotencyKey,
        crypto.randomUUID(),
        stamp,
      )
      .run();
    if ((result.meta?.changes ?? 0) > 0 && original["voucher_issue_id"]) {
      await this.db
        .prepare(
          "UPDATE voucher_issues SET status='ACTIVE' WHERE tenant_id=? AND id=? AND status='REDEEMED'",
        )
        .bind(this.actor.tenantId, original["voucher_issue_id"])
        .run();
    }
    return { id, duplicate: (result.meta?.changes ?? 0) === 0, reason };
  }

  async listGiftCards() {
    this.require(permissions.giftCardView);
    const rows = await this.db
      .prepare(
        `SELECT g.id,g.token_last_four,g.status,g.currency,g.original_value_minor,g.issued_at,g.expires_at,
                COALESCE(SUM(l.amount_minor),0) AS balance_minor
         FROM gift_cards g LEFT JOIN gift_card_ledger l ON l.tenant_id=g.tenant_id AND l.gift_card_id=g.id
         WHERE g.tenant_id=? GROUP BY g.id ORDER BY g.issued_at DESC LIMIT 500`,
      )
      .bind(this.actor.tenantId)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async issueGiftCard(input: {
    amountMinor: number;
    currency: string;
    purchaserCustomerId?: string;
    recipientCustomerId?: string;
    liabilityAccountId: string;
    collectionAccountId: string;
    redemptionAccountId: string;
    breakageAccountId?: string;
    expiresAt?: string;
    businessDate: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.giftCardManage);
    assertMinorAmount(input.amountMinor);
    await this.assertAccountCurrencies(
      [input.liabilityAccountId, input.collectionAccountId, input.redemptionAccountId],
      input.currency,
    );
    const existing = await this.db
      .prepare("SELECT gift_card_id FROM gift_card_ledger WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ gift_card_id: string }>();
    if (existing) return { id: existing.gift_card_id, duplicate: true };
    const token = generatePublicToken("GFT");
    const hash = await sha256Hex(token);
    const id = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();
    const journalId = `gift-card-issue:${ledgerId}`;
    const correlationId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO gift_cards
            (tenant_id,id,token_hash,token_last_four,status,currency,original_value_minor,
             purchaser_customer_id,recipient_customer_id,liability_account_id,collection_account_id,
             redemption_account_id,breakage_account_id,issued_at,expires_at,created_by,created_at,updated_at)
           VALUES (?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          hash,
          token.slice(-4),
          input.currency,
          input.amountMinor,
          input.purchaserCustomerId ?? null,
          input.recipientCustomerId ?? null,
          input.liabilityAccountId,
          input.collectionAccountId,
          input.redemptionAccountId,
          input.breakageAccountId ?? null,
          stamp,
          input.expiresAt ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO gift_card_ledger
            (tenant_id,id,gift_card_id,entry_type,amount_minor,currency,source_type,source_id,
             actor_id,business_date,reason,idempotency_key,correlation_id,journal_entry_id,created_at)
           VALUES (?,?,?,'ISSUE',?,?, 'GIFT_CARD_ISSUE',?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          ledgerId,
          id,
          input.amountMinor,
          input.currency,
          id,
          this.actor.id,
          input.businessDate,
          "Gift card value issued",
          input.idempotencyKey,
          correlationId,
          journalId,
          stamp,
        ),
      journalHeader(
        this.db,
        this.actor.tenantId,
        journalId,
        null,
        "GIFT_CARD_ISSUE",
        ledgerId,
        input.businessDate,
        correlationId,
        stamp,
      ),
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        1,
        input.collectionAccountId,
        input.amountMinor,
        0,
        input.currency,
      ),
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        2,
        input.liabilityAccountId,
        0,
        input.amountMinor,
        input.currency,
      ),
      postJournal(this.db, this.actor.tenantId, journalId, stamp),
      this.auditStatement({
        action: "GIFT_CARD_ISSUED",
        entityType: "GIFT_CARD",
        entityId: id,
        correlationId,
        at: stamp,
        metadata: {
          tokenLastFour: token.slice(-4),
          amountMinor: input.amountMinor,
          currency: input.currency,
        },
      }),
    ]);
    return { id, token, tokenLastFour: token.slice(-4), duplicate: false };
  }

  async giftCardBalance(token: string) {
    this.require(permissions.giftCardView);
    const hash = await sha256Hex(token.trim());
    const row = await this.db
      .prepare(
        `SELECT g.id,g.token_last_four,g.status,g.currency,g.expires_at,
                COALESCE(SUM(l.amount_minor),0) AS balance_minor
         FROM gift_cards g LEFT JOIN gift_card_ledger l ON l.tenant_id=g.tenant_id AND l.gift_card_id=g.id
         WHERE g.tenant_id=? AND g.token_hash=? GROUP BY g.id`,
      )
      .bind(this.actor.tenantId, hash)
      .first<{
        id: string;
        token_last_four: string;
        status: string;
        currency: string;
        expires_at: string | null;
        balance_minor: number;
      }>();
    if (!row) throw new CrmDomainError("NOT_FOUND", "Gift card was not found");
    return row;
  }

  async redeemGiftCard(input: {
    token: string;
    amountMinor: number;
    currency: string;
    branchId: string;
    orderId: string;
    invoiceId?: string;
    businessDate: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.giftCardManage);
    this.branch(input.branchId);
    assertMinorAmount(input.amountMinor);
    const hash = await sha256Hex(input.token.trim());
    const card = await this.db
      .prepare(
        `SELECT id,status,currency,expires_at,liability_account_id,redemption_account_id
         FROM gift_cards WHERE tenant_id=? AND token_hash=?`,
      )
      .bind(this.actor.tenantId, hash)
      .first<{
        id: string;
        status: string;
        currency: string;
        expires_at: string | null;
        liability_account_id: string;
        redemption_account_id: string;
      }>();
    if (!card) throw new CrmDomainError("NOT_FOUND", "Gift card was not found");
    if (card.currency !== input.currency) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Gift card currency does not match the order");
    }
    if (
      card.status !== "ACTIVE" ||
      (card.expires_at && card.expires_at <= new Date().toISOString())
    ) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Gift card is not active");
    }
    const id = crypto.randomUUID();
    const journalId = `gift-card-redeem:${id}`;
    const correlationId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO gift_card_ledger
            (tenant_id,id,gift_card_id,branch_id,entry_type,amount_minor,currency,source_type,
             source_id,actor_id,business_date,reason,idempotency_key,correlation_id,
             journal_entry_id,created_at)
           SELECT ?,?,?,?,'REDEEM',?,?, 'ORDER',?,?,?,?,?,?,?,?
           WHERE (SELECT COALESCE(SUM(amount_minor),0) FROM gift_card_ledger
                  WHERE tenant_id=? AND gift_card_id=?) + ? >= 0
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          card.id,
          input.branchId,
          -input.amountMinor,
          input.currency,
          input.orderId,
          this.actor.id,
          input.businessDate,
          "Gift card redeemed at checkout",
          input.idempotencyKey,
          correlationId,
          journalId,
          stamp,
          this.actor.tenantId,
          card.id,
          -input.amountMinor,
        ),
      journalHeaderIfLedgerExists(
        this.db,
        this.actor.tenantId,
        journalId,
        input.branchId,
        "GIFT_CARD_REDEMPTION",
        id,
        input.businessDate,
        correlationId,
        stamp,
      ),
      journalLineIfLedgerExists(
        this.db,
        this.actor.tenantId,
        journalId,
        id,
        1,
        card.liability_account_id,
        input.amountMinor,
        0,
        input.currency,
      ),
      journalLineIfLedgerExists(
        this.db,
        this.actor.tenantId,
        journalId,
        id,
        2,
        card.redemption_account_id,
        0,
        input.amountMinor,
        input.currency,
      ),
      postJournalIfLedgerExists(this.db, this.actor.tenantId, journalId, id, stamp),
      auditIfExists(
        this.db,
        this.actor,
        "GIFT_CARD_REDEEMED",
        "GIFT_CARD_LEDGER",
        id,
        input.branchId,
        correlationId,
        stamp,
      ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) === 0) {
      const replay = await this.db
        .prepare("SELECT id FROM gift_card_ledger WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (replay) return { id: replay.id, duplicate: true };
      throw new CrmDomainError("INSUFFICIENT_BALANCE", "Gift card balance is insufficient");
    }
    await this.db
      .prepare(
        `UPDATE gift_cards SET status=CASE WHEN (SELECT COALESCE(SUM(amount_minor),0)
           FROM gift_card_ledger WHERE tenant_id=? AND gift_card_id=?)=0 THEN 'REDEEMED' ELSE status END,
           updated_at=? WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, card.id, stamp, this.actor.tenantId, card.id)
      .run();
    return { id, duplicate: false };
  }

  async refundGiftCardValue(input: {
    giftCardId: string;
    originalRedemptionId: string;
    amountMinor: number;
    currency: string;
    branchId: string;
    businessDate: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.giftCardAdjust);
    this.branch(input.branchId);
    assertMinorAmount(input.amountMinor);
    const card = await this.db
      .prepare(
        `SELECT currency,liability_account_id,redemption_account_id
         FROM gift_cards WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, input.giftCardId)
      .first<{ currency: string; liability_account_id: string; redemption_account_id: string }>();
    if (!card) throw new CrmDomainError("NOT_FOUND", "Gift card was not found");
    if (card.currency !== input.currency)
      throw new CrmDomainError("NOT_ELIGIBLE", "Currency mismatch");
    const original = await this.db
      .prepare(
        `SELECT amount_minor FROM gift_card_ledger WHERE tenant_id=? AND id=?
         AND gift_card_id=? AND entry_type='REDEEM'`,
      )
      .bind(this.actor.tenantId, input.originalRedemptionId, input.giftCardId)
      .first<{ amount_minor: number }>();
    if (!original || input.amountMinor > Math.abs(original.amount_minor)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Gift-card refund exceeds original redemption");
    }
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const journalId = `gift-card-refund:${id}`;
    const stamp = new Date().toISOString();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO gift_card_ledger
          (tenant_id,id,gift_card_id,branch_id,entry_type,amount_minor,currency,source_type,source_id,
           source_entry_id,actor_id,business_date,reason,idempotency_key,correlation_id,journal_entry_id,created_at)
         SELECT ?,?,?,?,'REFUND',?,?,'REFUND',?,?,?,?,'Gift-card value restored after refund',?,?,?,?
         WHERE ? <= ABS(?) - COALESCE((SELECT SUM(amount_minor) FROM gift_card_ledger
           WHERE tenant_id=? AND source_entry_id=? AND entry_type IN ('REFUND','REVERSAL')),0)
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.giftCardId,
          input.branchId,
          input.amountMinor,
          input.currency,
          input.originalRedemptionId,
          input.originalRedemptionId,
          this.actor.id,
          input.businessDate,
          input.idempotencyKey,
          correlationId,
          journalId,
          stamp,
          input.amountMinor,
          original.amount_minor,
          this.actor.tenantId,
          input.originalRedemptionId,
        ),
      journalHeaderIfLedgerExists(
        this.db,
        this.actor.tenantId,
        journalId,
        input.branchId,
        "GIFT_CARD_REFUND",
        id,
        input.businessDate,
        correlationId,
        stamp,
      ),
      journalLineIfLedgerExists(
        this.db,
        this.actor.tenantId,
        journalId,
        id,
        1,
        card.redemption_account_id,
        input.amountMinor,
        0,
        input.currency,
      ),
      journalLineIfLedgerExists(
        this.db,
        this.actor.tenantId,
        journalId,
        id,
        2,
        card.liability_account_id,
        0,
        input.amountMinor,
        input.currency,
      ),
      postJournalIfLedgerExists(this.db, this.actor.tenantId, journalId, id, stamp),
      auditIfExists(
        this.db,
        this.actor,
        "GIFT_CARD_VALUE_RESTORED",
        "GIFT_CARD_LEDGER",
        id,
        input.branchId,
        correlationId,
        stamp,
      ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) === 0) {
      const replay = await this.db
        .prepare("SELECT id FROM gift_card_ledger WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (replay) return { id: replay.id, duplicate: true };
      throw new CrmDomainError("CONFLICT", "Gift-card refund capacity was exhausted");
    }
    await this.db
      .prepare("UPDATE gift_cards SET status='ACTIVE',updated_at=? WHERE tenant_id=? AND id=?")
      .bind(stamp, this.actor.tenantId, input.giftCardId)
      .run();
    return { id, duplicate: false };
  }

  async expireVouchers(asOf = new Date()) {
    this.require(permissions.voucherManage);
    const stamp = asOf.toISOString();
    const definitions = await this.db
      .prepare(
        `UPDATE voucher_definitions SET status='EXPIRED',updated_at=?
         WHERE tenant_id=? AND status='ACTIVE' AND valid_to IS NOT NULL AND valid_to<=?`,
      )
      .bind(stamp, this.actor.tenantId, stamp)
      .run();
    const issues = await this.db
      .prepare(
        `UPDATE voucher_issues SET status='EXPIRED'
         WHERE tenant_id=? AND status='ACTIVE' AND (
           (expires_at IS NOT NULL AND expires_at<=?) OR EXISTS (
             SELECT 1 FROM voucher_definitions d
             WHERE d.tenant_id=voucher_issues.tenant_id
               AND d.id=voucher_issues.voucher_definition_id AND d.status='EXPIRED'))`,
      )
      .bind(this.actor.tenantId, stamp)
      .run();
    const expiredDefinitions = definitions.meta?.changes ?? 0;
    const expiredIssues = issues.meta?.changes ?? 0;
    if (expiredDefinitions + expiredIssues > 0) {
      await this.db.batch([
        this.auditStatement({
          action: "VOUCHERS_EXPIRED",
          entityType: "VOUCHER_EXPIRY_RUN",
          entityId: stamp.slice(0, 10),
          at: stamp,
          metadata: { expiredDefinitions, expiredIssues },
        }),
      ]);
    }
    return { expiredDefinitions, expiredIssues };
  }

  async expireStoredValue(asOf = new Date()) {
    this.require(permissions.giftCardManage);
    const stamp = asOf.toISOString();
    const cards = await this.db
      .prepare(
        `SELECT g.id,g.currency,COALESCE(SUM(l.amount_minor),0) AS balance_minor
         FROM gift_cards g JOIN gift_card_ledger l ON l.tenant_id=g.tenant_id AND l.gift_card_id=g.id
         WHERE g.tenant_id=? AND g.status='ACTIVE' AND g.expires_at IS NOT NULL AND g.expires_at<=?
         GROUP BY g.id HAVING balance_minor>0`,
      )
      .bind(this.actor.tenantId, stamp)
      .all<{ id: string; currency: string; balance_minor: number }>();
    let expired = 0;
    for (const card of cards.results ?? []) {
      const key = `gift-expiry:${card.id}:${stamp.slice(0, 10)}`;
      const result = await this.db
        .prepare(
          `INSERT INTO gift_card_ledger
            (tenant_id,id,gift_card_id,entry_type,amount_minor,currency,source_type,source_id,
             actor_id,business_date,reason,idempotency_key,correlation_id,created_at)
           VALUES (?,?,?,'EXPIRY',?,?,'EXPIRY_WORKER',?,?,?,'Configured gift-card expiry',?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          card.id,
          -card.balance_minor,
          card.currency,
          key,
          this.actor.id,
          stamp.slice(0, 10),
          key,
          crypto.randomUUID(),
          stamp,
        )
        .run();
      if ((result.meta?.changes ?? 0) > 0) {
        await this.db
          .prepare("UPDATE gift_cards SET status='EXPIRED',updated_at=? WHERE tenant_id=? AND id=?")
          .bind(stamp, this.actor.tenantId, card.id)
          .run();
        expired += 1;
      }
    }
    const voucherExpiry = await this.expireVouchers(asOf);
    return { expiredGiftCards: expired, ...voucherExpiry };
  }

  static applyStacking(
    candidates: Array<{
      id: string;
      discountMinor: number;
      stackingPolicy: "ALLOW" | "BLOCK" | "BEST_ONLY" | "PRIORITY_ORDER";
      stackingPriority: number;
    }>,
  ) {
    if (!candidates.length) return [];
    const ordered = [...candidates].sort(
      (a, b) =>
        a.stackingPriority - b.stackingPriority ||
        b.discountMinor - a.discountMinor ||
        a.id.localeCompare(b.id),
    );
    if (ordered.some((item) => item.stackingPolicy === "BEST_ONLY")) {
      return [
        ordered.sort((a, b) => b.discountMinor - a.discountMinor || a.id.localeCompare(b.id))[0]!,
      ];
    }
    const blocker = ordered.find((item) => item.stackingPolicy === "BLOCK");
    if (blocker) return [blocker];
    if (ordered.some((item) => item.stackingPolicy === "PRIORITY_ORDER")) return ordered;
    return ordered;
  }

  private async program(programId: string) {
    const program = await this.db
      .prepare("SELECT * FROM loyalty_programs WHERE tenant_id=? AND id=? AND status='ACTIVE'")
      .bind(this.actor.tenantId, programId)
      .first<LoyaltyProgramRow>();
    if (!program) throw new CrmDomainError("NOT_FOUND", "Active loyalty program was not found");
    const now = new Date().toISOString();
    if (program.effective_from > now || (program.expires_at && program.expires_at <= now)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Loyalty program is outside its active period");
    }
    return program;
  }

  private async calculatePoints(
    program: LoyaltyProgramRow,
    customerId: string,
    netSpendMinor: number,
  ) {
    let base = 0;
    if (program.earning_type === "SPEND" && program.spend_minor_per_point) {
      const raw = netSpendMinor / program.spend_minor_per_point;
      base =
        program.rounding_policy === "CEILING"
          ? Math.ceil(raw)
          : program.rounding_policy === "NEAREST"
            ? Math.round(raw)
            : Math.floor(raw);
    } else if (program.earning_type === "VISIT") {
      base = 1;
    }
    const tier = await this.db
      .prepare(
        `SELECT t.points_multiplier_numerator,t.points_multiplier_denominator
         FROM customer_loyalty_memberships m JOIN loyalty_tiers t
           ON t.tenant_id=m.tenant_id AND t.id=m.tier_id
         WHERE m.tenant_id=? AND m.customer_id=? AND m.program_id=? AND m.status='ACTIVE' LIMIT 1`,
      )
      .bind(this.actor.tenantId, customerId, program.id)
      .first<{ points_multiplier_numerator: number; points_multiplier_denominator: number }>();
    return Math.floor(
      (base * (tier?.points_multiplier_numerator ?? 1)) /
        (tier?.points_multiplier_denominator ?? 1),
    );
  }

  private async resolveVoucher(code: string) {
    const normalized = normalizeVoucherCode(code);
    const hash = await sha256Hex(normalized);
    return this.db
      .prepare(
        `SELECT d.id AS definition_id,i.id AS issue_id,i.customer_id AS issue_customer_id,
                i.status AS issue_status,i.expires_at AS issue_expires_at,d.status,d.valid_from,
                d.valid_to,d.branch_scope_json,d.channel_scope_json,d.item_scope_json,
                d.category_scope_json,d.minimum_spend_minor,d.currency,d.discount_type,
                d.discount_value,d.usage_cap,d.per_customer_cap,d.customer_specific,d.single_use,
                d.stacking_policy,d.stacking_priority
         FROM voucher_definitions d
         LEFT JOIN voucher_issues i ON i.tenant_id=d.tenant_id AND i.voucher_definition_id=d.id
           AND i.code_hash=?
         WHERE d.tenant_id=? AND (d.code=? OR i.id IS NOT NULL)
         ORDER BY CASE WHEN i.id IS NOT NULL THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(hash, this.actor.tenantId, normalized)
      .first<VoucherRow>();
  }

  private async voucherUsage(definitionId: string, issueId?: string | null, customerId?: string) {
    const row = await this.db
      .prepare(
        `SELECT
          SUM(CASE WHEN status='CONFIRMED' THEN 1 ELSE -1 END) AS total,
          SUM(CASE WHEN customer_id=? THEN CASE WHEN status='CONFIRMED' THEN 1 ELSE -1 END ELSE 0 END) AS customer,
          SUM(CASE WHEN voucher_issue_id=? THEN CASE WHEN status='CONFIRMED' THEN 1 ELSE -1 END ELSE 0 END) AS issue
         FROM voucher_redemptions WHERE tenant_id=? AND voucher_definition_id=?`,
      )
      .bind(customerId ?? "", issueId ?? "", this.actor.tenantId, definitionId)
      .first<{ total: number | null; customer: number | null; issue: number | null }>();
    return { total: row?.total ?? 0, customer: row?.customer ?? 0, issue: row?.issue ?? 0 };
  }

  private async assertAccountCurrencies(accountIds: string[], currency: string) {
    const rows = await this.db
      .prepare(
        `SELECT id,currency FROM accounts WHERE tenant_id=? AND id IN (${accountIds.map(() => "?").join(",")}) AND active=1`,
      )
      .bind(this.actor.tenantId, ...accountIds)
      .all<{ id: string; currency: string }>();
    if ((rows.results ?? []).length !== new Set(accountIds).size) {
      throw new CrmDomainError("NOT_FOUND", "Configured gift-card account was not found");
    }
    if ((rows.results ?? []).some((row) => row.currency !== currency)) {
      throw new CrmDomainError("NOT_ELIGIBLE", "Gift-card account currency mismatch");
    }
  }
}

function eligible(program: LoyaltyProgramRow, branchId: string, channel: string) {
  const branches = safeJson<string[]>(program.eligible_branches_json, []);
  const channels = safeJson<string[]>(program.eligible_channels_json, []);
  return (
    (!branches.length || branches.includes(branchId)) &&
    (!channels.length || channels.includes(channel))
  );
}

function expiryFor(program: LoyaltyProgramRow, earnedAt: string) {
  if (program.expiry_type === "NONE") return null;
  if (program.expiry_type === "FIXED_DATE") return program.expiry_date;
  const expiry = new Date(earnedAt);
  expiry.setUTCDate(expiry.getUTCDate() + (program.expiry_days ?? 0));
  return expiry.toISOString();
}

function normalizeVoucherCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function auditIfExists(
  db: D1Database,
  actor: ServerActor,
  action: string,
  entityType: string,
  entityId: string,
  branchId: string | null,
  correlationId: string,
  stamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events
        (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
         correlation_id,session_id,metadata_json,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,'{}',?
       WHERE EXISTS (SELECT 1 FROM loyalty_ledger WHERE tenant_id=? AND id=?
         UNION ALL SELECT 1 FROM voucher_redemptions WHERE tenant_id=? AND id=?
         UNION ALL SELECT 1 FROM gift_card_ledger WHERE tenant_id=? AND id=?)`,
    )
    .bind(
      actor.tenantId,
      crypto.randomUUID(),
      branchId,
      actor.id,
      actor.deviceId ?? null,
      action,
      entityType,
      entityId,
      correlationId,
      actor.sessionId ?? null,
      stamp,
      actor.tenantId,
      entityId,
      actor.tenantId,
      entityId,
      actor.tenantId,
      entityId,
    );
}

function journalHeader(
  db: D1Database,
  tenantId: string,
  id: string,
  branchId: string | null,
  sourceType: string,
  sourceId: string,
  businessDate: string,
  correlationId: string,
  stamp: string,
) {
  return db
    .prepare(
      `INSERT INTO journal_entries
        (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
         correlation_id,payload_json,created_at)
       VALUES (?,?,?,?,?,?,'DRAFT',?,?, '{}',?)`,
    )
    .bind(
      tenantId,
      id,
      branchId,
      sourceType,
      sourceId,
      businessDate,
      sourceType,
      correlationId,
      stamp,
    );
}

function journalLine(
  db: D1Database,
  tenantId: string,
  journalId: string,
  line: number,
  accountId: string,
  debit: number,
  credit: number,
  currency: string,
) {
  return db
    .prepare(
      `INSERT INTO journal_lines
        (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
       VALUES (?,?,?,?,?,?,?,'{}')`,
    )
    .bind(tenantId, journalId, line, accountId, debit, credit, currency);
}

function postJournal(db: D1Database, tenantId: string, journalId: string, stamp: string) {
  return db
    .prepare(
      "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=? AND status='DRAFT'",
    )
    .bind(stamp, tenantId, journalId);
}

function journalHeaderIfLedgerExists(
  db: D1Database,
  tenantId: string,
  id: string,
  branchId: string,
  sourceType: string,
  ledgerId: string,
  businessDate: string,
  correlationId: string,
  stamp: string,
) {
  return db
    .prepare(
      `INSERT INTO journal_entries
        (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
         correlation_id,payload_json,created_at)
       SELECT ?,?,?,?,?,?,'DRAFT',?,?,'{}',?
       WHERE EXISTS (SELECT 1 FROM gift_card_ledger WHERE tenant_id=? AND id=?)`,
    )
    .bind(
      tenantId,
      id,
      branchId,
      sourceType,
      ledgerId,
      businessDate,
      sourceType,
      correlationId,
      stamp,
      tenantId,
      ledgerId,
    );
}

function journalLineIfLedgerExists(
  db: D1Database,
  tenantId: string,
  journalId: string,
  ledgerId: string,
  line: number,
  accountId: string,
  debit: number,
  credit: number,
  currency: string,
) {
  return db
    .prepare(
      `INSERT INTO journal_lines
        (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
       SELECT ?,?,?,?,?,?,?,'{}'
       WHERE EXISTS (SELECT 1 FROM gift_card_ledger WHERE tenant_id=? AND id=?)`,
    )
    .bind(tenantId, journalId, line, accountId, debit, credit, currency, tenantId, ledgerId);
}

function postJournalIfLedgerExists(
  db: D1Database,
  tenantId: string,
  journalId: string,
  ledgerId: string,
  stamp: string,
) {
  return db
    .prepare(
      `UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=?
       AND status='DRAFT' AND EXISTS (SELECT 1 FROM gift_card_ledger WHERE tenant_id=? AND id=?)`,
    )
    .bind(stamp, tenantId, journalId, tenantId, ledgerId);
}
