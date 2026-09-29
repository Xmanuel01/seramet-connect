import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const boundedText = z.string().trim().max(280);
const serviceMode = z.enum(["QR_TABLE", "PICKUP", "DIRECT_DELIVERY", "WEB_ORDER", "KIOSK"]);

export const createGuestSessionSchema = z
  .object({
    sessionType: z.enum(["WEB", "QR", "KIOSK", "PORTAL", "RESERVATION"]),
    qrToken: z.string().trim().min(24).max(256).optional(),
  })
  .strict();

export const guestGiftCardPaymentSchema = z
  .object({
    trackingToken: z.string().trim().min(24).max(256),
    paymentMethodId: id,
    instrumentToken: z.string().trim().min(12).max(256),
    amountMinor: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

export const guestMembershipLinkSchema = z
  .object({
    memberToken: z.string().trim().min(24).max(256),
  })
  .strict();

export const guestLoyaltyRedemptionSchema = z
  .object({
    trackingToken: z.string().trim().min(24).max(256),
    paymentMethodId: id,
    rewardId: id,
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

export const guestFeedbackSchema = z
  .object({
    trackingToken: z.string().trim().min(24).max(256),
    categoryId: id,
    surveyType: z.enum(["GENERAL", "NPS", "CSAT"]),
    rating: z.number().int().min(0).max(10),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

export const guestCartSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            itemId: id,
            quantity: z.number().int().min(1).max(50),
            modifierIds: z.array(id).max(20).optional(),
            specialRequest: boundedText.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    serviceMode,
    deliveryZoneId: id.optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    voucherCode: z.string().trim().min(3).max(128).optional(),
    tipMinor: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict();

export const submitGuestOrderSchema = z
  .object({
    quoteId: id,
    idempotencyKey: z.string().trim().min(12).max(160),
    customerName: z.string().trim().min(1).max(120).optional(),
    contactPhone: z.string().trim().min(5).max(40).optional(),
    deliveryAddress: z.string().trim().min(5).max(500).optional(),
    deliveryInstructions: boundedText.optional(),
  })
  .strict();

export const reservationAvailabilitySchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    partySize: z.number().int().min(1).max(100),
    durationMinutes: z.number().int().min(15).max(720).optional(),
    areaPreference: z.string().trim().max(120).optional(),
  })
  .strict();

export const createReservationSchema = reservationAvailabilitySchema
  .extend({
    guestName: z.string().trim().min(1).max(120),
    contactPhone: z.string().trim().min(5).max(40).optional(),
    contactEmail: z.string().trim().email().max(254).optional(),
    notes: boundedText.optional(),
    idempotencyKey: z.string().trim().min(12).max(160),
  })
  .strict();

export const modifyReservationSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }).optional(),
    partySize: z.number().int().min(1).max(100).optional(),
    durationMinutes: z.number().int().min(15).max(720).optional(),
    notes: boundedText.optional(),
  })
  .strict();

export const waitlistSchema = z
  .object({
    guestName: z.string().trim().min(1).max(120),
    contactPhone: z.string().trim().min(5).max(40).optional(),
    partySize: z.number().int().min(1).max(100),
    areaPreference: z.string().trim().max(120).optional(),
  })
  .strict();

export const serviceRequestSchema = z
  .object({
    requestType: z.enum(["CALL_WAITER", "REQUEST_WATER", "REQUEST_BILL", "NEED_ASSISTANCE"]),
    note: boundedText.optional(),
  })
  .strict();
