// One definition of the guided onboarding flow, shared by the wizard and the server.
// Steps are numbered 1..12. Progress saved by the previous flow (wizard steps 5..20, with
// registration as steps 1..4) carries no flow marker and is translated on read.

export const ONBOARDING_FLOW_VERSION = 2;
export const ONBOARDING_FLOW_MARKER = "_flow";

export type OnboardingStepId =
  | "location"
  | "currency"
  | "businessType"
  | "branch"
  | "hours"
  | "serviceModes"
  | "tax"
  | "payments"
  | "stations"
  | "menu"
  | "team"
  | "review";

export type OnboardingStepDefinition = {
  id: OnboardingStepId;
  title: string;
  description: string;
  // Required steps must be saved before onboarding can be completed.
  required: boolean;
};

export const onboardingSteps: readonly OnboardingStepDefinition[] = [
  {
    id: "location",
    title: "Where is your business located?",
    description: "Select your country and enter an address you can confirm.",
    required: true,
  },
  {
    id: "currency",
    title: "Your currency",
    description: "Choose one accounting currency and any foreign currencies you accept.",
    required: true,
  },
  {
    id: "businessType",
    title: "What kind of business is this?",
    description:
      "Your answer pre-fills opening hours, service modes and kitchen stations. Choose whether to track stock from day one.",
    required: true,
  },
  {
    id: "branch",
    title: "Your first branch",
    description: "Name the location your team will sell from.",
    required: true,
  },
  {
    id: "hours",
    title: "Opening hours",
    description: "Set when this branch trades. You can change these later.",
    required: true,
  },
  {
    id: "serviceModes",
    title: "How do customers order?",
    description: "Each mode you choose becomes an order channel on the POS.",
    required: true,
  },
  {
    id: "tax",
    title: "Tax and service charge",
    description: "Enter the rates you charge. Seramet does not assume a rate for you.",
    required: true,
  },
  {
    id: "payments",
    title: "How do customers pay?",
    description: "Choose the payment methods your cashiers can record.",
    required: true,
  },
  {
    id: "stations",
    title: "Kitchen and stations",
    description: "Orders are routed to these preparation stations and their screens.",
    required: true,
  },
  {
    id: "menu",
    title: "Your first menu items",
    description: "Add a few items now, import your full menu, or do this later.",
    required: false,
  },
  {
    id: "team",
    title: "Invite your team",
    description: "Optional. Each person gets a role and a temporary POS PIN.",
    required: false,
  },
  {
    id: "review",
    title: "Review your restaurant",
    description: "Finishing onboarding is separate from production go-live readiness.",
    required: true,
  },
];

export const ONBOARDING_STEP_COUNT = onboardingSteps.length;
export const ONBOARDING_REVIEW_STEP = ONBOARDING_STEP_COUNT;

export function onboardingStepNumber(id: OnboardingStepId) {
  return onboardingSteps.findIndex((step) => step.id === id) + 1;
}

export function onboardingStep(stepNumber: number): OnboardingStepDefinition | undefined {
  return onboardingSteps[stepNumber - 1];
}

export const requiredOnboardingStepNumbers = onboardingSteps
  .map((step, index) => (step.required && step.id !== "review" ? index + 1 : 0))
  .filter(Boolean);

export type ServiceModePreset = {
  code: string;
  displayName: string;
  channelType: "DINE_IN" | "TAKEAWAY" | "OWN_DELIVERY" | "MARKETPLACE" | "QR" | "PHONE";
};

export const serviceModePresets: readonly ServiceModePreset[] = [
  { code: "DINE_IN", displayName: "Dine-in", channelType: "DINE_IN" },
  { code: "TAKEAWAY", displayName: "Takeaway", channelType: "TAKEAWAY" },
  { code: "DELIVERY", displayName: "Own delivery", channelType: "OWN_DELIVERY" },
  { code: "MARKETPLACE", displayName: "Delivery apps", channelType: "MARKETPLACE" },
  { code: "QR", displayName: "QR table ordering", channelType: "QR" },
  { code: "PHONE", displayName: "Phone orders", channelType: "PHONE" },
];

export type StationPreset = {
  code: string;
  name: string;
  stationType: "KITCHEN" | "GRILL" | "FRYER" | "BAR" | "COFFEE" | "DESSERT" | "PASS" | "DISPATCH";
};

export type PaymentMethodPreset = {
  code: string;
  displayName: string;
  category: "CASH" | "DIGITAL_WALLET" | "CARD" | "BANK_TRANSFER";
};

export const paymentMethodPresets: readonly PaymentMethodPreset[] = [
  { code: "CASH", displayName: "Cash", category: "CASH" },
  { code: "MPESA", displayName: "M-Pesa", category: "DIGITAL_WALLET" },
  { code: "CARD", displayName: "Card", category: "CARD" },
  { code: "BANK_TRANSFER", displayName: "Bank transfer", category: "BANK_TRANSFER" },
];

export type BusinessTypePreset = {
  label: string;
  detail: string;
  open: string;
  close: string;
  serviceModes: string[];
  stations: StationPreset[];
};

const kitchen: StationPreset = { code: "KITCHEN", name: "Kitchen", stationType: "KITCHEN" };
const bar: StationPreset = { code: "BAR", name: "Bar", stationType: "BAR" };

// Starting points only: every value is shown to the owner and can be changed before saving.
export const businessTypePresets: Record<string, BusinessTypePreset> = {
  RESTAURANT: {
    label: "Restaurant",
    detail: "Table service with a kitchen",
    open: "08:00",
    close: "22:00",
    serviceModes: ["DINE_IN", "TAKEAWAY", "DELIVERY"],
    stations: [kitchen, bar],
  },
  CAFE: {
    label: "Café",
    detail: "Coffee, light meals and counter service",
    open: "07:00",
    close: "19:00",
    serviceModes: ["DINE_IN", "TAKEAWAY"],
    stations: [{ code: "COFFEE", name: "Coffee bar", stationType: "COFFEE" }, kitchen],
  },
  BAR: {
    label: "Bar or lounge",
    detail: "Drinks first, with an optional kitchen",
    open: "16:00",
    close: "23:00",
    serviceModes: ["DINE_IN"],
    stations: [bar, kitchen],
  },
  QUICK_SERVICE: {
    label: "Quick service",
    detail: "Fast food and counter ordering",
    open: "10:00",
    close: "22:00",
    serviceModes: ["TAKEAWAY", "DINE_IN", "DELIVERY"],
    stations: [kitchen, { code: "FRYER", name: "Fryer", stationType: "FRYER" }],
  },
  BAKERY: {
    label: "Bakery",
    detail: "Baked goods to take away",
    open: "06:00",
    close: "19:00",
    serviceModes: ["TAKEAWAY", "DINE_IN"],
    stations: [{ code: "BAKERY", name: "Bakery", stationType: "KITCHEN" }],
  },
  CLOUD_KITCHEN: {
    label: "Cloud kitchen",
    detail: "Delivery only, no dining room",
    open: "10:00",
    close: "23:00",
    // Delivery apps need a provider integration first, so they are offered but not pre-selected.
    serviceModes: ["DELIVERY", "TAKEAWAY"],
    stations: [kitchen, { code: "DISPATCH", name: "Dispatch", stationType: "DISPATCH" }],
  },
  OTHER: {
    label: "Something else",
    detail: "Start with a kitchen and adjust everything",
    open: "08:00",
    close: "22:00",
    serviceModes: ["DINE_IN", "TAKEAWAY"],
    stations: [kitchen],
  },
};

export const weekDays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type LegacyAwareProgress = {
  currentStep: number;
  status: "IN_PROGRESS" | "COMPLETED";
  completedSteps: number[];
  responses: Record<string, unknown>;
};

export function isCurrentFlow(responses: Record<string, unknown>) {
  return responses[ONBOARDING_FLOW_MARKER] === ONBOARDING_FLOW_VERSION;
}

/**
 * Translate progress saved by the previous 5..20 wizard into this flow. Old steps 13..19 only
 * recorded "configure now / later" and created nothing, so they are not carried over; the new
 * tax, payments, stations, menu and team steps check real records instead.
 */
export function translateLegacyProgress(progress: LegacyAwareProgress): LegacyAwareProgress {
  if (isCurrentFlow(progress.responses))
    return {
      ...progress,
      responses: withKnownServiceModes(progress.responses),
      currentStep: Math.min(Math.max(progress.currentStep, 1), ONBOARDING_REVIEW_STEP),
      completedSteps: progress.completedSteps.filter(
        (step) => step >= 1 && step <= ONBOARDING_REVIEW_STEP,
      ),
    };
  const done = new Set(progress.completedSteps);
  const old = (step: number) => record(progress.responses[String(step)]);
  const completed = new Set<number>();
  const responses: Record<string, unknown> = { [ONBOARDING_FLOW_MARKER]: ONBOARDING_FLOW_VERSION };
  const carry = (next: number, value: Record<string, unknown> | undefined, isDone: boolean) => {
    if (value) responses[String(next)] = value;
    if (isDone) completed.add(next);
  };
  carry(1, old(5) && { ...old(5), confirmed: done.has(6) }, done.has(5) && done.has(6));
  carry(2, old(7), done.has(7));
  carry(3, old(8), done.has(8));
  carry(4, old(9) && { ...old(9), ...(old(10) ?? {}) }, done.has(9) && done.has(10));
  carry(5, old(11), done.has(11));
  carry(6, old(12) && knownServiceModes(old(12)!), done.has(12));
  if (progress.status === "COMPLETED") {
    return {
      currentStep: ONBOARDING_REVIEW_STEP,
      status: "COMPLETED",
      completedSteps: [...completed, ONBOARDING_REVIEW_STEP].sort((a, b) => a - b),
      responses,
    };
  }
  let currentStep = 1;
  while (currentStep < ONBOARDING_REVIEW_STEP && completed.has(currentStep)) currentStep += 1;
  return {
    currentStep,
    status: "IN_PROGRESS",
    completedSteps: [...completed].sort((a, b) => a - b),
    responses,
  };
}

// A completed onboarding can be reopened while readiness is below the go-live threshold.
export const ONBOARDING_RESUME_BELOW_BPS = 8000;

/**
 * Where a completed onboarding reopens: the first step not saved in this flow. A business type
 * saved by the previous flow has no stock-tracking answer, so that step is asked again.
 */
export function onboardingResumeStep(progress: LegacyAwareProgress) {
  const done = new Set(progress.completedSteps);
  const businessTypeStep = onboardingStepNumber("businessType");
  if (typeof record(progress.responses[String(businessTypeStep)])?.["trackStock"] !== "boolean")
    done.delete(businessTypeStep);
  for (let step = 1; step < ONBOARDING_REVIEW_STEP; step += 1) if (!done.has(step)) return step;
  return ONBOARDING_REVIEW_STEP;
}

const serviceModeCodes = new Set(serviceModePresets.map((mode) => mode.code));

/**
 * The previous flow saved values such as "KITCHEN" as service modes. They are not order channels,
 * so they are dropped from a saved answer instead of being sent back invisibly on the next save.
 */
function knownServiceModes(response: Record<string, unknown>) {
  const modes = response["serviceModes"];
  if (!Array.isArray(modes)) return response;
  return {
    ...response,
    serviceModes: modes.filter(
      (mode) => typeof mode === "string" && serviceModeCodes.has(mode.trim().toUpperCase()),
    ),
  };
}

function withKnownServiceModes(responses: Record<string, unknown>) {
  const saved = record(responses[String(onboardingStepNumber("serviceModes"))]);
  return saved
    ? { ...responses, [String(onboardingStepNumber("serviceModes"))]: knownServiceModes(saved) }
    : responses;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
