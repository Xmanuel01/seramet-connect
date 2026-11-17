import { majorFromMinor, sumMinor } from "./money";
import { verifyInvoiceComponents } from "./invoice-components";

/** POS currently has no discount command; capture known zero, never infer old invoices. */
export function posInvoicePricing(input: {
  currency: string;
  itemsMinor: number;
  taxMinor: number;
  serviceMinor: number;
  exclusiveChargesMinor: number;
  deliveryChargeMinor?: number;
  deliveryPayableMinor?: number;
}) {
  const deliveryChargeMinor = input.deliveryChargeMinor ?? 0;
  const totalMinor = sumMinor([input.itemsMinor, input.exclusiveChargesMinor, deliveryChargeMinor]);
  const netSalesMinor = sumMinor([
    totalMinor,
    -input.taxMinor,
    -input.serviceMinor,
    -deliveryChargeMinor,
  ]);
  const amounts = {
    subtotal: majorFromMinor(
      sumMinor([netSalesMinor, input.serviceMinor, deliveryChargeMinor]),
      input.currency,
    ),
    tax: majorFromMinor(input.taxMinor, input.currency),
    total: majorFromMinor(totalMinor, input.currency),
  };
  return {
    ...amounts,
    financialComponents: verifyInvoiceComponents(
      {
        version: 1,
        currency: input.currency,
        grossSalesMinor: netSalesMinor,
        discountsMinor: 0,
        netSalesMinor,
        serviceChargeMinor: input.serviceMinor,
        ...(input.deliveryChargeMinor !== undefined ? { deliveryChargeMinor } : {}),
        ...(input.deliveryPayableMinor !== undefined
          ? { deliveryPayableMinor: input.deliveryPayableMinor }
          : {}),
        taxMinor: input.taxMinor,
        totalMinor,
      },
      amounts,
      input.currency,
    ),
  };
}
