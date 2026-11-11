import {
  formatBusinessDate,
  formatMoney,
  renderEmail,
  type EmailBlock,
  type RenderedEmail,
} from "@/server/email/layout";
import type { SerametEnv } from "@/lib/seramet-auth";
import { EMAIL_SENDERS, helpAddress, type EmailCategory } from "@/server/email/senders";

/**
 * Seramet's email templates. Each returns the category (which decides the sender), the
 * subject, and HTML plus plain text. Templates format what they are given; totals and
 * business rules stay with the code that owns them.
 *
 * Templates never include passwords, one-time codes or tokens other than the single action
 * link the email exists to deliver.
 */

export type TemplateContext = {
  /** The app's HTTPS origin, used for the logo. */
  publicOrigin?: string;
  /** Address that forwards today, for "need help" lines. */
  contactEmail: string;
};

export type BuiltEmail = RenderedEmail & { category: EmailCategory; subject: string };

/** Template context from the server environment. */
export function emailContext(
  env: Pick<
    SerametEnv,
    "SERAMET_PUBLIC_ORIGIN" | "SERAMET_EMAIL_ACTIVE_SENDERS" | "SERAMET_EMAIL_REPLY_ROUTES"
  >,
): TemplateContext {
  return {
    ...(env.SERAMET_PUBLIC_ORIGIN ? { publicOrigin: env.SERAMET_PUBLIC_ORIGIN } : {}),
    contactEmail: helpAddress(env),
  };
}

/** The headline facts of a daily report, read from the snapshot the PDF is rendered from. */
export function reportFactsFromSnapshot(
  snapshot: {
    businessDate: string;
    dailyReport?: {
      restaurant: string;
      branch: string;
      reference: string;
      outstandingInvoices: unknown[];
    };
  },
  recipientName?: string | null,
): ReportFacts {
  const report = snapshot.dailyReport!;
  return {
    businessName: report.restaurant,
    branchName: report.branch,
    businessDate: snapshot.businessDate,
    reference: report.reference,
    outstandingInvoices: report.outstandingInvoices.length,
    ...(recipientName ? { recipientName } : {}),
  };
}

const subjectSafe = (value: string) =>
  value
    .replace(/[\r\n\0]+/g, " ")
    .trim()
    .slice(0, 250);

function build(
  category: EmailCategory,
  subject: string,
  ctx: TemplateContext,
  heading: string,
  preheader: string,
  blocks: EmailBlock[],
  reason: string,
  senderName: string,
  unsubscribeUrl?: string,
): BuiltEmail {
  return {
    category,
    subject: subjectSafe(subject),
    ...renderEmail(
      {
        heading,
        preheader,
        blocks,
        reason,
        senderName,
        contactEmail: ctx.contactEmail,
        ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
      },
      ctx.publicOrigin,
    ),
  };
}

const greeting = (name?: string) => (name?.trim() ? `Hello ${name.trim()},` : "Hello,");

// ---------- Reports (reports@) ----------

export type ReportFacts = {
  businessName: string;
  branchName: string;
  businessDate: string;
  reference?: string;
  recipientName?: string;
  /** Optional headline figures already computed by the report owner, in minor units. */
  salesMinor?: number;
  paymentsMinor?: number;
  outstandingMinor?: number;
  outstandingInvoices?: number;
  currency?: string;
};

function reportRows(facts: ReportFacts): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Business", facts.businessName],
    ["Branch", facts.branchName],
    ["Business date", formatBusinessDate(facts.businessDate)],
  ];
  if (facts.reference) rows.push(["Report reference", facts.reference]);
  if (facts.salesMinor !== undefined)
    rows.push(["Sales", formatMoney(facts.salesMinor, facts.currency)]);
  if (facts.paymentsMinor !== undefined)
    rows.push(["Payments received", formatMoney(facts.paymentsMinor, facts.currency)]);
  if (facts.outstandingInvoices !== undefined)
    rows.push(["Unpaid invoices", String(facts.outstandingInvoices)]);
  if (facts.outstandingMinor !== undefined)
    rows.push(["Outstanding balance", formatMoney(facts.outstandingMinor, facts.currency)]);
  return rows;
}

const reportReason =
  "You receive this because you are on this branch's report list and can view its reconciliation.";

export function dailySummaryEmail(facts: ReportFacts, ctx: TemplateContext) {
  return build(
    "DAILY_SUMMARY",
    `Daily summary - ${facts.businessDate} - ${facts.branchName}`,
    ctx,
    `Daily summary for ${facts.branchName}`,
    `${facts.businessName} · ${formatBusinessDate(facts.businessDate)} · PDF attached`,
    [
      { kind: "paragraph", text: greeting(facts.recipientName) },
      {
        kind: "paragraph",
        text: `Here is the summary for ${facts.branchName} on ${formatBusinessDate(facts.businessDate)}: sales, payments and anything still open. The full report is attached as a PDF.`,
      },
      { kind: "facts", rows: reportRows(facts) },
      {
        kind: "note",
        text: "The day hasn't been closed in Seramet yet. Once it is, the official closing report follows.",
      },
    ],
    reportReason,
    EMAIL_SENDERS.REPORTS.name,
  );
}

export function closingReportEmail(facts: ReportFacts, ctx: TemplateContext) {
  return build(
    "CLOSING_REPORT",
    `Daily Closing Report - ${facts.businessDate} - ${facts.branchName}`,
    ctx,
    `Closing report for ${facts.branchName}`,
    `${facts.businessName} · ${formatBusinessDate(facts.businessDate)} closed · PDF attached`,
    [
      { kind: "paragraph", text: greeting(facts.recipientName) },
      {
        kind: "paragraph",
        text: `The business day has closed. The immutable closing report${facts.reference ? ` ${facts.reference}` : ""} is attached as a PDF.`,
      },
      { kind: "facts", rows: reportRows(facts) },
      {
        kind: "note",
        text: "Financial closure is recorded in Seramet independently of this email.",
      },
    ],
    reportReason,
    EMAIL_SENDERS.REPORTS.name,
  );
}

export function performanceReportEmail(
  facts: Omit<ReportFacts, "businessDate"> & {
    period: "WEEKLY" | "MONTHLY";
    periodStart: string;
    periodEnd: string;
  },
  ctx: TemplateContext,
) {
  const label = facts.period === "WEEKLY" ? "Weekly" : "Monthly";
  const range = `${formatBusinessDate(facts.periodStart)} – ${formatBusinessDate(facts.periodEnd)}`;
  return build(
    "PERFORMANCE_REPORT",
    `${label} performance - ${facts.periodStart} to ${facts.periodEnd} - ${facts.branchName}`,
    ctx,
    `${label} performance for ${facts.branchName}`,
    `${facts.businessName} · ${range}`,
    [
      { kind: "paragraph", text: greeting(facts.recipientName) },
      {
        kind: "paragraph",
        text: `Here is the ${label.toLowerCase()} performance of ${facts.branchName} for ${range}. The full report is attached as a PDF.`,
      },
      {
        kind: "facts",
        rows: [
          ["Period", range],
          ...reportRows({ ...facts, businessDate: facts.periodEnd }).filter(
            ([label]) => label !== "Business date",
          ),
        ],
      },
    ],
    reportReason,
    EMAIL_SENDERS.REPORTS.name,
  );
}

// ---------- Subscription billing (billing@) ----------
// These are Seramet's own subscription documents, never a restaurant's invoice to its guests.

export type SubscriptionFacts = {
  businessName: string;
  recipientName?: string;
  plan: string;
  invoiceNumber?: string;
  amountMinor: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  paidAt?: string;
  actionUrl?: string;
};

function subscriptionRows(f: SubscriptionFacts): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Business", f.businessName],
    ["Plan", f.plan],
  ];
  if (f.invoiceNumber) rows.push(["Seramet invoice", f.invoiceNumber]);
  if (f.periodStart && f.periodEnd)
    rows.push([
      "Service period",
      `${formatBusinessDate(f.periodStart)} – ${formatBusinessDate(f.periodEnd)}`,
    ]);
  rows.push(["Amount", formatMoney(f.amountMinor, f.currency)]);
  if (f.dueDate) rows.push(["Due date", formatBusinessDate(f.dueDate)]);
  if (f.paidAt) rows.push(["Paid on", formatBusinessDate(f.paidAt.slice(0, 10))]);
  return rows;
}

const billingReason = "You receive this because you manage this business's Seramet subscription.";

export function subscriptionInvoiceEmail(f: SubscriptionFacts, ctx: TemplateContext) {
  return build(
    "SUBSCRIPTION_INVOICE",
    `Seramet subscription invoice${f.invoiceNumber ? ` ${f.invoiceNumber}` : ""} - ${f.businessName}`,
    ctx,
    "Your Seramet subscription invoice",
    `${f.plan} · ${formatMoney(f.amountMinor, f.currency)}`,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: `This is Seramet's invoice for ${f.businessName}'s subscription. It is a charge from Seramet, not one of your restaurant's sales documents.`,
      },
      { kind: "facts", rows: subscriptionRows(f) },
      ...(f.actionUrl
        ? [{ kind: "action", label: "View and pay invoice", url: f.actionUrl } as const]
        : []),
    ],
    billingReason,
    EMAIL_SENDERS.BILLING.name,
  );
}

export function subscriptionPaymentEmail(f: SubscriptionFacts, ctx: TemplateContext) {
  return build(
    "SUBSCRIPTION_PAYMENT",
    `Payment received - Seramet subscription - ${f.businessName}`,
    ctx,
    "Thank you, your payment was received",
    `${formatMoney(f.amountMinor, f.currency)} for ${f.plan}`,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: `We received your payment for ${f.businessName}'s Seramet subscription.`,
      },
      { kind: "facts", rows: subscriptionRows(f) },
    ],
    billingReason,
    EMAIL_SENDERS.BILLING.name,
  );
}

export function subscriptionRenewalEmail(f: SubscriptionFacts, ctx: TemplateContext) {
  return build(
    "SUBSCRIPTION_RENEWAL",
    `Your Seramet subscription renews${f.dueDate ? ` on ${f.dueDate}` : " soon"} - ${f.businessName}`,
    ctx,
    "Your subscription renews soon",
    `${f.plan} · ${formatMoney(f.amountMinor, f.currency)}`,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: `${f.businessName}'s Seramet subscription is due for renewal. Renewing on time keeps your POS, reports and staff access running without interruption.`,
      },
      { kind: "facts", rows: subscriptionRows(f) },
      ...(f.actionUrl
        ? [{ kind: "action", label: "Review subscription", url: f.actionUrl } as const]
        : []),
    ],
    billingReason,
    EMAIL_SENDERS.BILLING.name,
  );
}

// ---------- Authentication (auth@) and security (security@) ----------

export function passwordResetEmail(
  f: { recipientName?: string; resetUrl: string; expiresInMinutes: number },
  ctx: TemplateContext,
) {
  return build(
    "PASSWORD_RESET",
    "Reset your Seramet password",
    ctx,
    "Reset your password",
    "Use this link to choose a new Seramet password.",
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: "Someone asked to reset the password for this Seramet account. If it was you, choose a new password below.",
      },
      { kind: "action", label: "Choose a new password", url: f.resetUrl },
      {
        kind: "note",
        text: `This link works once and expires in ${f.expiresInMinutes} minutes. If you didn't ask for it, ignore this email: your password stays the same.`,
      },
    ],
    "You receive this because a password reset was requested for your Seramet account.",
    EMAIL_SENDERS.AUTH.name,
  );
}

export function emailVerificationEmail(
  f: { recipientName?: string; verifyUrl: string; expiresInMinutes: number },
  ctx: TemplateContext,
) {
  return build(
    "EMAIL_VERIFICATION",
    "Confirm your email for Seramet",
    ctx,
    "Confirm your email address",
    "One step left to activate your Seramet account.",
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: "Confirm this email address to finish setting up your Seramet account.",
      },
      { kind: "action", label: "Confirm email", url: f.verifyUrl },
      {
        kind: "note",
        text: `This link works once and expires in ${f.expiresInMinutes} minutes. If you didn't create a Seramet account, ignore this email.`,
      },
    ],
    "You receive this because this address was used to register with Seramet.",
    EMAIL_SENDERS.AUTH.name,
  );
}

export function securityAlertEmail(
  f: {
    recipientName?: string;
    event: string;
    occurredAt: string;
    location?: string;
    device?: string;
    actionUrl?: string;
  },
  ctx: TemplateContext,
) {
  const rows: Array<[string, string]> = [
    ["What happened", f.event],
    ["When (UTC)", f.occurredAt.replace("T", " ").slice(0, 16)],
  ];
  if (f.location) rows.push(["Approximate location", f.location]);
  if (f.device) rows.push(["Device", f.device]);
  return build(
    "SECURITY_ALERT",
    `Security alert: ${f.event}`,
    ctx,
    "Security alert for your Seramet account",
    f.event,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: "We noticed the activity below on your Seramet account. If it was you, there is nothing to do.",
      },
      { kind: "facts", rows },
      {
        kind: "paragraph",
        text: "If it wasn't you, change your password now and tell your account owner.",
      },
      ...(f.actionUrl
        ? [{ kind: "action", label: "Secure my account", url: f.actionUrl } as const]
        : []),
    ],
    "You receive this because it concerns the security of your Seramet account.",
    EMAIL_SENDERS.SECURITY.name,
  );
}

// ---------- Onboarding (onboarding@) and support (support@) ----------

export function welcomeEmail(
  f: { recipientName?: string; businessName: string; loginUrl: string },
  ctx: TemplateContext,
) {
  return build(
    "WELCOME",
    `Welcome to Seramet, ${f.businessName}`,
    ctx,
    `Welcome to Seramet`,
    "Your account is ready.",
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: `Your Seramet account for ${f.businessName} is ready. Sign in to finish setting up your menu, staff and payment methods.`,
      },
      { kind: "action", label: "Sign in to Seramet", url: f.loginUrl },
    ],
    "You receive this because a Seramet account was created for you.",
    EMAIL_SENDERS.ONBOARDING.name,
  );
}

export function onboardingConfirmationEmail(
  f: {
    recipientName?: string;
    businessName: string;
    branches: number;
    goLiveDate?: string;
    dashboardUrl: string;
  },
  ctx: TemplateContext,
) {
  const rows: Array<[string, string]> = [
    ["Business", f.businessName],
    ["Branches", String(f.branches)],
  ];
  if (f.goLiveDate) rows.push(["Go-live date", formatBusinessDate(f.goLiveDate)]);
  return build(
    "ONBOARDING_CONFIRMATION",
    `${f.businessName} is set up on Seramet`,
    ctx,
    "Your business is set up",
    `${f.businessName} has completed Seramet setup.`,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: `${f.businessName} has completed setup on Seramet and is ready to trade.`,
      },
      { kind: "facts", rows },
      { kind: "action", label: "Open dashboard", url: f.dashboardUrl },
    ],
    "You receive this because you set up this business on Seramet.",
    EMAIL_SENDERS.ONBOARDING.name,
  );
}

export function supportAcknowledgementEmail(
  f: { recipientName?: string; ticketReference: string; summary: string },
  ctx: TemplateContext,
) {
  return build(
    "SUPPORT_ACKNOWLEDGEMENT",
    `We received your request [${f.ticketReference}]`,
    ctx,
    "We received your request",
    `Reference ${f.ticketReference}`,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: "Thanks for contacting Seramet Support. We have your request and will reply to this email thread.",
      },
      {
        kind: "facts",
        rows: [
          ["Reference", f.ticketReference],
          ["Summary", f.summary.slice(0, 200)],
        ],
      },
      {
        kind: "note",
        text: "Reply to this email to add details. Please never send passwords or card numbers.",
      },
    ],
    "You receive this because you contacted Seramet Support.",
    EMAIL_SENDERS.SUPPORT.name,
  );
}

// ---------- Updates (updates@) ----------

export function maintenanceNoticeEmail(
  f: {
    recipientName?: string;
    startsAt: string;
    endsAt: string;
    impact: string;
    statusUrl?: string;
  },
  ctx: TemplateContext,
) {
  return build(
    "MAINTENANCE_NOTICE",
    `Scheduled maintenance: ${f.startsAt.slice(0, 10)}`,
    ctx,
    "Scheduled maintenance",
    f.impact,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: "We have scheduled maintenance on Seramet. Here is what to expect.",
      },
      {
        kind: "facts",
        rows: [
          ["Starts (UTC)", f.startsAt.replace("T", " ").slice(0, 16)],
          ["Ends (UTC)", f.endsAt.replace("T", " ").slice(0, 16)],
          ["Impact", f.impact],
        ],
      },
      ...(f.statusUrl
        ? [{ kind: "action", label: "Service status", url: f.statusUrl } as const]
        : []),
    ],
    "You receive this service notice because your business uses Seramet.",
    EMAIL_SENDERS.UPDATES.name,
  );
}

/** Product news is marketing: send only with consent, and always with an unsubscribe link. */
export function productUpdateEmail(
  f: {
    recipientName?: string;
    title: string;
    highlights: string[];
    learnMoreUrl?: string;
    unsubscribeUrl: string;
  },
  ctx: TemplateContext,
) {
  return build(
    "PRODUCT_UPDATE",
    `What's new in Seramet: ${f.title}`,
    ctx,
    f.title,
    f.highlights[0] ?? f.title,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      ...f.highlights
        .slice(0, 8)
        .map((text) => ({ kind: "paragraph", text: `• ${text}` }) as const),
      ...(f.learnMoreUrl
        ? [{ kind: "action", label: "Learn more", url: f.learnMoreUrl } as const]
        : []),
    ],
    "You receive this because you chose to get Seramet product news.",
    EMAIL_SENDERS.UPDATES.name,
    f.unsubscribeUrl,
  );
}

// ---------- Restaurant documents (restaurant's identity, sent via notifications@) ----------

export function merchantDocumentEmail(
  f: {
    businessName: string;
    recipientName: string;
    documentType: "INVOICE" | "RECEIPT";
    documentNumber: string;
  },
  ctx: TemplateContext,
) {
  const kind = f.documentType === "INVOICE" ? "invoice" : "receipt";
  const title = f.documentType === "INVOICE" ? "Invoice" : "Receipt";
  return build(
    "MERCHANT_DOCUMENT",
    `${title} ${f.documentNumber} from ${f.businessName}`,
    ctx,
    `${title} from ${f.businessName}`,
    `Your ${kind} ${f.documentNumber} is attached as a PDF.`,
    [
      { kind: "paragraph", text: greeting(f.recipientName) },
      {
        kind: "paragraph",
        text: `Your ${kind} ${f.documentNumber} from ${f.businessName} is attached as a PDF.`,
      },
      { kind: "paragraph", text: "Thank you." },
      {
        kind: "note",
        text: `This ${kind} was issued by ${f.businessName}. Seramet delivers it on their behalf; questions about it go to ${f.businessName}.`,
      },
    ],
    `You receive this because ${f.businessName} sent you this ${kind}.`,
    f.businessName,
  );
}

/**
 * Branded HTML for Supabase Auth's own emails, which Supabase sends through Brevo SMTP.
 * The {{ .ConfirmationURL }} placeholders are filled in by Supabase. Paste into
 * Authentication > Emails > Templates; see docs/EMAIL_INFRASTRUCTURE.md.
 */
export function supabaseAuthTemplates(ctx: TemplateContext) {
  const url = "{{ .ConfirmationURL }}";
  return {
    confirmSignup: emailVerificationEmail({ verifyUrl: url, expiresInMinutes: 60 }, ctx),
    resetPassword: passwordResetEmail({ resetUrl: url, expiresInMinutes: 60 }, ctx),
    invite: build(
      "WELCOME",
      "You've been invited to Seramet",
      ctx,
      "You've been invited to Seramet",
      "Accept your invitation to join your team on Seramet.",
      [
        { kind: "paragraph", text: "Hello," },
        {
          kind: "paragraph",
          text: "Your team has invited you to Seramet. Accept the invitation to set your password and sign in.",
        },
        { kind: "action", label: "Accept invitation", url },
        { kind: "note", text: "If you weren't expecting this invitation, ignore this email." },
      ],
      "You receive this because your employer invited you to Seramet.",
      EMAIL_SENDERS.ONBOARDING.name,
    ),
    magicLink: build(
      "EMAIL_VERIFICATION",
      "Your Seramet sign-in link",
      ctx,
      "Sign in to Seramet",
      "Use this link to sign in.",
      [
        { kind: "paragraph", text: "Hello," },
        { kind: "paragraph", text: "Use the button below to sign in to Seramet." },
        { kind: "action", label: "Sign in", url },
        {
          kind: "note",
          text: "This link works once and expires shortly. If you didn't ask for it, ignore this email.",
        },
      ],
      "You receive this because a sign-in link was requested for your Seramet account.",
      EMAIL_SENDERS.AUTH.name,
    ),
  };
}
