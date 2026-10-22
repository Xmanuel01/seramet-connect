import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { authenticateSerametRequest, type ServerActor } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { handleDocumentEmailApi, deliverCustomerDocumentEmail } from "./document-email-api";
import { handleWorkerQueue, scheduleDurableWork } from "@/server/workers";

vi.mock("@/lib/seramet-auth", async (original) => ({
  ...(await original<object>()),
  authenticateSerametRequest: vi.fn(),
}));
const tenant = DEMO_TENANT_ID,
  branch = DEMO_WESTLANDS_BRANCH_ID;
const actor: ServerActor = {
  id: "email-operator",
  name: "Cashier",
  tenantId: tenant,
  branchId: branch,
  branch: "Westlands",
  assignedBranchIds: [branch],
  assignedBranches: [{ id: branch, name: "Westlands" }],
  roleIds: [],
  permissions: [...allPermissionCodes],
  role: "Cashier",
  branchScope: { type: "BRANCH", branchId: branch },
};
let db: SqliteD1TestDatabase, state: TransactionState;
let repo: TransactionRepository;
const config = {
  SERAMET_TRANSACTIONAL_EMAIL_CONFIG: JSON.stringify({
    [tenant]: { apiKey: "disposable-brevo-api-key", from: "Seramet <invoices@example.com>" },
  }),
};
beforeEach(async () => {
  db = createMigratedTestDatabase();
  const stamp = "2026-10-20T10:00:00.000Z";
  await db
    .prepare(
      "INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,'Disposable','Disposable','KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .bind(tenant, tenant, stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO branches(tenant_id,id,code,name,timezone,active,payload_json) VALUES (?,?,?,'Westlands','Africa/Nairobi',1,'{}')",
    )
    .bind(tenant, branch, branch)
    .run();
  await db
    .prepare(
      "INSERT INTO users(tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,'operator@example.com','Cashier',1,1,'{}',?,?)",
    )
    .bind(tenant, actor.id, stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO roles(tenant_id,id,code,name,active,payload_json) VALUES (?,'email-role','EMAIL','Email',1,'{}')",
    )
    .bind(tenant)
    .run();
  await db.prepare("INSERT INTO user_roles VALUES (?,?,'email-role')").bind(tenant, actor.id).run();
  await db.prepare("INSERT INTO user_branches VALUES (?,?,?)").bind(tenant, actor.id, branch).run();
  for (const permission of [permissions.invoicesView, permissions.receiptsView]) {
    await db
      .prepare("INSERT INTO permissions(code,description) VALUES (?,?) ON CONFLICT DO NOTHING")
      .bind(permission, permission)
      .run();
    await db
      .prepare("INSERT INTO role_permissions VALUES (?,'email-role',?)")
      .bind(tenant, permission)
      .run();
  }
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  vi.mocked(authenticateSerametRequest).mockResolvedValue(actor);
  state = createEmptyTransactionState(tenant);
  state.bills.push({
    id: "INV-27",
    tenantId: tenant,
    branchId: branch,
    branch: "Westlands",
    orderIds: [],
    customer: "Amina",
    status: "PAID",
    paymentStatus: "PAID",
    issuedAt: stamp,
    dueAt: stamp,
    lines: [
      {
        id: "line",
        productId: "rice",
        name: "Rice",
        category: "MAIN_MEALS",
        quantity: 1,
        unitPrice: 200,
        productionStation: "MAIN",
      },
    ],
    subtotal: 200,
    tax: 0,
    total: 200,
    paid: 200,
  });
  state.receipts.push({
    id: "RC-27",
    tenantId: tenant,
    branchId: branch,
    branch: "Westlands",
    invoiceId: "INV-27",
    orderId: "ORD-27",
    cashier: "Cashier",
    customer: "Amina",
    issuedAt: stamp,
    total: 200,
    paidAmount: 200,
    change: 0,
    paymentBreakdown: [{ method: "CASH", amount: 200, reference: "PAY-27" }],
    reprints: [],
  });
  repo = {
    loadState: vi.fn().mockImplementation(async () => structuredClone(state)),
  } as unknown as TransactionRepository;
});
afterEach(() => {
  db.close();
  setConfigurationRepositoryForTests();
  vi.resetAllMocks();
});
const env = () => ({ SERAMET_DB: db, ...config });
function request(type: "INVOICE" | "RECEIPT" = "INVOICE", key = randomUUID(), overrides = {}) {
  return new Request("https://example.invalid/api/seramet/document-emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      documentType: type,
      recordId: type === "INVOICE" ? "INV-27" : "RC-27",
      recipient: { name: "Amina", email: "amina@example.com" },
      ...overrides,
    }),
  });
}
describe("authorized PDF email obligations", () => {
  it("recovers a failed queue dispatch and sends once through the actual worker handler", async () => {
    const failedQueue = { send: vi.fn().mockRejectedValue(new Error("Disposable queue outage")) };
    const response = await handleDocumentEmailApi(
      request(),
      { ...env(), SERAMET_WORK_QUEUE: failedQueue },
      repo,
    );
    const body = await response!.json();
    const recovered = vi.fn().mockResolvedValue(undefined);
    const workerEnv = {
      ...env(),
      SERAMET_ENVIRONMENT: "test",
      SERAMET_WORK_QUEUE: { send: recovered },
    };
    await scheduleDurableWork(workerEnv);
    const queued = recovered.mock.calls.find(([entry]) => entry.jobId === body.jobId)?.[0];
    expect(queued).toBeTruthy();
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ messageId: "<worker@brevo.test>" }), { status: 201 }),
      );
    try {
      const message = {
        id: randomUUID(),
        timestamp: new Date(),
        body: queued,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
      };
      await handleWorkerQueue({ queue: "disposable", messages: [message] }, workerEnv);
      await handleWorkerQueue({ queue: "disposable", messages: [message] }, workerEnv);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await db
          .prepare("SELECT status FROM worker_jobs WHERE id=?")
          .bind(body.jobId)
          .first("status"),
      ).toBe("SUCCEEDED");
      expect(
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action='DOCUMENT_EMAIL_PROVIDER_ACCEPTED'",
          )
          .first("count"),
      ).toBe(1);
    } finally {
      send.mockRestore();
    }
  });
  it.each(["INVOICE", "RECEIPT"] as const)(
    "queues and sends a frozen %s PDF through the existing worker infrastructure",
    async (type) => {
      const key = randomUUID();
      const queued = await handleDocumentEmailApi(request(type, key), env(), repo);
      expect(queued!.status).toBe(202);
      const body = await queued!.json();
      expect(body.status).toBe("QUEUED");
      expect(await (await handleDocumentEmailApi(request(type, key), env(), repo))!.json()).toEqual(
        body,
      );
      expect(await db.prepare("SELECT COUNT(*) AS count FROM worker_jobs").first("count")).toBe(1);
      const stored = await db
        .prepare("SELECT payload_json FROM worker_jobs WHERE id=?")
        .bind(body.jobId)
        .first<{ payload_json: string }>();
      const payload = JSON.parse(stored!.payload_json);
      const pdf = Uint8Array.from(atob(payload.pdf), (c) => c.charCodeAt(0));
      if (process.env.SERAMET_EMAIL_EVIDENCE === "true") {
        await mkdir(".seramet/brevo-email-evidence", { recursive: true });
        await writeFile(`.seramet/brevo-email-evidence/${type.toLowerCase()}.pdf`, pdf);
      }
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
      state.bills[0]!.total = 999; // Delivery must use the frozen attachment, not recalculate later.
      await db
        .prepare("UPDATE worker_jobs SET status='RUNNING',attempt_count=1 WHERE id=?")
        .bind(body.jobId)
        .run();
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ messageId: "<document@brevo.test>" }), { status: 201 }),
        );
      await deliverCustomerDocumentEmail(env(), tenant, body.jobId, send);
      await deliverCustomerDocumentEmail(env(), tenant, body.jobId, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(send.mock.calls[0]![1]!.body as string).attachment[0].content).toBe(
        payload.pdf,
      );
      const status = await handleDocumentEmailApi(
        new Request(`https://example.invalid/api/seramet/document-emails/${body.jobId}`),
        env(),
        repo,
      );
      expect(await status!.json()).toEqual({ jobId: body.jobId, status: "PROVIDER_ACCEPTED" });
      expect(status!.headers.get("Cache-Control")).toBe("private, no-store");
    },
  );
  it("rejects changed idempotency details, including another recipient", async () => {
    const key = randomUUID();
    await handleDocumentEmailApi(request("INVOICE", key), env(), repo);
    await expect(
      handleDocumentEmailApi(
        request("INVOICE", key, { recipient: { name: "Other", email: "other@example.com" } }),
        env(),
        repo,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM worker_jobs").first("count")).toBe(1);
  });
  it("fails closed without configuration and never records a fake sent email", async () => {
    await expect(handleDocumentEmailApi(request(), { SERAMET_DB: db }, repo)).rejects.toMatchObject(
      { status: 503 },
    );
    expect(await db.prepare("SELECT COUNT(*) AS count FROM worker_jobs").first("count")).toBe(0);
  });
  it("rejects missing permissions and foreign tenant/branch documents", async () => {
    vi.mocked(authenticateSerametRequest).mockResolvedValue({ ...actor, permissions: [] });
    await expect(handleDocumentEmailApi(request(), env(), repo)).rejects.toMatchObject({
      status: 403,
    });
    vi.mocked(authenticateSerametRequest).mockResolvedValue(actor);
    state.bills[0]!.branchId = "other-branch";
    await expect(handleDocumentEmailApi(request(), env(), repo)).rejects.toMatchObject({
      status: 404,
    });
    state.bills[0]!.branchId = branch;
    state.bills[0]!.tenantId = "other-tenant";
    await expect(handleDocumentEmailApi(request(), env(), repo)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("blocks a different operator from reading another operator's email job", async () => {
    const body = await (await handleDocumentEmailApi(request(), env(), repo))!.json();
    vi.mocked(authenticateSerametRequest).mockResolvedValue({ ...actor, id: "other-operator" });
    await expect(
      handleDocumentEmailApi(
        new Request(`https://example.invalid/api/seramet/document-emails/${body.jobId}`),
        env(),
        repo,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks revoked operator permissions before contacting Brevo", async () => {
    const body = await (await handleDocumentEmailApi(request(), env(), repo))!.json();
    await db
      .prepare("UPDATE worker_jobs SET status='RUNNING',attempt_count=1 WHERE id=?")
      .bind(body.jobId)
      .run();
    await db.prepare("DELETE FROM role_permissions WHERE tenant_id=?").bind(tenant).run();
    const send = vi.fn<typeof fetch>();
    await expect(deliverCustomerDocumentEmail(env(), tenant, body.jobId, send)).rejects.toThrow(
      "OPERATOR_NOT_AUTHORIZED",
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects client-supplied document contents and oversized bodies", async () => {
    await expect(
      handleDocumentEmailApi(request("INVOICE", randomUUID(), { pdf: "fabricated" }), env(), repo),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      handleDocumentEmailApi(
        request("INVOICE", randomUUID(), { padding: "x".repeat(5000) }),
        env(),
        repo,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
