import type { SerametEnv } from "@/lib/seramet-auth";

/**
 * Seramet's departmental email identities. Every address is on seramet.co.ke and sends
 * through Brevo. An identity is only used as the From address once an administrator has
 * verified it in Brevo and listed it in SERAMET_EMAIL_ACTIVE_SENDERS; until then the
 * platform's current working sender sends instead. A departmental reply-to is only set once
 * its Cloudflare forwarding rule exists and it is listed in SERAMET_EMAIL_REPLY_ROUTES.
 *
 * Senders are chosen on the server from the email's category. No request, client or
 * restaurant setting can pick a sender.
 */
export const EMAIL_SENDERS = {
  ADMIN: { email: "admin@seramet.co.ke", name: "Seramet Administration" },
  SUPPORT: { email: "support@seramet.co.ke", name: "Seramet Support" },
  BILLING: { email: "billing@seramet.co.ke", name: "Seramet Billing" },
  SALES: { email: "sales@seramet.co.ke", name: "Seramet Sales" },
  SECURITY: { email: "security@seramet.co.ke", name: "Seramet Security" },
  OPERATIONS: { email: "operations@seramet.co.ke", name: "Seramet Operations" },
  PARTNERS: { email: "partners@seramet.co.ke", name: "Seramet Partnerships" },
  LEGAL: { email: "legal@seramet.co.ke", name: "Seramet Legal" },
  PRIVACY: { email: "privacy@seramet.co.ke", name: "Seramet Privacy" },
  NOTIFICATIONS: { email: "notifications@seramet.co.ke", name: "Seramet Notifications" },
  REPORTS: { email: "reports@seramet.co.ke", name: "Seramet Reports" },
  AUTH: { email: "auth@seramet.co.ke", name: "Seramet Authentication" },
  ONBOARDING: { email: "onboarding@seramet.co.ke", name: "Seramet Onboarding" },
  UPDATES: { email: "updates@seramet.co.ke", name: "Seramet Updates" },
} as const;

export type SenderIdentity = keyof typeof EMAIL_SENDERS;

/**
 * What an email is about. Platform categories speak for Seramet. MERCHANT_DOCUMENT is a
 * restaurant's own invoice or receipt to its customer: it carries the restaurant's name and
 * is never presented as a Seramet subscription document.
 */
export const EMAIL_CATEGORIES = {
  DAILY_SUMMARY: { sender: "REPORTS", replyTo: "SUPPORT", transactional: true },
  CLOSING_REPORT: { sender: "REPORTS", replyTo: "SUPPORT", transactional: true },
  PERFORMANCE_REPORT: { sender: "REPORTS", replyTo: "SUPPORT", transactional: true },
  LOW_STOCK_ALERT: { sender: "NOTIFICATIONS", replyTo: "SUPPORT", transactional: true },
  OPERATIONAL_ALERT: { sender: "NOTIFICATIONS", replyTo: "OPERATIONS", transactional: true },
  SUBSCRIPTION_INVOICE: { sender: "BILLING", replyTo: "BILLING", transactional: true },
  SUBSCRIPTION_RENEWAL: { sender: "BILLING", replyTo: "BILLING", transactional: true },
  SUBSCRIPTION_PAYMENT: { sender: "BILLING", replyTo: "BILLING", transactional: true },
  PASSWORD_RESET: { sender: "AUTH", replyTo: "SUPPORT", transactional: true },
  EMAIL_VERIFICATION: { sender: "AUTH", replyTo: "SUPPORT", transactional: true },
  SECURITY_ALERT: { sender: "SECURITY", replyTo: "SECURITY", transactional: true },
  WELCOME: { sender: "ONBOARDING", replyTo: "SUPPORT", transactional: true },
  ONBOARDING_CONFIRMATION: { sender: "ONBOARDING", replyTo: "SUPPORT", transactional: true },
  SUPPORT_ACKNOWLEDGEMENT: { sender: "SUPPORT", replyTo: "SUPPORT", transactional: true },
  MAINTENANCE_NOTICE: { sender: "UPDATES", replyTo: "SUPPORT", transactional: true },
  // Product news is marketing: only for people who agreed to receive it, with an unsubscribe.
  PRODUCT_UPDATE: { sender: "UPDATES", replyTo: "SUPPORT", transactional: false },
  MERCHANT_DOCUMENT: { sender: "NOTIFICATIONS", replyTo: "SUPPORT", transactional: true },
} as const satisfies Record<
  string,
  { sender: SenderIdentity; replyTo: SenderIdentity; transactional: boolean }
>;

export type EmailCategory = keyof typeof EMAIL_CATEGORIES;

export const isEmailCategory = (value: unknown): value is EmailCategory =>
  typeof value === "string" && Object.hasOwn(EMAIL_CATEGORIES, value);

export type Mailbox = { email: string; name?: string };

const mailbox = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
// Display names reach a mail header: no line breaks, quotes or angle brackets.
const unsafeName = /[\r\n\0<>"\\]/;

export function isSafeMailbox(value: Mailbox | undefined): value is Mailbox {
  return (
    !!value &&
    typeof value.email === "string" &&
    value.email.length <= 254 &&
    mailbox.test(value.email) &&
    (value.name === undefined ||
      (typeof value.name === "string" && value.name.length <= 120 && !unsafeName.test(value.name)))
  );
}

type SenderEnv = Pick<SerametEnv, "SERAMET_EMAIL_ACTIVE_SENDERS" | "SERAMET_EMAIL_REPLY_ROUTES">;

function identityList(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim().toUpperCase())
      .filter((name): name is SenderIdentity => Object.hasOwn(EMAIL_SENDERS, name)),
  );
}

/** Identities an administrator has verified in Brevo and switched on. Unknown names are ignored. */
export const activeSenderIdentities = (env: SenderEnv) =>
  identityList(env.SERAMET_EMAIL_ACTIVE_SENDERS);

/**
 * Identities whose address has a working Cloudflare forwarding rule. A reply-to is only set to
 * one of these, so a reply never bounces off an address that does not forward yet.
 */
export const routedReplyIdentities = (env: SenderEnv) =>
  identityList(env.SERAMET_EMAIL_REPLY_ROUTES);

/** Where "need help?" lines point: support@ once it forwards, otherwise admin@. */
export function helpAddress(env: SenderEnv) {
  return routedReplyIdentities(env).has("SUPPORT")
    ? EMAIL_SENDERS.SUPPORT.email
    : EMAIL_SENDERS.ADMIN.email;
}

export type ResolvedSender = {
  sender: Mailbox;
  replyTo?: Mailbox;
  /** The departmental identity intended for this category. */
  identity: SenderIdentity;
  /** True when the platform's current sender stood in for an unverified identity. */
  fallback: boolean;
};

/**
 * Picks the From and Reply-To for an email category.
 *
 * `fallback` is the sender that already works today (from the protected Brevo configuration).
 * A merchant document uses the restaurant's name ("Kahawa House via Seramet") so the customer
 * sees who issued it, and replies go to the restaurant when it has a contact email.
 */
export function resolveSender(
  env: SenderEnv,
  category: EmailCategory,
  fallback: Mailbox,
  merchant?: { name?: string; replyTo?: string },
): ResolvedSender {
  const route = EMAIL_CATEGORIES[category];
  const active = activeSenderIdentities(env);
  const intended = EMAIL_SENDERS[route.sender];
  const usable = active.has(route.sender);
  const merchantName = merchant?.name
    ?.replace(/[\r\n\0<>"\\]/g, "")
    .trim()
    .slice(0, 80);
  const name =
    category === "MERCHANT_DOCUMENT" && merchantName
      ? `${merchantName} via Seramet`
      : usable
        ? intended.name
        : fallback.name;
  const sender: Mailbox = {
    email: usable ? intended.email : fallback.email,
    ...(name ? { name } : {}),
  };
  const merchantReply =
    category === "MERCHANT_DOCUMENT" && merchant?.replyTo
      ? { email: merchant.replyTo.trim(), ...(merchantName ? { name: merchantName } : {}) }
      : undefined;
  const departmental = EMAIL_SENDERS[route.replyTo];
  // Reply-to addresses are Cloudflare forwarding routes; they need no Brevo verification, but
  // they must forward. Without one, replies go to the From address, which already forwards.
  const replyTo = isSafeMailbox(merchantReply)
    ? merchantReply
    : departmental.email === sender.email || !routedReplyIdentities(env).has(route.replyTo)
      ? undefined
      : { email: departmental.email, name: departmental.name };
  if (!isSafeMailbox(sender)) throw new Error("EMAIL_SENDER_INVALID");
  return { sender, ...(replyTo ? { replyTo } : {}), identity: route.sender, fallback: !usable };
}
