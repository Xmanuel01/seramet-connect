export type GuestSessionType = "WEB" | "QR" | "KIOSK" | "PORTAL" | "RESERVATION";
export type GuestServiceMode = "QR_TABLE" | "PICKUP" | "DIRECT_DELIVERY" | "WEB_ORDER" | "KIOSK";

export type GuestCartInput = {
  items: Array<{
    itemId: string;
    quantity: number;
    modifierIds?: string[] | undefined;
    specialRequest?: string | undefined;
  }>;
  serviceMode: GuestServiceMode;
  deliveryZoneId?: string | undefined;
  scheduledFor?: string | undefined;
  voucherCode?: string | undefined;
  tipMinor?: number | undefined;
};

export type GuestQuoteLine = {
  itemId: string;
  name: string;
  categoryCode: string;
  quantity: number;
  unitPriceMinor: number;
  modifierTotalMinor: number;
  lineTotalMinor: number;
  stationCode?: string;
  modifiers: Array<{ id: string; name: string; priceMinor: number }>;
  specialRequest?: string;
};

export type GuestQuote = {
  id: string;
  branchId: string;
  sessionId: string;
  serviceMode: GuestServiceMode;
  currency: string;
  lines: GuestQuoteLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  deliveryChargeMinor: number;
  tipMinor: number;
  totalMinor: number;
  amountDueMinor: number;
  expiresAt: string;
  warnings: string[];
};

export type ReservationStatus =
  "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "WAITLISTED";

export type PublicBranchProfile = {
  restaurantSlug: string;
  branchSlug: string;
  publicName: string;
  branchName: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  address: string;
  phone?: string;
  email?: string;
  currency: string;
  status: "OPEN" | "CLOSED" | "ORDERING_PAUSED" | "RESERVATIONS_ONLY" | "COMING_SOON";
  serviceModes: GuestServiceMode[];
  operatingHours: Record<string, [string, string]>;
  branding: Record<string, string>;
  orderingEnabled: boolean;
  reservationsEnabled: boolean;
  minimumOrderMinor: number;
};

export type PublicMenuItem = {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  description?: string;
  imageUrl?: string;
  priceMinor: number;
  currency: string;
  available: boolean;
  soldOutReason?: string;
  stationCode?: string;
  modifierGroups: Array<{
    id: string;
    name: string;
    required: boolean;
    minimum: number;
    maximum: number;
    options: Array<{ id: string; name: string; priceMinor: number; available: boolean }>;
  }>;
  dietaryTags: string[];
  allergenInformation: string[];
};

export type GuestApiErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EXPIRED"
  | "CONFLICT"
  | "DUPLICATE"
  | "STALE_QUOTE"
  | "VALIDATION_FAILED"
  | "UNAVAILABLE"
  | "RATE_LIMITED";

export class GuestDomainError extends Error {
  constructor(
    public readonly code: GuestApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
