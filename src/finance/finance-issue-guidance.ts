import { humanize } from "@/finance/finance-labels";

// What each automatic accounts check means, and what to do about it, in the
// words an owner or accountant would use.
const guidance: Record<string, { title: string; nextStep: string }> = {
  CHART_OF_ACCOUNTS_MISSING: {
    title: "Your accounts aren't set up yet",
    nextStep:
      "Set up the restaurant's accounts in Setup Centre → Accounting. Linking payment methods to accounts doesn't create the accounts themselves.",
  },
  UNCLASSIFIED_LEDGER_ACCOUNTS: {
    title: "Some accounts have no type",
    nextStep:
      "Give each account a type (asset, liability, equity, income, expense or cost of sales) in Setup Centre → Accounting, so statements can group them.",
  },
  CASH_ACCOUNT_CLASSIFICATION_MISSING: {
    title: "Cash and bank accounts aren't marked",
    nextStep:
      "Mark which accounts hold cash and which are bank accounts in Setup Centre → Accounting. A payment method called Cash doesn't mark an account by itself.",
  },
  NO_POSTED_LEDGER_ENTRIES: {
    title: "Nothing was posted in this period",
    nextStep: "Check the branch and dates. If sales happened, review them in Payments.",
  },
  SETTLED_SALES_NOT_IN_GL: {
    title: "Some paid sales aren't in the accounts yet",
    nextStep:
      "Open the sales in Invoices and check they were posted. Don't enter them again by hand; that would count them twice.",
  },
  SUPPLIER_BILLS_MISSING_GL: {
    title: "Some supplier bills aren't in the accounts",
    nextStep: "Open Payables and post the bills that show Not posted.",
  },
  IMBALANCED_POSTED_JOURNALS: {
    title: "Some entries don't balance",
    nextStep:
      "Debits and credits differ on at least one entry. Ask your accountant to review it in the General Ledger before relying on these figures.",
  },
  POSTED_JOURNAL_WITHOUT_LINES: {
    title: "Some entries have no amounts",
    nextStep: "Ask your accountant to review the empty entries in the General Ledger.",
  },
  BALANCE_SHEET_DIFFERENCE: {
    title: "The balance sheet doesn't balance",
    nextStep:
      "Assets don't equal liabilities plus equity. Resolve the other checks on this list first; ask your accountant if the difference remains.",
  },
  FOREIGN_CURRENCY_REVALUATION_REQUIRED: {
    title: "Some amounts are in another currency",
    nextStep:
      "Totals show only your main currency. Ask your accountant to convert the other-currency balances.",
  },
};

export function financeIssueGuidance(code: string) {
  return Object.hasOwn(guidance, code)
    ? guidance[code]!
    : {
        title: humanize(code),
        nextStep: "Ask your accountant to review this in the General Ledger.",
      };
}
