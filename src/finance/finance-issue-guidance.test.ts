import { describe, expect, it } from "vitest";
import { financeIssueGuidance } from "@/finance/finance-issue-guidance";

describe("accounting issue guidance", () => {
  it("distinguishes missing accounts from mappings and payment methods", () => {
    expect(financeIssueGuidance("CHART_OF_ACCOUNTS_MISSING").nextStep).toContain(
      "Account mappings alone cannot create missing accounts",
    );
    expect(financeIssueGuidance("CASH_ACCOUNT_CLASSIFICATION_MISSING").nextStep).toContain(
      "A payment method named Cash is not a classified ledger account",
    );
  });

  it("offers investigation rather than fabricated or duplicate postings", () => {
    expect(financeIssueGuidance("NO_POSTED_LEDGER_ENTRIES").nextStep).toContain(
      "Check the branch and date filters",
    );
    expect(financeIssueGuidance("SETTLED_SALES_NOT_IN_GL").nextStep).toContain(
      "Do not create balancing entries or post the same sale again",
    );
  });

  it("preserves unknown issues instead of hiding them", () => {
    expect(financeIssueGuidance("NEW_FINANCIAL_CHECK")).toEqual({
      title: "NEW FINANCIAL CHECK",
      nextStep: null,
    });
  });
});
