import { parseCsvRows, parseXlsxRows } from "@/lib/menu-import-export";
import { parseMajorAmount } from "@/payments/money";
import type { SettlementLineType } from "@/payments/types";

export type NormalizedBankStatementRow = {
  externalTransactionId: string;
  date: string;
  valueDate?: string;
  amountMinor: number;
  currency: string;
  description: string;
  payerOrPayee?: string;
  reference?: string;
  balanceMinor?: number;
  rawReference?: string;
};

export type NormalizedSettlementImport = {
  providerSettlementId: string;
  connectionId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  settledAt?: string;
  grossAmountMinor: number;
  netAmountMinor: number;
  lines: Array<{
    type: SettlementLineType;
    externalOrderId?: string;
    externalPaymentId?: string;
    amountMinor: number;
    taxAmountMinor: number;
    reference: string;
    description: string;
    metadata: Record<string, unknown>;
  }>;
};

export type ImportIssue = {
  row: number;
  severity: "ERROR" | "WARNING";
  code: "MISSING_FIELD" | "INVALID_AMOUNT" | "INVALID_DATE" | "DUPLICATE" | "UNKNOWN_TYPE";
  message: string;
};

export type StatementPreview<T> = {
  adapterCode: string;
  recognized: T[];
  duplicates: number[];
  unknown: number[];
  issues: ImportIssue[];
  canPost: boolean;
};

export type BankStatementAdapter = {
  code: string;
  parse: (
    source: string | ArrayBuffer,
    currency: string,
  ) => Promise<StatementPreview<NormalizedBankStatementRow>>;
};

export type SettlementImportAdapter = {
  code: string;
  parse: (
    source: string | ArrayBuffer,
    context: { connectionId: string; currency: string },
  ) => Promise<StatementPreview<NormalizedSettlementImport>>;
};

export const genericBankStatementAdapter: BankStatementAdapter = {
  code: "GENERIC_BANK_CSV_XLSX_V1",
  async parse(source, currency) {
    const rows = await sourceRows(source);
    const issues: ImportIssue[] = [];
    const recognized: NormalizedBankStatementRow[] = [];
    const duplicateRows: number[] = [];
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const externalTransactionId = value(row, "externaltransactionid", "transactionid", "id");
      const date = value(row, "date", "transactiondate");
      const amount = value(row, "amount", "transactionamount");
      if (!externalTransactionId || !date || !amount) {
        issues.push({
          row: rowNumber,
          severity: "ERROR",
          code: "MISSING_FIELD",
          message: "Transaction ID, date and amount are required",
        });
        return;
      }
      if (seen.has(externalTransactionId)) {
        duplicateRows.push(rowNumber);
        issues.push({
          row: rowNumber,
          severity: "WARNING",
          code: "DUPLICATE",
          message: `Duplicate transaction ${externalTransactionId}`,
        });
        return;
      }
      try {
        const parsedDate = normalizeDate(date);
        const rowCurrency = value(row, "currency") || currency;
        const amountMinor = parseMajorAmount(amount, rowCurrency);
        recognized.push({
          externalTransactionId,
          date: parsedDate,
          ...(value(row, "valuedate") ? { valueDate: normalizeDate(value(row, "valuedate")) } : {}),
          amountMinor,
          currency: rowCurrency.toUpperCase(),
          description: value(row, "description", "narration") || "Imported bank transaction",
          ...(value(row, "payer", "payee", "counterparty")
            ? { payerOrPayee: value(row, "payer", "payee", "counterparty") }
            : {}),
          ...(value(row, "reference") ? { reference: value(row, "reference") } : {}),
          ...(value(row, "balance")
            ? { balanceMinor: parseMajorAmount(value(row, "balance"), rowCurrency) }
            : {}),
          ...(value(row, "rawreference") ? { rawReference: value(row, "rawreference") } : {}),
        });
        seen.add(externalTransactionId);
      } catch (error) {
        issues.push({
          row: rowNumber,
          severity: "ERROR",
          code:
            error instanceof Error && error.message.includes("date")
              ? "INVALID_DATE"
              : "INVALID_AMOUNT",
          message: error instanceof Error ? error.message : "Invalid bank statement row",
        });
      }
    });
    return {
      adapterCode: this.code,
      recognized,
      duplicates: duplicateRows,
      unknown: [],
      issues,
      canPost: recognized.length > 0 && !issues.some((issue) => issue.severity === "ERROR"),
    };
  },
};

export const genericSettlementAdapter: SettlementImportAdapter = {
  code: "GENERIC_SETTLEMENT_CSV_XLSX_V1",
  async parse(source, context) {
    const rows = await sourceRows(source);
    const issues: ImportIssue[] = [];
    const duplicates: number[] = [];
    const unknown: number[] = [];
    const seen = new Set<string>();
    const bySettlement = new Map<string, NormalizedSettlementImport>();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const settlementId = value(row, "settlementid", "providersettlementid");
      const reference = value(row, "reference", "linereference");
      const rawType = value(row, "type", "linetype").toUpperCase();
      const amount = value(row, "amount");
      const key = `${settlementId}:${reference}`;
      if (!settlementId || !reference || !rawType || !amount) {
        issues.push({
          row: rowNumber,
          severity: "ERROR",
          code: "MISSING_FIELD",
          message: "Settlement ID, type, reference and amount are required",
        });
        return;
      }
      if (!isSettlementType(rawType)) {
        unknown.push(rowNumber);
        issues.push({
          row: rowNumber,
          severity: "ERROR",
          code: "UNKNOWN_TYPE",
          message: `Unknown settlement line type ${rawType}`,
        });
        return;
      }
      if (seen.has(key)) {
        duplicates.push(rowNumber);
        issues.push({
          row: rowNumber,
          severity: "WARNING",
          code: "DUPLICATE",
          message: `Duplicate settlement line ${reference}`,
        });
        return;
      }
      try {
        const currency = (value(row, "currency") || context.currency).toUpperCase();
        const periodStart = normalizeDate(value(row, "periodstart"));
        const periodEnd = normalizeDate(value(row, "periodend"));
        const amountMinor = Math.abs(parseMajorAmount(amount, currency));
        const batch = bySettlement.get(settlementId) ?? {
          providerSettlementId: settlementId,
          connectionId: context.connectionId,
          currency,
          periodStart,
          periodEnd,
          ...(value(row, "settledat") ? { settledAt: normalizeDate(value(row, "settledat")) } : {}),
          grossAmountMinor: 0,
          netAmountMinor: 0,
          lines: [],
        };
        batch.lines.push({
          type: rawType,
          ...(value(row, "externalorderid")
            ? { externalOrderId: value(row, "externalorderid") }
            : {}),
          ...(value(row, "externalpaymentid")
            ? { externalPaymentId: value(row, "externalpaymentid") }
            : {}),
          amountMinor,
          taxAmountMinor: value(row, "taxamount")
            ? Math.abs(parseMajorAmount(value(row, "taxamount"), currency))
            : 0,
          reference,
          description: value(row, "description") || rawType.replaceAll("_", " "),
          metadata: {},
        });
        if (rawType === "GROSS_SALE") batch.grossAmountMinor += amountMinor;
        bySettlement.set(settlementId, batch);
        seen.add(key);
      } catch (error) {
        issues.push({
          row: rowNumber,
          severity: "ERROR",
          code:
            error instanceof Error && error.message.includes("date")
              ? "INVALID_DATE"
              : "INVALID_AMOUNT",
          message: error instanceof Error ? error.message : "Invalid settlement row",
        });
      }
    });
    const recognized = [...bySettlement.values()].map((batch) => ({
      ...batch,
      netAmountMinor:
        batch.grossAmountMinor -
        batch.lines
          .filter((line) => line.type !== "GROSS_SALE")
          .reduce((sum, line) => sum + line.amountMinor, 0),
    }));
    return {
      adapterCode: this.code,
      recognized,
      duplicates,
      unknown,
      issues,
      canPost: recognized.length > 0 && !issues.some((issue) => issue.severity === "ERROR"),
    };
  },
};

async function sourceRows(source: string | ArrayBuffer) {
  const rows = (
    typeof source === "string" ? parseCsvRows(source) : await parseXlsxRows(source)
  ) as Array<Record<string, string>>;
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, entry]) => [
        key.toLowerCase().replace(/[^a-z0-9]/g, ""),
        entry,
      ]),
    ),
  );
}

function value(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const found = row[key] ?? row[key.replaceAll("_", "")];
    if (found?.trim()) return found.trim();
  }
  return "";
}

function normalizeDate(value: string) {
  const timestamp = Date.parse(value);
  if (!value || !Number.isFinite(timestamp)) throw new Error(`Invalid date ${value || "(blank)"}`);
  return new Date(timestamp).toISOString();
}

function isSettlementType(value: string): value is SettlementLineType {
  return [
    "GROSS_SALE",
    "COMMISSION",
    "SERVICE_FEE",
    "DELIVERY_ADJUSTMENT",
    "PROMOTION",
    "REFUND",
    "TAX_ADJUSTMENT",
    "OTHER_ADJUSTMENT",
  ].includes(value);
}
