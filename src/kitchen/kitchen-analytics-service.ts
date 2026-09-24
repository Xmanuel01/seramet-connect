import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { authoritativeBusinessDate } from "@/server/business-date";
import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

type PeriodDays = 1 | 7 | 30;

type StationAggregateRow = {
  station_id: string;
  station_name: string;
  ticket_count: number;
  completed_count: number;
  late_count: number;
  timing_weight: number;
  average_prep_weighted: number | null;
  pickup_weight: number;
  average_pickup_weighted: number | null;
  throughput_samples: number;
  average_throughput_milli: number | null;
  insufficient_rows: number;
};

type DailyRow = {
  business_date: string;
  ticket_count: number;
  completed_count: number;
  late_count: number;
  timing_weight: number;
  average_prep_weighted: number | null;
};

export class KitchenAnalyticsService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async overview(branchId: string, periodDays: PeriodDays) {
    this.require(permissions.kitchenView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);

    const branch = await this.db
      .prepare(
        "SELECT timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=? AND active=1",
      )
      .bind(this.actor.tenantId, branchId)
      .first<{ timezone: string; business_day_cutoff_minutes: number }>();
    if (!branch) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Kitchen analytics branch not found");
    }

    const periodEnd = authoritativeBusinessDate({
      timezone: branch.timezone,
      cutoffMinutes: branch.business_day_cutoff_minutes,
    });
    const periodStart = shiftDate(periodEnd, -(periodDays - 1));

    const [stations, daily, production, prep, cookbook, currentPrep] = await Promise.all([
      this.stationAggregates(branchId, periodStart, periodEnd),
      this.dailyTrend(branchId, periodStart, periodEnd),
      this.productionSummary(branchId, periodStart, periodEnd),
      this.prepSummary(branchId, periodStart, periodEnd),
      this.cookbookCoverage(branchId),
      this.currentPrepRisks(branchId, periodEnd),
    ]);

    const totalTickets = stations.reduce((sum, row) => sum + row.ticketCount, 0);
    const totalCompleted = stations.reduce((sum, row) => sum + row.completedCount, 0);
    const totalLate = stations.reduce((sum, row) => sum + row.lateCount, 0);
    const completionBps = ratioBps(totalCompleted, totalTickets);
    const lateBps = ratioBps(totalLate, totalTickets);
    const timedCompleted = stations.reduce((sum, row) => sum + row.timingWeight, 0);
    const averagePrepMs =
      timedCompleted > 0
        ? Math.round(
            stations.reduce(
              (sum, row) => sum + (row.averagePrepMs ?? 0) * row.timingWeight,
              0,
            ) / timedCompleted,
          )
        : null;

    return {
      branchId,
      periodDays,
      periodStart,
      periodEnd,
      summary: {
        ticketCount: totalTickets,
        completedCount: totalCompleted,
        lateCount: totalLate,
        completionBps,
        lateBps,
        averagePrepMs,
      },
      stations,
      daily,
      production,
      prep,
      cookbook,
      currentPrep,
      generatedAt: new Date().toISOString(),
    };
  }

  private async stationAggregates(branchId: string, start: string, end: string) {
    const result = await this.db
      .prepare(
        "SELECT m.station_id,s.name AS station_name," +
          " SUM(m.ticket_count) AS ticket_count,SUM(m.completed_count) AS completed_count," +
          " SUM(m.late_count) AS late_count," +
          " SUM(CASE WHEN m.average_prep_ms IS NOT NULL THEN m.completed_count ELSE 0 END) AS timing_weight," +
          " CASE WHEN SUM(CASE WHEN m.average_prep_ms IS NOT NULL THEN m.completed_count ELSE 0 END)>0" +
          " THEN SUM(CASE WHEN m.average_prep_ms IS NOT NULL THEN m.average_prep_ms*m.completed_count ELSE 0 END)" +
          " / SUM(CASE WHEN m.average_prep_ms IS NOT NULL THEN m.completed_count ELSE 0 END) ELSE NULL END AS average_prep_weighted," +
          " SUM(CASE WHEN m.average_ready_pickup_ms IS NOT NULL THEN m.completed_count ELSE 0 END) AS pickup_weight," +
          " CASE WHEN SUM(CASE WHEN m.average_ready_pickup_ms IS NOT NULL THEN m.completed_count ELSE 0 END)>0" +
          " THEN SUM(CASE WHEN m.average_ready_pickup_ms IS NOT NULL THEN m.average_ready_pickup_ms*m.completed_count ELSE 0 END)" +
          " / SUM(CASE WHEN m.average_ready_pickup_ms IS NOT NULL THEN m.completed_count ELSE 0 END) ELSE NULL END AS average_pickup_weighted," +
          " SUM(CASE WHEN m.throughput_per_hour_milli IS NOT NULL THEN 1 ELSE 0 END) AS throughput_samples," +
          " AVG(m.throughput_per_hour_milli) AS average_throughput_milli," +
          " SUM(CASE WHEN m.quality='INSUFFICIENT_DATA' THEN 1 ELSE 0 END) AS insufficient_rows" +
          " FROM daily_station_metrics m JOIN stations s" +
          " ON s.tenant_id=m.tenant_id AND s.id=m.station_id" +
          " WHERE m.tenant_id=? AND m.branch_id=? AND m.business_date BETWEEN ? AND ?" +
          " GROUP BY m.station_id,s.name ORDER BY late_count DESC,ticket_count DESC,s.name",
      )
      .bind(this.actor.tenantId, branchId, start, end)
      .all<StationAggregateRow>();

    return (result.results ?? []).map((row) => ({
      stationId: row.station_id,
      stationName: row.station_name,
      ticketCount: Number(row.ticket_count ?? 0),
      completedCount: Number(row.completed_count ?? 0),
      lateCount: Number(row.late_count ?? 0),
      completionBps: ratioBps(Number(row.completed_count ?? 0), Number(row.ticket_count ?? 0)),
      lateBps: ratioBps(Number(row.late_count ?? 0), Number(row.ticket_count ?? 0)),
      averagePrepMs:
        row.average_prep_weighted === null ? null : Math.round(Number(row.average_prep_weighted)),
      averageReadyPickupMs:
        row.average_pickup_weighted === null
          ? null
          : Math.round(Number(row.average_pickup_weighted)),
      throughputPerHourMilli:
        row.average_throughput_milli === null
          ? null
          : Math.round(Number(row.average_throughput_milli)),
      timingWeight: Number(row.timing_weight ?? 0),
      quality:
        Number(row.ticket_count ?? 0) === 0
          ? "INSUFFICIENT_DATA"
          : Number(row.insufficient_rows ?? 0) > 0
            ? "LOW"
            : "HIGH",
    }));
  }

  private async dailyTrend(branchId: string, start: string, end: string) {
    const result = await this.db
      .prepare(
        "SELECT business_date,SUM(ticket_count) AS ticket_count,SUM(completed_count) AS completed_count," +
          " SUM(late_count) AS late_count," +
          " SUM(CASE WHEN average_prep_ms IS NOT NULL THEN completed_count ELSE 0 END) AS timing_weight," +
          " CASE WHEN SUM(CASE WHEN average_prep_ms IS NOT NULL THEN completed_count ELSE 0 END)>0" +
          " THEN SUM(CASE WHEN average_prep_ms IS NOT NULL THEN average_prep_ms*completed_count ELSE 0 END)" +
          " / SUM(CASE WHEN average_prep_ms IS NOT NULL THEN completed_count ELSE 0 END) ELSE NULL END AS average_prep_weighted" +
          " FROM daily_station_metrics WHERE tenant_id=? AND branch_id=? AND business_date BETWEEN ? AND ?" +
          " GROUP BY business_date ORDER BY business_date",
      )
      .bind(this.actor.tenantId, branchId, start, end)
      .all<DailyRow>();

    return (result.results ?? []).map((row) => ({
      businessDate: row.business_date,
      ticketCount: Number(row.ticket_count ?? 0),
      completedCount: Number(row.completed_count ?? 0),
      lateCount: Number(row.late_count ?? 0),
      lateBps: ratioBps(Number(row.late_count ?? 0), Number(row.ticket_count ?? 0)),
      averagePrepMs:
        row.average_prep_weighted === null ? null : Math.round(Number(row.average_prep_weighted)),
    }));
  }

  private async productionSummary(branchId: string, start: string, end: string) {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS batch_count," +
          " SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed_count," +
          " SUM(CASE WHEN status='IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count," +
          " SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count," +
          " SUM(CASE WHEN status='COMPLETED' AND yield_variance_bps < -500 THEN 1 ELSE 0 END) AS below_target_count," +
          " AVG(CASE WHEN status='COMPLETED' AND yield_variance_bps IS NOT NULL THEN yield_variance_bps END) AS average_yield_variance_bps," +
          " AVG(CASE WHEN status='COMPLETED' AND yield_variance_bps IS NOT NULL THEN ABS(yield_variance_bps) END) AS average_absolute_yield_variance_bps" +
          " FROM production_batches WHERE tenant_id=? AND branch_id=? AND business_date BETWEEN ? AND ?",
      )
      .bind(this.actor.tenantId, branchId, start, end)
      .first<Record<string, unknown>>();
    return {
      batchCount: Number(row?.["batch_count"] ?? 0),
      completedCount: Number(row?.["completed_count"] ?? 0),
      inProgressCount: Number(row?.["in_progress_count"] ?? 0),
      cancelledCount: Number(row?.["cancelled_count"] ?? 0),
      belowTargetCount: Number(row?.["below_target_count"] ?? 0),
      averageYieldVarianceBps:
        row?.["average_yield_variance_bps"] === null ||
        row?.["average_yield_variance_bps"] === undefined
          ? null
          : Math.round(Number(row["average_yield_variance_bps"])),
      averageAbsoluteYieldVarianceBps:
        row?.["average_absolute_yield_variance_bps"] === null ||
        row?.["average_absolute_yield_variance_bps"] === undefined
          ? null
          : Math.round(Number(row["average_absolute_yield_variance_bps"])),
    };
  }

  private async prepSummary(branchId: string, start: string, end: string) {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS task_count," +
          " SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed_count," +
          " SUM(CASE WHEN status='STARTED' THEN 1 ELSE 0 END) AS started_count," +
          " SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS approved_count," +
          " SUM(CASE WHEN status='DISMISSED' THEN 1 ELSE 0 END) AS dismissed_count," +
          " SUM(CASE WHEN status IN ('RECOMMENDED','ADJUSTED') THEN 1 ELSE 0 END) AS awaiting_approval_count" +
          " FROM production_prep_recommendations WHERE tenant_id=? AND branch_id=?" +
          " AND business_date BETWEEN ? AND ?",
      )
      .bind(this.actor.tenantId, branchId, start, end)
      .first<Record<string, unknown>>();
    const total = Number(row?.["task_count"] ?? 0);
    const completed = Number(row?.["completed_count"] ?? 0);
    return {
      taskCount: total,
      completedCount: completed,
      startedCount: Number(row?.["started_count"] ?? 0),
      approvedCount: Number(row?.["approved_count"] ?? 0),
      dismissedCount: Number(row?.["dismissed_count"] ?? 0),
      awaitingApprovalCount: Number(row?.["awaiting_approval_count"] ?? 0),
      completionBps: ratioBps(completed, Math.max(0, total - Number(row?.["dismissed_count"] ?? 0))),
    };
  }

  private async cookbookCoverage(branchId: string) {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS recipe_count," +
          " SUM(CASE WHEN EXISTS (" +
          " SELECT 1 FROM cookbook_recipe_content_versions c" +
          " WHERE c.tenant_id=r.tenant_id AND c.recipe_version_id=r.current_version_id" +
          " AND c.status='PUBLISHED') THEN 1 ELSE 0 END) AS published_count" +
          " FROM recipes r WHERE r.tenant_id=? AND r.active=1" +
          " AND r.current_version_id IS NOT NULL" +
          " AND (r.branch_override_id IS NULL OR r.branch_override_id=?)",
      )
      .bind(this.actor.tenantId, branchId)
      .first<Record<string, unknown>>();
    const recipeCount = Number(row?.["recipe_count"] ?? 0);
    const publishedCount = Number(row?.["published_count"] ?? 0);
    return {
      recipeCount,
      publishedCount,
      missingCount: Math.max(0, recipeCount - publishedCount),
      coverageBps: ratioBps(publishedCount, recipeCount),
    };
  }

  private async currentPrepRisks(branchId: string, businessDate: string) {
    const rows = await this.db
      .prepare(
        "SELECT p.id,r.name AS recipe_name,p.status,p.recipe_version_id,r.current_version_id," +
          " CASE WHEN EXISTS (SELECT 1 FROM cookbook_recipe_content_versions c" +
          " WHERE c.tenant_id=p.tenant_id AND c.recipe_version_id=p.recipe_version_id" +
          " AND c.status='PUBLISHED') THEN 1 ELSE 0 END AS has_published_method" +
          " FROM production_prep_recommendations p JOIN recipes r" +
          " ON r.tenant_id=p.tenant_id AND r.id=p.recipe_id" +
          " WHERE p.tenant_id=? AND p.branch_id=? AND p.business_date=?" +
          " AND p.status NOT IN ('COMPLETED','DISMISSED')" +
          " ORDER BY r.name,p.id",
      )
      .bind(this.actor.tenantId, branchId, businessDate)
      .all<Record<string, unknown>>();

    const risks = (rows.results ?? []).flatMap((row) => {
      const reasons: string[] = [];
      if (String(row["recipe_version_id"]) !== String(row["current_version_id"])) {
        reasons.push("RECIPE_VERSION_CHANGED");
      }
      if (Number(row["has_published_method"] ?? 0) !== 1) reasons.push("COOKBOOK_NOT_PUBLISHED");
      if (!reasons.length) return [];
      return [
        {
          id: String(row["id"]),
          recipeName: String(row["recipe_name"] ?? "Recipe"),
          status: String(row["status"]),
          reasons,
        },
      ];
    });
    return { blockerCount: risks.length, blockers: risks.slice(0, 20) };
  }

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission as never)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        permission + " permission is required",
      );
    }
  }
}

function ratioBps(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.min(10_000, Math.round((numerator * 10_000) / denominator)));
}

function shiftDate(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseKitchenAnalyticsPeriod(value: string | null): PeriodDays {
  const days = Number(value ?? "7");
  if (days !== 1 && days !== 7 && days !== 30) {
    throw new ServerOperationError(
      "VALIDATION_FAILED",
      400,
      "periodDays must be one of 1, 7 or 30",
    );
  }
  return days;
}
