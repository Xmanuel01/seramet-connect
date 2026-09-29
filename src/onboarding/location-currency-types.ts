export type CountryReference = {
  code: string;
  name: string;
  administrativeLevel1Label: string;
  defaultCurrencyCode: string;
  callingCode: string;
  defaultTimezone: string;
  defaultLocale: string;
};

export type CurrencyReference = {
  code: string;
  name: string;
  symbol: string;
  minorDigits: number;
};

export type BusinessLocation = {
  countryCode: string;
  administrativeLevel1: string;
  administrativeLevel2: string;
  city: string;
  addressLine: string;
  postalCode: string;
  latitudeMicrodegrees: number | null;
  longitudeMicrodegrees: number | null;
  status: "DRAFT" | "CONFIRMED";
};

export type AcceptedCurrency = CurrencyReference & {
  isBase: boolean;
  status: "ACTIVE" | "INACTIVE";
  paymentEligible: boolean;
  cashEligible: boolean;
  digitalPaymentEligible: boolean;
  exchangeRatePolicy: "MANUAL" | "PROVIDER" | "HQ" | "LEGAL_ENTITY";
  rateFreshnessMinutes: number;
  roundingPolicy: "HALF_UP" | "UP" | "DOWN";
  changePolicy: "TENDER_CURRENCY" | "BASE_CURRENCY" | "NO_CHANGE";
  branchIds: string[];
  paymentMethodIds: string[];
};

export type OnboardingWizardState = {
  currentStep: number;
  status: "IN_PROGRESS" | "COMPLETED";
  completedSteps: number[];
  responses: Record<string, unknown>;
  version: number;
  location: BusinessLocation | null;
  suggestedCurrency: CurrencyReference | null;
  acceptedCurrencies: AcceptedCurrency[];
  canChangeBaseCurrency: boolean;
  baseCurrencyLockReason: string | null;
};

export type OnboardingStepInput = {
  step: number;
  action: "SAVE" | "BACK" | "COMPLETE";
  response: Record<string, unknown>;
};

export type ManualFxRateInput = {
  baseCurrency: string;
  tenderCurrency: string;
  rateNumerator: number;
  rateDenominator: number;
  effectiveFrom: string;
  effectiveUntil: string;
  reason: string;
  idempotencyKey: string;
};

export type FxPaymentQuote = {
  id: string;
  branchId: string;
  invoiceId: string;
  paymentMethodId: string;
  baseCurrency: string;
  tenderCurrency: string;
  baseAmountMinor: number;
  tenderAmountMinor: number;
  convertedBaseAmountMinor: number;
  roundingAdjustmentMinor: number;
  rateNumerator: number;
  rateDenominator: number;
  rateSourceId: string;
  rateTimestamp: string;
  quality: "CURRENT" | "MANUAL";
  expiresAt: string;
  status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "CANCELLED";
};
