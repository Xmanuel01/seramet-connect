import { z } from "zod";
import type { OrderChannelDefinition } from "@/platform/types";
import type { SettlementAccountMappings } from "@/payments/reconciliation-engine";

/** Where a delivery app's payout posts: one account per kind of line on its report. */
export const payoutAccountsSchema = z
  .object({
    bankAccountId: z.string().trim().min(1).max(120),
    marketplaceReceivableAccountId: z.string().trim().min(1).max(120),
    commissionExpenseAccountId: z.string().trim().min(1).max(120),
    serviceFeeExpenseAccountId: z.string().trim().min(1).max(120),
    deliveryAdjustmentAccountId: z.string().trim().min(1).max(120),
    promotionExpenseAccountId: z.string().trim().min(1).max(120),
    refundExpenseAccountId: z.string().trim().min(1).max(120),
    taxAdjustmentAccountId: z.string().trim().min(1).max(120),
    otherAdjustmentAccountId: z.string().trim().min(1).max(120),
  })
  .strict();

export type PayoutAccounts = z.infer<typeof payoutAccountsSchema>;

export const payoutAccountFields: ReadonlyArray<{
  key: keyof PayoutAccounts;
  label: string;
  /** Starter-chart codes to suggest, first match wins. */
  suggest: string[];
}> = [
  { key: "bankAccountId", label: "Bank the payout arrives in", suggest: ["1010"] },
  {
    key: "marketplaceReceivableAccountId",
    label: "Money owed by the app",
    suggest: ["1100"],
  },
  { key: "commissionExpenseAccountId", label: "App commission", suggest: ["6100"] },
  { key: "serviceFeeExpenseAccountId", label: "Other app fees", suggest: ["6100", "6000"] },
  { key: "promotionExpenseAccountId", label: "Promotions you funded", suggest: ["4900"] },
  { key: "refundExpenseAccountId", label: "Refunds", suggest: ["4910"] },
  { key: "deliveryAdjustmentAccountId", label: "Delivery adjustments", suggest: ["4200"] },
  { key: "taxAdjustmentAccountId", label: "Tax withheld by the app", suggest: ["2100", "1300"] },
  { key: "otherAdjustmentAccountId", label: "Other deductions", suggest: ["6100"] },
];

export function channelPayoutAccounts(
  channel: Pick<OrderChannelDefinition, "metadata"> | undefined,
): SettlementAccountMappings | undefined {
  const parsed = payoutAccountsSchema.safeParse(channel?.metadata["payoutAccounts"]);
  return parsed.success ? parsed.data : undefined;
}

/** The connection id an app's payouts and orders are filed under. */
export function appSettlementConnectionId(
  channel: Pick<OrderChannelDefinition, "id" | "deliveryProviderConnectionId">,
) {
  return channel.deliveryProviderConnectionId ?? `manual:${channel.id}`;
}
