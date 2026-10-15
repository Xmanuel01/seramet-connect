import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handlePrintingApi, deriveBridgeSigningKey } from "@/server/printing-api";
import { authenticateSerametRequest, type ServerActor } from "@/lib/seramet-auth";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { MemoryTransactionRepository } from "@/lib/seramet-repository";
import { permissions } from "@/platform/permissions";
import { printerConfigurationSchema } from "@/printing/printer-configuration";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";

vi.mock("@/lib/seramet-auth", async (original) => ({
  ...(await original<object>()),
  authenticateSerametRequest: vi.fn(),
}));
let db: SqliteD1TestDatabase;
let actor: ServerActor;
let branchId: string;
const repository = new MemoryTransactionRepository();
const signingKey = crypto.randomUUID() + crypto.randomUUID();
beforeEach(async () => {
  db = createMigratedTestDatabase();
  branchId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  actor = {
    id: crypto.randomUUID(),
    name: "Disposable manager",
    tenantId,
    branchId,
    branch: "Disposable branch",
    roleIds: [],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Disposable branch" }],
    permissions: [permissions.settingsHardwareView, permissions.settingsHardwareManage],
    branchScope: { type: "BRANCH", branchId },
    role: "Branch Manager",
    authLevel: "FULL",
  } as ServerActor;
  vi.mocked(authenticateSerametRequest).mockResolvedValue(actor);
  await db
    .prepare(
      "INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      tenantId,
      tenantId,
      "Disposable",
      "Disposable",
      "KES",
      "Africa/Nairobi",
      "en-KE",
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  await db
    .prepare("INSERT INTO branches(tenant_id,id,code,name,timezone) VALUES (?,?,?,?,?)")
    .bind(tenantId, branchId, branchId, "Disposable branch", "Africa/Nairobi")
    .run();
});
afterEach(() => db.close());
const request = (path: string, input?: unknown) =>
  new Request(
    `http://localhost/api/seramet/printing/${path}`,
    input
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      : undefined,
  );
const env = () => ({
  SERAMET_DB: db,
  SERAMET_ENVIRONMENT: "development",
  SERAMET_PRINT_SIGNING_KEY: signingKey,
});
const configuration = () =>
  printerConfigurationSchema.parse({
    branchId,
    name: "Disposable thermal",
    bridgeId: crypto.randomUUID(),
    transport: "TCP",
    host: "127.0.0.1",
    roles: ["BILL", "RECEIPT"],
  });

it("persists administrator config, edits/disables it and lists only active branch", async () => {
  const saved = await (await handlePrintingApi(
    request("printers", configuration()),
    env(),
    repository,
  ))!.json();
  expect(saved.printer.id).toBeTruthy();
  const listed = await (await handlePrintingApi(request("printers"), env(), repository))!.json();
  expect(listed.printers).toHaveLength(1);
  await handlePrintingApi(
    request("printers", { ...saved.printer, enabled: false }),
    env(),
    repository,
  );
  const stored = await db
    .prepare("SELECT payload_json FROM hardware_devices WHERE tenant_id=? AND id=?")
    .bind(actor.tenantId, saved.printer.id)
    .first<{ payload_json: string }>();
  expect(JSON.parse(stored!.payload_json).printing.enabled).toBe(false);
  actor.branchId = crypto.randomUUID();
  const other = await (await handlePrintingApi(request("printers"), env(), repository))!.json();
  expect(other.printers).toEqual([]);
});

it("denies cashier configuration and cross-branch targets", async () => {
  const input = configuration();
  actor.permissions = [permissions.ordersUpdate];
  await expect(
    handlePrintingApi(request("printers", input), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
  actor.permissions = [permissions.settingsHardwareManage];
  await expect(
    handlePrintingApi(
      request("printers", { ...input, branchId: crypto.randomUUID() }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it("issues server-generated diagnostic evidence without accepting client content", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  const input = {
    printerId: printer.id,
    documentType: "TEST",
    recordId: crypto.randomUUID(),
    testKind: "FOOD_KOT",
  };
  const result = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  const payload = JSON.parse(
    Buffer.from(result.authorization.payload, "base64url").toString("utf8"),
  );
  expect(payload).toMatchObject({
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    bridgeId: printer.bridgeId,
    target: { id: printer.id, host: "127.0.0.1" },
  });
  expect(payload.content).toContain("NOT A SALE");
  expect(JSON.stringify(result)).not.toContain(signingKey);
  await expect(
    handlePrintingApi(request("authorize", { ...input, content: "injected" }), env(), repository),
  ).rejects.toMatchObject({ status: 400 });
});

it("denies unclaimed KOT, unconfirmed receipts and cross-branch printer IDs", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  actor.permissions.push(permissions.ordersUpdate, permissions.invoicesManage);
  await expect(
    handlePrintingApi(
      request("authorize", { printerId: crypto.randomUUID(), documentType: "TEST", recordId: "x" }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    handlePrintingApi(
      request("authorize", {
        printerId: printer.id,
        documentType: "FOOD_KOT",
        recordId: "missing-claim",
      }),
      env(),
      repository,
    ),
  ).rejects.toBeDefined();
  await expect(
    handlePrintingApi(
      request("authorize", {
        printerId: printer.id,
        documentType: "RECEIPT",
        recordId: "not-confirmed",
      }),
      env(),
      repository,
    ),
  ).rejects.toBeDefined();
});

it("rejects unsafe endpoint syntax, incompatible profiles and excessive copies", () => {
  for (const patch of [
    { host: "http://169.254.169.254/" },
    { port: 80 },
    { copies: 100 },
    { encoding: "utf8" },
    { cutter: "unsupported" },
  ]) {
    expect(printerConfigurationSchema.safeParse({ ...configuration(), ...patch }).success).toBe(
      false,
    );
  }
});

it("derives isolated enrollment keys without exporting the server master", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  const enrollment = await (await handlePrintingApi(
    request("enrollment", { bridgeId: printer.bridgeId }),
    env(),
    repository,
  ))!.json();
  expect(enrollment.signingKey).not.toBe(signingKey);
  expect(enrollment.signingKey).toBe(
    await deriveBridgeSigningKey(signingKey, actor.tenantId, actor.branchId, printer.bridgeId),
  );
  expect(enrollment.signingKey).not.toBe(
    await deriveBridgeSigningKey(signingKey, actor.tenantId, crypto.randomUUID(), printer.bridgeId),
  );
  actor.permissions = [];
  await expect(
    handlePrintingApi(request("enrollment", { bridgeId: printer.bridgeId }), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
});

it("authorizes only the exact claimed immutable station obligation and renders it reproducibly", async () => {
  await db
    .prepare(
      "INSERT INTO stations(tenant_id,id,branch_id,code,name,station_type,payload_json) VALUES (?,?,?,?,?,'KITCHEN','{}')",
    )
    .bind(actor.tenantId, crypto.randomUUID(), branchId, "GRILL", "Grill")
    .run();
  const printer = (
    await (await handlePrintingApi(
      request("printers", { ...configuration(), roles: ["KITCHEN"], stations: ["GRILL"] }),
      env(),
      repository,
    ))!.json()
  ).printer;
  actor.permissions.push(permissions.ordersUpdate);
  const state = createEmptyTransactionState(actor.tenantId);
  const orderId = crypto.randomUUID();
  const obligationId = crypto.randomUUID();
  const claimToken = crypto.randomUUID();
  const stamp = new Date().toISOString();
  const lines = [
    {
      id: crypto.randomUUID(),
      name: "Persisted meal",
      category: "Test",
      quantity: 2,
      unitPrice: 123.45,
      productionStation: "GRILL",
      itemNote: "No salt",
    },
  ];
  state.orders = [
    {
      id: orderId,
      tenantId: actor.tenantId,
      branchId,
      branch: actor.branch,
      customer: "Disposable",
      channel: "Takeaway",
      cashier: actor.name,
      status: "SENT_TO_KITCHEN",
      paymentStatus: "UNPAID",
      createdAt: stamp,
      updatedAt: stamp,
      lines,
      subtotal: 246.9,
      tax: 0,
      total: 246.9,
    },
  ];
  state.kitchenPrintObligations = [
    {
      id: obligationId,
      tenantId: actor.tenantId,
      branchId,
      branch: actor.branch,
      orderId,
      station: "GRILL",
      sourceId: crypto.randomUUID(),
      kind: "ORIGINAL",
      lines,
      status: "CLAIMED",
      claimedBy: actor.id,
      claimToken,
      claimedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  await repository.saveState(state, actor, "Disposable print acceptance");
  await hydrateAuthoritativeConfiguration(db, env(), true);
  const input = {
    printerId: printer.id,
    documentType: "FOOD_KOT",
    recordId: obligationId,
    claimToken,
  };
  const first = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  const second = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  const decode = (result: { authorization: { payload: string } }) =>
    JSON.parse(Buffer.from(result.authorization.payload, "base64url").toString("utf8"));
  expect(decode(first).content).toBe(decode(second).content);
  expect(decode(first).id).toBe(`${obligationId}:0`);
  expect(decode(first).content).toContain("2 x PERSISTED MEAL");
  expect(decode(first).content).toContain("NO SALT");
  await expect(
    handlePrintingApi(
      request("authorize", { ...input, claimToken: crypto.randomUUID() }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 409 });
});
