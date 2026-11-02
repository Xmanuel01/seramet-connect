import { useAppContext } from "@/lib/app-context";

// Readable names for codes stored in the ledger. Anything not listed is turned
// into words ("GIFT_CARD_ISSUE" -> "Gift card issue"), never shown raw.

/** "SOME_CODE" -> "Some code". */
export function humanize(code: string | null | undefined) {
  const words = String(code ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "";
}

const SOURCE_LABELS: Record<string, string> = {
  POS_INVOICE: "Sale",
  POS_INVOICE_REVERSAL: "Sale reversal",
  PAYMENT_TRANSACTION: "Payment",
  PAYMENT_CLEARING: "Payment clearing",
  REFUND: "Refund",
  REFUND_CONFIRMED: "Refund",
  GOODS_RECEIPT: "Goods received",
  SUPPLIER_INVOICE: "Supplier bill",
  INVENTORY_ADJUSTMENT: "Stock adjustment",
  INVENTORY_MOVEMENT: "Stock movement",
  CASH_MOVEMENT: "Cash movement",
  CUSTODY_COLLECTION: "Rider cash collected",
  CUSTODY_REMITTANCE: "Rider cash handed in",
  GIFT_CARD_ISSUE: "Gift card sold",
  GIFT_CARD_REDEMPTION: "Gift card redeemed",
  HOUSE_ACCOUNT: "House account",
  MANUAL_ADJUSTMENT: "Manual adjustment",
  BANK: "Bank",
};

export function sourceLabel(type: string) {
  return SOURCE_LABELS[type] ?? humanize(type);
}

/** Journal sources that make up the daily sales journal. */
export const SALES_SOURCES = ["POS_INVOICE", "POS_INVOICE_REVERSAL"] as const;

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  REVENUE: "Income",
  EXPENSE: "Expense",
  COGS: "Cost of sales",
  COST_OF_GOODS_SOLD: "Cost of sales",
};

export function accountTypeLabel(type: string) {
  return ACCOUNT_TYPE_LABELS[type] ?? humanize(type);
}

export const INCOME_TYPES = ["INCOME", "REVENUE"];
export const COST_TYPES = ["COGS", "COST_OF_GOODS_SOLD"];

/** Branch names for this tenant, for tables that hold branch ids. */
export function useBranchName() {
  const { activeTenantId, platformState } = useAppContext();
  return (branchId: string | null | undefined) => {
    if (!branchId) return "";
    return (
      platformState.branches.find(
        (branch) => branch.tenantId === activeTenantId && branch.id === branchId,
      )?.name ?? "Other branch"
    );
  };
}

export type CloseBlockerLink =
  | { to: "/payment-control"; search: { tab: "bank" | "settlements" | "refunds" } }
  | { to: "/stock-count" | "/supplier-bills" | "/system-health" | "/cost-control" };

const CLOSE_BLOCKERS: Record<string, { label: string; link: CloseBlockerLink }> = {
  UNRESOLVED_RECONCILIATION: {
    label: "Payments not reconciled",
    link: { to: "/payment-control", search: { tab: "bank" } },
  },
  UNMATCHED_SETTLEMENT: {
    label: "Settlements not matched to the bank",
    link: { to: "/payment-control", search: { tab: "settlements" } },
  },
  PENDING_REFUND: {
    label: "Refunds waiting for approval",
    link: { to: "/payment-control", search: { tab: "refunds" } },
  },
  OPEN_STOCK_COUNT: { label: "Stock counts still open", link: { to: "/stock-count" } },
  UNPOSTED_SUPPLIER_INVOICE: {
    label: "Supplier bills not posted",
    link: { to: "/supplier-bills" },
  },
  INVENTORY_GL_VARIANCE: {
    label: "Stock value differs from the accounts",
    link: { to: "/cost-control" },
  },
  FAILED_DURABLE_JOB: { label: "Background tasks that failed", link: { to: "/system-health" } },
};

/** What a period-close blocker means and where it is fixed. */
export function closeBlocker(code: string): { label: string; link: CloseBlockerLink | null } {
  return CLOSE_BLOCKERS[code] ?? { label: humanize(code), link: null };
}
