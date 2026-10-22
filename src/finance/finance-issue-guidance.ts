const guidance: Record<string, { title: string; nextStep: string }> = {
  CHART_OF_ACCOUNTS_MISSING: {
    title: "Chart of accounts not configured",
    nextStep:
      "An authorized finance administrator must configure the restaurant's real ledger accounts. Account mappings alone cannot create missing accounts.",
  },
  NO_POSTED_LEDGER_ENTRIES: {
    title: "No posted journals in this period",
    nextStep:
      "Check the branch and date filters, then review source transactions in Reconciliation. Sales and payments are not automatically evidence of posted revenue journals.",
  },
  CASH_ACCOUNT_CLASSIFICATION_MISSING: {
    title: "Cash and bank accounts need classification",
    nextStep:
      "Finance must verify the real cash and bank accounts and their classifications. A payment method named Cash is not a classified ledger account.",
  },
  SETTLED_SALES_NOT_IN_GL: {
    title: "Collected sales need ledger reconciliation",
    nextStep:
      "Review the original invoices and their source-linked postings. Do not create balancing entries or post the same sale again to clear this warning.",
  },
};

export function financeIssueGuidance(code: string) {
  return Object.hasOwn(guidance, code)
    ? guidance[code]!
    : { title: code.replaceAll("_", " "), nextStep: null };
}
