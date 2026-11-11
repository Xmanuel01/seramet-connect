import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { renderCustomerDocumentPdf } from "@/server/customer-document-pdf";
import { deliverPdfEmail, pdfDigest, type PdfEmail } from "@/server/transactional-email";
import { applyProviderEvent, pruneEmailDeliveryLog } from "@/server/email/delivery-log";
import { handleEmailApi, isPlatformEmailAdmin } from "@/server/email/email-api";
import {
  EMAIL_CATEGORIES,
  EMAIL_SENDERS,
  helpAddress,
  resolveSender,
} from "@/server/email/senders";
import * as templates from "@/server/email/templates";
import { permissions } from "@/platform/permissions";
import { accountOwnerPermissions } from "@/platform/standard-roles";
import type { ServerActor } from "@/lib/seramet-auth";

const fallback = { email: "admin@seramet.co.ke", name: "Seramet POS" };
const ctx = { publicOrigin: "https://pos.seramet.co.ke", contactEmail: "admin@seramet.co.ke" };

describe("departmental senders", () => {
  it("keeps the current working sender until an identity is switched on", () => {
    expect(resolveSender({}, "DAILY_SUMMARY", fallback)).toEqual({
      sender: fallback,
      identity: "REPORTS",
      fallback: true,
    });
  });

  it("uses the verified departmental identity once it is active", () => {
    const env = { SERAMET_EMAIL_ACTIVE_SENDERS: "reports, billing ,NOT_A_SENDER" };
    expect(resolveSender(env, "CLOSING_REPORT", fallback).sender).toEqual(EMAIL_SENDERS.REPORTS);
    expect(resolveSender(env, "SUBSCRIPTION_INVOICE", fallback).sender).toEqual(
      EMAIL_SENDERS.BILLING,
    );
    expect(resolveSender(env, "PASSWORD_RESET", fallback).sender).toEqual(fallback);
  });

  it("only sets a reply-to whose forwarding route is live", () => {
    expect(resolveSender({}, "DAILY_SUMMARY", fallback).replyTo).toBeUndefined();
    const routed = resolveSender(
      { SERAMET_EMAIL_REPLY_ROUTES: "SUPPORT" },
      "DAILY_SUMMARY",
      fallback,
    );
    expect(routed.replyTo).toEqual(EMAIL_SENDERS.SUPPORT);
    expect(helpAddress({ SERAMET_EMAIL_REPLY_ROUTES: "SUPPORT" })).toBe("support@seramet.co.ke");
    expect(helpAddress({})).toBe("admin@seramet.co.ke");
  });

  it("presents a restaurant's documents under its own name, replies to the restaurant", () => {
    const route = resolveSender(
      { SERAMET_EMAIL_ACTIVE_SENDERS: "NOTIFICATIONS" },
      "MERCHANT_DOCUMENT",
      fallback,
      { name: 'Kahawa "House"\r\nBcc: x@evil.test', replyTo: "hello@kahawa.example" },
    );
    expect(route.sender.email).toBe("notifications@seramet.co.ke");
    expect(route.sender.name).toBe("Kahawa HouseBcc: x@evil.test via Seramet");
    expect(route.sender.name).not.toMatch(/[\r\n"<>]/);
    expect(route.replyTo?.email).toBe("hello@kahawa.example");
  });

  it("maps every category to a seramet.co.ke identity", () => {
    for (const route of Object.values(EMAIL_CATEGORIES))
      expect(EMAIL_SENDERS[route.sender].email).toMatch(/@seramet\.co\.ke$/);
    expect(EMAIL_CATEGORIES.PRODUCT_UPDATE.transactional).toBe(false);
  });
});

describe("email templates", () => {
  const report = {
    businessName: "Kahawa <House>",
    branchName: "Westlands",
    businessDate: "2026-11-10",
    reference: "DC-1",
    outstandingInvoices: 2,
    salesMinor: 1_234_500,
  };
  const subscription = {
    businessName: "Kahawa House",
    plan: "Growth",
    amountMinor: 450_000,
    invoiceNumber: "SER-1",
    dueDate: "2026-12-01",
    actionUrl: "https://pos.seramet.co.ke/billing",
  };
  const all = [
    templates.dailySummaryEmail(report, ctx),
    templates.closingReportEmail(report, ctx),
    templates.performanceReportEmail(
      { ...report, period: "WEEKLY", periodStart: "2026-11-03", periodEnd: "2026-11-09" },
      ctx,
    ),
    templates.performanceReportEmail(
      { ...report, period: "MONTHLY", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      ctx,
    ),
    templates.subscriptionInvoiceEmail(subscription, ctx),
    templates.subscriptionPaymentEmail({ ...subscription, paidAt: "2026-11-11T08:00:00Z" }, ctx),
    templates.subscriptionRenewalEmail(subscription, ctx),
    templates.passwordResetEmail(
      { resetUrl: "https://pos.seramet.co.ke/reset?t=abc", expiresInMinutes: 60 },
      ctx,
    ),
    templates.emailVerificationEmail(
      { verifyUrl: "https://pos.seramet.co.ke/verify?t=abc", expiresInMinutes: 60 },
      ctx,
    ),
    templates.securityAlertEmail(
      { event: "New sign-in", occurredAt: "2026-11-11T08:00:00Z", device: "Chrome on Windows" },
      ctx,
    ),
    templates.welcomeEmail(
      { businessName: "Kahawa House", loginUrl: "https://pos.seramet.co.ke/login" },
      ctx,
    ),
    templates.onboardingConfirmationEmail(
      { businessName: "Kahawa House", branches: 2, dashboardUrl: "https://pos.seramet.co.ke/" },
      ctx,
    ),
    templates.supportAcknowledgementEmail(
      { ticketReference: "SUP-9", summary: "Printer offline" },
      ctx,
    ),
    templates.maintenanceNoticeEmail(
      {
        startsAt: "2026-11-15T00:00:00Z",
        endsAt: "2026-11-15T01:00:00Z",
        impact: "POS read-only for 60 minutes",
      },
      ctx,
    ),
    templates.productUpdateEmail(
      {
        title: "Split payments",
        highlights: ["Split a bill across M-Pesa and cash"],
        unsubscribeUrl: "https://pos.seramet.co.ke/unsubscribe?t=x",
      },
      ctx,
    ),
    templates.merchantDocumentEmail(
      {
        businessName: "Kahawa House",
        recipientName: "Amina",
        documentType: "INVOICE",
        documentNumber: "INV-27",
      },
      ctx,
    ),
  ];

  it("renders all templates as escaped, branded HTML with a plain-text twin", () => {
    expect(all).toHaveLength(16);
    for (const email of all) {
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.html).toContain(
        '<img src="https://pos.seramet.co.ke/brand/seramet-mark-light.png"',
      );
      expect(email.html).not.toMatch(/<script|data:image|Kahawa <House>/);
      expect(email.text.length).toBeGreaterThan(40);
      expect(email.text).not.toMatch(/<(p|table|td|a|div|img)\b/i);
    }
    expect(all[0]!.html).toContain("Kahawa &lt;House&gt;");
    expect(all[0]!.text).toContain("Sales: ");
  });

  it("distinguishes Seramet's subscription invoice from a restaurant's own document", () => {
    expect(all[4]!.category).toBe("SUBSCRIPTION_INVOICE");
    expect(all[4]!.text).toContain("not one of your restaurant's sales documents");
    const merchant = all[15]!;
    expect(merchant.category).toBe("MERCHANT_DOCUMENT");
    expect(merchant.subject).toBe("Invoice INV-27 from Kahawa House");
    expect(merchant.text).toContain("issued by Kahawa House");
    expect(merchant.text).not.toMatch(/subscription/i);
  });

  it("puts the action link in both versions and an unsubscribe only on marketing", () => {
    expect(all[7]!.text).toContain("https://pos.seramet.co.ke/reset?t=abc");
    expect(all[7]!.html).toContain("https://pos.seramet.co.ke/reset?t=abc");
    expect(all[14]!.html).toContain("Unsubscribe");
    expect(all.filter((e) => e.html.includes("Unsubscribe"))).toHaveLength(1);
  });

  it("refuses non-HTTPS links and leaves the logo out without an HTTPS origin", () => {
    expect(() =>
      templates.passwordResetEmail({ resetUrl: "javascript:alert(1)", expiresInMinutes: 5 }, ctx),
    ).toThrow();
    const local = templates.dailySummaryEmail(report, {
      publicOrigin: "http://localhost:5173",
      contactEmail: "admin@seramet.co.ke",
    });
    expect(local.html).not.toContain("<img");
  });

  it("produces Supabase Auth templates with Supabase's own link placeholder", () => {
    const auth = templates.supabaseAuthTemplates(ctx);
    for (const email of Object.values(auth)) expect(email.html).toContain("{{ .ConfirmationURL }}");
  });
});

describe("categorised Brevo delivery", () => {
  let db: SqliteD1TestDatabase;
  let pdf: Uint8Array;
  let message: PdfEmail;
  const accepted = (id = "<accepted@brevo.test>") =>
    new Response(JSON.stringify({ messageId: id }), { status: 201 });
  const migration = readFileSync(
    resolve(process.cwd(), "migrations/0035_email_delivery_log.sql"),
    "utf8",
  ).split("-- Platform-wide email records")[0]!;
  const env = (extra: Record<string, string> = {}) => ({
    SERAMET_DB: db,
    SERAMET_TRANSACTIONAL_EMAIL_CONFIG: JSON.stringify({
      apiKey: "disposable-api-key-not-real",
      from: "Seramet POS <admin@seramet.co.ke>",
    }),
    ...extra,
  });
  beforeEach(async () => {
    db = new SqliteD1TestDatabase();
    await db.exec(
      "CREATE TABLE worker_jobs(tenant_id TEXT,id TEXT,status TEXT,result_json TEXT,attempt_count INTEGER,max_attempts INTEGER); INSERT INTO worker_jobs VALUES('tenant','job','RUNNING','{}',1,8)",
    );
    await db.exec(migration);
    pdf = await renderCustomerDocumentPdf("DAILY SUMMARY\nTOTAL 200.00", "2026-11-10T21:00:00Z");
    const email = templates.dailySummaryEmail(
      { businessName: "Kahawa", branchName: "Westlands", businessDate: "2026-11-10" },
      ctx,
    );
    message = {
      to: { email: "Owner@Example.com" },
      subject: email.subject,
      text: email.text,
      html: email.html,
      category: email.category,
      filename: "daily-summary-2026-11-10.pdf",
      sha256: await pdfDigest(pdf),
    };
  });
  afterEach(() => db.close());

  it("sends HTML, text and PDF from the active departmental sender and logs acceptance", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    await deliverPdfEmail(
      env({ SERAMET_EMAIL_ACTIVE_SENDERS: "REPORTS", SERAMET_EMAIL_REPLY_ROUTES: "SUPPORT" }),
      "tenant",
      "job",
      message,
      pdf,
      send,
    );
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.sender).toEqual(EMAIL_SENDERS.REPORTS);
    expect(body.replyTo).toEqual(EMAIL_SENDERS.SUPPORT);
    expect(body.htmlContent).toBe(message.html);
    expect(body.textContent).toBe(message.text);
    expect(body.attachment).toHaveLength(1);
    expect(body.tags).toEqual(["seramet-transactional", "category-daily_summary"]);
    const evidence = JSON.parse(
      (await db.prepare("SELECT result_json FROM worker_jobs").first<{ result_json: string }>())!
        .result_json,
    );
    expect(evidence.email.html).toBeUndefined();
    expect(evidence.email.htmlSha256).toMatch(/^[a-f0-9]{64}$/);
    const log = await db
      .prepare("SELECT * FROM email_delivery_log")
      .first<Record<string, unknown>>();
    expect(log).toMatchObject({
      category: "DAILY_SUMMARY",
      sender_identity: "REPORTS",
      sender_email: "reports@seramet.co.ke",
      recipient_email: "owner@example.com",
      status: "ACCEPTED",
      provider_message_id: "<accepted@brevo.test>",
    });
  });

  it("falls back to the configured sender while REPORTS is unverified", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    await deliverPdfEmail(env(), "tenant", "job", message, pdf, send);
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.sender).toEqual({ email: "admin@seramet.co.ke", name: "Seramet POS" });
    expect(body.replyTo).toBeUndefined();
  });

  it("retries with the sender first prepared, even after the active list changes", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(accepted());
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toThrow(
      "TRANSACTIONAL_EMAIL_RATE_LIMITED",
    );
    await deliverPdfEmail(
      env({ SERAMET_EMAIL_ACTIVE_SENDERS: "REPORTS" }),
      "tenant",
      "job",
      message,
      pdf,
      send,
    );
    const second = JSON.parse(send.mock.calls[1]![1]!.body as string);
    expect(second.sender.email).toBe("admin@seramet.co.ke");
  });

  it("treats an exhausted Brevo quota (402) as retryable, not as a permanent rejection", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 402 }));
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toMatchObject(
      { message: "TRANSACTIONAL_EMAIL_RATE_LIMITED", retryable: true },
    );
    const log = await db.prepare("SELECT status,failure_reason FROM email_delivery_log").first();
    expect(log).toEqual({
      status: "RATE_LIMITED",
      failure_reason: "Brevo sending quota exhausted",
    });
  });

  it("finishes a job prepared before categories existed exactly as it was prepared", async () => {
    const legacy = {
      email: {
        to: message.to,
        subject: "Daily summary - 2026-11-10 - Westlands",
        text: "Old plain text",
        filename: message.filename,
        sha256: message.sha256,
        provider: "BREVO",
        sender: { email: "admin@seramet.co.ke", name: "Seramet POS" },
        outcome: "RATE_LIMITED",
      },
    };
    await db.prepare("UPDATE worker_jobs SET result_json=?").bind(JSON.stringify(legacy)).run();
    const send = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    await deliverPdfEmail(
      env({ SERAMET_EMAIL_ACTIVE_SENDERS: "REPORTS" }),
      "tenant",
      "job",
      message,
      pdf,
      send,
    );
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.textContent).toBe("Old plain text");
    expect(body.htmlContent).toBeUndefined();
    expect(body.sender.email).toBe("admin@seramet.co.ke");
  });

  it("rejects an unknown category instead of guessing a sender", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(
      deliverPdfEmail(
        env(),
        "tenant",
        "job",
        { ...message, category: "ANYTHING" as never },
        pdf,
        send,
      ),
    ).rejects.toThrow("TRANSACTIONAL_EMAIL_DOCUMENT_INVALID");
    expect(send).not.toHaveBeenCalled();
  });

  it("applies Brevo events without downgrading a final outcome, and prunes old rows", async () => {
    await deliverPdfEmail(
      env(),
      "tenant",
      "job",
      message,
      pdf,
      vi.fn().mockResolvedValue(accepted()),
    );
    const at = "2026-11-11T08:00:00.000Z";
    const id = "<accepted@brevo.test>";
    expect(
      await applyProviderEvent(db, { providerMessageId: id, status: "DELIVERED", occurredAt: at }),
    ).toBe(true);
    await applyProviderEvent(db, { providerMessageId: id, status: "DEFERRED", occurredAt: at });
    expect(
      await db.prepare("SELECT status,delivered_at,last_event FROM email_delivery_log").first(),
    ).toEqual({ status: "DELIVERED", delivered_at: at, last_event: "DEFERRED" });
    expect(
      await applyProviderEvent(db, {
        providerMessageId: "<other@x>",
        status: "BOUNCED",
        occurredAt: at,
      }),
    ).toBe(false);
    expect(await pruneEmailDeliveryLog(db, new Date("2027-12-31T00:00:00Z"))).toBe(1);
  });

  describe("webhook and platform access", () => {
    const token = "t".repeat(40);
    const hook = (auth: string | null, payload: unknown) =>
      handleEmailApi(
        new Request("https://pos.seramet.co.ke/api/seramet/email/brevo-webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(auth ? { authorization: auth } : {}),
          },
          body: JSON.stringify(payload),
        }),
        env({ SERAMET_BREVO_WEBHOOK_TOKEN: token }) as never,
      );
    beforeEach(async () => {
      await db.exec(
        "CREATE TABLE rate_limit_buckets(scope_key TEXT, bucket TEXT, window_started_at TEXT, count INTEGER, expires_at TEXT, PRIMARY KEY(scope_key,bucket,window_started_at))",
      );
      await deliverPdfEmail(
        env(),
        "tenant",
        "job",
        message,
        pdf,
        vi.fn().mockResolvedValue(accepted()),
      );
    });

    it("rejects webhooks without the bearer token", async () => {
      await expect(hook(null, {})).rejects.toMatchObject({ status: 401 });
      await expect(hook("Bearer wrong", {})).rejects.toMatchObject({ status: 401 });
    });

    it("records a hard bounce reported by Brevo", async () => {
      const response = await hook(`Bearer ${token}`, {
        event: "hard_bounce",
        "message-id": "<accepted@brevo.test>",
        ts_event: 1_794_384_000,
        reason: "Mailbox does not exist",
        email: "owner@example.com",
      });
      expect(await response!.json()).toEqual({ ok: true, applied: 1 });
      expect(
        await db.prepare("SELECT status,failure_reason FROM email_delivery_log").first(),
      ).toEqual({ status: "BOUNCED", failure_reason: "Mailbox does not exist" });
    });

    it("needs both the platform allowlist and the permission; owners never get it", () => {
      const actor = {
        id: "u1",
        tenantId: "seramet",
        permissions: [permissions.platformEmailView],
      } as unknown as ServerActor;
      expect(isPlatformEmailAdmin({}, actor)).toBe(false);
      expect(isPlatformEmailAdmin({ SERAMET_PLATFORM_ADMINS: "seramet:u1" }, actor)).toBe(true);
      expect(
        isPlatformEmailAdmin({ SERAMET_PLATFORM_ADMINS: "seramet:u1" }, {
          ...actor,
          permissions: [],
        } as ServerActor),
      ).toBe(false);
      expect(accountOwnerPermissions).not.toContain(permissions.platformEmailView);
    });
  });
});
