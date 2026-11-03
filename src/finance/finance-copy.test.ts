import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every page in Finance and Payments, plus the parts they embed.
const pages = [
  "src/routes/finance.tsx",
  "src/routes/statements.tsx",
  "src/routes/general-ledger.tsx",
  "src/routes/payment-control.tsx",
  "src/routes/receivables.tsx",
  "src/routes/payables.tsx",
  "src/routes/expenses.tsx",
  "src/routes/period-close.tsx",
  "src/routes/prime-cost.tsx",
  "src/routes/reports.tsx",
  "src/routes/supplier-bills.tsx",
  "src/routes/invoices.tsx",
  "src/routes/receipts.tsx",
  "src/finance/StatementsPage.tsx",
  "src/finance/FinancialReports.tsx",
  "src/finance/AdvancedFinanceModules.tsx",
  "src/finance/finance-ui.tsx",
  "src/finance/finance-issue-guidance.ts",
  "src/finance/finance-labels.ts",
  "src/components/app/RefundsWorkspace.tsx",
  "src/components/app/InvoiceSplitDialog.tsx",
  "src/components/app/MpesaToMatch.tsx",
];

// Words that belong to the code, not to a restaurant.
const developerWording =
  /\b(authoritative|idempoten\w*|backend|server[- ]side|schema|read model|endpoint|payload|persisted|adapter|evidence|verified page|scope is enforced|report shell|EOD|GL)\b/i;

/** Sentences a person can see: string literals and JSX text that contain a space. */
function visibleText(source: string) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const strings = [...code.matchAll(/"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  return strings
    .map((text) => text.replace(/\$\{[^}]*\}/g, "").trim())
    .filter(
      (text) =>
        / /.test(text) && !/^[\w./@-]+$/.test(text) && !/className|^[a-z-:/[\]\d. ]+$/.test(text),
    );
}

describe("finance and payment pages speak plainly", () => {
  for (const page of pages)
    it(`${page} shows no developer wording`, () => {
      const offending = visibleText(readFileSync(page, "utf8")).filter((text) =>
        developerWording.test(text),
      );
      expect(offending).toEqual([]);
    });
});
