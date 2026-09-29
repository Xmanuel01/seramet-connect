import type { D1Database } from "@/server/database/d1";
import { authoritativeBusinessDate } from "@/server/business-date";
import type { ServerActor } from "@/lib/seramet-auth";
import type { EvidencePeriod, IntelligenceIntent, IntelligenceToolKey } from "@/intelligence/types";

export type IntelligencePlan = {
  intent: IntelligenceIntent;
  tools: IntelligenceToolKey[];
  period: EvidencePeriod;
};

export async function planIntelligenceQuery(
  db: D1Database,
  actor: ServerActor,
  question: string,
): Promise<IntelligencePlan> {
  const intent = classifyIntent(question);
  return {
    intent,
    tools: toolsForIntent(intent),
    period: await resolveEvidencePeriod(db, actor, question),
  };
}

export function classifyIntent(question: string): IntelligenceIntent {
  const input = question.toLowerCase();
  if (
    /\b(race|ethnicity|ethnic|religion|religious|politic(?:al|s)?|health condition|diagnosis|sexual orientation|criminal history|financial distress)\b/.test(
      input,
    )
  ) {
    return "UNSUPPORTED";
  }
  if (
    /\b(delete|erase|hide|rewrite|change the books|ignore the count|reveal|show .*secret|api key|credential|post journal|issue refund|close period|approve go.?live|send (?:a )?campaign|alter consent|change consent|unsubscribe customer|issue gift.?card|issue voucher|merge customer)\b/.test(
      input,
    )
  ) {
    return "UNSUPPORTED";
  }
  if (/how do i|where do i|how can i|explain this screen|what does .* mean/.test(input))
    return "GENERAL_PRODUCT_HELP";
  if (/enterprise|franchise|head office|hq|regional|rollout|legal entit/.test(input))
    return "ENTERPRISE_OVERVIEW";
  if (/feedback|nps|csat|complaint trend/.test(input)) return "CRM_FEEDBACK";
  if (/campaign|voucher performance|redemption campaign/.test(input)) return "CRM_CAMPAIGNS";
  if (/loyalty|points|tier|reward/.test(input)) return "CRM_LOYALTY";
  if (/retention|returned customer|returning customer|lapsed|inactive customer|cohort/.test(input))
    return "CRM_RETENTION";
  if (/customer|crm|guest value|repeat visitor/.test(input)) return "CRM_OVERVIEW";
  if (/compare.*branch|which branch|all branches|owner/.test(input)) return "OWNER_OVERVIEW";
  if (/food.?cost|gross margin|recipe cost|cost bridge/.test(input)) return "FOOD_COST";
  if (/profit|p&l|financial|net sales|gross profit|operating result/.test(input)) return "FINANCE";
  if (/settlement/.test(input)) return "SETTLEMENT";
  if (/payment|m-?pesa|reconcil|cash variance|unmatched/.test(input))
    return "PAYMENT_RECONCILIATION";
  if (/supplier/.test(input)) return "SUPPLIER";
  if (/purchase|requisition|procure|order recommendation/.test(input)) return "PROCUREMENT";
  if (/stock|inventory|86|unavailable|low par|run out|wastage|expiry/.test(input))
    return "INVENTORY";
  if (/kitchen|station|ticket|prep|p90|fulfil/.test(input)) return "KITCHEN";
  if (/employee|staff|attendance|late minutes|shift/.test(input)) return "STAFF_OPERATIONS";
  if (/channel|marketplace|commission|cancellation rate/.test(input))
    return "CHANNEL_PROFITABILITY";
  if (/close|end of day|eod|blocking period/.test(input)) return "CLOSE_READINESS";
  if (/action|attention|risk|issue|exception/.test(input)) return "MANAGEMENT_ACTIONS";
  if (/integration|provider|device health/.test(input)) return "INTEGRATION_HEALTH";
  if (/setup|readiness|go live/.test(input)) return "SETUP_READINESS";
  if (/compare|change|why did/.test(input)) return "COMPARE_PERIODS";
  if (/today|yesterday|doing|summary|overview|morning/.test(input)) return "BRANCH_OVERVIEW";
  return "UNSUPPORTED";
}

function toolsForIntent(intent: IntelligenceIntent): IntelligenceToolKey[] {
  const map: Record<IntelligenceIntent, IntelligenceToolKey[]> = {
    BRANCH_OVERVIEW: ["BRANCH_SUMMARY", "BRANCH_HEALTH", "MANAGEMENT_ACTIONS"],
    OWNER_OVERVIEW: ["OWNER_SUMMARY", "MANAGEMENT_ACTIONS"],
    ENTERPRISE_OVERVIEW: ["ENTERPRISE_OVERVIEW"],
    FINANCE: ["FLASH_PNL"],
    FOOD_COST: ["FOOD_COST_BRIDGE", "MENU_PROFITABILITY"],
    COMPARE_PERIODS: ["BRANCH_SUMMARY"],
    COMPARE_BRANCHES: ["OWNER_SUMMARY"],
    CHANNEL_PROFITABILITY: ["CHANNEL_PROFITABILITY"],
    INVENTORY: ["INVENTORY_RISK"],
    PROCUREMENT: ["PURCHASE_RECOMMENDATIONS"],
    SUPPLIER: ["SUPPLIER_PERFORMANCE"],
    KITCHEN: ["KITCHEN_PERFORMANCE"],
    STAFF_OPERATIONS: ["STAFF_OPERATIONS"],
    PAYMENT_RECONCILIATION: ["PAYMENT_RECONCILIATION"],
    SETTLEMENT: ["SETTLEMENT_EXCEPTIONS"],
    MANAGEMENT_ACTIONS: ["MANAGEMENT_ACTIONS"],
    CLOSE_READINESS: ["CLOSE_READINESS"],
    INTEGRATION_HEALTH: ["INTEGRATION_HEALTH"],
    SETUP_READINESS: ["SETUP_READINESS"],
    CRM_OVERVIEW: ["CRM_SUMMARY"],
    CRM_RETENTION: ["CRM_RETENTION"],
    CRM_LOYALTY: ["CRM_LOYALTY"],
    CRM_CAMPAIGNS: ["CRM_CAMPAIGNS"],
    CRM_FEEDBACK: ["CRM_FEEDBACK"],
    GENERAL_PRODUCT_HELP: ["PRODUCT_HELP"],
    UNSUPPORTED: [],
  };
  return map[intent];
}

async function resolveEvidencePeriod(
  db: D1Database,
  actor: ServerActor,
  question: string,
): Promise<EvidencePeriod> {
  const branch = await db
    .prepare(
      `SELECT timezone,business_day_cutoff_minutes FROM branches
       WHERE tenant_id=? AND id=? AND active=1`,
    )
    .bind(actor.tenantId, actor.branchId)
    .first<{ timezone: string; business_day_cutoff_minutes: number }>();
  if (!branch) throw new Error("Authorized branch time configuration is unavailable");
  const current = authoritativeBusinessDate({
    timezone: branch.timezone,
    cutoffMinutes: branch.business_day_cutoff_minutes,
  });
  const input = question.toLowerCase();
  let label = "Last 7 business days";
  let start = addDays(current, -6);
  let end = current;
  if (/yesterday/.test(input)) {
    label = "Yesterday";
    start = end = addDays(current, -1);
  } else if (/today|this business day/.test(input)) {
    label = "Current business day";
    start = end = current;
  } else if (/last week/.test(input)) {
    const monday = startOfWeek(current);
    start = addDays(monday, -7);
    end = addDays(monday, -1);
    label = "Last week";
  } else if (/this week/.test(input)) {
    start = startOfWeek(current);
    label = "This week";
  } else if (/last month/.test(input)) {
    const first = current.slice(0, 7) + "-01";
    end = addDays(first, -1);
    start = end.slice(0, 7) + "-01";
    label = "Last month";
  } else if (/this month/.test(input)) {
    start = current.slice(0, 7) + "-01";
    label = "This month";
  }
  const days = dayDifference(start, end) + 1;
  return {
    label,
    start,
    end,
    comparisonStart: addDays(start, -days),
    comparisonEnd: addDays(start, -1),
    timezone: branch.timezone,
    businessDayCutoffMinutes: branch.business_day_cutoff_minutes,
  };
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  return addDays(value, 1 - day);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDifference(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000,
  );
}
