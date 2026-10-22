import { verifyInvoiceComponents, type InvoiceComponents } from "@/payments/invoice-components";
import { ServerOperationError } from "@/server/errors";
import type { D1Database, D1PreparedStatement } from "./d1";

const keys = ["CUSTOMER_RECEIVABLE", "SALES_REVENUE", "TAX_PAYABLE", "SERVICE_CHARGE"] as const;
type MappingKey = (typeof keys)[number];
type Accounts = Record<MappingKey, string>;
type LedgerSnapshot = {
  version: 1;
  branchId: string;
  businessDate: string;
  currency: string;
  accounts: Accounts;
  components: InvoiceComponents;
  posted: boolean;
  reversed: boolean;
};
type Mapping = {
  mapping_key: string;
  mapping_branch: string | null;
  status: string;
  finance_signoff_status: string;
  id: string | null;
  account_branch: string | null;
  active: number;
  currency: string;
  account_type: string;
};
type InvoiceInput = {
  tenantId: string;
  invoiceId: string;
  branchId: string;
  businessDate: string;
  currency: string;
  payload: Record<string, unknown>;
  correlationId: string;
  actorId: string;
  stamp: string;
};

function approvedPostingGuard(input: InvoiceInput, accounts: Accounts) {
  const values: string[] = [];
  const clauses = keys.map((key) => {
    const types =
      key === "CUSTOMER_RECEIVABLE"
        ? "'ASSET','CUSTOMER_RECEIVABLE'"
        : key === "TAX_PAYABLE"
          ? "'LIABILITY'"
          : "'INCOME','REVENUE'";
    values.push(
      input.tenantId,
      key,
      accounts[key],
      input.currency,
      input.branchId,
      input.branchId,
      input.branchId,
    );
    return `EXISTS (
      SELECT 1 FROM setup_account_mappings m JOIN accounts a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
      WHERE m.tenant_id=? AND m.mapping_key=? AND m.account_id=?
        AND m.status='CONFIGURED' AND m.finance_signoff_status='APPROVED'
        AND a.active=1 AND a.currency=? AND a.account_type IN (${types})
        AND (a.branch_id IS NULL OR a.branch_id=?)
        AND (m.branch_id=? OR (m.branch_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM setup_account_mappings branch_override
          WHERE branch_override.tenant_id=m.tenant_id AND branch_override.mapping_key=m.mapping_key AND branch_override.branch_id=?
        )))
    )`;
  });
  return { sql: ` WHERE ${clauses.join(" AND ")}`, values };
}

function reject(message: string): never {
  throw new ServerOperationError("VALIDATION_FAILED", 422, message);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function components(payload: Record<string, unknown>, currency: string) {
  if (!record(payload.financialComponents))
    reject("Recorded invoice components are required for accounting");
  try {
    return verifyInvoiceComponents(
      payload.financialComponents as InvoiceComponents,
      {
        subtotal: payload.subtotal as number,
        tax: payload.tax as number,
        total: payload.total as number,
      },
      currency,
    );
  } catch {
    return reject("Invoice components do not reconcile with authoritative totals");
  }
}

function readSnapshot(payload: Record<string, unknown>): LedgerSnapshot {
  const snapshot = payload.invoiceLedger;
  const accounts = record(snapshot) && record(snapshot.accounts) ? snapshot.accounts : undefined;
  if (
    !record(snapshot) ||
    snapshot.version !== 1 ||
    !accounts ||
    keys.some((key) => typeof accounts[key] !== "string") ||
    typeof snapshot.posted !== "boolean" ||
    typeof snapshot.reversed !== "boolean" ||
    typeof snapshot.branchId !== "string" ||
    typeof snapshot.businessDate !== "string" ||
    typeof snapshot.currency !== "string"
  ) {
    return reject(
      "Existing invoice needs explicit accounting reconciliation before further changes",
    );
  }
  const verified = components(payload, snapshot.currency);
  if (!record(snapshot.components) || !sameComponents(verified, snapshot.components)) {
    reject("Persisted invoice accounting snapshot is inconsistent");
  }
  return snapshot as LedgerSnapshot;
}

function sameComponents(
  left: InvoiceComponents,
  right: Record<string, unknown> | InvoiceComponents,
) {
  return (
    [
      "version",
      "currency",
      "grossSalesMinor",
      "discountsMinor",
      "netSalesMinor",
      "serviceChargeMinor",
      "taxMinor",
      "totalMinor",
    ] as const
  ).every((key) => left[key] === right[key]);
}

/** Normalized journals are the financial authority; these statements join the existing atomic mutation. */
export class PosInvoiceLedger {
  private readonly snapshots = new Map<string, LedgerSnapshot>();

  constructor(private readonly db: D1Database) {}

  private async accounts(input: InvoiceInput): Promise<Accounts> {
    const rows = await this.db
      .prepare(
        `SELECT m.mapping_key,m.branch_id AS mapping_branch,m.status,m.finance_signoff_status,
              a.id,a.branch_id AS account_branch,a.active,a.currency,a.account_type
       FROM setup_account_mappings m LEFT JOIN accounts a
         ON a.tenant_id=m.tenant_id AND a.id=m.account_id
       WHERE m.tenant_id=? AND (m.branch_id=? OR m.branch_id IS NULL)`,
      )
      .bind(input.tenantId, input.branchId)
      .all<Mapping>();
    const selected = keys.map((key) => {
      const candidates = (rows.results ?? []).filter((row) => row.mapping_key === key);
      const mapping =
        candidates.find((row) => row.mapping_branch === input.branchId) ??
        candidates.find((row) => row.mapping_branch === null);
      const types =
        key === "CUSTOMER_RECEIVABLE"
          ? ["ASSET", "CUSTOMER_RECEIVABLE"]
          : key === "TAX_PAYABLE"
            ? ["LIABILITY"]
            : ["INCOME", "REVENUE"];
      if (
        !mapping?.id ||
        mapping.status !== "CONFIGURED" ||
        mapping.finance_signoff_status !== "APPROVED" ||
        mapping.active !== 1 ||
        mapping.currency !== input.currency ||
        (mapping.account_branch !== null && mapping.account_branch !== input.branchId) ||
        !types.includes(mapping.account_type)
      ) {
        reject(
          `An approved, active ${key} account mapping is required for this branch and currency`,
        );
      }
      return [key, mapping.id] as const;
    });
    return Object.fromEntries(selected) as Accounts;
  }

  async prepare(input: InvoiceInput) {
    const closed = await this.db
      .prepare(
        "SELECT id FROM day_closes WHERE tenant_id=? AND branch_id=? AND business_date=? AND status='CLOSED'",
      )
      .bind(input.tenantId, input.branchId, input.businessDate)
      .first();
    if (closed)
      reject(
        "The invoice belongs to a closed business period; use an authorized correction workflow",
      );
    const prior = await this.db
      .prepare("SELECT payload_json FROM invoices WHERE tenant_id=? AND id=?")
      .bind(input.tenantId, input.invoiceId)
      .first<{ payload_json: string }>();
    const previous = prior ? readSnapshot(JSON.parse(prior.payload_json)) : undefined;
    if (previous?.posted && previous.components.totalMinor > 0) {
      for (const sourceType of previous.reversed
        ? ["POS_INVOICE", "POS_INVOICE_REVERSAL"]
        : ["POS_INVOICE"]) {
        const journal = await this.db
          .prepare(
            "SELECT id FROM journal_entries WHERE tenant_id=? AND branch_id=? AND source_type=? AND source_id=? AND status='POSTED'",
          )
          .bind(input.tenantId, input.branchId, sourceType, input.invoiceId)
          .first();
        if (!journal)
          reject(
            "Persisted invoice posting is missing; explicit accounting reconciliation is required",
          );
      }
    }
    const current = components(input.payload, input.currency);
    const status = input.payload.status;
    const payable = ["OPEN", "PARTIAL", "PENDING", "PAID", "PROVIDER_RECEIVABLE"].includes(
      String(status),
    );
    const cancelled = ["VOID", "MERGED", "SPLIT"].includes(String(status));
    if (!payable && !cancelled && status !== "DRAFT_BILL")
      reject("Unsupported invoice accounting status");
    if (
      previous &&
      (previous.branchId !== input.branchId ||
        previous.currency !== input.currency ||
        previous.businessDate !== input.businessDate)
    )
      reject("Posted invoice accounting scope cannot change");
    if (previous?.posted && !sameComponents(previous.components, current)) {
      reject("Posted invoice amounts cannot change; use an authorized credit or debit adjustment");
    }
    if (previous?.reversed && payable)
      reject("A reversed invoice cannot be reopened for collection");
    if (cancelled && input.payload.paid !== 0)
      reject("A paid invoice requires an authorized refund or credit adjustment");
    const accounts = previous?.posted ? previous.accounts : await this.accounts(input);
    const post = payable && !previous?.posted;
    const reverse = cancelled && Boolean(previous?.posted) && !previous?.reversed;
    const snapshot: LedgerSnapshot = {
      version: 1,
      branchId: input.branchId,
      currency: input.currency,
      businessDate: input.businessDate,
      accounts,
      components: current,
      posted: Boolean(previous?.posted) || post,
      reversed: Boolean(previous?.reversed) || reverse,
    };
    this.snapshots.set(input.invoiceId, snapshot);
    const statements: D1PreparedStatement[] = [];
    if ((post || reverse) && current.totalMinor > 0) {
      const sourceType = reverse ? "POS_INVOICE_REVERSAL" : "POS_INVOICE";
      const journalId = `${sourceType}:${input.invoiceId}`;
      // Revalidate at the write boundary. If approval changed after the initial
      // read, no journal is inserted and the child-line FK rolls the batch back.
      const guard = reverse ? { sql: "", values: [] } : approvedPostingGuard(input, accounts);
      const lines = [
        { accountId: accounts.CUSTOMER_RECEIVABLE, signed: current.totalMinor },
        { accountId: accounts.SALES_REVENUE, signed: -current.netSalesMinor },
        { accountId: accounts.SERVICE_CHARGE, signed: -current.serviceChargeMinor },
        { accountId: accounts.TAX_PAYABLE, signed: -current.taxMinor },
      ].filter((line) => line.signed !== 0);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO journal_entries
         (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
          correlation_id,payload_json,created_at,posted_at)
         SELECT ?,?,?,?,?,?,'DRAFT',?,?,?,?,NULL${guard.sql}`,
          )
          .bind(
            input.tenantId,
            journalId,
            input.branchId,
            sourceType,
            input.invoiceId,
            input.businessDate,
            reverse ? "Unpaid invoice reversal" : "Invoice revenue recognition",
            input.correlationId,
            JSON.stringify({ invoiceId: input.invoiceId, actorId: input.actorId, ...snapshot }),
            input.stamp,
            ...guard.values,
          ),
      );
      lines.forEach((line, index) => {
        const signed = reverse ? -line.signed : line.signed;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO journal_lines
           (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
           VALUES (?,?,?,?,?,?,?,'{}')`,
            )
            .bind(
              input.tenantId,
              journalId,
              index + 1,
              line.accountId,
              Math.max(0, signed),
              Math.max(0, -signed),
              input.currency,
            ),
        );
      });
      statements.push(
        this.db
          .prepare(
            "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=? AND status='DRAFT'",
          )
          .bind(input.stamp, input.tenantId, journalId),
      );
    }
    return { snapshot, statements };
  }

  async assertCollectionAccount(
    tenantId: string,
    invoiceId: string,
    branchId: string,
    currency: string,
    receivable: string | undefined,
  ) {
    let snapshot = this.snapshots.get(invoiceId);
    if (!snapshot) {
      const row = await this.db
        .prepare("SELECT payload_json FROM invoices WHERE tenant_id=? AND id=?")
        .bind(tenantId, invoiceId)
        .first<{ payload_json: string }>();
      if (!row) reject("Invoice accounting record is unavailable");
      snapshot = readSnapshot(JSON.parse(row.payload_json));
    }
    if (
      !snapshot.posted ||
      snapshot.reversed ||
      snapshot.branchId !== branchId ||
      snapshot.currency !== currency ||
      snapshot.accounts.CUSTOMER_RECEIVABLE !== receivable
    ) {
      reject("Payment receivable mapping must match the invoice's authorized accounting scope");
    }
    const active = await this.db
      .prepare(
        "SELECT id FROM accounts WHERE tenant_id=? AND id=? AND active=1 AND currency=? AND (branch_id=? OR branch_id IS NULL)",
      )
      .bind(tenantId, receivable, currency, branchId)
      .first();
    if (!active)
      reject("The invoice receivable account is no longer active in this branch and currency");
  }
}
