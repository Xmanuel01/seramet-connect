import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import {
  deliverPdfEmail,
  pdfDigest,
  transactionalEmailConfiguration,
  type PdfEmail,
} from "./transactional-email";
import { renderCustomerDocumentPdf } from "./customer-document-pdf";
import { documentEmailStatus } from "./document-email-api";

let db: SqliteD1TestDatabase;
let pdf: Uint8Array;
let message: PdfEmail;
const config = {
  SERAMET_TRANSACTIONAL_EMAIL_CONFIG: JSON.stringify({
    tenant: { apiKey: "disposable-api-key-not-real", from: "Seramet <receipts@example.com>" },
  }),
};
beforeEach(async () => {
  db = new SqliteD1TestDatabase();
  await db.exec(
    "CREATE TABLE worker_jobs(tenant_id TEXT,id TEXT,status TEXT,result_json TEXT,attempt_count INTEGER,max_attempts INTEGER); INSERT INTO worker_jobs VALUES('tenant','job','RUNNING','{}',1,8)",
  );
  pdf = await renderCustomerDocumentPdf(
    "TAX INVOICE\nRice 200.00\nTOTAL 200.00",
    "2026-10-20T10:00:00Z",
  );
  message = {
    to: { email: "customer@example.com", name: "Amina" },
    subject: "Invoice INV-27",
    text: "Your invoice is attached.",
    filename: "invoice-INV-27.pdf",
    sha256: await pdfDigest(pdf),
  };
});
afterEach(() => db.close());
const env = () => ({ SERAMET_DB: db, ...config });
const accepted = () =>
  new Response(JSON.stringify({ messageId: "<accepted@brevo.test>" }), { status: 201 });
describe("Brevo PDF delivery safety", () => {
  it("sends an actual PDF with the entered recipient and records provider acceptance exactly once", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    await deliverPdfEmail(env(), "tenant", "job", message, pdf, send);
    await deliverPdfEmail(env(), "tenant", "job", message, pdf, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe("https://api.brevo.com/v3/smtp/email");
    const init = send.mock.calls[0]![1]!;
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ "api-key": "disposable-api-key-not-real" });
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual([message.to]);
    expect(body.attachment[0].name).toBe(message.filename);
    const attachment = Uint8Array.from(atob(body.attachment[0].content), (c) => c.charCodeAt(0));
    expect(attachment).toEqual(pdf);
    expect((await PDFDocument.load(attachment)).getPageCount()).toBe(1);
    const row = await db
      .prepare("SELECT result_json FROM worker_jobs")
      .first<{ result_json: string }>();
    expect(JSON.parse(row!.result_json)).toMatchObject({
      acceptedByProvider: true,
      email: { provider: "BREVO", outcome: "ACCEPTED" },
    });
  });
  it("has one sending winner under concurrent direct calls", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    const attempts = await Promise.allSettled([
      deliverPdfEmail(env(), "tenant", "job", message, pdf, send),
      deliverPdfEmail(env(), "tenant", "job", message, pdf, send),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retries a confirmed 429 with identical PDF bytes", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(accepted());
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toMatchObject(
      { message: "TRANSACTIONAL_EMAIL_RATE_LIMITED", retryable: true },
    );
    await deliverPdfEmail(env(), "tenant", "job", message, pdf, send);
    expect(send.mock.calls[0]![1]!.body).toBe(send.mock.calls[1]![1]!.body);
  });
  it.each([401, 408, 409, 500, 503])(
    "never automatically repeats provider HTTP %s",
    async (status) => {
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private credentials and diagnostics", { status }));
      await expect(
        deliverPdfEmail(env(), "tenant", "job", message, pdf, send),
      ).rejects.toMatchObject({ retryable: false });
      await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toThrow(
        "RECONCILIATION_REQUIRED",
      );
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it("retains a crash/timeout marker and never leaks transport messages", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret=private-password"));
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toThrow(
      "TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED",
    );
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toThrow(
      "RECONCILIATION_REQUIRED",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(await db.prepare("SELECT result_json FROM worker_jobs").first()),
    ).not.toContain("private-password");
  });
  it("rejects tampered PDF bytes, attempts beyond the cap, and foreign tenants before sending", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(
      deliverPdfEmail(env(), "tenant", "job", { ...message, sha256: "wrong" }, pdf, send),
    ).rejects.toThrow("DOCUMENT_INVALID");
    await expect(deliverPdfEmail(env(), "other", "job", message, pdf, send)).rejects.toThrow(
      "AUTHORIZED_JOB_REQUIRED",
    );
    await db.prepare("UPDATE worker_jobs SET attempt_count=9").run();
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toThrow(
      "AUTHORIZED_JOB_REQUIRED",
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("fails closed on missing tenant configuration without reusing legacy credentials", () => {
    expect(() =>
      transactionalEmailConfiguration(
        {
          SERAMET_CLOSING_EMAIL_API_KEY: "old-resend-key",
          SERAMET_CLOSING_EMAIL_FROM: "old@example.com",
        },
        "tenant",
      ),
    ).toThrow("CONFIGURATION_REQUIRED");
    expect(() => transactionalEmailConfiguration(config, "other")).toThrow(
      "CONFIGURATION_REQUIRED",
    );
  });
  it("rejects changed recipients after a rate-limit rejection", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
    await expect(deliverPdfEmail(env(), "tenant", "job", message, pdf, send)).rejects.toThrow(
      "RATE_LIMITED",
    );
    await expect(
      deliverPdfEmail(
        env(),
        "tenant",
        "job",
        { ...message, to: { email: "other@example.com" } },
        pdf,
        send,
      ),
    ).rejects.toThrow("PREPARED_MESSAGE_CHANGED");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("distinguishes active sending, uncertainty, acceptance and queueing", () => {
    expect(
      documentEmailStatus({
        status: "RUNNING",
        result_json: JSON.stringify({ email: { outcome: "IN_FLIGHT" } }),
      }),
    ).toBe("QUEUED");
    expect(
      documentEmailStatus({
        status: "DEAD_LETTER",
        result_json: JSON.stringify({ email: { outcome: "IN_FLIGHT" } }),
      }),
    ).toBe("RECONCILIATION_REQUIRED");
    expect(
      documentEmailStatus({
        status: "SUCCEEDED",
        result_json: JSON.stringify({ acceptedByProvider: true }),
      }),
    ).toBe("PROVIDER_ACCEPTED");
  });
  it("paginates long invoices deterministically without dropping totals", async () => {
    const content = `${"Long item description 123.45\n".repeat(180)}TOTAL 22221.00`;
    const first = await renderCustomerDocumentPdf(content, "2026-10-20T10:00:00Z");
    const second = await renderCustomerDocumentPdf(content, "2026-10-20T10:00:00Z");
    expect(first).toEqual(second);
    expect((await PDFDocument.load(first)).getPageCount()).toBeGreaterThan(2);
  });
});
