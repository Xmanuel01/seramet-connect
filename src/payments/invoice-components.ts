import { assertMinorAmount, parseMajorAmount, sumMinor } from "./money";

/** Optional for historical/provider records whose economic components are unknown. */
export type InvoiceComponents = {
  version: 1;
  currency: string;
  grossSalesMinor: number;
  discountsMinor: number;
  netSalesMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  totalMinor: number;
};

export type InvoiceTotals = { subtotal: number; tax: number; total: number };

export function verifyInvoiceComponents(
  components: InvoiceComponents,
  totals: InvoiceTotals,
  currency: string,
): InvoiceComponents {
  if (components.version !== 1 || components.currency !== currency)
    throw new Error("Invoice component version or currency mismatch");
  for (const field of [
    "grossSalesMinor",
    "discountsMinor",
    "netSalesMinor",
    "serviceChargeMinor",
    "taxMinor",
    "totalMinor",
  ] as const) {
    assertMinorAmount(components[field], field);
    if (components[field] < 0) throw new Error("Invoice components cannot be negative");
  }
  if (
    sumMinor([components.grossSalesMinor, -components.discountsMinor]) !==
      components.netSalesMinor ||
    sumMinor([components.netSalesMinor, components.serviceChargeMinor]) !==
      parseMajorAmount(totals.subtotal, currency) ||
    components.taxMinor !== parseMajorAmount(totals.tax, currency) ||
    sumMinor([components.netSalesMinor, components.serviceChargeMinor, components.taxMinor]) !==
      components.totalMinor ||
    components.totalMinor !== parseMajorAmount(totals.total, currency)
  )
    throw new Error("Invoice components do not reconcile with authoritative totals");
  return { ...components };
}

/** Integer allocation with exact conservation and no rounding beyond a child's capacity. */
export function allocateInvoiceMinor(amount: number, weights: number[]): number[] {
  assertMinorAmount(amount);
  const total = sumMinor(weights);
  if (amount < 0 || weights.some((weight) => weight < 0) || total <= 0)
    throw new Error("Invalid invoice component allocation");
  let cumulative = 0n;
  let allocated = 0n;
  return weights.map((weight) => {
    cumulative += BigInt(weight);
    const target = (BigInt(amount) * cumulative) / BigInt(total);
    const result = Number(target - allocated);
    allocated = target;
    return result;
  });
}

export function splitInvoiceComponents(
  source: InvoiceComponents,
  totals: number[],
): InvoiceComponents[] {
  if (sumMinor(totals) !== source.totalMinor) throw new Error("Invoice split total mismatch");
  const taxes = allocateInvoiceMinor(source.taxMinor, totals);
  const remaining = totals.map((total, i) => total - taxes[i]!);
  const services =
    sumMinor(remaining) === 0
      ? remaining
      : allocateInvoiceMinor(source.serviceChargeMinor, remaining);
  const discounts = allocateInvoiceMinor(source.discountsMinor, totals);
  return totals.map((totalMinor, i) => {
    const netSalesMinor = totalMinor - taxes[i]! - services[i]!;
    return {
      ...source,
      totalMinor,
      netSalesMinor,
      discountsMinor: discounts[i]!,
      grossSalesMinor: sumMinor([netSalesMinor, discounts[i]!]),
      serviceChargeMinor: services[i]!,
      taxMinor: taxes[i]!,
    };
  });
}

export function summarizeInvoiceComponents(
  invoices: ReadonlyArray<InvoiceTotals & { financialComponents?: InvoiceComponents }>,
  currency: string,
) {
  const recorded = invoices.filter((invoice) => invoice.financialComponents);
  const verified = recorded.map((invoice) =>
    verifyInvoiceComponents(invoice.financialComponents!, invoice, currency),
  );
  const missing = invoices.length - recorded.length;
  if (missing) return { status: "NOT_RECORDED" as const, missing, invoiceCount: invoices.length };
  const fields = [
    "grossSalesMinor",
    "discountsMinor",
    "netSalesMinor",
    "serviceChargeMinor",
    "taxMinor",
    "totalMinor",
  ] as const;
  const totals = Object.fromEntries(
    fields.map((field) => [field, sumMinor(verified.map((row) => row[field]))]),
  ) as Pick<InvoiceComponents, (typeof fields)[number]>;
  return { status: "COMPLETE" as const, missing: 0, invoiceCount: invoices.length, totals };
}
