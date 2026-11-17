import { parseCsvRows, parseXlsxRows } from "@/lib/menu-import-export";
import { parseMajorAmount } from "@/payments/money";
import type {
  ImportIssue,
  NormalizedSettlementImport,
  StatementPreview,
} from "@/payments/statement-adapters";
import type { SettlementLineType } from "@/payments/types";

/**
 * Reads the payout reports delivery apps give restaurants: one row per order with its sales,
 * the app's fees, promotions, refunds and cash already paid to the restaurant. Columns are
 * found by header name (apps rename and add columns), never by position.
 */
export type PayoutFileLayout = {
  code: string;
  name: string;
  columns: {
    orderId: string[];
    sales: string[];
    payout?: string[];
    payoutReference?: string[];
    payoutDate?: string[];
    orderDate?: string[];
    status?: string[];
  };
  /** Each amount column and the settlement line it becomes; fees are taken as deductions. */
  deductions: Array<{ type: SettlementLineType; columns: string[] }>;
};

const uberEats: PayoutFileLayout = {
  code: "UBER_EATS_PAYMENT_DETAILS",
  name: "Uber Eats payment details",
  columns: {
    orderId: ["order id", "orderid", "order uuid"],
    sales: ["sales (incl. tax)", "sales incl tax", "sales (incl tax)", "total sales"],
    payout: ["total payout", "net payout", "payout"],
    payoutReference: ["payout reference id", "payout reference", "payout id"],
    payoutDate: ["payout date"],
    orderDate: ["order date", "order accept time", "date"],
    status: ["order status"],
  },
  deductions: [
    {
      type: "COMMISSION",
      columns: [
        "marketplace fee",
        "merchant fee",
        "tax on merchant fee",
        "delivery network fee",
        "order processing fee",
        "service fee",
      ],
    },
    { type: "PROMOTION", columns: ["promotions on items", "promotions on delivery"] },
    { type: "REFUND", columns: ["refunds (incl tax)", "refunds (incl. tax)", "refunds"] },
    { type: "MERCHANT_COLLECTION", columns: ["cash collected"] },
    { type: "TAX_ADJUSTMENT", columns: ["marketplace facilitator tax", "backup withholding tax"] },
    { type: "OTHER_ADJUSTMENT", columns: ["price adjustments (incl. tax)", "other payments"] },
  ],
};

// Glovo's partner payout export has not been confirmed against a real file yet; these are the
// names its Partner Portal uses for the same figures. Unknown layouts are reported, not guessed.
const glovo: PayoutFileLayout = {
  code: "GLOVO_PARTNER_PAYOUT",
  name: "Glovo payout",
  columns: {
    orderId: ["glovo code", "order code", "order id", "order number"],
    sales: ["products price", "total products price", "order value", "subtotal", "gross sales"],
    payout: ["partner payout", "net payout", "amount to pay", "payout", "total to partner"],
    payoutReference: ["invoice number", "payout id", "invoice id"],
    payoutDate: ["invoice date", "payout date"],
    orderDate: ["order date", "creation date", "date"],
    status: ["order status", "status"],
  },
  deductions: [
    { type: "COMMISSION", columns: ["glovo commission", "commission", "commission vat"] },
    {
      type: "PROMOTION",
      columns: ["promotion assumed by partner", "partner promotions", "promotions", "discount"],
    },
    { type: "REFUND", columns: ["refunds", "refunded amount", "incidents"] },
    { type: "MERCHANT_COLLECTION", columns: ["cash collected", "cash paid to partner", "cash"] },
    { type: "OTHER_ADJUSTMENT", columns: ["adjustments", "other adjustments", "penalties"] },
  ],
};

export const payoutFileLayouts: readonly PayoutFileLayout[] = [uberEats, glovo];

type Row = Record<string, string>;

/** The layout whose order and sales columns are both in the file. */
export function detectPayoutLayout(headers: string[]) {
  const present = new Set(headers.map(normalizeHeader));
  return payoutFileLayouts.find(
    (layout) =>
      layout.columns.orderId.some((name) => present.has(normalizeHeader(name))) &&
      layout.columns.sales.some((name) => present.has(normalizeHeader(name))),
  );
}

export async function parseDeliveryAppPayout(
  source: string | ArrayBuffer,
  context: { connectionId: string; currency: string; fileName?: string },
): Promise<
  StatementPreview<NormalizedSettlementImport> & { layoutName?: string; headers: string[] }
> {
  const raw = (
    typeof source === "string" ? parseCsvRows(source) : await parseXlsxRows(source)
  ) as Row[];
  const headers = raw.length ? Object.keys(raw[0]!) : [];
  const layout = detectPayoutLayout(headers);
  if (!layout) {
    return {
      adapterCode: "UNRECOGNISED",
      recognized: [],
      duplicates: [],
      unknown: [],
      issues: [
        {
          row: 1,
          severity: "ERROR",
          code: "MISSING_FIELD",
          message:
            "This file isn't a payout report Seramet recognises. It needs an order ID column and a sales column.",
        },
      ],
      canPost: false,
      headers,
    };
  }
  const rows = raw.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])),
  );
  const issues: ImportIssue[] = [];
  const duplicates: number[] = [];
  const seen = new Set<string>();
  const batches = new Map<string, NormalizedSettlementImport & { reportedNetMinor: number }>();
  const currency = context.currency.toUpperCase();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const orderId = pick(row, layout.columns.orderId);
    const salesText = pick(row, layout.columns.sales);
    if (!orderId && !salesText) return; // blank or total rows
    if (!orderId) {
      issues.push({
        row: rowNumber,
        severity: "WARNING",
        code: "MISSING_FIELD",
        message: "Row has no order ID and was skipped",
      });
      return;
    }
    if (seen.has(orderId)) {
      duplicates.push(rowNumber);
      issues.push({
        row: rowNumber,
        severity: "WARNING",
        code: "DUPLICATE",
        message: `Order ${orderId} appears twice; the second row was skipped`,
      });
      return;
    }
    try {
      const salesMinor = Math.abs(amount(salesText, currency));
      const reference = pick(row, layout.columns.payoutReference ?? []);
      const payoutDate = pick(row, layout.columns.payoutDate ?? []);
      const orderDate = pick(row, layout.columns.orderDate ?? []);
      const key = reference || payoutDate || "file";
      const when = dateOrUndefined(orderDate) ?? dateOrUndefined(payoutDate);
      const batch =
        batches.get(key) ??
        ({
          providerSettlementId:
            reference ||
            `${layout.code}-${(dateOrUndefined(payoutDate) ?? "").slice(0, 10) || context.fileName || "file"}`,
          connectionId: context.connectionId,
          currency,
          periodStart: when ?? new Date(0).toISOString(),
          periodEnd: when ?? new Date(0).toISOString(),
          ...(dateOrUndefined(payoutDate) ? { settledAt: dateOrUndefined(payoutDate)! } : {}),
          grossAmountMinor: 0,
          netAmountMinor: 0,
          lines: [],
          reportedNetMinor: 0,
        } satisfies NormalizedSettlementImport & { reportedNetMinor: number });
      if (when) {
        if (when < batch.periodStart || batch.periodStart === new Date(0).toISOString())
          batch.periodStart = when;
        if (when > batch.periodEnd) batch.periodEnd = when;
      }
      batch.lines.push({
        type: "GROSS_SALE",
        externalOrderId: orderId,
        amountMinor: salesMinor,
        taxAmountMinor: 0,
        reference: `${orderId}:sale`,
        description: `Sale ${orderId}`,
        metadata: { row: rowNumber },
      });
      batch.grossAmountMinor += salesMinor;
      for (const deduction of layout.deductions) {
        for (const column of deduction.columns) {
          const text = row[normalizeHeader(column)];
          if (!text?.trim()) continue;
          const value = amount(text, currency);
          if (value === 0) continue;
          // Fees, promotions and refunds reduce the payout whichever sign the app prints them
          // with. A positive "other payment" adds to it and cannot be posted as a deduction.
          if (deduction.type === "OTHER_ADJUSTMENT" && value > 0) {
            issues.push({
              row: rowNumber,
              severity: "WARNING",
              code: "INVALID_AMOUNT",
              message: `${column} adds ${text} for ${orderId}; record it by hand after posting`,
            });
            continue;
          }
          batch.lines.push({
            type: deduction.type,
            externalOrderId: orderId,
            amountMinor: Math.abs(value),
            taxAmountMinor: 0,
            reference: `${orderId}:${normalizeHeader(column)}`,
            description: `${column} ${orderId}`,
            metadata: { row: rowNumber },
          });
        }
      }
      const payoutText = pick(row, layout.columns.payout ?? []);
      if (payoutText) batch.reportedNetMinor += amount(payoutText, currency);
      batches.set(key, batch);
      seen.add(orderId);
    } catch (error) {
      issues.push({
        row: rowNumber,
        severity: "ERROR",
        code: "INVALID_AMOUNT",
        message: error instanceof Error ? error.message : "Invalid payout row",
      });
    }
  });
  const recognized = [...batches.values()].map(({ reportedNetMinor, ...batch }) => {
    const deductions = batch.lines
      .filter((line) => line.type !== "GROSS_SALE")
      .reduce((sum, line) => sum + line.amountMinor, 0);
    const netAmountMinor = batch.grossAmountMinor - deductions;
    if (reportedNetMinor && reportedNetMinor !== netAmountMinor) {
      issues.push({
        row: 1,
        severity: "WARNING",
        code: "INVALID_AMOUNT",
        message: `Payout ${batch.providerSettlementId}: the file says ${reportedNetMinor / 100}, Seramet's lines add up to ${netAmountMinor / 100}. Check before posting.`,
      });
    }
    return { ...batch, netAmountMinor };
  });
  return {
    adapterCode: layout.code,
    layoutName: layout.name,
    recognized,
    duplicates,
    unknown: [],
    issues,
    canPost: recognized.length > 0 && !issues.some((issue) => issue.severity === "ERROR"),
    headers,
  };
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(row: Row, names: string[]) {
  for (const name of names) {
    const found = row[normalizeHeader(name)];
    if (found?.trim()) return found.trim();
  }
  return "";
}

/** Amounts as printed: "1,234.50", "-90.00", "(90.00)", "KES 950". */
function amount(text: string, currency: string) {
  const trimmed = text.trim();
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.includes("-");
  const digits = trimmed.replace(/[^0-9.]/g, "");
  if (!digits || !/^\d*\.?\d*$/.test(digits)) throw new Error(`"${text}" is not an amount`);
  const minor = parseMajorAmount(Number(digits), currency);
  return negative ? -minor : minor;
}

function dateOrUndefined(text: string) {
  if (!text) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
