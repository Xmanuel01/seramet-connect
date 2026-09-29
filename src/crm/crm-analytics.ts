import { CrmDomainError, CrmServiceBase, safeJson } from "@/crm/service-base";
import type { DataQuality, SegmentDefinition, SegmentRule } from "@/crm/types";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";

export type CustomerFacts = {
  orderCount: number;
  netSpendMinor: number;
  averageOrderMinor: number;
  daysSinceLastVisit: number;
  refundMinor: number;
  discountMinor: number;
  favoriteChannel?: string;
  loyaltyPoints: number;
  tierId?: string;
};

export function evaluateSegment(definition: SegmentDefinition, facts: CustomerFacts) {
  const all = definition.all ?? [];
  const any = definition.any ?? [];
  if (!all.length && !any.length) return false;
  return (
    all.every((rule) => evaluateRule(rule, facts)) &&
    (!any.length || any.some((rule) => evaluateRule(rule, facts)))
  );
}

function evaluateRule(rule: SegmentRule, facts: CustomerFacts) {
  const actual = facts[rule.field];
  switch (rule.operator) {
    case "EQ":
      return actual === rule.value;
    case "NEQ":
      return actual !== rule.value;
    case "GT":
      return typeof actual === "number" && typeof rule.value === "number" && actual > rule.value;
    case "GTE":
      return typeof actual === "number" && typeof rule.value === "number" && actual >= rule.value;
    case "LT":
      return typeof actual === "number" && typeof rule.value === "number" && actual < rule.value;
    case "LTE":
      return typeof actual === "number" && typeof rule.value === "number" && actual <= rule.value;
    case "IN":
      return Array.isArray(rule.value) && rule.value.includes(actual as never);
  }
}

export function calculateRfm(
  facts: Pick<CustomerFacts, "daysSinceLastVisit" | "orderCount" | "netSpendMinor">,
  thresholds: {
    recencyDays: [number, number, number, number];
    frequency: [number, number, number, number];
    monetaryMinor: [number, number, number, number];
  },
) {
  return {
    recency: inverseScore(facts.daysSinceLastVisit, thresholds.recencyDays),
    frequency: score(facts.orderCount, thresholds.frequency),
    monetary: score(facts.netSpendMinor, thresholds.monetaryMinor),
  };
}

function score(value: number, thresholds: [number, number, number, number]) {
  return thresholds.reduce((result, threshold) => result + Number(value >= threshold), 1);
}

function inverseScore(value: number, thresholds: [number, number, number, number]) {
  return 5 - thresholds.reduce((result, threshold) => result + Number(value > threshold), 0);
}

export class CrmAnalyticsService extends CrmServiceBase {
  constructor(db: D1Database, actor: ServerActor) {
    super(db, actor);
  }

  async recalculateMetrics(branchId?: string) {
    this.require(permissions.crmView);
    if (branchId) this.branch(branchId);
    const branchPredicate = branchId ? "AND branch_id=?" : "";
    const links = await this.db
      .prepare(
        `SELECT customer_id,branch_id,currency,business_date,net_minor,refund_minor,discount_minor,
                channel,item_summary_json,created_at
         FROM customer_transaction_links WHERE tenant_id=? AND completed=1 ${branchPredicate}
         ORDER BY customer_id,branch_id,business_date,created_at`,
      )
      .bind(this.actor.tenantId, ...(branchId ? [branchId] : []))
      .all<{
        customer_id: string;
        branch_id: string;
        currency: string;
        business_date: string;
        net_minor: number;
        refund_minor: number;
        discount_minor: number;
        channel: string | null;
        item_summary_json: string;
        created_at: string;
      }>();
    const branches = await this.db
      .prepare("SELECT id,brand_id FROM branches WHERE tenant_id=?")
      .bind(this.actor.tenantId)
      .all<{ id: string; brand_id: string | null }>();
    const brandByBranch = new Map(
      (branches.results ?? []).map((row) => [row.id, row.brand_id ?? ""]),
    );
    const grouped = new Map<string, ReturnType<typeof emptyAggregate>>();
    for (const link of links.results ?? []) {
      const key = `${link.customer_id}:${link.branch_id}:${link.currency}`;
      const group =
        grouped.get(key) ?? emptyAggregate(link.customer_id, link.branch_id, link.currency);
      group.orderCount += 1;
      group.visitDates.add(link.business_date);
      group.netSpendMinor += link.net_minor;
      group.refundMinor += link.refund_minor;
      group.discountMinor += link.discount_minor;
      group.firstVisitAt = minDate(group.firstVisitAt, link.created_at);
      group.lastVisitAt = maxDate(group.lastVisitAt, link.created_at);
      if (link.channel)
        group.channels.set(link.channel, (group.channels.get(link.channel) ?? 0) + 1);
      for (const item of safeJson<Array<{ name?: string; quantity?: number }>>(
        link.item_summary_json,
        [],
      )) {
        if (!item.name || !Number.isFinite(item.quantity)) continue;
        group.items.set(item.name, (group.items.get(item.name) ?? 0) + Number(item.quantity));
      }
      grouped.set(key, group);
    }
    const stamp = new Date().toISOString();
    const statements = [];
    for (const group of grouped.values()) {
      const favoriteChannel = deterministicFavorite(group.channels);
      const favoriteItems = [...group.items.entries()]
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
        .slice(0, 5);
      const daysSinceLastVisit = group.lastVisitAt
        ? Math.max(0, Math.floor((Date.now() - Date.parse(group.lastVisitAt)) / 86_400_000))
        : 0;
      const rfm = calculateRfm(
        {
          daysSinceLastVisit,
          orderCount: group.orderCount,
          netSpendMinor: group.netSpendMinor,
        },
        {
          recencyDays: [7, 30, 60, 90],
          frequency: [2, 4, 8, 16],
          monetaryMinor: [100_000, 500_000, 1_000_000, 5_000_000],
        },
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO customer_metric_snapshots
              (tenant_id,customer_id,brand_id,branch_id,period_key,currency,visit_count,order_count,
               gross_spend_minor,net_spend_minor,refund_minor,discount_minor,average_order_minor,
               first_visit_at,last_visit_at,favorite_branch_id,favorite_channel,favorite_items_json,
               rfm_json,quality,evidence_watermark,calculated_at)
             VALUES (?,?,?,?, 'LIFETIME',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(tenant_id,customer_id,brand_id,branch_id,period_key) DO UPDATE SET
               currency=excluded.currency,visit_count=excluded.visit_count,order_count=excluded.order_count,
               gross_spend_minor=excluded.gross_spend_minor,net_spend_minor=excluded.net_spend_minor,
               refund_minor=excluded.refund_minor,discount_minor=excluded.discount_minor,
               average_order_minor=excluded.average_order_minor,first_visit_at=excluded.first_visit_at,
               last_visit_at=excluded.last_visit_at,favorite_branch_id=excluded.favorite_branch_id,
               favorite_channel=excluded.favorite_channel,favorite_items_json=excluded.favorite_items_json,
               rfm_json=excluded.rfm_json,quality=excluded.quality,
               evidence_watermark=excluded.evidence_watermark,calculated_at=excluded.calculated_at`,
          )
          .bind(
            this.actor.tenantId,
            group.customerId,
            brandByBranch.get(group.branchId) ?? "",
            group.branchId,
            group.currency,
            group.visitDates.size,
            group.orderCount,
            group.netSpendMinor + group.refundMinor,
            group.netSpendMinor,
            group.refundMinor,
            group.discountMinor,
            group.orderCount ? Math.round(group.netSpendMinor / group.orderCount) : 0,
            group.firstVisitAt,
            group.lastVisitAt,
            group.branchId,
            favoriteChannel,
            JSON.stringify(favoriteItems),
            JSON.stringify({ ...rfm, daysSinceLastVisit }),
            group.orderCount >= 5 ? "HIGH" : group.orderCount >= 2 ? "MEDIUM" : "LOW",
            `${group.lastVisitAt}:${group.orderCount}`,
            stamp,
          ),
        this.db
          .prepare(
            "UPDATE customers SET last_activity_at=?,updated_at=? WHERE tenant_id=? AND id=?",
          )
          .bind(group.lastVisitAt, stamp, this.actor.tenantId, group.customerId),
      );
    }
    for (let index = 0; index < statements.length; index += 200) {
      await this.db.batch(statements.slice(index, index + 200));
    }
    await this.db
      .prepare(
        `UPDATE crm_recalculation_events SET status='PROCESSED',processed_at=?
         WHERE tenant_id=? AND status IN ('PENDING','PROCESSING')
           AND (? IS NULL OR branch_id=? OR branch_id IS NULL)`,
      )
      .bind(stamp, this.actor.tenantId, branchId ?? null, branchId ?? null)
      .run();
    return { projectedCustomers: grouped.size };
  }

  async retentionSummary(input: { branchId?: string; asOf?: Date; lapsedDays?: number }) {
    this.require(permissions.crmView);
    if (input.branchId) this.branch(input.branchId);
    const asOf = input.asOf ?? new Date();
    const lapsedDays = input.lapsedDays ?? 60;
    const rows = await this.db
      .prepare(
        `SELECT customer_id,MIN(business_date) AS first_date,MAX(business_date) AS last_date,
                COUNT(*) AS orders
         FROM customer_transaction_links WHERE tenant_id=? AND completed=1
           AND (? IS NULL OR branch_id=?) GROUP BY customer_id`,
      )
      .bind(this.actor.tenantId, input.branchId ?? null, input.branchId ?? null)
      .all<{ customer_id: string; first_date: string; last_date: string; orders: number }>();
    const facts = rows.results ?? [];
    const daysSince = (date: string) =>
      Math.floor((asOf.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    return {
      identifiedCustomers: facts.length,
      newCustomers30Days: facts.filter((row) => daysSince(row.first_date) <= 30).length,
      repeatCustomers: facts.filter((row) => row.orders >= 2).length,
      lapsedCustomers: facts.filter((row) => daysSince(row.last_date) > lapsedDays).length,
      returnRateBps: facts.length
        ? Math.round((facts.filter((row) => row.orders >= 2).length * 10_000) / facts.length)
        : 0,
      lapsedDefinitionDays: lapsedDays,
      quality: qualityForCount(facts.length),
    };
  }

  async cohortRetention(branchId?: string) {
    this.require(permissions.crmView);
    if (branchId) this.branch(branchId);
    const rows = await this.db
      .prepare(
        `SELECT customer_id,business_date FROM customer_transaction_links
         WHERE tenant_id=? AND completed=1 AND (? IS NULL OR branch_id=?)
         ORDER BY customer_id,business_date`,
      )
      .bind(this.actor.tenantId, branchId ?? null, branchId ?? null)
      .all<{ customer_id: string; business_date: string }>();
    const visits = new Map<string, string[]>();
    for (const row of rows.results ?? []) {
      const list = visits.get(row.customer_id) ?? [];
      list.push(row.business_date);
      visits.set(row.customer_id, list);
    }
    const cohorts = new Map<
      string,
      { customers: Set<string>; retained: Map<number, Set<string>> }
    >();
    for (const [customerId, dates] of visits) {
      const first = dates[0]!;
      const cohort = first.slice(0, 7);
      const entry = cohorts.get(cohort) ?? {
        customers: new Set<string>(),
        retained: new Map<number, Set<string>>(),
      };
      entry.customers.add(customerId);
      for (const date of dates) {
        const offset = monthDifference(first, date);
        const set = entry.retained.get(offset) ?? new Set<string>();
        set.add(customerId);
        entry.retained.set(offset, set);
      }
      cohorts.set(cohort, entry);
    }
    return [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, value]) => ({
        cohort,
        customers: value.customers.size,
        retention: [...value.retained.entries()]
          .sort(([a], [b]) => a - b)
          .map(([month, retained]) => ({
            month,
            retained: retained.size,
            rateBps: value.customers.size
              ? Math.round((retained.size * 10_000) / value.customers.size)
              : 0,
          })),
        quality: qualityForCount(value.customers.size),
      }));
  }
}

function emptyAggregate(customerId: string, branchId: string, currency: string) {
  return {
    customerId,
    branchId,
    currency,
    orderCount: 0,
    visitDates: new Set<string>(),
    netSpendMinor: 0,
    refundMinor: 0,
    discountMinor: 0,
    firstVisitAt: "" as string,
    lastVisitAt: "" as string,
    channels: new Map<string, number>(),
    items: new Map<string, number>(),
  };
}

function minDate(current: string, value: string) {
  return !current || value < current ? value : current;
}

function maxDate(current: string, value: string) {
  return !current || value > current ? value : current;
}

function deterministicFavorite(values: Map<string, number>) {
  return (
    [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  );
}

function qualityForCount(count: number): DataQuality {
  return count >= 100 ? "HIGH" : count >= 30 ? "MEDIUM" : count > 0 ? "LOW" : "INSUFFICIENT_DATA";
}

function monthDifference(first: string, next: string) {
  const [firstYear, firstMonth] = first.split("-").map(Number);
  const [nextYear, nextMonth] = next.split("-").map(Number);
  return (nextYear! - firstYear!) * 12 + (nextMonth! - firstMonth!);
}
