import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  handlePrintingApi,
  deriveBridgeSigningKey,
  printSigningMaster,
  authorizeDelivery,
  signPrintJob,
} from "@/server/printing-api";
import { authenticateSerametRequest, type ServerActor } from "@/lib/seramet-auth";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { MemoryTransactionRepository } from "@/lib/seramet-repository";
import { permissions } from "@/platform/permissions";
import { printerConfigurationSchema } from "@/printing/printer-configuration";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import { hydrateSeededTenantsForTests } from "@/testing/configuration-fixture";
import { loadTenantConfigurationState } from "@/server/database/authoritative-configuration";

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
afterEach(() => {
  vi.useRealTimers();
  db.close();
});
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

it("binds explicit raster capabilities and canonical layout; text diagnostics cannot alter an existing identity", async () => {
  const raster = {
    command: "GS_V_0",
    printableWidthDots: 576,
    dpi: 203,
    maxBandHeight: 128,
    maxHeightDots: 8192,
    maxBytes: 524288,
  };
  const config = { ...configuration(), renderingMode: "RASTER_ESC_POS", raster };
  const printer = (
    await (await handlePrintingApi(request("printers", config), env(), repository))!.json()
  ).printer;
  const input = { printerId: printer.id, documentType: "TEST", recordId: crypto.randomUUID() };
  const issue = async (data: unknown) =>
    await (await handlePrintingApi(request("authorize", data), env(), repository))!.json();
  const first = await issue(input);
  const decoded = JSON.parse(Buffer.from(first.authorization.payload, "base64url").toString());
  expect(decoded.profile.renderingMode).toBe("RASTER_ESC_POS");
  // Image printers get the approved typeset layout (v3), with the ruled text kept
  // for a text-mode fallback; the legacy text-grid raster layout is not sent.
  expect(decoded.v).toBe(3);
  expect(decoded.profile.raster).toEqual(raster);
  expect(decoded.document).toBeUndefined();
  expect(decoded.logo).toBeUndefined();
  expect(decoded.rich.paper).toBe(config.paperWidth);
  expect(JSON.stringify(decoded.rich.blocks[0])).toContain("PRINTER TEST - NOT A SALE");
  expect(JSON.stringify(decoded.rich)).toContain("INVOICE");
  expect(decoded.content).toContain("PRINTER TEST - NOT A SALE");
  await expect(issue({ ...input, testRenderingMode: "TEXT_ESC_POS" })).rejects.toMatchObject({
    status: 409,
  });
  const text = await issue({
    ...input,
    recordId: crypto.randomUUID(),
    testRenderingMode: "TEXT_ESC_POS",
  });
  const textJob = JSON.parse(Buffer.from(text.authorization.payload, "base64url").toString());
  expect(textJob.profile.renderingMode).toBe("TEXT_ESC_POS");
  expect(textJob.v).toBe(1);
  expect(textJob.document).toBeUndefined();
  const changed = await signPrintJob(
    { ...decoded, profile: { ...decoded.profile, raster: { ...raster, printableWidthDots: 640 } } },
    await deriveBridgeSigningKey(signingKey, actor.tenantId, branchId, printer.bridgeId),
  );
  await expect(
    handlePrintingApi(request("consume", { authorization: changed }), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
  // Image (raster) mode is allowed on Windows-spooled USB printers too.
  expect(
    printerConfigurationSchema.safeParse({ ...config, transport: "WINDOWS", osPrinterName: "test" })
      .success,
  ).toBe(true);
  expect(
    printerConfigurationSchema.safeParse({ ...config, raster: { ...raster, command: "UNKNOWN" } })
      .success,
  ).toBe(false);
});

it("consumes one global attempt across terminals, old evidence, ledger loss and bounded recovery", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  const input = { printerId: printer.id, documentType: "TEST", recordId: crypto.randomUUID() };
  const issued = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  const competing = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      handlePrintingApi(
        request("consume", { authorization: issued.authorization }),
        env(),
        repository,
      ),
    ),
  );
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(competing.filter((r) => r.status === "rejected")).toHaveLength(11);
  const original = JSON.parse(Buffer.from(issued.authorization.payload, "base64url").toString());
  const key = await deriveBridgeSigningKey(signingKey, actor.tenantId, branchId, printer.bridgeId);
  const changed = await signPrintJob({ ...original, content: "substituted" }, key);
  await expect(
    handlePrintingApi(request("consume", { authorization: changed }), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
  const expired = await signPrintJob({ ...original, expiresAt: Date.now() - 1 }, key);
  await expect(
    handlePrintingApi(request("consume", { authorization: expired }), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
  for (const recoveryId of [crypto.randomUUID(), crypto.randomUUID()]) {
    const recovered = await authorizeDelivery(db, actor, {
      ...original,
      recoveryId,
      expiresAt: Date.now() + 90000,
    });
    const authorization = await signPrintJob(recovered, key);
    await handlePrintingApi(request("consume", { authorization }), env(), repository);
    await expect(
      handlePrintingApi(
        request("consume", { authorization: issued.authorization }),
        env(),
        repository,
      ),
    ).rejects.toMatchObject({ status: 409 });
  }
  await expect(
    authorizeDelivery(db, actor, { ...original, recoveryId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='PRINT_DELIVERY_RESERVED'")
      .first(),
  ).toEqual({ n: 3 });
});

it("rejects self-signed but unissued capabilities and branch substitutions", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  const key = await deriveBridgeSigningKey(signingKey, actor.tenantId, branchId, printer.bridgeId);
  const authorization = await signPrintJob(
    {
      v: 1,
      id: crypto.randomUUID(),
      tenantId: actor.tenantId,
      branchId,
      bridgeId: printer.bridgeId,
      actorId: actor.id,
      deliveryAttempt: 0,
      expiresAt: Date.now() + 90000,
      target: { id: printer.id },
    },
    key,
  );
  await expect(
    handlePrintingApi(request("consume", { authorization }), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
});

it("revokes issued delivery when the configured printer changes", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  const issued = await (await handlePrintingApi(
    request("authorize", {
      printerId: printer.id,
      documentType: "TEST",
      recordId: crypto.randomUUID(),
    }),
    env(),
    repository,
  ))!.json();
  await handlePrintingApi(request("printers", { ...printer, host: "10.0.0.8" }), env(), repository);
  await expect(
    handlePrintingApi(
      request("consume", { authorization: issued.authorization }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='PRINT_DELIVERY_RESERVED'")
      .first(),
  ).toEqual({ n: 0 });
});

it("records one authoritative receipt reprint across separate terminals", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  actor.permissions.push(permissions.invoicesManage);
  const state = createEmptyTransactionState(actor.tenantId);
  const invoiceId = crypto.randomUUID(),
    receiptId = crypto.randomUUID(),
    stamp = new Date().toISOString();
  state.bills.push({
    id: invoiceId,
    tenantId: actor.tenantId,
    branchId,
    branch: "Disposable branch",
    orderIds: [],
    customer: "Test",
    status: "PAID",
    paymentStatus: "PAID",
    issuedAt: stamp,
    dueAt: stamp,
    lines: [
      {
        id: crypto.randomUUID(),
        name: "Meal",
        category: "Test",
        quantity: 2,
        unitPrice: 12.34,
        productionStation: "NONE",
      },
    ],
    subtotal: 24.68,
    tax: 0,
    total: 24.68,
    paid: 24.68,
  });
  state.receipts.push({
    id: receiptId,
    tenantId: actor.tenantId,
    branchId,
    invoiceId,
    orderId: crypto.randomUUID(),
    branch: "Disposable branch",
    cashier: "Disposable operator",
    customer: "Test",
    issuedAt: stamp,
    total: 24.68,
    paidAmount: 24.68,
    change: 0,
    paymentBreakdown: [{ method: "CASH", amount: 24.68, reference: "TEST ONLY" }],
    reprints: [],
  });
  await repository.saveState(state, actor, "Disposable receipt acceptance");
  await hydrateSeededTenantsForTests(db, env());
  const input = {
    printerId: printer.id,
    documentType: "RECEIPT",
    recordId: receiptId,
    reprintId: crypto.randomUUID(),
    reprintReason: "Customer requested another receipt",
  };
  const first = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  actor.id = crypto.randomUUID();
  actor.name = "Second disposable terminal";
  const second = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  const results = await Promise.allSettled(
    [first, second].map((issued) =>
      handlePrintingApi(
        request("consume", { authorization: issued.authorization }),
        env(),
        repository,
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await repository.loadState(actor.tenantId)).receipts[0]!.reprints).toHaveLength(1);
  actor.permissions = [];
  await expect(
    handlePrintingApi(request("authorize", input), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
});

it("binds bill reprint identity and reason across terminals before signing", async () => {
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  actor.permissions.push(permissions.invoicesManage);
  const state = createEmptyTransactionState(actor.tenantId);
  const id = crypto.randomUUID();
  state.bills.push({
    id,
    tenantId: actor.tenantId,
    branchId,
    branch: "Disposable branch",
    orderIds: [],
    customer: "Test",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: new Date().toISOString(),
    dueAt: new Date().toISOString(),
    lines: [
      {
        id: crypto.randomUUID(),
        name: "Meal",
        category: "Test",
        quantity: 2,
        unitPrice: 12.34,
        productionStation: "NONE",
      },
    ],
    subtotal: 24.68,
    tax: 0,
    total: 24.68,
    paid: 0,
  });
  await repository.saveState(state, actor, "Disposable bill reprint acceptance");
  await hydrateSeededTenantsForTests(db, env());
  const input = {
    printerId: printer.id,
    documentType: "BILL",
    recordId: id,
    reprintId: crypto.randomUUID(),
    reprintReason: "Customer requested another copy",
  };
  const first = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  actor.id = crypto.randomUUID();
  const second = await (await handlePrintingApi(
    request("authorize", input),
    env(),
    repository,
  ))!.json();
  expect(JSON.parse(Buffer.from(first.authorization.payload, "base64url").toString()).id).toBe(
    JSON.parse(Buffer.from(second.authorization.payload, "base64url").toString()).id,
  );
  await expect(
    handlePrintingApi(
      request("authorize", { ...input, reprintReason: "An altered operator reason" }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    handlePrintingApi(
      request("authorize", { ...input, reprintReason: undefined }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    await db
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='PRINT_REPRINT_AUTHORIZED'")
      .first(),
  ).toEqual({ n: 1 });
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

it("deletes a printer from the branch but keeps its record, unless another printer backs onto it", async () => {
  const save = async (input: unknown) =>
    (await (await handlePrintingApi(request("printers", input), env(), repository))!.json())
      .printer as { id: string; name: string };
  const remove = (id: string) =>
    handlePrintingApi(
      new Request(`http://localhost/api/seramet/printing/printers/${id}`, { method: "DELETE" }),
      env(),
      repository,
    );
  const main = await save(configuration());
  const backup = await save({
    ...configuration(),
    name: "Disposable backup",
    fallbackPrinterId: main.id,
  });

  await expect(remove(main.id)).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining("Disposable backup"),
  });

  // Routes that print to the backup go, and it is cleared as a route fallback everywhere.
  const route = (routeId: string, primary: string, fallback: string | null) =>
    db
      .prepare(
        "INSERT INTO print_routes (tenant_id,id,branch_id,document_type,primary_device_id,fallback_device_id,payload_json) VALUES (?,?,?,'BILL',?,?,?)",
      )
      .bind(
        actor.tenantId,
        routeId,
        branchId,
        primary,
        fallback,
        JSON.stringify(fallback ? { fallbackDeviceId: fallback } : {}),
      )
      .run();
  await route("route-to-backup", backup.id, null);
  await route("route-with-backup", main.id, backup.id);

  expect((await remove(backup.id))!.status).toBe(200);
  const listed = await (await handlePrintingApi(request("printers"), env(), repository))!.json();
  expect(listed.printers.map((printer: { id: string }) => printer.id)).toEqual([main.id]);
  const stored = await db
    .prepare("SELECT trust_status,lifecycle_state FROM hardware_devices WHERE tenant_id=? AND id=?")
    .bind(actor.tenantId, backup.id)
    .first<{ trust_status: string; lifecycle_state: string }>();
  // Retired as well as revoked, so device activation cannot bring it back.
  expect(stored).toEqual({ trust_status: "REVOKED", lifecycle_state: "RETIRED" });
  const routes = await db
    .prepare("SELECT id,fallback_device_id,payload_json FROM print_routes WHERE tenant_id=?")
    .bind(actor.tenantId)
    .all<{ id: string; fallback_device_id: string | null; payload_json: string }>();
  expect(routes.results).toEqual([
    { id: "route-with-backup", fallback_device_id: null, payload_json: "{}" },
  ]);
  const audit = await db
    .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id=? AND action=?")
    .bind(actor.tenantId, "PRINTER_DELETED")
    .first<{ count: number }>();
  expect(audit?.count).toBe(1);

  // A stale edit form cannot bring a deleted printer back.
  await expect(
    handlePrintingApi(
      request("printers", { ...configuration(), id: backup.id, name: "Disposable backup" }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(remove(backup.id)).rejects.toMatchObject({ status: 404 });

  actor.permissions = [permissions.settingsHardwareView];
  await expect(remove(main.id)).rejects.toMatchObject({ status: 403 });
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
  // The test print uses the approved kitchen ticket at the printer's width.
  expect(payload.content).toMatch(/^\s+KITCHEN ORDER$/m);
  expect(payload.content).toMatch(/^NEW ORDER\s+KITCHEN$/m);
  expect(payload.content).toContain("1 x Printer diagnostic");
  const width = printer.paperWidth === "58mm" ? 32 : 42;
  for (const line of payload.content.split("\n")) expect(line.length).toBeLessThanOrEqual(width);
  for (const testKind of ["BILL", "RECEIPT"]) {
    const document = await (await handlePrintingApi(
      request("authorize", { ...input, testKind, recordId: crypto.randomUUID() }),
      env(),
      repository,
    ))!.json();
    const content = JSON.parse(
      Buffer.from(document.authorization.payload, "base64url").toString("utf8"),
    ).content;
    // The bill prints the approved INVOICE layout; the receipt the approved RECEIPT.
    expect(content).toMatch(testKind === "BILL" ? /^\s+INVOICE$/m : /^RECEIPT/m);
    expect(content).toMatch(/^\|QTY\|ITEM/m);
  }
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

it("enrolls a freshly generated machine identity but not an arbitrary unconfigured one", async () => {
  const enrollment = await (await handlePrintingApi(
    request("enrollment", { bridgeId: "front-desk-3f2a9c" }),
    env(),
    repository,
  ))!.json();
  expect(enrollment.bridgeId).toBe("front-desk-3f2a9c");
  expect(enrollment.signingKey).toBe(
    await deriveBridgeSigningKey(signingKey, actor.tenantId, actor.branchId, "front-desk-3f2a9c"),
  );
  await expect(
    handlePrintingApi(request("enrollment", { bridgeId: "Front Desk PC!" }), env(), repository),
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
  await hydrateSeededTenantsForTests(db, env());
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
  expect(decode(first).content).toMatch(/^2 x Persisted meal$/im);
  expect(decode(first).content.toUpperCase()).toContain("NO SALT");
  await handlePrintingApi(
    request("consume", { authorization: first.authorization }),
    env(),
    repository,
  );
  await expect(
    handlePrintingApi(
      request("authorize", { ...input, claimToken: crypto.randomUUID() }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 409 });
  actor.id = crypto.randomUUID();
  await expect(
    handlePrintingApi(request("authorize", input), env(), repository),
  ).rejects.toMatchObject({ status: 409 });
  const recoveryToken = crypto.randomUUID();
  Object.assign(state.kitchenPrintObligations![0]!, {
    claimedBy: actor.id,
    claimToken: recoveryToken,
    reviewReason: "Manager inspected paper and authorized recovery",
  });
  await repository.saveState(state, actor, "Disposable reviewed KOT recovery");
  const recovery = await (await handlePrintingApi(
    request("authorize", { ...input, claimToken: recoveryToken }),
    env(),
    repository,
  ))!.json();
  expect(decode(recovery).id).toBe(decode(first).id);
  expect(recovery.retry).toBe(true);
  await expect(
    handlePrintingApi(
      request("consume", { authorization: first.authorization }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await handlePrintingApi(
    request("consume", { authorization: recovery.authorization }),
    env(),
    repository,
  );
  const reprintId = crypto.randomUUID();
  const reprintClaim = crypto.randomUUID();
  actor.name = "Reviewing manager";
  state.kitchenPrintObligations!.push({
    ...state.kitchenPrintObligations![0]!,
    id: reprintId,
    sourceId: crypto.randomUUID(),
    kind: "REPRINT",
    claimToken: reprintClaim,
  });
  await repository.saveState(state, actor, "Disposable authorized KOT reprint");
  const reprint = await (await handlePrintingApi(
    request("authorize", { ...input, recordId: reprintId, claimToken: reprintClaim }),
    env(),
    repository,
  ))!.json();
  const text = decode(reprint).content.replace(/\s+/g, " ");
  expect(decode(reprint).content.split("\n")[1]).toMatch(/^REPRINT\s+KITCHEN$/);
  expect(text).toContain("REQUESTED BY: Reviewing manager");
  expect(text).not.toContain(`BY: ${state.orders[0]!.cashier}`);
});

it("derives a separate print signing master when no explicit key is configured", async () => {
  const jwt = "j".repeat(48);
  const derived = await printSigningMaster({ SERAMET_JWT_SECRET: jwt });
  expect(derived).toMatch(/^[0-9a-f]{64}$/);
  expect(derived).not.toContain(jwt);
  expect(await printSigningMaster({ SERAMET_JWT_SECRET: jwt })).toBe(derived);
  expect(
    await printSigningMaster({ SERAMET_JWT_SECRET: jwt, SERAMET_PRINT_SIGNING_KEY: signingKey }),
  ).toBe(signingKey);
  expect(await printSigningMaster({ SERAMET_JWT_SECRET: "short" })).toBe("");
});

it("turns the kitchen printer bypass on for 36 hours, records who and why, and turns it off", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T06:00:00Z"));
  const send = (method: "POST" | "DELETE", input?: unknown) =>
    handlePrintingApi(
      new Request("http://localhost/api/seramet/printing/dispatch-bypass", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(input ? { body: JSON.stringify(input) } : {}),
      }),
      env(),
      repository,
    );
  await expect(send("POST", { reason: "short" })).rejects.toMatchObject({ status: 400 });

  const started = await send("POST", { reason: "Kitchen printer is being replaced" });
  expect(started!.status).toBe(201);
  const { bypass } = await started!.json();
  expect(bypass).toMatchObject({
    startedBy: "Disposable manager",
    reason: "Kitchen printer is being replaced",
  });
  expect(Date.parse(bypass.until) - Date.parse(bypass.startedAt)).toBe(36 * 60 * 60 * 1000);
  // It cannot be restarted to stretch the window.
  await expect(send("POST", { reason: "Kitchen printer is being replaced" })).rejects.toMatchObject(
    { status: 409 },
  );
  const branch = await db
    .prepare("SELECT payload_json FROM branches WHERE tenant_id=? AND id=?")
    .bind(actor.tenantId, branchId)
    .first<{ payload_json: string }>();
  expect(JSON.parse(branch!.payload_json).metadata.kitchenPrintBypassUntil).toBe(bypass.until);

  // Distinct event times make the audit ordering assertion independent of runner speed.
  vi.setSystemTime(new Date("2026-11-06T06:00:01Z"));
  const ended = await send("DELETE");
  expect((await ended!.json()).bypass).toBeNull();
  const audit = await db
    .prepare("SELECT action FROM audit_events WHERE tenant_id=? ORDER BY created_at")
    .bind(actor.tenantId)
    .all<{ action: string }>();
  expect((audit.results ?? []).map((row) => row.action)).toEqual([
    "KITCHEN_PRINT_BYPASS_STARTED",
    "KITCHEN_PRINT_BYPASS_ENDED",
  ]);
});

it("lets only hardware managers change the printer bypass", async () => {
  actor.permissions = [permissions.settingsHardwareView];
  await expect(
    handlePrintingApi(
      new Request("http://localhost/api/seramet/printing/dispatch-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Kitchen printer is being replaced" }),
      }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 403 });
});

const logoRequest = (method: string, body?: unknown, query = "") =>
  new Request(`http://localhost/api/seramet/printing/receipt-logo${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
// 16 x 2 dots, solid top row.
const sampleLogo = { width: 16, height: 2, data: Buffer.from([255, 255, 0, 0]).toString("base64") };

it("saves company and branch receipt logos, prints the branch one on bills and receipts only", async () => {
  actor.permissions.push(permissions.settingsOrganisationManage);
  const saved = await (await handlePrintingApi(
    logoRequest("PUT", { scope: "COMPANY", logo: sampleLogo }),
    env(),
    repository,
  ))!.json();
  expect(saved.company).toMatchObject({ ...sampleLogo, updatedBy: actor.id });
  expect(saved.branch).toBeUndefined();
  const printer = (
    await (await handlePrintingApi(request("printers", configuration()), env(), repository))!.json()
  ).printer;
  const authorize = async (testKind: string) =>
    JSON.parse(
      Buffer.from(
        (
          await (await handlePrintingApi(
            request("authorize", {
              printerId: printer.id,
              documentType: "TEST",
              recordId: crypto.randomUUID(),
              testKind,
            }),
            env(),
            repository,
          ))!.json()
        ).authorization.payload,
        "base64url",
      ).toString("utf8"),
    );
  expect((await authorize("RECEIPT")).logo).toEqual(sampleLogo);
  expect((await authorize("FOOD_KOT")).logo).toBeUndefined();
  const branchLogo = { ...sampleLogo, data: Buffer.from([1, 2, 3, 4]).toString("base64") };
  await handlePrintingApi(
    logoRequest("PUT", { scope: "BRANCH", logo: branchLogo }),
    env(),
    repository,
  );
  expect((await authorize("BILL")).logo).toEqual(branchLogo);
  const afterRemoval = await (await handlePrintingApi(
    logoRequest("DELETE", undefined, "?scope=BRANCH"),
    env(),
    repository,
  ))!.json();
  expect(afterRemoval.branch).toBeUndefined();
  expect((await authorize("BILL")).logo).toEqual(sampleLogo);
  const audits = await db
    .prepare("SELECT action FROM audit_events WHERE tenant_id=? AND action LIKE 'RECEIPT_LOGO_%'")
    .bind(actor.tenantId)
    .all<{ action: string }>();
  expect(audits.results?.map((row) => row.action).sort()).toEqual([
    "RECEIPT_LOGO_REMOVED",
    "RECEIPT_LOGO_SAVED",
    "RECEIPT_LOGO_SAVED",
  ]);
});

it("keeps logos out of settings snapshots and refuses bad images and missing rights", async () => {
  await expect(
    handlePrintingApi(
      logoRequest("PUT", { scope: "COMPANY", logo: sampleLogo }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    handlePrintingApi(
      logoRequest("PUT", { scope: "BRANCH", logo: { ...sampleLogo, data: "AAAA" } }),
      env(),
      repository,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await handlePrintingApi(
    logoRequest("PUT", { scope: "BRANCH", logo: sampleLogo }),
    env(),
    repository,
  );
  const state = await loadTenantConfigurationState(db, env() as never, actor.tenantId);
  expect(JSON.stringify(state)).not.toContain(sampleLogo.data);
  expect(state.documentTemplates.some((t) => t.documentType === "RECEIPT_LOGO")).toBe(false);
  actor.permissions = [permissions.settingsHardwareView];
  await expect(
    handlePrintingApi(logoRequest("DELETE", undefined, "?scope=BRANCH"), env(), repository),
  ).rejects.toMatchObject({ status: 403 });
  // Anyone who can open the Printers page can see the current logo.
  const seen = await (await handlePrintingApi(logoRequest("GET"), env(), repository))!.json();
  expect(seen.branch).toMatchObject(sampleLogo);
});
