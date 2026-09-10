import {
  generatePublicToken,
  maskContact,
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  sha256Hex,
} from "@/crm/contact-normalization";
import { CrmDomainError, CrmServiceBase, placeholders, safeJson } from "@/crm/service-base";
import type {
  ConsentChannel,
  ConsentStatus,
  CustomerCreateInput,
  CustomerIdentifierType,
  CustomerProfile,
  CustomerSummary,
  DataQuality,
  PhoneNormalizationPolicy,
} from "@/crm/types";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";

type CustomerRow = {
  id: string;
  customer_code: string;
  account_type: "INDIVIDUAL" | "CORPORATE";
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  phone_display: string | null;
  email_display: string | null;
  preferred_language: string | null;
  preferred_branch_id: string | null;
  company_name: string | null;
  status: CustomerSummary["status"];
  last_activity_at: string | null;
};

type MetricRow = {
  visit_count: number;
  order_count: number;
  net_spend_minor: number;
  refund_minor: number;
  discount_minor: number;
  average_order_minor: number;
  currency: string;
  first_visit_at: string | null;
  last_visit_at: string | null;
  favorite_branch_id: string | null;
  favorite_channel: string | null;
  favorite_items_json: string;
  quality: DataQuality;
};

const consentChannels: ConsentChannel[] = [
  "EMAIL_MARKETING",
  "SMS_MARKETING",
  "WHATSAPP_MARKETING",
  "PUSH_MARKETING",
  "PHONE_MARKETING",
];

export class CrmService extends CrmServiceBase {
  constructor(
    db: D1Database,
    actor: ServerActor,
    private readonly phonePolicy: PhoneNormalizationPolicy = {
      defaultCallingCode: "",
      nationalPrefix: "0",
      minNationalDigits: 8,
      maxNationalDigits: 15,
    },
  ) {
    super(db, actor);
  }

  async createCustomer(input: CustomerCreateInput) {
    this.require(permissions.crmCustomerManage);
    const preferredBranchId =
      input.preferredBranchId ??
      (this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : undefined);
    if (preferredBranchId) this.branch(preferredBranchId);
    const phone = input.phone ? normalizePhone(input.phone, this.phonePolicy) : undefined;
    const email = input.email ? normalizeEmail(input.email) : undefined;
    if (phone) await this.assertIdentifierAvailable("PHONE", phone, "");
    if (email) await this.assertIdentifierAvailable("EMAIL", email, "");

    const id = crypto.randomUUID();
    const customerCode = `CUS-${id.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO customers
            (tenant_id,id,customer_code,account_type,display_name,first_name,last_name,phone_display,
             email_display,preferred_language,preferred_branch_id,brand_id,company_name,billing_contact,
             tax_identifier,invoice_terms_days,account_reference,status,created_source,created_by,
             last_activity_at,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,NULL,'{}',?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          customerCode,
          input.accountType ?? "INDIVIDUAL",
          input.displayName.trim(),
          input.firstName?.trim() ?? null,
          input.lastName?.trim() ?? null,
          input.phone?.trim() ?? null,
          input.email?.trim() ?? null,
          input.preferredLanguage?.trim() ?? null,
          preferredBranchId ?? null,
          input.brandId ?? null,
          input.companyName?.trim() ?? null,
          input.billingContact?.trim() ?? null,
          input.taxIdentifier?.trim() ?? null,
          input.invoiceTermsDays ?? null,
          input.accountReference?.trim() ?? null,
          input.createdSource,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO customer_journey_events
            (tenant_id,id,customer_id,branch_id,event_type,source_type,source_id,summary,
             occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          id,
          preferredBranchId ?? this.actor.branchId ?? null,
          "PROFILE_CREATED",
          "CUSTOMER",
          id,
          "Customer profile created",
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "CUSTOMER_CREATED",
        entityType: "CUSTOMER",
        entityId: id,
        ...(preferredBranchId ? { branchId: preferredBranchId } : {}),
        correlationId,
        at: stamp,
      }),
    ];
    if (phone) statements.splice(1, 0, this.identifierStatement(id, "PHONE", phone, input.phone));
    if (email) statements.splice(1, 0, this.identifierStatement(id, "EMAIL", email, input.email));
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) {
        throw new CrmDomainError("DUPLICATE", "An exact customer identifier already exists");
      }
      throw error;
    }
    return { id, customerCode, displayName: input.displayName.trim(), status: "ACTIVE" as const };
  }

  async resolveIdentity(input: {
    type: CustomerIdentifierType;
    value: string;
    providerConnectionId?: string;
  }) {
    this.require(permissions.crmCustomerView);
    const normalized = normalizeIdentifier(input.type, input.value, this.phonePolicy);
    const providerScope = input.providerConnectionId ?? "";
    const row = await this.db
      .prepare(
        `SELECT i.customer_id,COALESCE(a.canonical_customer_id,i.customer_id) AS canonical_customer_id,
                i.verified,c.status
         FROM customer_identifiers i
         JOIN customers c ON c.tenant_id=i.tenant_id AND c.id=i.customer_id
         LEFT JOIN customer_aliases a ON a.tenant_id=i.tenant_id AND a.alias_customer_id=i.customer_id
         WHERE i.tenant_id=? AND i.identifier_type=? AND i.provider_scope=?
           AND i.normalized_value=? AND i.status='ACTIVE' LIMIT 1`,
      )
      .bind(this.actor.tenantId, input.type, providerScope, normalized)
      .first<{
        customer_id: string;
        canonical_customer_id: string;
        verified: number;
        status: string;
      }>();
    if (!row) return null;
    await this.assertCustomerVisible(row.canonical_customer_id);
    return {
      customerId: row.canonical_customer_id,
      matchedCustomerId: row.customer_id,
      matchType: input.type,
      exact: true,
      verified: row.verified === 1,
    };
  }

  async searchCustomers(input: {
    query?: string;
    branchId?: string;
    limit?: number;
    cursor?: string;
  }) {
    this.require(permissions.crmCustomerView);
    const branchId =
      input.branchId ??
      (this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : undefined);
    if (branchId) this.branch(branchId);
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const query = input.query?.trim() ?? "";
    const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const normalizedEmail = query.includes("@") ? query.toLowerCase() : "";
    let normalizedPhone = "";
    if (/\d{6}/.test(query)) {
      try {
        normalizedPhone = normalizePhone(query, this.phonePolicy);
      } catch {
        normalizedPhone = query.replace(/\D/g, "");
      }
    }
    const cursor = input.cursor ?? "";
    const rows = await this.db
      .prepare(
        `SELECT c.id,c.customer_code,c.account_type,c.display_name,c.phone_display,c.email_display,
                c.preferred_branch_id,c.status,c.last_activity_at,
                COALESCE((SELECT SUM(m.order_count) FROM customer_metric_snapshots m
                  WHERE m.tenant_id=c.tenant_id AND m.customer_id=c.id AND m.period_key='LIFETIME'
                    AND (?='' OR m.branch_id=?)),0) AS order_count,
                COALESCE((SELECT SUM(m.net_spend_minor) FROM customer_metric_snapshots m
                  WHERE m.tenant_id=c.tenant_id AND m.customer_id=c.id AND m.period_key='LIFETIME'
                    AND (?='' OR m.branch_id=?)),0) AS net_spend_minor,
                (SELECT m.currency FROM customer_metric_snapshots m WHERE m.tenant_id=c.tenant_id
                  AND m.customer_id=c.id AND m.period_key='LIFETIME' AND (?='' OR m.branch_id=?)
                  ORDER BY m.calculated_at DESC LIMIT 1) AS currency,
                COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l
                  WHERE l.tenant_id=c.tenant_id AND l.customer_id=c.id),0) AS loyalty_points,
                (SELECT t.name FROM customer_loyalty_memberships lm
                  LEFT JOIN loyalty_tiers t ON t.tenant_id=lm.tenant_id AND t.id=lm.tier_id
                  WHERE lm.tenant_id=c.tenant_id AND lm.customer_id=c.id AND lm.status='ACTIVE'
                  ORDER BY lm.joined_at LIMIT 1) AS tier_name,
                COALESCE((SELECT MIN(m.quality) FROM customer_metric_snapshots m
                  WHERE m.tenant_id=c.tenant_id AND m.customer_id=c.id AND m.period_key='LIFETIME'),
                  'INSUFFICIENT_DATA') AS quality
         FROM customers c
         WHERE c.tenant_id=? AND c.id>? AND c.status<>'ANONYMIZED'
           AND (?='' OR c.preferred_branch_id=? OR EXISTS (
             SELECT 1 FROM customer_transaction_links bl
             WHERE bl.tenant_id=c.tenant_id AND bl.customer_id=c.id AND bl.branch_id=?))
           AND (?='' OR c.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR c.customer_code LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR EXISTS (SELECT 1 FROM customer_identifiers i WHERE i.tenant_id=c.tenant_id
               AND i.customer_id=c.id AND i.status='ACTIVE'
               AND ((?<>'' AND i.identifier_type='EMAIL' AND i.normalized_value LIKE ?)
                 OR (?<>'' AND i.identifier_type='PHONE' AND i.normalized_value LIKE ?))))
         ORDER BY c.id LIMIT ?`,
      )
      .bind(
        branchId ?? "",
        branchId ?? "",
        branchId ?? "",
        branchId ?? "",
        branchId ?? "",
        branchId ?? "",
        this.actor.tenantId,
        cursor,
        branchId ?? "",
        branchId ?? "",
        branchId ?? "",
        query,
        like,
        like,
        normalizedEmail,
        `%${normalizedEmail}%`,
        normalizedPhone,
        `%${normalizedPhone.replace(/^\+/, "")}%`,
        limit + 1,
      )
      .all<{
        id: string;
        customer_code: string;
        account_type: "INDIVIDUAL" | "CORPORATE";
        display_name: string;
        phone_display: string | null;
        email_display: string | null;
        preferred_branch_id: string | null;
        status: CustomerSummary["status"];
        last_activity_at: string | null;
        order_count: number;
        net_spend_minor: number;
        currency: string | null;
        loyalty_points: number;
        tier_name: string | null;
        quality: DataQuality;
      }>();
    const all = rows.results ?? [];
    const hasMore = all.length > limit;
    const canViewContacts = this.actor.permissions.includes(permissions.crmCustomerContactView);
    return {
      customers: all.slice(0, limit).map((row): CustomerSummary => {
        const phone = maskContact(row.phone_display, canViewContacts);
        const email = maskContact(row.email_display, canViewContacts);
        return {
          id: row.id,
          customerCode: row.customer_code,
          displayName: row.display_name,
          accountType: row.account_type,
          status: row.status,
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(row.preferred_branch_id ? { preferredBranchId: row.preferred_branch_id } : {}),
          ...(row.last_activity_at ? { lastActivityAt: row.last_activity_at } : {}),
          orderCount: row.order_count,
          netSpendMinor: this.actor.permissions.includes(permissions.crmCustomerValueView)
            ? row.net_spend_minor
            : 0,
          ...(row.currency ? { currency: row.currency } : {}),
          loyaltyPoints: row.loyalty_points,
          ...(row.tier_name ? { tierName: row.tier_name } : {}),
          quality: row.quality,
        };
      }),
      nextCursor: hasMore ? all[limit - 1]?.id : undefined,
    };
  }

  async customerProfile(customerId: string): Promise<CustomerProfile> {
    this.require(permissions.crmCustomerView);
    const canonicalId = await this.resolveCanonicalId(customerId);
    await this.assertCustomerVisible(canonicalId);
    const customer = await this.db
      .prepare(
        `SELECT id,customer_code,account_type,display_name,first_name,last_name,phone_display,
                email_display,preferred_language,preferred_branch_id,company_name,status,last_activity_at
         FROM customers WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, canonicalId)
      .first<CustomerRow>();
    if (!customer) throw new CrmDomainError("NOT_FOUND", "Customer was not found");
    const customerIds = await this.customerFamilyIds(canonicalId);
    const params = placeholders(customerIds.length);
    const branchIds = this.actor.branchScope.type === "ALL" ? [] : this.actor.assignedBranchIds;
    const branchPredicate = branchIds.length
      ? `AND branch_id IN (${placeholders(branchIds.length)})`
      : "";
    const metricRows = await this.db
      .prepare(
        `SELECT visit_count,order_count,net_spend_minor,refund_minor,discount_minor,
                average_order_minor,currency,first_visit_at,last_visit_at,favorite_branch_id,
                favorite_channel,favorite_items_json,quality
         FROM customer_metric_snapshots
         WHERE tenant_id=? AND customer_id IN (${params}) AND period_key='LIFETIME' ${branchPredicate}`,
      )
      .bind(this.actor.tenantId, ...customerIds, ...branchIds)
      .all<MetricRow>();
    const metrics = combineMetrics(metricRows.results ?? []);
    const consentRows = await this.db
      .prepare(
        `SELECT channel,status,effective_at FROM customer_consents
         WHERE tenant_id=? AND customer_id IN (${params}) ORDER BY effective_at DESC,rowid DESC`,
      )
      .bind(this.actor.tenantId, ...customerIds)
      .all<{ channel: ConsentChannel; status: ConsentStatus; effective_at: string }>();
    const latestConsents = new Map<
      ConsentChannel,
      { status: ConsentStatus; effectiveAt: string }
    >();
    for (const row of consentRows.results ?? []) {
      if (!latestConsents.has(row.channel)) {
        latestConsents.set(row.channel, { status: row.status, effectiveAt: row.effective_at });
      }
    }
    const loyaltyRows = await this.db
      .prepare(
        `SELECT p.id AS program_id,p.name AS program_name,t.name AS tier_name,
                COALESCE(SUM(l.points),0) AS points_balance,
                COALESCE(SUM(CASE WHEN l.points>0 AND l.expires_at IS NOT NULL
                  AND l.expires_at<=datetime('now','+30 days') THEN l.points ELSE 0 END),0) AS upcoming_expiry
         FROM loyalty_programs p
         LEFT JOIN loyalty_ledger l ON l.tenant_id=p.tenant_id AND l.program_id=p.id
           AND l.customer_id IN (${params})
         LEFT JOIN customer_loyalty_memberships lm ON lm.tenant_id=p.tenant_id AND lm.program_id=p.id
           AND lm.customer_id IN (${params}) AND lm.status='ACTIVE'
         LEFT JOIN loyalty_tiers t ON t.tenant_id=lm.tenant_id AND t.id=lm.tier_id
         WHERE p.tenant_id=? AND p.status='ACTIVE'
         GROUP BY p.id,p.name,t.name ORDER BY p.name`,
      )
      .bind(...customerIds, ...customerIds, this.actor.tenantId)
      .all<{
        program_id: string;
        program_name: string;
        tier_name: string | null;
        points_balance: number;
        upcoming_expiry: number;
      }>();
    const rewardRows = await this.db
      .prepare(
        `SELECT r.id,r.name,r.reward_type,r.points_cost
         FROM loyalty_rewards r
         JOIN loyalty_programs p ON p.tenant_id=r.tenant_id AND p.id=r.program_id
         WHERE r.tenant_id=? AND r.active=1 AND p.status='ACTIVE'
           AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?)
           AND r.points_cost<=COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l
             WHERE l.tenant_id=r.tenant_id AND l.program_id=r.program_id
               AND l.customer_id IN (${params})),0)
         ORDER BY r.points_cost,r.name LIMIT 50`,
      )
      .bind(this.actor.tenantId, new Date().toISOString(), new Date().toISOString(), ...customerIds)
      .all<{ id: string; name: string; reward_type: string; points_cost: number }>();
    const giftRows = this.actor.permissions.includes(permissions.giftCardView)
      ? await this.db
          .prepare(
            `SELECT g.id,g.token_last_four,g.currency,COALESCE(SUM(l.amount_minor),0) AS balance_minor
             FROM gift_cards g JOIN gift_card_ledger l ON l.tenant_id=g.tenant_id AND l.gift_card_id=g.id
             WHERE g.tenant_id=? AND (g.purchaser_customer_id IN (${params})
               OR g.recipient_customer_id IN (${params}))
             GROUP BY g.id,g.token_last_four,g.currency HAVING balance_minor>0 ORDER BY g.issued_at DESC`,
          )
          .bind(this.actor.tenantId, ...customerIds, ...customerIds)
          .all<{ id: string; token_last_four: string; currency: string; balance_minor: number }>()
      : {
          results: [] as Array<{
            id: string;
            token_last_four: string;
            currency: string;
            balance_minor: number;
          }>,
        };
    const feedbackBranchPredicate = branchIds.length
      ? `AND f.branch_id IN (${placeholders(branchIds.length)})`
      : "";
    const feedback = await this.db
      .prepare(
        `SELECT f.id,c.name AS category,f.rating,f.status,f.submitted_at
         FROM customer_feedback f JOIN customer_feedback_categories c
           ON c.tenant_id=f.tenant_id AND c.id=f.category_id
         WHERE f.tenant_id=? AND f.customer_id IN (${params}) ${feedbackBranchPredicate}
         ORDER BY f.submitted_at DESC LIMIT 50`,
      )
      .bind(this.actor.tenantId, ...customerIds, ...branchIds)
      .all<{
        id: string;
        category: string;
        rating: number;
        status: string;
        submitted_at: string;
      }>();
    const journeyBranchPredicate = branchIds.length
      ? `AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))`
      : "";
    const journey = await this.db
      .prepare(
        `SELECT id,event_type,summary,occurred_at FROM customer_journey_events
         WHERE tenant_id=? AND customer_id IN (${params}) ${journeyBranchPredicate}
         ORDER BY occurred_at DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...customerIds, ...branchIds)
      .all<{ id: string; event_type: string; summary: string; occurred_at: string }>();
    const availableVouchers = this.actor.permissions.includes(permissions.voucherView)
      ? await this.db
          .prepare(
            `SELECT i.id,d.name,i.code_last_four,i.expires_at,d.valid_to,d.discount_type
             FROM voucher_issues i JOIN voucher_definitions d
               ON d.tenant_id=i.tenant_id AND d.id=i.voucher_definition_id
             WHERE i.tenant_id=? AND i.customer_id IN (${params})
               AND i.status='ACTIVE' AND d.status='ACTIVE' AND d.valid_from<=?
               AND (d.valid_to IS NULL OR d.valid_to>?)
               AND (i.expires_at IS NULL OR i.expires_at>?)
               ${
                 branchIds.length
                   ? `AND (d.branch_scope_json='[]' OR EXISTS (
                 SELECT 1 FROM json_each(d.branch_scope_json) WHERE value IN (${placeholders(branchIds.length)})))`
                   : ""
               }
             ORDER BY COALESCE(i.expires_at,d.valid_to,'9999-12-31') LIMIT 50`,
          )
          .bind(
            this.actor.tenantId,
            ...customerIds,
            new Date().toISOString(),
            new Date().toISOString(),
            new Date().toISOString(),
            ...branchIds,
          )
          .all<{
            id: string;
            name: string;
            code_last_four: string;
            expires_at: string | null;
            valid_to: string | null;
            discount_type: string;
          }>()
      : {
          results: [] as Array<{
            id: string;
            name: string;
            code_last_four: string;
            expires_at: string | null;
            valid_to: string | null;
            discount_type: string;
          }>,
        };
    const vouchersUsed = this.actor.permissions.includes(permissions.voucherView)
      ? await this.db
          .prepare(
            `SELECT r.id,d.name,r.discount_minor,r.redeemed_at
             FROM voucher_redemptions r JOIN voucher_definitions d
               ON d.tenant_id=r.tenant_id AND d.id=r.voucher_definition_id
             WHERE r.tenant_id=? AND r.customer_id IN (${params}) AND r.status='CONFIRMED'
               ${branchIds.length ? `AND r.branch_id IN (${placeholders(branchIds.length)})` : ""}
             ORDER BY r.redeemed_at DESC LIMIT 50`,
          )
          .bind(this.actor.tenantId, ...customerIds, ...branchIds)
          .all<{ id: string; name: string; discount_minor: number; redeemed_at: string }>()
      : {
          results: [] as Array<{
            id: string;
            name: string;
            discount_minor: number;
            redeemed_at: string;
          }>,
        };
    const tags = await this.db
      .prepare(
        `SELECT t.id,t.name FROM customer_tag_assignments a JOIN customer_tags t
           ON t.tenant_id=a.tenant_id AND t.id=a.tag_id
         WHERE a.tenant_id=? AND a.customer_id IN (${params}) AND t.active=1 ORDER BY t.name`,
      )
      .bind(this.actor.tenantId, ...customerIds)
      .all<{ id: string; name: string }>();
    const notes = this.actor.permissions.includes(permissions.crmCustomerManage)
      ? await this.db
          .prepare(
            `SELECT id,note,created_at,created_by FROM customer_notes
             WHERE tenant_id=? AND customer_id IN (${params}) ORDER BY created_at DESC LIMIT 50`,
          )
          .bind(this.actor.tenantId, ...customerIds)
          .all<{ id: string; note: string; created_at: string; created_by: string }>()
      : {
          results: [] as Array<{
            id: string;
            note: string;
            created_at: string;
            created_by: string;
          }>,
        };
    const campaignInteractions = this.actor.permissions.includes(permissions.campaignView)
      ? await this.db
          .prepare(
            `SELECT e.id,c.name,d.channel,e.event_type,e.occurred_at
             FROM campaign_events e JOIN campaigns c
               ON c.tenant_id=e.tenant_id AND c.id=e.campaign_id
             LEFT JOIN campaign_deliveries d
               ON d.tenant_id=e.tenant_id AND d.id=e.delivery_id
             WHERE e.tenant_id=? AND e.customer_id IN (${params})
               ${
                 branchIds.length
                   ? `AND (c.branch_scope_json='[]' OR EXISTS (
                 SELECT 1 FROM json_each(c.branch_scope_json) WHERE value IN (${placeholders(branchIds.length)})))`
                   : ""
               }
             ORDER BY e.occurred_at DESC LIMIT 50`,
          )
          .bind(this.actor.tenantId, ...customerIds, ...branchIds)
          .all<{
            id: string;
            name: string;
            channel: string | null;
            event_type: string;
            occurred_at: string;
          }>()
      : {
          results: [] as Array<{
            id: string;
            name: string;
            channel: string | null;
            event_type: string;
            occurred_at: string;
          }>,
        };
    const canViewContacts = this.actor.permissions.includes(permissions.crmCustomerContactView);
    const canViewValue = this.actor.permissions.includes(permissions.crmCustomerValueView);
    const loyalty = (loyaltyRows.results ?? []).map((row) => ({
      programId: row.program_id,
      programName: row.program_name,
      ...(row.tier_name ? { tierName: row.tier_name } : {}),
      pointsBalance: row.points_balance,
      upcomingExpiry: row.upcoming_expiry,
    }));
    const phone = maskContact(customer.phone_display, canViewContacts);
    const email = maskContact(customer.email_display, canViewContacts);
    return {
      id: customer.id,
      customerCode: customer.customer_code,
      displayName: customer.display_name,
      accountType: customer.account_type,
      status: customer.status,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(customer.preferred_branch_id ? { preferredBranchId: customer.preferred_branch_id } : {}),
      ...(customer.last_activity_at ? { lastActivityAt: customer.last_activity_at } : {}),
      ...(customer.first_name ? { firstName: customer.first_name } : {}),
      ...(customer.last_name ? { lastName: customer.last_name } : {}),
      ...(customer.preferred_language ? { preferredLanguage: customer.preferred_language } : {}),
      ...(customer.company_name ? { companyName: customer.company_name } : {}),
      orderCount: metrics.orderCount,
      netSpendMinor: canViewValue ? metrics.netSpendMinor : 0,
      ...(metrics.currency ? { currency: metrics.currency } : {}),
      loyaltyPoints: loyalty.reduce((sum, item) => sum + item.pointsBalance, 0),
      ...(loyalty[0]?.tierName ? { tierName: loyalty[0].tierName } : {}),
      quality: metrics.quality,
      consents: consentChannels.map((channel) => ({
        channel,
        status: latestConsents.get(channel)?.status ?? "UNKNOWN",
        effectiveAt: latestConsents.get(channel)?.effectiveAt ?? customer.last_activity_at ?? "",
      })),
      loyalty,
      availableRewards: (rewardRows.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.reward_type,
        pointsCost: row.points_cost,
      })),
      availableVouchers: (availableVouchers.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        codeLastFour: row.code_last_four,
        ...((row.expires_at ?? row.valid_to)
          ? { validTo: (row.expires_at ?? row.valid_to) as string }
          : {}),
        discountType: row.discount_type,
      })),
      vouchersUsed: (vouchersUsed.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        discountMinor: row.discount_minor,
        redeemedAt: row.redeemed_at,
      })),
      giftCards: (giftRows.results ?? []).map((row) => ({
        id: row.id,
        tokenLastFour: row.token_last_four,
        currency: row.currency,
        balanceMinor: row.balance_minor,
      })),
      tags: (tags.results ?? []).map((row) => ({ id: row.id, name: row.name })),
      notes: (notes.results ?? []).map((row) => ({
        id: row.id,
        note: row.note,
        createdAt: row.created_at,
        createdBy: row.created_by,
      })),
      campaignInteractions: (campaignInteractions.results ?? []).map((row) => ({
        id: row.id,
        campaignName: row.name,
        channel: row.channel ?? "UNKNOWN",
        status: row.event_type,
        occurredAt: row.occurred_at,
      })),
      visits: {
        count: metrics.visitCount,
        averageOrderMinor: canViewValue ? metrics.averageOrderMinor : 0,
        ...(metrics.firstVisitAt ? { firstVisitAt: metrics.firstVisitAt } : {}),
        ...(metrics.lastVisitAt ? { lastVisitAt: metrics.lastVisitAt } : {}),
        ...(metrics.favoriteBranchId ? { favoriteBranchId: metrics.favoriteBranchId } : {}),
        ...(metrics.favoriteChannel ? { favoriteChannel: metrics.favoriteChannel } : {}),
        favoriteItems: metrics.favoriteItems,
        refundMinor: canViewValue ? metrics.refundMinor : 0,
        discountMinor: canViewValue ? metrics.discountMinor : 0,
      },
      feedback: (feedback.results ?? []).map((row) => ({
        id: row.id,
        category: row.category,
        rating: row.rating,
        status: row.status,
        submittedAt: row.submitted_at,
      })),
      journey: (journey.results ?? []).map((row) => ({
        id: row.id,
        type: row.event_type,
        summary: row.summary,
        occurredAt: row.occurred_at,
      })),
    };
  }

  async mergeCustomers(input: {
    canonicalCustomerId: string;
    duplicateCustomerId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.crmCustomerMerge);
    if (input.canonicalCustomerId === input.duplicateCustomerId) {
      throw new CrmDomainError("VALIDATION_FAILED", "A customer cannot be merged into itself");
    }
    await Promise.all([
      this.customerExists(input.canonicalCustomerId),
      this.customerExists(input.duplicateCustomerId),
    ]);
    const prior = await this.db
      .prepare(
        "SELECT canonical_customer_id,merge_event_id FROM customer_aliases WHERE tenant_id=? AND alias_customer_id=?",
      )
      .bind(this.actor.tenantId, input.duplicateCustomerId)
      .first<{ canonical_customer_id: string; merge_event_id: string }>();
    if (prior) {
      if (prior.canonical_customer_id !== input.canonicalCustomerId) {
        throw new CrmDomainError("CONFLICT", "Customer was already merged to another profile");
      }
      return { canonicalCustomerId: prior.canonical_customer_id, duplicate: true };
    }
    const stamp = new Date().toISOString();
    const mergeEventId = `merge:${input.idempotencyKey}`;
    const correlationId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO customer_aliases
              (tenant_id,alias_customer_id,canonical_customer_id,merge_event_id,reason,merged_by,merged_at)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            input.duplicateCustomerId,
            input.canonicalCustomerId,
            mergeEventId,
            input.reason,
            this.actor.id,
            stamp,
          ),
        this.db
          .prepare(
            `UPDATE customers SET status='INACTIVE',updated_at=?
             WHERE tenant_id=? AND id=? AND status<>'ANONYMIZED'`,
          )
          .bind(stamp, this.actor.tenantId, input.duplicateCustomerId),
        this.db
          .prepare(
            `UPDATE customer_transaction_links SET customer_id=?,link_source='MERGE',updated_at=?
             WHERE tenant_id=? AND customer_id=?`,
          )
          .bind(input.canonicalCustomerId, stamp, this.actor.tenantId, input.duplicateCustomerId),
        this.db
          .prepare(
            `INSERT OR IGNORE INTO customer_tag_assignments
              (tenant_id,customer_id,tag_id,source,source_id,assigned_by,assigned_at)
             SELECT tenant_id,?,tag_id,'MERGE',?, ?, ? FROM customer_tag_assignments
             WHERE tenant_id=? AND customer_id=?`,
          )
          .bind(
            input.canonicalCustomerId,
            mergeEventId,
            this.actor.id,
            stamp,
            this.actor.tenantId,
            input.duplicateCustomerId,
          ),
        this.db
          .prepare("DELETE FROM customer_tag_assignments WHERE tenant_id=? AND customer_id=?")
          .bind(this.actor.tenantId, input.duplicateCustomerId),
        this.db
          .prepare(
            `INSERT INTO customer_journey_events
              (tenant_id,id,customer_id,branch_id,event_type,source_type,source_id,summary,
               occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            input.canonicalCustomerId,
            this.actor.branchId ?? null,
            "CUSTOMER_MERGED",
            "CUSTOMER_ALIAS",
            input.duplicateCustomerId,
            "Verified duplicate profile merged",
            stamp,
            stamp,
          ),
        this.auditStatement({
          action: "CUSTOMER_MERGED",
          entityType: "CUSTOMER",
          entityId: input.canonicalCustomerId,
          reason: input.reason,
          correlationId,
          metadata: { duplicateCustomerId: input.duplicateCustomerId, mergeEventId },
          at: stamp,
        }),
      ]);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) {
        const replay = await this.db
          .prepare(
            "SELECT canonical_customer_id FROM customer_aliases WHERE tenant_id=? AND alias_customer_id=?",
          )
          .bind(this.actor.tenantId, input.duplicateCustomerId)
          .first<{ canonical_customer_id: string }>();
        if (replay?.canonical_customer_id === input.canonicalCustomerId) {
          return { canonicalCustomerId: input.canonicalCustomerId, duplicate: true };
        }
      }
      throw error;
    }
    return { canonicalCustomerId: input.canonicalCustomerId, duplicate: false };
  }

  async appendConsent(input: {
    customerId: string;
    channel: ConsentChannel;
    status: ConsentStatus;
    source: string;
    policyVersion: string;
    proofReference?: string;
    effectiveAt?: string;
  }) {
    this.require(permissions.crmCustomerManage);
    const customerId = await this.resolveCanonicalId(input.customerId);
    const stamp = input.effectiveAt ?? new Date().toISOString();
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO customer_consents
            (tenant_id,id,customer_id,channel,status,source,policy_version,actor_id,
             proof_reference,effective_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          customerId,
          input.channel,
          input.status,
          input.source,
          input.policyVersion,
          this.actor.id,
          input.proofReference ?? null,
          stamp,
          new Date().toISOString(),
        ),
      this.db
        .prepare(
          `INSERT INTO customer_journey_events
            (tenant_id,id,customer_id,branch_id,event_type,source_type,source_id,summary,
             occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          customerId,
          this.actor.branchId ?? null,
          "CONSENT_CHANGED",
          "CUSTOMER_CONSENT",
          id,
          `${input.channel} set to ${input.status}`,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "CUSTOMER_CONSENT_CHANGED",
        entityType: "CUSTOMER_CONSENT",
        entityId: id,
        correlationId,
        metadata: { channel: input.channel, status: input.status },
        at: stamp,
      }),
    ];
    if (input.status === "WITHDRAWN" || input.status === "DENIED") {
      statements.splice(
        1,
        0,
        this.db
          .prepare(
            `INSERT INTO customer_suppressions
              (tenant_id,id,customer_id,channel,reason,source,active,created_by,created_at)
             VALUES (?,?,?,?,?,?,1,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            customerId,
            marketingChannel(input.channel),
            input.status === "WITHDRAWN" ? "UNSUBSCRIBED" : "CUSTOMER_REQUEST",
            input.source,
            this.actor.id,
            stamp,
          ),
      );
    }
    await this.db.batch(statements);
    return { id, customerId, channel: input.channel, status: input.status, effectiveAt: stamp };
  }

  async addCustomerNote(input: {
    customerId: string;
    note: string;
    visibility: "CRM" | "SERVICE" | "FINANCE";
  }) {
    this.require(permissions.crmCustomerManage);
    const customerId = await this.resolveCanonicalId(input.customerId);
    await this.assertCustomerVisible(customerId);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_notes
            (tenant_id,id,customer_id,note,visibility,created_by,created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          customerId,
          input.note.trim(),
          input.visibility,
          this.actor.id,
          stamp,
        ),
      this.auditStatement({
        action: "CUSTOMER_NOTE_CREATED",
        entityType: "CUSTOMER_NOTE",
        entityId: id,
        branchId: this.actor.branchId,
        at: stamp,
        metadata: { customerId, visibility: input.visibility },
      }),
    ]);
    return { id, customerId, createdAt: stamp };
  }

  async listTags() {
    this.require(permissions.crmCustomerView);
    const rows = await this.db
      .prepare(
        `SELECT id,code,name,description,assignment_type,active
         FROM customer_tags WHERE tenant_id=? ORDER BY active DESC,name`,
      )
      .bind(this.actor.tenantId)
      .all();
    return rows.results ?? [];
  }

  async createTag(input: { code: string; name: string; description?: string }) {
    this.require(permissions.crmCustomerManage);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_tags
            (tenant_id,id,code,name,description,assignment_type,active,created_at,updated_at)
           VALUES (?,?,?,?,?,'MANUAL',1,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.trim().toUpperCase(),
          input.name.trim(),
          input.description?.trim() ?? null,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "CUSTOMER_TAG_CREATED",
        entityType: "CUSTOMER_TAG",
        entityId: id,
        at: stamp,
        metadata: { code: input.code.trim().toUpperCase() },
      }),
    ]);
    return { id };
  }

  async assignTag(input: { customerId: string; tagId: string }) {
    this.require(permissions.crmCustomerManage);
    const customerId = await this.resolveCanonicalId(input.customerId);
    await this.assertCustomerVisible(customerId);
    const tag = await this.db
      .prepare("SELECT id FROM customer_tags WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, input.tagId)
      .first<{ id: string }>();
    if (!tag) throw new CrmDomainError("NOT_FOUND", "Customer tag was not found");
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_tag_assignments
            (tenant_id,customer_id,tag_id,source,source_id,assigned_by,assigned_at)
           VALUES (?,?,?,'MANUAL',NULL,?,?)
           ON CONFLICT(tenant_id,customer_id,tag_id) DO NOTHING`,
        )
        .bind(this.actor.tenantId, customerId, input.tagId, this.actor.id, stamp),
      this.auditStatement({
        action: "CUSTOMER_TAG_ASSIGNED",
        entityType: "CUSTOMER",
        entityId: customerId,
        branchId: this.actor.branchId,
        at: stamp,
        metadata: { tagId: input.tagId },
      }),
    ]);
    return { customerId, tagId: input.tagId };
  }

  async createPrivacyRequest(input: {
    customerId: string;
    requestType:
      | "ACCESS"
      | "EXPORT"
      | "CORRECTION"
      | "ANONYMIZATION"
      | "DELETION_WHERE_PERMITTED"
      | "MARKETING_OPTOUT";
    requestReference: string;
  }) {
    this.require(permissions.crmPrivacyManage);
    const customerId = await this.resolveCanonicalId(input.customerId);
    await this.assertCustomerVisible(customerId);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_privacy_requests
            (tenant_id,id,customer_id,request_type,status,request_reference,requested_at,requested_by)
           VALUES (?,?,?,?,'REQUESTED',?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          customerId,
          input.requestType,
          input.requestReference,
          stamp,
          this.actor.id,
        ),
      this.db
        .prepare(
          `INSERT INTO customer_privacy_events
            (tenant_id,id,request_id,event_type,actor_id,payload_json,created_at)
           VALUES (?,?,?,'REQUESTED',?,'{}',?)`,
        )
        .bind(this.actor.tenantId, crypto.randomUUID(), id, this.actor.id, stamp),
      this.auditStatement({
        action: "CUSTOMER_PRIVACY_REQUESTED",
        entityType: "CUSTOMER_PRIVACY_REQUEST",
        entityId: id,
        at: stamp,
      }),
    ]);
    return { id, customerId, status: "REQUESTED" as const };
  }

  async listPrivacyRequests(limit = 200, branchId?: string) {
    this.require(permissions.crmPrivacyManage);
    const scopedBranch =
      branchId ?? (this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : undefined);
    if (scopedBranch) this.branch(scopedBranch);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new CrmDomainError(
        "VALIDATION_FAILED",
        "Privacy request limit must be between 1 and 500",
      );
    }
    const rows = await this.db
      .prepare(
        `SELECT r.id,r.customer_id,c.display_name,r.request_type,r.status,r.request_reference,
                r.requested_at,r.completed_at
         FROM customer_privacy_requests r JOIN customers c
           ON c.tenant_id=r.tenant_id AND c.id=r.customer_id
         WHERE r.tenant_id=?
           AND (? IS NULL OR c.preferred_branch_id=? OR EXISTS (
             SELECT 1 FROM customer_transaction_links l WHERE l.tenant_id=c.tenant_id
               AND l.customer_id=c.id AND l.branch_id=?))
         ORDER BY r.requested_at DESC LIMIT ?`,
      )
      .bind(
        this.actor.tenantId,
        scopedBranch ?? null,
        scopedBranch ?? null,
        scopedBranch ?? null,
        limit,
      )
      .all();
    return rows.results ?? [];
  }

  async anonymizeCustomer(requestId: string, reason: string) {
    this.require(permissions.crmPrivacyManage);
    const request = await this.db
      .prepare(
        `SELECT customer_id,status,request_type FROM customer_privacy_requests
         WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, requestId)
      .first<{ customer_id: string; status: string; request_type: string }>();
    if (!request) throw new CrmDomainError("NOT_FOUND", "Privacy request was not found");
    await this.assertCustomerVisible(request.customer_id);
    if (!["ANONYMIZATION", "DELETION_WHERE_PERMITTED"].includes(request.request_type)) {
      throw new CrmDomainError("INVALID_STATE", "Privacy request does not authorize anonymization");
    }
    const customer = await this.db
      .prepare("SELECT status FROM customers WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, request.customer_id)
      .first<{ status: string }>();
    if (customer?.status === "ANONYMIZED")
      return { customerId: request.customer_id, duplicate: true };
    if (!customer) throw new CrmDomainError("NOT_FOUND", "Customer was not found");
    const stamp = new Date().toISOString();
    const pseudonym = `Anonymized ${request.customer_id.replaceAll("-", "").slice(0, 8)}`;
    const statements = [
      this.db
        .prepare(
          `UPDATE customers SET display_name=?,first_name=NULL,last_name=NULL,phone_display=NULL,
             email_display=NULL,date_of_birth=NULL,preferred_language=NULL,company_name=NULL,
             billing_contact=NULL,tax_identifier=NULL,account_reference=NULL,status='ANONYMIZED',
             anonymized_at=?,anonymized_by=?,updated_at=? WHERE tenant_id=? AND id=?`,
        )
        .bind(pseudonym, stamp, this.actor.id, stamp, this.actor.tenantId, request.customer_id),
      this.db
        .prepare(
          `UPDATE customer_identifiers SET normalized_value='anon:'||id,display_value=NULL,
             status='REVOKED',updated_at=? WHERE tenant_id=? AND customer_id=?`,
        )
        .bind(stamp, this.actor.tenantId, request.customer_id),
      this.db
        .prepare(
          `INSERT INTO customer_suppressions
            (tenant_id,id,customer_id,channel,reason,source,active,created_by,created_at)
           VALUES (?,? ,?,'ALL','CUSTOMER_REQUEST','PRIVACY_REQUEST',1,?,?)`,
        )
        .bind(this.actor.tenantId, crypto.randomUUID(), request.customer_id, this.actor.id, stamp),
      this.db
        .prepare(
          `UPDATE customer_privacy_requests SET status='COMPLETED',completed_at=?,completed_by=?
           WHERE tenant_id=? AND id=?`,
        )
        .bind(stamp, this.actor.id, this.actor.tenantId, requestId),
      this.db
        .prepare(
          `INSERT INTO customer_privacy_events
            (tenant_id,id,request_id,event_type,actor_id,reason,payload_json,created_at)
           VALUES (?,?,?,'ANONYMIZED',?,?,'{"financialRecordsPreserved":true}',?)`,
        )
        .bind(this.actor.tenantId, crypto.randomUUID(), requestId, this.actor.id, reason, stamp),
      this.auditStatement({
        action: "CUSTOMER_ANONYMIZED",
        entityType: "CUSTOMER",
        entityId: request.customer_id,
        reason,
        at: stamp,
        metadata: { privacyRequestId: requestId, financialRecordsPreserved: true },
      }),
    ];
    for (const channel of consentChannels) {
      statements.splice(
        3,
        0,
        this.db
          .prepare(
            `INSERT INTO customer_consents
              (tenant_id,id,customer_id,channel,status,source,policy_version,actor_id,
               effective_at,created_at) VALUES (?,?,?,?,'WITHDRAWN','PRIVACY_REQUEST',?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            request.customer_id,
            channel,
            `privacy:${requestId}`,
            this.actor.id,
            stamp,
            stamp,
          ),
      );
    }
    await this.db.batch(statements);
    return { customerId: request.customer_id, duplicate: false };
  }

  async createFeedback(input: {
    branchId: string;
    customerId?: string;
    orderId?: string;
    categoryId: string;
    surveyType: "GENERAL" | "NPS" | "CSAT";
    rating: number;
    comment?: string;
    source: string;
  }) {
    this.require(permissions.feedbackManage);
    this.branch(input.branchId);
    const customerId = input.customerId
      ? await this.resolveCanonicalId(input.customerId)
      : undefined;
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_feedback
            (tenant_id,id,branch_id,customer_id,order_id,category_id,survey_type,rating,comment,
             source,status,submitted_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          customerId ?? null,
          input.orderId ?? null,
          input.categoryId,
          input.surveyType,
          input.rating,
          input.comment ?? null,
          input.source,
          stamp,
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO customer_feedback_events
            (tenant_id,id,feedback_id,event_type,actor_id,payload_json,created_at)
           VALUES (?,?,?,'SUBMITTED',?,'{}',?)`,
        )
        .bind(this.actor.tenantId, crypto.randomUUID(), id, this.actor.id, stamp),
      ...(customerId
        ? [
            this.db
              .prepare(
                `INSERT INTO customer_journey_events
                  (tenant_id,id,customer_id,branch_id,event_type,source_type,source_id,summary,
                   occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
              )
              .bind(
                this.actor.tenantId,
                crypto.randomUUID(),
                customerId,
                input.branchId,
                "FEEDBACK_SUBMITTED",
                "CUSTOMER_FEEDBACK",
                id,
                `${input.surveyType} feedback submitted`,
                stamp,
                stamp,
              ),
          ]
        : []),
    ]);
    return { id, status: "OPEN" as const };
  }

  async listFeedbackCategories() {
    this.require(permissions.feedbackView);
    const rows = await this.db
      .prepare(
        `SELECT id,code,name,active FROM customer_feedback_categories
         WHERE tenant_id=? ORDER BY active DESC,name`,
      )
      .bind(this.actor.tenantId)
      .all();
    return rows.results ?? [];
  }

  async listFeedback(branchId?: string, limit = 200) {
    this.require(permissions.feedbackView);
    const scopedBranch = branchId ?? this.actor.branchId;
    if (!scopedBranch) {
      throw new CrmDomainError("VALIDATION_FAILED", "A branch is required to list feedback");
    }
    this.branch(scopedBranch);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new CrmDomainError("VALIDATION_FAILED", "Feedback limit must be between 1 and 500");
    }
    const rows = await this.db
      .prepare(
        `SELECT f.id,f.customer_id,c.display_name,f.order_id,fc.name AS category,f.survey_type,
                f.rating,f.comment,f.status,f.owner_id,f.submitted_at
         FROM customer_feedback f JOIN customer_feedback_categories fc
           ON fc.tenant_id=f.tenant_id AND fc.id=f.category_id
         LEFT JOIN customers c ON c.tenant_id=f.tenant_id AND c.id=f.customer_id
         WHERE f.tenant_id=? AND f.branch_id=? ORDER BY f.submitted_at DESC LIMIT ?`,
      )
      .bind(this.actor.tenantId, scopedBranch, limit)
      .all();
    return rows.results ?? [];
  }

  async resolveFeedback(input: {
    feedbackId: string;
    status: "IN_REVIEW" | "FOLLOW_UP" | "RESOLVED" | "DISMISSED";
    note?: string;
    resolution?: string;
  }) {
    this.require(permissions.feedbackManage);
    const feedback = await this.db
      .prepare("SELECT branch_id,status FROM customer_feedback WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.feedbackId)
      .first<{ branch_id: string; status: string }>();
    if (!feedback) throw new CrmDomainError("NOT_FOUND", "Feedback was not found");
    this.branch(feedback.branch_id);
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE customer_feedback SET status=?,owner_id=?,resolution=COALESCE(?,resolution),
             resolved_at=CASE WHEN ? IN ('RESOLVED','DISMISSED') THEN ? ELSE NULL END,updated_at=?
           WHERE tenant_id=? AND id=?`,
        )
        .bind(
          input.status,
          this.actor.id,
          input.resolution ?? null,
          input.status,
          stamp,
          stamp,
          this.actor.tenantId,
          input.feedbackId,
        ),
      this.db
        .prepare(
          `INSERT INTO customer_feedback_events
            (tenant_id,id,feedback_id,event_type,actor_id,note,payload_json,created_at)
           VALUES (?,?,?,?,?,?,'{}',?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          input.feedbackId,
          input.status,
          this.actor.id,
          input.note ?? null,
          stamp,
        ),
      this.auditStatement({
        action: "CUSTOMER_FEEDBACK_RESOLVED",
        entityType: "CUSTOMER_FEEDBACK",
        entityId: input.feedbackId,
        branchId: feedback.branch_id,
        at: stamp,
        metadata: { from: feedback.status, to: input.status },
      }),
    ]);
    return { id: input.feedbackId, status: input.status };
  }

  async dashboard(branchId?: string) {
    this.require(permissions.crmView);
    const scopeBranch =
      branchId ?? (this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : undefined);
    if (scopeBranch) this.branch(scopeBranch);
    const branchFilter = scopeBranch ? " AND branch_id=?" : "";
    const values = scopeBranch ? [this.actor.tenantId, scopeBranch] : [this.actor.tenantId];
    const [customers, metrics, loyalty, vouchers, gifts, campaigns, feedback, links] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM customers c WHERE c.tenant_id=? AND c.status='ACTIVE'
           ${
             scopeBranch
               ? `AND (c.preferred_branch_id=? OR EXISTS (
             SELECT 1 FROM customer_transaction_links l WHERE l.tenant_id=c.tenant_id
               AND l.customer_id=c.id AND l.branch_id=?))`
               : ""
           }`,
          )
          .bind(this.actor.tenantId, ...(scopeBranch ? [scopeBranch, scopeBranch] : []))
          .first<{ count: number }>(),
        this.db
          .prepare(
            `SELECT COALESCE(SUM(order_count),0) AS orders,COALESCE(SUM(net_spend_minor),0) AS net_spend,
                  COALESCE(SUM(CASE WHEN last_visit_at>=datetime('now','-30 days') THEN 1 ELSE 0 END),0) AS active,
                  COALESCE(SUM(CASE WHEN order_count>=2 THEN 1 ELSE 0 END),0) AS repeat_count,
                  MIN(quality) AS quality
           FROM customer_metric_snapshots WHERE tenant_id=? AND period_key='LIFETIME'${branchFilter}`,
          )
          .bind(...values)
          .first<{
            orders: number;
            net_spend: number;
            active: number;
            repeat_count: number;
            quality: DataQuality | null;
          }>(),
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT customer_id) AS members,
                  COALESCE(SUM(CASE WHEN points>0 THEN points ELSE 0 END),0) AS issued,
                  ABS(COALESCE(SUM(CASE WHEN entry_type='REDEEM' THEN points ELSE 0 END),0)) AS redeemed
           FROM loyalty_ledger WHERE tenant_id=?${scopeBranch ? " AND (branch_id=? OR branch_id IS NULL)" : ""}`,
          )
          .bind(...values)
          .first<{ members: number; issued: number; redeemed: number }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS redeemed FROM voucher_redemptions
           WHERE tenant_id=? AND status='CONFIRMED'${branchFilter}`,
          )
          .bind(...values)
          .first<{ redeemed: number }>(),
        this.db
          .prepare(
            `SELECT COALESCE(SUM(l.amount_minor),0) AS liability
           FROM gift_card_ledger l WHERE l.tenant_id=?${scopeBranch ? " AND (l.branch_id=? OR l.branch_id IS NULL)" : ""}`,
          )
          .bind(...values)
          .first<{ liability: number }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM campaigns WHERE tenant_id=? AND status IN ('SCHEDULED','ACTIVE')
           ${scopeBranch ? "AND (branch_scope_json='[]' OR EXISTS (SELECT 1 FROM json_each(branch_scope_json) WHERE value=?))" : ""}`,
          )
          .bind(this.actor.tenantId, ...(scopeBranch ? [scopeBranch] : []))
          .first<{ count: number }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS count,AVG(CASE WHEN survey_type='CSAT' THEN rating END) AS csat,
                  100.0*(SUM(CASE WHEN survey_type='NPS' AND rating>=9 THEN 1 ELSE 0 END)-
                    SUM(CASE WHEN survey_type='NPS' AND rating<=6 THEN 1 ELSE 0 END))/
                    NULLIF(SUM(CASE WHEN survey_type='NPS' THEN 1 ELSE 0 END),0) AS nps
           FROM customer_feedback WHERE tenant_id=?${branchFilter}`,
          )
          .bind(...values)
          .first<{ count: number; csat: number | null; nps: number | null }>(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM customer_transaction_links
           WHERE tenant_id=? AND completed=1${branchFilter}`,
          )
          .bind(...values)
          .first<{ count: number }>(),
      ]);
    const customerCount = customers?.count ?? 0;
    const evidenceCount = links?.count ?? 0;
    const quality: DataQuality =
      evidenceCount === 0
        ? (metrics?.quality ?? "INSUFFICIENT_DATA")
        : evidenceCount >= Math.max(customerCount, 1) * 2
          ? "HIGH"
          : evidenceCount >= Math.max(customerCount, 1)
            ? "MEDIUM"
            : "LOW";
    return {
      activeCustomers: metrics?.active ?? 0,
      totalCustomers: customerCount,
      repeatCustomers: metrics?.repeat_count ?? 0,
      returnRateBps: customerCount
        ? Math.round(((metrics?.repeat_count ?? 0) * 10_000) / customerCount)
        : 0,
      netSpendMinor: metrics?.net_spend ?? 0,
      orderCount: metrics?.orders ?? 0,
      loyaltyMembers: loyalty?.members ?? 0,
      pointsIssued: loyalty?.issued ?? 0,
      pointsRedeemed: loyalty?.redeemed ?? 0,
      vouchersRedeemed: vouchers?.redeemed ?? 0,
      giftCardLiabilityMinor: gifts?.liability ?? 0,
      activeCampaigns: campaigns?.count ?? 0,
      feedbackCount: feedback?.count ?? 0,
      csat: feedback?.csat ?? null,
      nps: feedback?.nps === null || feedback?.nps === undefined ? null : Math.round(feedback.nps),
      quality,
      evidence: { completedCustomerLinks: evidenceCount },
    };
  }

  async exportCustomers() {
    this.require(permissions.crmCustomerExport);
    const canViewContacts = this.actor.permissions.includes(permissions.crmCustomerContactView);
    const branchIds = this.actor.branchScope.type === "ALL" ? [] : this.actor.assignedBranchIds;
    const branchPredicate = branchIds.length
      ? `AND (preferred_branch_id IN (${placeholders(branchIds.length)}) OR EXISTS (
          SELECT 1 FROM customer_transaction_links l WHERE l.tenant_id=customers.tenant_id
            AND l.customer_id=customers.id AND l.branch_id IN (${placeholders(branchIds.length)})))`
      : "";
    const rows = await this.db
      .prepare(
        `SELECT id,customer_code,account_type,display_name,phone_display,email_display,status,
                preferred_language,preferred_branch_id,company_name,created_at,updated_at
         FROM customers WHERE tenant_id=? ${branchPredicate} ORDER BY id LIMIT 100000`,
      )
      .bind(this.actor.tenantId, ...branchIds, ...branchIds)
      .all<Record<string, unknown>>();
    await this.db.batch([
      this.auditStatement({
        action: "CUSTOMER_EXPORT_CREATED",
        entityType: "CUSTOMER_EXPORT",
        entityId: crypto.randomUUID(),
        metadata: { rowCount: rows.results?.length ?? 0, contactsIncluded: canViewContacts },
      }),
    ]);
    return (rows.results ?? []).map((row) => ({
      ...row,
      phone_display: maskContact(row["phone_display"] as string | null, canViewContacts),
      email_display: maskContact(row["email_display"] as string | null, canViewContacts),
    }));
  }

  async previewCustomerImport(input: {
    sourceName: string;
    fileHash: string;
    idempotencyKey: string;
    rows: Array<{
      displayName: string;
      phone?: string;
      email?: string;
      memberId?: string;
      tags: string[];
      consentStatus?: ConsentStatus;
      consentEvidence?: string;
    }>;
  }) {
    this.require(permissions.crmCustomerManage);
    const existing = await this.db
      .prepare(
        "SELECT id,status,preview_json FROM customer_import_jobs WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; status: string; preview_json: string }>();
    if (existing)
      return { id: existing.id, status: existing.status, ...safeJson(existing.preview_json, {}) };
    const preview = [] as Array<Record<string, unknown>>;
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;
    for (const [index, row] of input.rows.entries()) {
      try {
        const phone = row.phone ? normalizePhone(row.phone, this.phonePolicy) : undefined;
        const email = row.email ? normalizeEmail(row.email) : undefined;
        const duplicate = await this.findExistingIdentifier(phone, email);
        const consentAccepted =
          row.consentStatus !== "GRANTED" || Boolean(row.consentEvidence?.trim());
        if (!consentAccepted) throw new Error("Granted consent requires explicit evidence");
        if (duplicate) duplicates += 1;
        else valid += 1;
        preview.push({
          row: index + 1,
          status: duplicate ? "DUPLICATE" : "VALID",
          customerId: duplicate ?? undefined,
          normalizedPhone: phone,
          normalizedEmail: email,
          consentAccepted,
        });
      } catch (error) {
        invalid += 1;
        preview.push({
          row: index + 1,
          status: "INVALID",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const previewJson = JSON.stringify({
      valid,
      invalid,
      duplicates,
      rows: preview,
      sourceRows: input.rows,
    });
    await this.db
      .prepare(
        `INSERT INTO customer_import_jobs
          (tenant_id,id,status,file_hash,source_name,row_count,valid_count,invalid_count,
           duplicate_count,preview_json,idempotency_key,created_by,created_at)
         VALUES (?,?,'READY',?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.fileHash,
        input.sourceName,
        input.rows.length,
        valid,
        invalid,
        duplicates,
        previewJson,
        input.idempotencyKey,
        this.actor.id,
        stamp,
      )
      .run();
    return { id, status: "READY" as const, valid, invalid, duplicates, rows: preview };
  }

  async commitCustomerImport(jobId: string) {
    this.require(permissions.crmCustomerManage);
    const job = await this.db
      .prepare("SELECT status,preview_json FROM customer_import_jobs WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, jobId)
      .first<{ status: string; preview_json: string }>();
    if (!job) throw new CrmDomainError("NOT_FOUND", "Customer import was not found");
    if (job.status === "COMPLETED") return { id: jobId, duplicate: true };
    if (job.status !== "READY") throw new CrmDomainError("INVALID_STATE", "Import is not ready");
    const payload = safeJson<{
      rows: Array<{ row: number; status: string }>;
      sourceRows: Array<{
        displayName: string;
        phone?: string;
        email?: string;
        consentStatus?: ConsentStatus;
        consentEvidence?: string;
      }>;
    }>(job.preview_json, { rows: [], sourceRows: [] });
    let created = 0;
    for (const result of payload.rows) {
      if (result.status !== "VALID") continue;
      const source = payload.sourceRows[result.row - 1];
      if (!source) continue;
      const customer = await this.createCustomer({
        displayName: source.displayName,
        ...(source.phone ? { phone: source.phone } : {}),
        ...(source.email ? { email: source.email } : {}),
        createdSource: "CUSTOMER_IMPORT",
      });
      if (source.consentStatus && source.consentStatus !== "UNKNOWN") {
        await this.appendConsent({
          customerId: customer.id,
          channel: "EMAIL_MARKETING",
          status: source.consentStatus,
          source: "CUSTOMER_IMPORT_WITH_EVIDENCE",
          policyVersion: "imported-evidence",
          ...(source.consentEvidence ? { proofReference: source.consentEvidence } : {}),
        });
      }
      created += 1;
    }
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE customer_import_jobs SET status='COMPLETED',completed_at=? WHERE tenant_id=? AND id=? AND status='READY'",
        )
        .bind(stamp, this.actor.tenantId, jobId),
      this.auditStatement({
        action: "CUSTOMER_IMPORT_COMPLETED",
        entityType: "CUSTOMER_IMPORT",
        entityId: jobId,
        metadata: { created },
        at: stamp,
      }),
    ]);
    return { id: jobId, duplicate: false, created };
  }

  private async assertCustomerVisible(customerId: string) {
    if (this.actor.branchScope.type === "ALL") return;
    const branchIds = this.actor.assignedBranchIds;
    if (!branchIds.length) {
      throw new CrmDomainError(
        "PERMISSION_DENIED",
        "Customer is outside the assigned branch scope",
      );
    }
    const params = placeholders(branchIds.length);
    const row = await this.db
      .prepare(
        `SELECT id FROM customers c WHERE c.tenant_id=? AND c.id=? AND
          (c.preferred_branch_id IN (${params}) OR EXISTS (
            SELECT 1 FROM customer_transaction_links l WHERE l.tenant_id=c.tenant_id
              AND l.customer_id=c.id AND l.branch_id IN (${params})))`,
      )
      .bind(this.actor.tenantId, customerId, ...branchIds, ...branchIds)
      .first<{ id: string }>();
    if (!row) {
      throw new CrmDomainError(
        "PERMISSION_DENIED",
        "Customer is outside the assigned branch scope",
      );
    }
  }

  private identifierStatement(
    customerId: string,
    type: CustomerIdentifierType,
    normalized: string,
    display?: string,
  ) {
    const stamp = new Date().toISOString();
    return this.db
      .prepare(
        `INSERT INTO customer_identifiers
          (tenant_id,id,customer_id,identifier_type,provider_connection_id,provider_scope,
           normalized_value,display_value,verified,verification_source,status,created_by,
           created_at,updated_at) VALUES (?,?,?,?,NULL,'',?,?,0,NULL,'ACTIVE',?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        customerId,
        type,
        normalized,
        display?.trim() ?? null,
        this.actor.id,
        stamp,
        stamp,
      );
  }

  private async assertIdentifierAvailable(
    type: CustomerIdentifierType,
    value: string,
    scope: string,
  ) {
    const row = await this.db
      .prepare(
        `SELECT customer_id FROM customer_identifiers
         WHERE tenant_id=? AND identifier_type=? AND provider_scope=? AND normalized_value=?
           AND status='ACTIVE'`,
      )
      .bind(this.actor.tenantId, type, scope, value)
      .first<{ customer_id: string }>();
    if (row) throw new CrmDomainError("DUPLICATE", `Exact ${type.toLowerCase()} already exists`);
  }

  private async resolveCanonicalId(customerId: string) {
    const row = await this.db
      .prepare(
        `SELECT c.id,COALESCE(a.canonical_customer_id,c.id) AS canonical_id
         FROM customers c LEFT JOIN customer_aliases a
           ON a.tenant_id=c.tenant_id AND a.alias_customer_id=c.id
         WHERE c.tenant_id=? AND c.id=?`,
      )
      .bind(this.actor.tenantId, customerId)
      .first<{ id: string; canonical_id: string }>();
    if (!row) throw new CrmDomainError("NOT_FOUND", "Customer was not found");
    return row.canonical_id;
  }

  private async customerFamilyIds(canonicalId: string) {
    const aliases = await this.db
      .prepare(
        "SELECT alias_customer_id FROM customer_aliases WHERE tenant_id=? AND canonical_customer_id=?",
      )
      .bind(this.actor.tenantId, canonicalId)
      .all<{ alias_customer_id: string }>();
    return [canonicalId, ...(aliases.results ?? []).map((row) => row.alias_customer_id)];
  }

  private async findExistingIdentifier(phone?: string, email?: string) {
    if (!phone && !email) return null;
    const row = await this.db
      .prepare(
        `SELECT customer_id FROM customer_identifiers WHERE tenant_id=? AND status='ACTIVE'
         AND ((identifier_type='PHONE' AND normalized_value=?) OR
              (identifier_type='EMAIL' AND normalized_value=?)) LIMIT 1`,
      )
      .bind(this.actor.tenantId, phone ?? "", email ?? "")
      .first<{ customer_id: string }>();
    return row?.customer_id ?? null;
  }
}

function combineMetrics(rows: MetricRow[]) {
  if (!rows.length) {
    return {
      visitCount: 0,
      orderCount: 0,
      netSpendMinor: 0,
      refundMinor: 0,
      discountMinor: 0,
      averageOrderMinor: 0,
      currency: undefined,
      firstVisitAt: undefined,
      lastVisitAt: undefined,
      favoriteBranchId: undefined,
      favoriteChannel: undefined,
      favoriteItems: [] as Array<{ name: string; quantity: number }>,
      quality: "INSUFFICIENT_DATA" as DataQuality,
    };
  }
  const orderCount = rows.reduce((sum, row) => sum + row.order_count, 0);
  const netSpendMinor = rows.reduce((sum, row) => sum + row.net_spend_minor, 0);
  const first = rows
    .map((row) => row.first_visit_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const last = rows
    .map((row) => row.last_visit_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const favoriteItems = new Map<string, number>();
  for (const row of rows) {
    for (const item of safeJson<Array<{ name: string; quantity: number }>>(
      row.favorite_items_json,
      [],
    )) {
      favoriteItems.set(item.name, (favoriteItems.get(item.name) ?? 0) + item.quantity);
    }
  }
  const qualities: DataQuality[] = ["INSUFFICIENT_DATA", "LOW", "MEDIUM", "HIGH"];
  return {
    visitCount: rows.reduce((sum, row) => sum + row.visit_count, 0),
    orderCount,
    netSpendMinor,
    refundMinor: rows.reduce((sum, row) => sum + row.refund_minor, 0),
    discountMinor: rows.reduce((sum, row) => sum + row.discount_minor, 0),
    averageOrderMinor: orderCount ? Math.round(netSpendMinor / orderCount) : 0,
    currency: rows[0]?.currency,
    firstVisitAt: first,
    lastVisitAt: last,
    favoriteBranchId:
      rows.sort((a, b) => b.order_count - a.order_count)[0]?.favorite_branch_id ?? undefined,
    favoriteChannel:
      rows.sort((a, b) => b.order_count - a.order_count)[0]?.favorite_channel ?? undefined,
    favoriteItems: [...favoriteItems.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
      .slice(0, 5),
    quality: rows.reduce(
      (lowest, row) =>
        qualities.indexOf(row.quality) < qualities.indexOf(lowest) ? row.quality : lowest,
      "HIGH" as DataQuality,
    ),
  };
}

function marketingChannel(channel: ConsentChannel) {
  return channel.replace("_MARKETING", "") as "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" | "PHONE";
}
