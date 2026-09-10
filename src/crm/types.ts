export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";

export type CustomerStatus = "ACTIVE" | "INACTIVE" | "ANONYMIZED" | "BLOCKED";
export type CustomerIdentifierType =
  | "PHONE"
  | "EMAIL"
  | "EXTERNAL_CUSTOMER_ID"
  | "LOYALTY_NUMBER"
  | "MEMBER_TOKEN"
  | "MARKETPLACE_REFERENCE"
  | "ONLINE_ACCOUNT";

export type ConsentChannel =
  "EMAIL_MARKETING" | "SMS_MARKETING" | "WHATSAPP_MARKETING" | "PUSH_MARKETING" | "PHONE_MARKETING";

export type ConsentStatus = "GRANTED" | "DENIED" | "WITHDRAWN" | "UNKNOWN";
export type CommunicationChannel = "EMAIL" | "SMS" | "WHATSAPP" | "PUSH";

export type CustomerSummary = {
  id: string;
  customerCode: string;
  displayName: string;
  accountType: "INDIVIDUAL" | "CORPORATE";
  status: CustomerStatus;
  phone?: string;
  email?: string;
  preferredBranchId?: string;
  lastActivityAt?: string;
  orderCount: number;
  netSpendMinor: number;
  currency?: string;
  loyaltyPoints: number;
  tierName?: string;
  quality: DataQuality;
};

export type CustomerProfile = CustomerSummary & {
  firstName?: string;
  lastName?: string;
  preferredLanguage?: string;
  companyName?: string;
  consents: Array<{ channel: ConsentChannel; status: ConsentStatus; effectiveAt: string }>;
  loyalty: Array<{
    programId: string;
    programName: string;
    tierName?: string;
    pointsBalance: number;
    upcomingExpiry: number;
  }>;
  availableRewards: Array<{ id: string; name: string; type: string; pointsCost: number }>;
  availableVouchers: Array<{
    id: string;
    name: string;
    codeLastFour: string;
    validTo?: string;
    discountType: string;
  }>;
  vouchersUsed: Array<{
    id: string;
    name: string;
    discountMinor: number;
    redeemedAt: string;
  }>;
  giftCards: Array<{ id: string; tokenLastFour: string; currency: string; balanceMinor: number }>;
  tags: Array<{ id: string; name: string; color?: string }>;
  notes: Array<{ id: string; note: string; createdAt: string; createdBy: string }>;
  campaignInteractions: Array<{
    id: string;
    campaignName: string;
    channel: string;
    status: string;
    occurredAt: string;
  }>;
  visits: {
    count: number;
    averageOrderMinor: number;
    firstVisitAt?: string;
    lastVisitAt?: string;
    favoriteBranchId?: string;
    favoriteChannel?: string;
    favoriteItems: Array<{ name: string; quantity: number }>;
    refundMinor: number;
    discountMinor: number;
  };
  feedback: Array<{
    id: string;
    category: string;
    rating: number;
    status: string;
    submittedAt: string;
  }>;
  journey: Array<{
    id: string;
    type: string;
    summary: string;
    occurredAt: string;
  }>;
};

export type CustomerCreateInput = {
  displayName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  preferredBranchId?: string;
  brandId?: string;
  accountType?: "INDIVIDUAL" | "CORPORATE";
  companyName?: string;
  billingContact?: string;
  taxIdentifier?: string;
  invoiceTermsDays?: number;
  accountReference?: string;
  createdSource: string;
};

export type PhoneNormalizationPolicy = {
  defaultCallingCode: string;
  nationalPrefix?: string;
  minNationalDigits?: number;
  maxNationalDigits?: number;
};

export type SegmentRuleField =
  | "orderCount"
  | "netSpendMinor"
  | "averageOrderMinor"
  | "daysSinceLastVisit"
  | "refundMinor"
  | "discountMinor"
  | "favoriteChannel"
  | "loyaltyPoints"
  | "tierId";

export type SegmentRule = {
  field: SegmentRuleField;
  operator: "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "IN";
  value: string | number | Array<string | number>;
};

export type SegmentDefinition = { all?: SegmentRule[]; any?: SegmentRule[] };

export type CampaignCapability = "SEND_EMAIL" | "SEND_SMS" | "SEND_WHATSAPP" | "SEND_PUSH";

export type CampaignProviderResult = {
  status: "SENT" | "FAILED" | "UNKNOWN";
  providerMessageId?: string;
  errorCode?: string;
};

export type CampaignMessage = {
  tenantId: string;
  deliveryId: string;
  channel: CommunicationChannel;
  destination: string;
  subject?: string;
  body: string;
  idempotencyKey: string;
};
