import { z } from "zod";
import type { OrderChannelDefinition } from "@/platform/types";

export const deliverySettingsSchema = z
  .object({
    fulfilment: z.enum(["RESTAURANT", "PROVIDER", "PICKUP", "NONE"]),
    beneficiary: z.enum(["RIDER", "BUSINESS"]),
    allowManual: z.boolean(),
    allowOrderAmount: z.boolean().default(false),
    // Who receives money the customer pays on delivery. COUNTER: the rider only delivers and
    // the cashier clears the invoice with whatever was paid. RIDER: the rider carries it and
    // is tracked until it is handed in.
    cashHandledBy: z.enum(["COUNTER", "RIDER"]).default("COUNTER"),
    // Scheduled orders: minutes for the rider to reach the customer once the food is ready,
    // used when the app gives only a delivery time; and the kitchen's prep time for scheduled
    // orders typed in by hand, which have no connection to estimate it.
    scheduledTravelMinutes: z.number().int().min(0).max(240).default(15),
    scheduledPrepMinutes: z.number().int().min(1).max(480).default(25),
    rates: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(120),
            amountMinor: z.number().int().nonnegative().safe(),
            branchIds: z.array(z.string().min(1)).max(100).default([]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.rates.map((rate) => rate.id)).size === value.rates.length,
    "Delivery rate IDs must be unique",
  );

export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;
export const deliveryChargeSchema = z
  .object({
    amountMinor: z.number().int().nonnegative().safe(),
    beneficiary: z.enum(["RIDER", "BUSINESS"]),
    source: z.enum(["RATE", "MANUAL", "PROVIDER", "ORDER"]),
    rateId: z.string().max(80).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type DeliveryCharge = z.infer<typeof deliveryChargeSchema>;

export const deliveryContactSchema = z.object({
  recipientName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(64).optional(),
  phoneCode: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  doorNumber: z.string().trim().max(40).optional(),
});

export function deliverySettings(channel: Pick<OrderChannelDefinition, "metadata"> | undefined) {
  const parsed = deliverySettingsSchema.safeParse(channel?.metadata["deliverySettings"]);
  return parsed.success ? parsed.data : undefined;
}

/** Owner-controlled amount entry, independent of marketplace names or online pricing. */
export function withRiderDelivery(
  channel: Pick<OrderChannelDefinition, "metadata"> | undefined,
  enabled: boolean,
): DeliverySettings {
  return deliverySettingsSchema.parse({
    beneficiary: "RIDER",
    allowManual: false,
    rates: [],
    ...deliverySettings(channel),
    fulfilment: enabled ? "RESTAURANT" : "PROVIDER",
    allowOrderAmount: enabled,
  });
}

/** Riders carry customer money only where the channel says so; the counter is the default. */
export function ridersCarryCash(channel: Pick<OrderChannelDefinition, "metadata"> | undefined) {
  return deliverySettings(channel)?.cashHandledBy === "RIDER";
}

export function validateLocalDeliveryCharge(
  charge: DeliveryCharge | undefined,
  settings: DeliverySettings | undefined,
  branchId: string,
) {
  if (!charge) return;
  deliveryChargeSchema.parse(charge);
  if (!settings || settings.fulfilment !== "RESTAURANT")
    throw new Error("Configure restaurant delivery before adding a delivery charge");
  if (charge.beneficiary !== settings.beneficiary)
    throw new Error("Delivery fee recipient does not match channel settings");
  if (charge.source === "ORDER") {
    if (!settings.allowOrderAmount)
      throw new Error("Delivery amount entry is disabled for this channel");
  } else if (charge.source === "RATE") {
    const rate = settings.rates.find(
      (row) =>
        row.id === charge.rateId && (!row.branchIds.length || row.branchIds.includes(branchId)),
    );
    if (!rate || rate.amountMinor !== charge.amountMinor)
      throw new Error("Delivery rate changed; select the current rate again");
  } else if (charge.source !== "MANUAL" || !settings.allowManual || !charge.reason?.trim()) {
    throw new Error("Manual delivery charge requires permission and a reason");
  }
}
