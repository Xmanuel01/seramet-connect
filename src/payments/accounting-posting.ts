import { assertMinorAmount, sumMinor } from "@/payments/money";
import type { FinancialJournal, JournalLine } from "@/payments/types";

export function assertBalancedJournal(lines: readonly JournalLine[]) {
  if (lines.length < 2) throw new Error("A journal must contain at least two lines");
  for (const line of lines) {
    assertMinorAmount(line.debitMinor, "journal debit");
    assertMinorAmount(line.creditMinor, "journal credit");
    if (line.debitMinor < 0 || line.creditMinor < 0) {
      throw new Error("Journal debit and credit values cannot be negative");
    }
    if ((line.debitMinor === 0) === (line.creditMinor === 0)) {
      throw new Error("Each journal line must contain exactly one non-zero side");
    }
  }
  const debit = sumMinor(lines.map((line) => line.debitMinor));
  const credit = sumMinor(lines.map((line) => line.creditMinor));
  if (debit !== credit) throw new Error(`Unbalanced journal: debit ${debit}, credit ${credit}`);
}

export function createJournal(input: Omit<FinancialJournal, "status" | "createdAt">) {
  assertBalancedJournal(input.lines);
  return {
    ...input,
    status: "POSTED" as const,
    postedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } satisfies FinancialJournal;
}

export function reverseJournal(
  original: FinancialJournal,
  input: { id: string; actor: string; businessDate: string },
) {
  if (original.status === "REVERSED") throw new Error("Journal has already been reversed");
  const lines = original.lines.map((line) => ({
    ...line,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor,
    metadata: { ...line.metadata, reversalOfId: original.id },
  }));
  return createJournal({
    id: input.id,
    tenantId: original.tenantId,
    ...(original.branchId ? { branchId: original.branchId } : {}),
    sourceType: "REVERSAL",
    sourceId: original.sourceId,
    businessDate: input.businessDate,
    description: `Reversal of ${original.description}`,
    lines,
    postedBy: input.actor,
    reversalOfId: original.id,
  });
}
