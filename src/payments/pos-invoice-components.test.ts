import { describe, expect, it } from "vitest";
import { posInvoicePricing } from "./pos-invoice-components";
import { verifyInvoiceComponents } from "./invoice-components";

describe("POS economic capture", () => {
  it.each([
    {
      itemsMinor: 10000,
      taxMinor: 0,
      serviceMinor: 0,
      exclusiveChargesMinor: 0,
      net: 10000,
      total: 10000,
    },
    {
      itemsMinor: 10000,
      taxMinor: 1600,
      serviceMinor: 500,
      exclusiveChargesMinor: 2100,
      net: 10000,
      total: 12100,
    },
    {
      itemsMinor: 11600,
      taxMinor: 1600,
      serviceMinor: 0,
      exclusiveChargesMinor: 0,
      net: 10000,
      total: 11600,
    },
    {
      itemsMinor: 12100,
      taxMinor: 1600,
      serviceMinor: 500,
      exclusiveChargesMinor: 0,
      net: 10000,
      total: 12100,
    },
  ])("reconciles configured inclusive/exclusive charges: $total", (input) => {
    const result = posInvoicePricing({ currency: "KES", ...input });
    expect(result.financialComponents.netSalesMinor).toBe(input.net);
    expect(result.financialComponents.totalMinor).toBe(input.total);
    expect(verifyInvoiceComponents(result.financialComponents, result, "KES")).toEqual(
      result.financialComponents,
    );
  });
  it("rejects fractions, unsafe sums and charges greater than the total", () => {
    for (const changed of [
      { itemsMinor: 0.1 },
      { taxMinor: 20000 },
      { itemsMinor: Number.MAX_SAFE_INTEGER, exclusiveChargesMinor: 1 },
    ])
      expect(() =>
        posInvoicePricing({
          currency: "KES",
          itemsMinor: 10000,
          taxMinor: 0,
          serviceMinor: 0,
          exclusiveChargesMinor: 0,
          ...changed,
        }),
      ).toThrow();
  });
});
