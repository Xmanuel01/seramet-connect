export const HISTORICAL_SALES_TEMPLATE_VERSION = 1;

export const historicalSalesHeaders = [
  "templateVersion",
  "externalSaleReference",
  "branchCode",
  "businessDate",
  "occurredAt",
  "currency",
  "grossAmount",
  "discountAmount",
  "refundAmount",
  "taxAmount",
  "serviceChargeAmount",
  "netAmount",
  "orderCount",
  "channelCode",
  "paymentMethodReference",
  "notes",
] as const;

const aliases: Record<string, (typeof historicalSalesHeaders)[number]> = {
  version: "templateVersion",
  salereference: "externalSaleReference",
  orderreference: "externalSaleReference",
  receiptnumber: "externalSaleReference",
  branch: "branchCode",
  date: "businessDate",
  saledate: "businessDate",
  timestamp: "occurredAt",
  grosssales: "grossAmount",
  gross: "grossAmount",
  discount: "discountAmount",
  refunds: "refundAmount",
  tax: "taxAmount",
  vat: "taxAmount",
  servicecharge: "serviceChargeAmount",
  netsales: "netAmount",
  net: "netAmount",
  orders: "orderCount",
  channel: "channelCode",
  paymentmethod: "paymentMethodReference",
};

export function createHistoricalSalesTemplate() {
  const example = [
    String(HISTORICAL_SALES_TEMPLATE_VERSION),
    "OLD-POS-0001",
    "BRANCH-001",
    "2026-01-31",
    "2026-01-31T18:45:00+03:00",
    "KES",
    "12500.00",
    "500.00",
    "0.00",
    "1724.14",
    "0.00",
    "12000.00",
    "1",
    "DINE_IN",
    "CASH",
    "Optional migration note",
  ];
  return `${historicalSalesHeaders.join(",")}\n${example.map(csvCell).join(",")}\n`;
}

export function resolveHistoricalSalesHeader(value: string) {
  const normalized = normalizeHeader(value);
  return (
    historicalSalesHeaders.find((header) => normalizeHeader(header) === normalized) ??
    aliases[normalized]
  );
}

export function normalizeHistoricalSalesRows(rows: Array<Record<string, string>>) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [resolveHistoricalSalesHeader(key) ?? key, value]),
    ),
  );
}

export function unsupportedHistoricalSalesColumns(rows: Array<Record<string, string>>) {
  const unsupported = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value.trim() && !resolveHistoricalSalesHeader(key)) unsupported.add(key);
    }
  }
  return [...unsupported].sort();
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function csvCell(value: string) {
  const safe = /^[=+@]/.test(value) || /^-\D/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
