import { describe, expect, it } from "vitest";
import { financeIssueGuidance } from "@/finance/finance-issue-guidance";

const serverIssueCodes = [
  "IMBALANCED_POSTED_JOURNALS",
  "SUPPLIER_BILLS_MISSING_GL",
  "POSTED_JOURNAL_WITHOUT_LINES",
  "SETTLED_SALES_NOT_IN_GL",
  "FOREIGN_CURRENCY_REVALUATION_REQUIRED",
  "CHART_OF_ACCOUNTS_MISSING",
  "UNCLASSIFIED_LEDGER_ACCOUNTS",
  "NO_POSTED_LEDGER_ENTRIES",
  "BALANCE_SHEET_DIFFERENCE",
  "CASH_ACCOUNT_CLASSIFICATION_MISSING",
];

describe("accounting issue guidance", () => {
  it("explains every check the server can report in plain words", () => {
    for (const code of serverIssueCodes) {
      const { title, nextStep } = financeIssueGuidance(code);
      expect(title).not.toMatch(/_|[A-Z]{3,}/);
      expect(nextStep).toBeTruthy();
      expect(`${title} ${nextStep}`).not.toMatch(/authoritative|idempot|source-linked|GL\b/i);
    }
  });

  it("distinguishes missing accounts from mappings and payment methods", () => {
    expect(financeIssueGuidance("CHART_OF_ACCOUNTS_MISSING").nextStep).toContain(
      "Linking payment methods to accounts doesn't create the accounts",
    );
    expect(financeIssueGuidance("CASH_ACCOUNT_CLASSIFICATION_MISSING").nextStep).toContain(
      "A payment method called Cash doesn't mark an account",
    );
  });

  it("warns against entering sales twice", () => {
    expect(financeIssueGuidance("SETTLED_SALES_NOT_IN_GL").nextStep).toContain(
      "Don't enter them again by hand",
    );
  });

  it("names unknown checks in words instead of codes", () => {
    expect(financeIssueGuidance("NEW_FINANCIAL_CHECK")).toEqual({
      title: "New financial check",
      nextStep: "Ask your accountant to review this in the General Ledger.",
    });
  });
});
