import { authorizeBranchRead, SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";

export type FinanceWindow = {
  branchId?: string;
  from: string;
  to: string;
};

export type AccountMovement = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  openingDebitMinor: number;
  openingCreditMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  debitMinor: number;
  creditMinor: number;
  closingSignedMinor: number;
};

type RawMovement = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_currency: string;
  opening_debit: number | string;
  opening_credit: number | string;
  period_debit: number | string;
  period_credit: number | string;
};
type Account = { id: string; code: string; name: string; account_type: string; currency: string };
type Scope = {
  tenantId: string;
  branchIds: string[];
  currency: string;
  from: string;
  to: string;
};
type PostingIssue = { code: string; count: number; detail: string };

function amount(value: number | string) {
  const num = Number(value);
  if (!Number.isSafeInteger(num)) {
    throw new SerametHttpError(422, "Ledger contains an amount outside safe minor-unit precision");
  }
  return num;
}

function date(value: string, label: string) {
  const parsed = Date.parse(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    throw new SerametHttpError(400, label + " must be a valid ISO date");
  }
  return value;
}

export class FinancialLedgerService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  private permit() {
    if (
      !this.actor.permissions.includes(permissions.accountingView) &&
      !this.actor.permissions.includes(permissions.financeJournalView) &&
      !this.actor.permissions.includes(permissions.financeView)
    ) {
      throw new SerametHttpError(403, "Accounting reporting permission is required");
    }
  }

  private async scope(input: FinanceWindow): Promise<Scope> {
    this.permit();
    const from = date(input.from, "from");
    const to = date(input.to, "to");
    const range = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
    if (range < 0 || range > 366) {
      throw new SerametHttpError(400, "Choose a period of at most 367 days");
    }
    let branchIds: string[];
    if (input.branchId) {
      authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
      branchIds = [input.branchId];
    } else if (this.actor.branchScope.type === "BRANCH") {
      if (!this.actor.branchId) throw new SerametHttpError(403, "Branch access is required");
      branchIds = [this.actor.branchId];
    } else {
      if (!this.actor.permissions.includes(permissions.tenantScopeAllBranches)) {
        throw new SerametHttpError(403, "All-branch accounting access is required");
      }
      const result = await this.db
        .prepare("SELECT id FROM branches WHERE tenant_id=? AND active=1 ORDER BY id")
        .bind(this.actor.tenantId)
        .all<{ id: string }>();
      branchIds = (result.results ?? []).map((branch) => branch.id);
    }
    if (branchIds.length === 0) {
      throw new SerametHttpError(409, "Configure an authorized branch before reporting");
    }
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string }>();
    if (!tenant?.default_currency)
      throw new SerametHttpError(409, "Tenant base currency is missing");
    return {
      tenantId: this.actor.tenantId,
      branchIds,
      currency: tenant.default_currency,
      from,
      to,
    };
  }

  private branches(scope: Scope, alias = "je") {
    return alias + ".branch_id IN (" + scope.branchIds.map(() => "?").join(",") + ")";
  }

  private async accounts(scope: Scope) {
    const result = await this.db
      .prepare(
        "SELECT id,code,name,account_type,currency FROM accounts WHERE tenant_id=? AND (branch_id IS NULL OR branch_id IN (" +
          scope.branchIds.map(() => "?").join(",") +
          ")) ORDER BY code,id",
      )
      .bind(scope.tenantId, ...scope.branchIds)
      .all<Account>();
    return result.results ?? [];
  }

  private async movements(scope: Scope) {
    const query = [
      "SELECT jl.account_id,a.code AS account_code,a.name AS account_name,",
      "a.account_type,a.currency AS account_currency,",
      "SUM(CASE WHEN je.business_date < ? THEN jl.debit_minor ELSE 0 END) AS opening_debit,",
      "SUM(CASE WHEN je.business_date < ? THEN jl.credit_minor ELSE 0 END) AS opening_credit,",
      "SUM(CASE WHEN je.business_date >= ? THEN jl.debit_minor ELSE 0 END) AS period_debit,",
      "SUM(CASE WHEN je.business_date >= ? THEN jl.credit_minor ELSE 0 END) AS period_credit",
      "FROM journal_lines jl JOIN journal_entries je ON je.tenant_id=jl.tenant_id",
      "AND je.id=jl.journal_entry_id JOIN accounts a ON a.tenant_id=jl.tenant_id AND a.id=jl.account_id",
      "WHERE jl.tenant_id=? AND je.status='POSTED' AND je.business_date<=? AND",
      this.branches(scope),
      "GROUP BY jl.account_id,a.code,a.name,a.account_type,a.currency",
    ].join(" ");
    const result = await this.db
      .prepare(query)
      .bind(
        scope.from,
        scope.from,
        scope.from,
        scope.from,
        scope.tenantId,
        scope.to,
        ...scope.branchIds,
      )
      .all<RawMovement>();
    return result.results ?? [];
  }

  private async postingIssues(scope: Scope): Promise<PostingIssue[]> {
    const issues: PostingIssue[] = [];
    const imbalanced = await this.db
      .prepare(
        [
          "SELECT COUNT(*) AS issue_count FROM (",
          "SELECT je.id,jl.currency FROM journal_entries je JOIN journal_lines jl",
          "ON jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id",
          "WHERE je.tenant_id=? AND je.status='POSTED' AND je.business_date BETWEEN ? AND ?",
          "AND",
          this.branches(scope),
          "GROUP BY je.id,jl.currency HAVING SUM(jl.debit_minor)<>SUM(jl.credit_minor)) AS unmatched",
        ].join(" "),
      )
      .bind(scope.tenantId, scope.from, scope.to, ...scope.branchIds)
      .first<{ issue_count: number | string }>();
    if (amount(imbalanced?.issue_count ?? 0) > 0) {
      issues.push({
        code: "IMBALANCED_POSTED_JOURNALS",
        count: amount(imbalanced!.issue_count),
        detail: "Posted journal vouchers contain unequal debits and credits.",
      });
    }
    const unpostedSuppliers = await this.db
      .prepare(
        [
          "SELECT COUNT(*) AS issue_count FROM supplier_invoices",
          "WHERE tenant_id=? AND invoice_date BETWEEN ? AND ?",
          "AND status IN ('POSTED','PARTIALLY_PAID','PAID')",
          "AND journal_entry_id IS NULL AND branch_id IN (",
          scope.branchIds.map(() => "?").join(","),
          ")",
        ].join(" "),
      )
      .bind(scope.tenantId, scope.from, scope.to, ...scope.branchIds)
      .first<{ issue_count: number | string }>();
    if (amount(unpostedSuppliers?.issue_count ?? 0) > 0) {
      issues.push({
        code: "SUPPLIER_BILLS_MISSING_GL",
        count: amount(unpostedSuppliers!.issue_count),
        detail: "Submitted supplier invoices have no linked journal voucher.",
      });
    }
    const emptyPosted = await this.db
      .prepare(
        [
          "SELECT COUNT(*) AS issue_count FROM journal_entries je",
          "WHERE je.tenant_id=? AND je.status='POSTED' AND je.business_date BETWEEN ? AND ?",
          "AND",
          this.branches(scope),
          "AND NOT EXISTS (SELECT 1 FROM journal_lines jl",
          "WHERE jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id)",
        ].join(" "),
      )
      .bind(scope.tenantId, scope.from, scope.to, ...scope.branchIds)
      .first<{ issue_count: number | string }>();
    if (amount(emptyPosted?.issue_count ?? 0) > 0) {
      issues.push({
        code: "POSTED_JOURNAL_WITHOUT_LINES",
        count: amount(emptyPosted!.issue_count),
        detail:
          "Posted vouchers lacking debit and credit lines cannot substantiate a ledger balance.",
      });
    }
    // Unrelated manually posted revenue is not evidence that a POS invoice
    // was posted. An exact source-linked journal is required per invoice.
    const untracedSales = await this.db
      .prepare(
        [
          "SELECT COUNT(*) AS issue_count FROM invoices i",
          "WHERE i.tenant_id=? AND i.business_date BETWEEN ? AND ? AND i.paid_minor>0",
          "AND i.status NOT IN ('DRAFT','CANCELLED','VOID','VOIDED')",
          "AND i.branch_id IN (",
          scope.branchIds.map(() => "?").join(","),
          ") AND NOT EXISTS (",
          "SELECT 1 FROM journal_entries je",
          "WHERE je.tenant_id=i.tenant_id AND je.branch_id=i.branch_id",
          "AND je.status='POSTED' AND je.source_type='POS_INVOICE' AND je.source_id=i.id)",
        ].join(" "),
      )
      .bind(scope.tenantId, scope.from, scope.to, ...scope.branchIds)
      .first<{ issue_count: number | string }>();
    if (amount(untracedSales?.issue_count ?? 0) > 0) {
      issues.push({
        code: "SETTLED_SALES_NOT_IN_GL",
        count: amount(untracedSales!.issue_count),
        detail:
          "Settled POS invoices are missing exact source-linked posted journals. Unrelated revenue vouchers or unverified day totals do not prove POS-to-GL completeness.",
      });
    }
    return issues;
  }

  async statement(input: FinanceWindow) {
    const scope = await this.scope(input);
    const masters = await this.accounts(scope);
    const raw = await this.movements(scope);
    const issues = await this.postingIssues(scope);
    const missingCurrency = raw.filter((row) => row.account_currency !== scope.currency);
    if (missingCurrency.length) {
      issues.push({
        code: "FOREIGN_CURRENCY_REVALUATION_REQUIRED",
        count: missingCurrency.length,
        detail:
          "Some accounts use a different currency; no unapproved currency conversion has been applied.",
      });
    }
    if (masters.length === 0) {
      issues.push({
        code: "CHART_OF_ACCOUNTS_MISSING",
        count: 1,
        detail:
          "Configure the organization's chart of accounts before issuing financial statements.",
      });
    }
    const movementById = new Map(raw.map((row) => [row.account_id, row]));
    const lines: AccountMovement[] = masters.map((account) => {
      const row = movementById.get(account.id);
      const openingDebitMinor = amount(row?.opening_debit ?? 0);
      const openingCreditMinor = amount(row?.opening_credit ?? 0);
      const periodDebitMinor = amount(row?.period_debit ?? 0);
      const periodCreditMinor = amount(row?.period_credit ?? 0);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.account_type,
        currency: account.currency,
        openingDebitMinor,
        openingCreditMinor,
        periodDebitMinor,
        periodCreditMinor,
        debitMinor: openingDebitMinor + periodDebitMinor,
        creditMinor: openingCreditMinor + periodCreditMinor,
        closingSignedMinor:
          openingDebitMinor + periodDebitMinor - openingCreditMinor - periodCreditMinor,
      };
    });
    const unknown = lines.filter(
      (line) =>
        ![
          "ASSET",
          "LIABILITY",
          "EQUITY",
          "INCOME",
          "REVENUE",
          "EXPENSE",
          "COGS",
          "COST_OF_GOODS_SOLD",
          "BANK",
          "CASH",
        ].includes(line.type),
    );
    if (unknown.length) {
      issues.push({
        code: "UNCLASSIFIED_LEDGER_ACCOUNTS",
        count: unknown.length,
        detail: "Account types must be configured before issuing classified statements.",
      });
    }
    const sum = (types: string[], side: "debit" | "credit") =>
      lines
        .filter((line) => types.includes(line.type) && line.currency === scope.currency)
        .reduce(
          (total, line) =>
            total + (side === "debit" ? line.closingSignedMinor : -line.closingSignedMinor),
          0,
        );
    const assetsMinor = sum(["ASSET", "BANK", "CASH"], "debit");
    const liabilitiesMinor = sum(["LIABILITY"], "credit");
    const equityMinor = sum(["EQUITY"], "credit");
    const incomeMinor = sum(["INCOME", "REVENUE"], "credit");
    const expenseMinor = sum(["EXPENSE", "COGS", "COST_OF_GOODS_SOLD"], "debit");
    const retainedMinor = incomeMinor - expenseMinor;
    const periodIncomeMinor = lines
      .filter((row) => ["INCOME", "REVENUE"].includes(row.type) && row.currency === scope.currency)
      .reduce((sum, row) => sum + row.periodCreditMinor - row.periodDebitMinor, 0);
    const periodExpenseMinor = lines
      .filter(
        (row) =>
          ["EXPENSE", "COGS", "COST_OF_GOODS_SOLD"].includes(row.type) &&
          row.currency === scope.currency,
      )
      .reduce((sum, row) => sum + row.periodDebitMinor - row.periodCreditMinor, 0);
    const balanceDifferenceMinor = assetsMinor - liabilitiesMinor - equityMinor - retainedMinor;
    const hasMovement = lines.some((line) => line.periodDebitMinor || line.periodCreditMinor);
    if (!hasMovement) {
      issues.push({
        code: "NO_POSTED_LEDGER_ENTRIES",
        count: 1,
        detail: "There are no posted journal entries for the selected branches and period.",
      });
    }
    if (balanceDifferenceMinor !== 0 && missingCurrency.length === 0) {
      issues.push({
        code: "BALANCE_SHEET_DIFFERENCE",
        count: 1,
        detail:
          "Assets differ from liabilities, equity and unclosed earnings; investigate posting and opening balances.",
      });
    }
    const cashAccounts = lines.filter((line) => line.type === "BANK" || line.type === "CASH");
    if (cashAccounts.length === 0) {
      issues.push({
        code: "CASH_ACCOUNT_CLASSIFICATION_MISSING",
        count: 1,
        detail:
          "Bank and cash accounts must be explicitly classified before cash movement can be reported.",
      });
    }
    // Never combine a foreign-currency bank balance with KES cash movement.
    // Even when other base-currency cash accounts exist, the resulting
    // total would be incomplete without verified currency conversion.
    const foreignCashAccounts = cashAccounts.filter((line) => line.currency !== scope.currency);
    if (foreignCashAccounts.length > 0) {
      issues.push({
        code: "CASH_MOVEMENT_CURRENCY_MISMATCH",
        count: foreignCashAccounts.length,
        detail:
          "Foreign-currency cash and bank accounts require verified currency conversion; a combined cash total is unavailable.",
      });
    }
    const debit = lines
      .filter((line) => line.currency === scope.currency)
      .reduce((total, line) => total + line.periodDebitMinor, 0);
    const credit = lines
      .filter((line) => line.currency === scope.currency)
      .reduce((total, line) => total + line.periodCreditMinor, 0);
    return {
      scope: {
        from: scope.from,
        to: scope.to,
        branchIds: scope.branchIds,
        currency: scope.currency,
      },
      quality: issues.length ? ("INCOMPLETE" as const) : ("RECONCILED" as const),
      issues,
      lines,
      trial: {
        periodDebitMinor: debit,
        periodCreditMinor: credit,
        balanced:
          hasMovement &&
          debit === credit &&
          issues.every((issue) => issue.code !== "IMBALANCED_POSTED_JOURNALS"),
      },
      balanceSheet: {
        assetsMinor,
        liabilitiesMinor,
        equityMinor,
        unclosedEarningsMinor: retainedMinor,
        differenceMinor: balanceDifferenceMinor,
      },
      incomeStatement: {
        incomeMinor: periodIncomeMinor,
        expenseMinor: periodExpenseMinor,
        netResultMinor: periodIncomeMinor - periodExpenseMinor,
      },
      cashMovement:
        cashAccounts.length && foreignCashAccounts.length === 0
          ? {
              openingMinor: cashAccounts.reduce(
                (sum, row) => sum + row.openingDebitMinor - row.openingCreditMinor,
                0,
              ),
              periodMinor: cashAccounts.reduce(
                (sum, row) => sum + row.periodDebitMinor - row.periodCreditMinor,
                0,
              ),
            }
          : null,
    };
  }

  async ledger(
    input: FinanceWindow & {
      limit?: number;
      offset?: number;
      accountId?: string;
      accountType?: string;
    },
  ) {
    const scope = await this.scope(input);
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 20_000
    ) {
      throw new SerametHttpError(400, "Invalid ledger page parameters");
    }
    if (
      input.accountType &&
      !["EXPENSE", "COGS", "COST_OF_GOODS_SOLD"].includes(input.accountType)
    ) {
      throw new SerametHttpError(400, "Unsupported accounting account filter");
    }
    const condition =
      (input.accountId ? "AND a.id=? " : "") + (input.accountType ? "AND a.account_type=?" : "");
    const bindings = [
      scope.tenantId,
      scope.from,
      scope.to,
      ...scope.branchIds,
      ...(input.accountId ? [input.accountId] : []),
      ...(input.accountType ? [input.accountType] : []),
    ];
    const result = await this.db
      .prepare(
        [
          "SELECT je.id AS voucher_id,je.business_date,je.source_type,je.source_id,",
          "je.description,je.branch_id,jl.line_number,jl.account_id,a.code AS account_code,a.account_type,",
          "a.name AS account_name,jl.currency,jl.debit_minor,jl.credit_minor",
          "FROM journal_lines jl JOIN journal_entries je ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id",
          "JOIN accounts a ON a.tenant_id=jl.tenant_id AND a.id=jl.account_id",
          "WHERE je.tenant_id=? AND je.status='POSTED' AND je.business_date BETWEEN ? AND ?",
          "AND",
          this.branches(scope),
          condition,
          "ORDER BY je.business_date DESC,je.id DESC,jl.line_number ASC LIMIT ? OFFSET ?",
        ].join(" "),
      )
      .bind(...bindings, limit + 1, offset)
      .all<Record<string, string | number>>();
    const rows = result.results ?? [];
    return {
      scope: {
        from: scope.from,
        to: scope.to,
        branchIds: scope.branchIds,
        currency: scope.currency,
      },
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit,
      offset,
      limit,
    };
  }

  async receivables(input: FinanceWindow) {
    const scope = await this.scope(input);
    const rows = await this.db
      .prepare(
        [
          "SELECT id,branch_id,invoice_number,status,business_date,currency,total_minor,paid_minor",
          "FROM invoices WHERE tenant_id=? AND business_date<=? AND paid_minor<total_minor",
          "AND status NOT IN ('DRAFT','CANCELLED','VOID','VOIDED')",
          "AND branch_id IN (",
          scope.branchIds.map(() => "?").join(","),
          ")",
          "ORDER BY business_date DESC,id DESC LIMIT 201",
        ].join(" "),
      )
      .bind(scope.tenantId, scope.to, ...scope.branchIds)
      .all<Record<string, string | number>>();
    return {
      currency: scope.currency,
      rows: (rows.results ?? []).slice(0, 200),
      truncated: (rows.results ?? []).length > 200,
      historicalAsOfVerified: false,
      note: [
        "Outstanding amounts reflect current persisted invoice payments.",
        "The selected date filters invoices but does not reconstruct historical balances.",
        "Marketplace settlement is reconciled separately.",
      ].join(" "),
    };
  }

  async payables(input: FinanceWindow) {
    const scope = await this.scope(input);
    const rows = await this.db
      .prepare(
        [
          "SELECT i.id,i.branch_id,i.invoice_number,i.invoice_date,i.due_date,i.currency,",
          "i.total_minor,i.status,i.journal_entry_id,s.name AS supplier_name",
          "FROM supplier_invoices i JOIN suppliers s ON s.tenant_id=i.tenant_id AND s.id=i.supplier_id",
          "WHERE i.tenant_id=? AND i.invoice_date<=? AND i.status<>'DRAFT'",
          "AND i.branch_id IN (",
          scope.branchIds.map(() => "?").join(","),
          ")",
          "ORDER BY i.invoice_date DESC,i.id DESC LIMIT 201",
        ].join(" "),
      )
      .bind(scope.tenantId, scope.to, ...scope.branchIds)
      .all<Record<string, string | number | null>>();
    return {
      currency: scope.currency,
      rows: (rows.results ?? []).slice(0, 200),
      truncated: (rows.results ?? []).length > 200,
      allocationVerified: false,
      note: "Invoice totals and statuses are accurate. Balances on partly paid supplier invoices are estimates until supplier payment matching is added.",
    };
  }
}
