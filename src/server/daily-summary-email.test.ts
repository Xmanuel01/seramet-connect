import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  createEmptyTransactionState,
  normalizeTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import {
  configureClosing,
  dueSummaryDate,
  lastEndedBusinessDate,
  summarizeBusinessDay,
} from "@/payments/daily-closing";
import type { ServerActor } from "@/lib/seramet-auth";
import { renderDailyClosingPdf } from "@/server/daily-closing-report";

let state: TransactionState;
vi.mock("@/server/database/authoritative-transaction-repository", () => ({
  D1AuthoritativeTransactionRepository: class {
    async loadState() {
      return state;
    }
  },
}));
import { deliverDailySummaryEmail, queueDailySummaryEmails } from "@/server/daily-summary-email";

let db: SqliteD1TestDatabase;
let recipientId: string;
const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const env = () => ({
  SERAMET_DB: db,
  SERAMET_TRANSACTIONAL_EMAIL_CONFIG: JSON.stringify({
    [tenantId]: { apiKey: "disposable-brevo-key-not-real", from: "Seramet <reports@example.com>" },
  }),
});

function withRecipients(ids: string[]) {
  const next = normalizeTransactionState(createEmptyTransactionState(tenantId));
  next.paymentOperations!.closingPolicies = [
    {
      id: branchId,
      tenantId,
      branchId,
      mode: "SUPERVISOR_DAILY_CLOSE",
      materialVarianceMinor: 50_000,
      recipientUserIds: ids,
      updatedBy: "owner",
      updatedAt: "2026-11-01T00:00:00.000Z",
    },
  ];
  return next;
}

beforeEach(() => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  db = createDemoFixtureDatabase();
  // A manager with an email, this branch and report access: who the server will send to.
  recipientId = "daily-summary-manager";
  const stamp = "2026-11-01T00:00:00.000Z";
  db.sqlite
    .prepare(
      "INSERT INTO users(tenant_id,id,name,email,employment_status,active,created_at,updated_at) VALUES(?,?,?,?,'ACTIVE',1,?,?)",
    )
    .run(tenantId, recipientId, "Report Manager", "manager@example.com", stamp, stamp);
  db.sqlite.prepare("INSERT INTO user_branches VALUES(?,?,?)").run(tenantId, recipientId, branchId);
  db.sqlite
    .prepare("INSERT INTO roles(tenant_id,id,code,name,active) VALUES(?,?,?,?,1)")
    .run(tenantId, "daily-summary-role", "DAILY_SUMMARY_READER", "Report reader");
  db.sqlite
    .prepare("INSERT INTO role_permissions(tenant_id,role_id,permission_code) VALUES(?,?,?)")
    .run(tenantId, "daily-summary-role", "reconciliation.view");
  db.sqlite
    .prepare("INSERT INTO user_roles(tenant_id,user_id,role_id) VALUES(?,?,?)")
    .run(tenantId, recipientId, "daily-summary-role");
  state = withRecipients([recipientId]);
});
afterEach(() => {
  db.close();
  setConfigurationRepositoryForTests();
  vi.unstubAllGlobals();
});

describe("automatic end-of-day summary", () => {
  it("reports an unclosed day as a summary, never as a signed-off close", async () => {
    const snapshot = summarizeBusinessDay(state, {
      tenantId,
      branchId,
      businessDate: "2026-11-08",
      recipientUserIds: [recipientId],
      preparedAt: "2026-11-09T01:07:00.000Z",
    });
    expect(snapshot.dailyReport).toMatchObject({ provisional: true, supervisorId: "system" });
    const pdf = await renderDailyClosingPdf(snapshot);
    expect((await PDFDocument.load(pdf)).getTitle()).toMatch(/^Daily Summary - /);
    // A retried send must render the same bytes, or the email layer refuses it.
    expect(await renderDailyClosingPdf(snapshot)).toEqual(pdf);
  });

  it("picks the business day that has just ended", () => {
    const date = lastEndedBusinessDate(tenantId, branchId, new Date("2026-11-09T12:00:00Z"));
    expect(date).toMatch(/^2026-11-0[78]$/);
  });

  it("queues one email per recipient per day, however often it runs", async () => {
    const now = new Date("2026-11-09T12:00:00Z");
    expect(await queueDailySummaryEmails(env(), tenantId, now)).toEqual({ queued: 1 });
    expect(await queueDailySummaryEmails(env(), tenantId, now)).toEqual({ queued: 0 });
    const job = db.sqlite
      .prepare("SELECT branch_id,payload_json,status FROM worker_jobs WHERE job_type=?")
      .get("DAILY_SUMMARY_EMAIL") as { branch_id: string; payload_json: string; status: string };
    expect(job.branch_id).toBe(branchId);
    expect(JSON.parse(job.payload_json)).toEqual({
      businessDate: lastEndedBusinessDate(tenantId, branchId, now),
      recipientUserId: recipientId,
    });
    // Nobody chosen: nothing queued.
    state = withRecipients([]);
    expect(
      await queueDailySummaryEmails(env(), tenantId, new Date("2026-11-10T12:00:00Z")),
    ).toEqual({ queued: 0 });
  });

  it("waits for the chosen send time", async () => {
    // Demo branch: Africa/Nairobi (UTC+3), business day ends at midnight.
    state.paymentOperations!.closingPolicies![0]!.summarySendMinutes = 23 * 60;
    const at22 = new Date("2026-11-10T19:00:00Z"); // 22:00 on 10 Nov in Nairobi
    const at2330 = new Date("2026-11-10T20:30:00Z"); // 23:30
    expect(dueSummaryDate(tenantId, branchId, 23 * 60, at22)).toBeNull();
    expect(dueSummaryDate(tenantId, branchId, 23 * 60, at2330)).toBe("2026-11-09");
    expect(await queueDailySummaryEmails(env(), tenantId, at22)).toEqual({ queued: 0 });
    expect(await queueDailySummaryEmails(env(), tenantId, at2330)).toEqual({ queued: 1 });
    // Without a chosen time it goes as soon as the day ends.
    expect(dueSummaryDate(tenantId, branchId, undefined, new Date("2026-11-09T21:05:00Z"))).toBe(
      "2026-11-09",
    );
  });

  it("only accepts a send time after the business day ends", () => {
    const cutoff = Number(
      createDefaultDemoPlatformState().branches.find((b) => b.id === branchId)!.metadata[
        "businessDayCutoffMinutes"
      ] ?? 0,
    );
    const actor = {
      id: "owner",
      tenantId,
      branchId,
      permissions: ["reconciliation.approve"],
      assignedBranchIds: [branchId],
      assignedBranches: [{ id: branchId, name: "Branch" }],
      branchScope: { type: "BRANCH", branchId },
    } as unknown as ServerActor;
    const input = {
      branchId,
      mode: "SUPERVISOR_DAILY_CLOSE" as const,
      materialVarianceMinor: 50_000,
      recipientUserIds: [],
    };
    expect(() => configureClosing(state, actor, { ...input, summarySendMinutes: 1_440 })).toThrow(
      /after the business day ends/,
    );
    if (cutoff > 0)
      expect(() =>
        configureClosing(state, actor, { ...input, summarySendMinutes: cutoff - 1 }),
      ).toThrow(/after the business day ends/);
    const saved = configureClosing(state, actor, { ...input, summarySendMinutes: 23 * 60 });
    expect(saved.paymentOperations!.closingPolicies![0]).toMatchObject({
      summarySendMinutes: 23 * 60,
    });
    // Saving without a time (the closing screen) keeps the chosen one.
    const kept = configureClosing(saved, actor, input);
    expect(kept.paymentOperations!.closingPolicies![0]!.summarySendMinutes).toBe(23 * 60);
  });

  async function runningJob() {
    await queueDailySummaryEmails(env(), tenantId, new Date("2026-11-09T12:00:00Z"));
    const job = db.sqlite
      .prepare("SELECT id,payload_json FROM worker_jobs WHERE job_type='DAILY_SUMMARY_EMAIL'")
      .get() as { id: string; payload_json: string };
    db.sqlite
      .prepare("UPDATE worker_jobs SET status='RUNNING',attempt_count=1 WHERE id=?")
      .run(job.id);
    return job;
  }

  it("emails the PDF summary through Brevo to the chosen person", async () => {
    const job = await runningJob();
    const fetch = vi.fn(async () => Response.json({ messageId: "<summary@example.com>" }));
    vi.stubGlobal("fetch", fetch);
    await deliverDailySummaryEmail(env(), tenantId, job.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual([{ email: "manager@example.com" }]);
    expect(body.subject).toMatch(/^Daily summary - \d{4}-\d{2}-\d{2} - /);
    expect(body.attachment[0].name).toMatch(/^daily-summary-\d{4}-\d{2}-\d{2}\.pdf$/);
    const saved = db.sqlite
      .prepare("SELECT result_json FROM worker_jobs WHERE id=?")
      .get(job.id) as {
      result_json: string;
    };
    expect(JSON.parse(saved.result_json)).toMatchObject({ acceptedByProvider: true });
  });

  it("sends nothing once the day is closed or the person is taken off the list", async () => {
    const job = await runningJob();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const businessDate = (JSON.parse(job.payload_json) as { businessDate: string }).businessDate;
    state.paymentOperations!.dayCloses = [
      {
        id: "day",
        tenantId,
        branchId,
        businessDate,
        status: "CLOSED",
        snapshots: [],
      } as unknown as NonNullable<TransactionState["paymentOperations"]>["dayCloses"][number],
    ];
    await deliverDailySummaryEmail(env(), tenantId, job.id);
    state = withRecipients([]);
    await deliverDailySummaryEmail(env(), tenantId, job.id);
    expect(fetch).not.toHaveBeenCalled();
  });
});
