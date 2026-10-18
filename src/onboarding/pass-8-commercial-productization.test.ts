import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "@/server/database/schema-version";
import type { SerametEnv, ServerActor } from "@/lib/seramet-auth";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { createManualMenuCsv } from "@/onboarding/manual-menu-item";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import type { DurableQueueMessage, ObjectStoreBinding } from "@/server/environment";
import {
  handleWorkerQueue,
  scheduleDurableWork,
  type SerametWorkerMessage,
} from "@/server/workers";
import { handleOnboardingApi } from "@/server/onboarding-api";
import { createMenuCatalogReader } from "@/integrations/marketplace/menu-catalog-reader";
import { HistoricalSalesMigrationService } from "@/onboarding/historical-sales-migration-service";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import type { ImportPreview } from "@/onboarding/types";
import { handleScannerInternalApi } from "@/server/scanner-internal-api";
import { scannerAuthRequestHeaders, signScannerRequest } from "@/server/scanner-auth";

const tenantId = "tenant-setup-a";
const secondTenantId = "tenant-setup-b";
const branchId = "branch-setup-a";
const secondBranchId = "branch-setup-b";
const warehouseId = "warehouse-setup-a";
const stamp = "2026-09-01T08:00:00.000Z";
const jwtSecret = "pass-eight-menu-import-signing-secret-32-bytes";
const jwtIssuer = "https://identity.seramet.test";
const jwtAudience = "seramet-pass-eight";
const scannerSecret = "pass-eight-scanner-evidence-secret-at-least-32-bytes";

describe.sequential("Pass 8 commercial productization and onboarding", () => {
  let db: SqliteD1TestDatabase;
  let service: OnboardingService;
  let secretValues: Map<string, { value: string; version: string }>;
  let env: SerametEnv;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    seedFoundation(db);
    secretValues = new Map();
    env = testEnvironment(db, secretValues);
    service = new OnboardingService(db, actor(), env);
  });

  afterEach(() => db.close());

  it("applies schema version 9 and the commercial onboarding tables", async () => {
    expect(
      await db.prepare("SELECT MAX(version) version FROM schema_migrations").first("version"),
    ).toBe(CURRENT_SCHEMA_VERSION);
    for (const table of [
      "tenant_onboarding_profiles",
      "branch_operating_profiles",
      "setup_stage_snapshots",
      "setup_readiness_results",
      "setup_imports",
      "setup_import_rows",
      "setup_import_reference_aliases",
      "historical_sales_migrations",
      "historical_sales_migration_rows",
      "historical_sales_records",
      "menu_catalog_items",
      "opening_stock_batches",
      "opening_stock_lines",
      "setup_account_mappings",
      "tax_service_rules",
      "setup_test_runs",
      "provider_secret_metadata",
      "subscription_lifecycle_events",
      "support_diagnostic_exports",
      "tenant_data_export_jobs",
      "go_live_events",
    ]) {
      expect(
        await db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .bind(table)
          .first(),
        table,
      ).not.toBeNull();
    }
  });

  it("updates the authoritative business profile and keeps an audit event", async () => {
    await service.updateBusinessProfile({
      legalName: "Configured Legal Entity",
      tradingName: "Configured Restaurant",
      countryCode: "KE",
      defaultCurrency: "KES",
      timezone: "Africa/Nairobi",
      locale: "en-KE",
      accountingMode: "PERPETUAL",
      defaultDocumentFooter: "Configured footer",
    });
    expect(await service.getBusinessProfile()).toMatchObject({
      legalName: "Configured Legal Entity",
      tradingName: "Configured Restaurant",
      countryCode: "KE",
      defaultCurrency: "KES",
    });
    expect(await auditCount(db, "BUSINESS_PROFILE_UPDATED")).toBe(1);
  });

  it("creates brands, branches, warehouse policy and audit without display-name logic", async () => {
    const brand = await service.createBrand({ code: "SECOND", name: "Second configured brand" });
    const result = await service.createBranch({
      idempotencyKey: "create-branch-pass8-test-0001",
      brandId: brand.id,
      code: "NEW",
      name: "New configured branch",
      timezone: "Africa/Nairobi",
      businessDayCutoffMinutes: 180,
      negativeStockPolicy: "MANAGER_OVERRIDE",
      paymentsRequired: false,
      inventoryEnabled: true,
      recipesRequired: false,
      printingRequired: false,
      kdsRequired: false,
      createWarehouse: { code: "MAIN", name: "Main store" },
    });
    expect(result.warehouseId).toBeTruthy();
    expect(
      await db
        .prepare(
          "SELECT negative_stock_policy FROM branch_operating_profiles WHERE tenant_id=? AND branch_id=?",
        )
        .bind(tenantId, result.id)
        .first("negative_stock_policy"),
    ).toBe("MANAGER_OVERRIDE");
    expect(await auditCount(db, "BRANCH_CREATED")).toBe(1);
  });

  it("maps nonstandard columns from another POS without incorrect unsupported warnings", async () => {
    const preview = await service.previewImport({
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId],
      kind: "MENU",
      originalName: "previous-pos.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "Stock Identifier,Dish Label,Sales Group,Sale Amount,currency\nCUTE-001,Fish Pilau,MAIN,470,KES",
      ),
      duplicateStrategy: "ERROR",
      columnMap: {
        itemCode: "Stock Identifier",
        name: "Dish Label",
        categoryCode: "Sales Group",
        basePrice: "Sale Amount",
      },
      idempotencyKey: "mapped-previous-pos",
    });
    expect(preview).toMatchObject({
      rowCount: 1,
      errorCount: 0,
      canCommit: true,
    });
    expect(preview.rows[0]?.warnings.some((issue) => issue.code === "UNSUPPORTED_COLUMN")).toBe(
      false,
    );
    await completeMenuImport(service, db, env, preview);
    expect(await service.listMenuCatalog(branchId)).toContainEqual(
      expect.objectContaining({ code: "CUTE-001", selling_price_minor: 47000 }),
    );
  });

  it("requires authenticated CLEAN evidence tied to the exact file before preview or commit", async () => {
    const bytes = new TextEncoder().encode(
      "code,name,category,price,currency\nSEC-01,Validated item,MAIN,1250,KES",
    );
    const original = await service.previewImport({
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId],
      kind: "MENU",
      originalName: "validated.csv",
      mimeType: "text/csv",
      bytes,
      duplicateStrategy: "ERROR",
      idempotencyKey: "legacy-unscanned-preview",
    });
    await db
      .prepare(
        "UPDATE setup_imports SET scan_status='PENDING',scan_evidence_json='{}' WHERE tenant_id=? AND id=?",
      )
      .bind(tenantId, original.id)
      .run();
    await expect(service.commitImport(original.id, original.commitKey)).rejects.toThrow(
      /no valid file security scan/,
    );
    const report = await db
      .prepare("SELECT report_json FROM setup_imports WHERE tenant_id=? AND id=?")
      .bind(tenantId, original.id)
      .first<{ report_json: string }>();
    expect(JSON.parse(report!.report_json).fileValidationPolicy).toBe("authenticated-clean-v1");
  });

  it("fails closed before persisting menu or historical previews when scanning is unavailable", async () => {
    const unavailableEnv = { ...env, SERAMET_MALWARE_SCANNER: undefined };
    const unavailableMenu = new OnboardingService(db, actor(), unavailableEnv);
    const bytes = new TextEncoder().encode(
      "code,name,category,price,currency\nNO-SCAN-01,Unsafe preview,MAIN,1250,KES",
    );

    await expect(
      unavailableMenu.previewImport({
        branchId,
        kind: "MENU",
        originalName: "unscanned.csv",
        mimeType: "text/csv",
        bytes,
        duplicateStrategy: "ERROR",
        idempotencyKey: "unscanned-menu-preview",
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      new HistoricalSalesMigrationService(db, actor(), unavailableEnv).preview({
        sourceSystem: "Previous POS",
        originalName: "unscanned-history.csv",
        mimeType: "text/csv",
        bytes: new TextEncoder().encode(
          "externalSaleReference,branchCode,businessDate,currency,grossSales,netSales,orderCount\n" +
            "HIST-01,A,2026-08-01,KES,1250,1250,1",
        ),
      }),
    ).rejects.toMatchObject({ status: 503 });

    expect(await rowCount(db, "setup_imports")).toBe(0);
    expect(await rowCount(db, "setup_import_rows")).toBe(0);
    expect(await rowCount(db, "historical_sales_migrations")).toBe(0);
    expect(await rowCount(db, "historical_sales_migration_rows")).toBe(0);
  });

  it("quarantines an upload and creates no preview until the clean-scanned worker runs", async () => {
    const queuedMessages: unknown[] = [];
    const pipelineEnv: SerametEnv = {
      ...env,
      SERAMET_OBJECTS: memoryObjectStore(),
      SERAMET_SCANNER_EVIDENCE_SECRET: scannerSecret,
      SERAMET_SCAN_QUEUE: {
        async send(message) {
          queuedMessages.push(message);
        },
      },
      SERAMET_WORK_QUEUE: {
        async send(message) {
          queuedMessages.push(message);
        },
      },
    };
    const pipeline = new OnboardingService(db, actor(), pipelineEnv);
    const upload = await pipeline.queueImportPreparation({
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId],
      kind: "MENU",
      originalName: "queued-menu.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "code,name,category,price,currency\nQUEUED-01,Queued meal,MAIN,1250,KES",
      ),
      duplicateStrategy: "ERROR",
      idempotencyKey: "queued-menu-upload",
    });

    expect(upload).toMatchObject({ status: "PENDING", duplicate: false });
    expect(queuedMessages).toHaveLength(1);
    expect(await rowCount(db, "setup_imports")).toBe(0);
    expect(await rowCount(db, "setup_import_rows")).toBe(0);
    expect(
      await db
        .prepare(
          "SELECT status FROM stored_objects WHERE tenant_id=? AND object_class='IMPORT_QUARANTINE'",
        )
        .bind(tenantId)
        .first("status"),
    ).toBe("PENDING_SCAN");

    await authorizeQueuedImportScan(pipelineEnv, upload.jobId);
    await processWorkerJob(db, pipelineEnv, upload.jobId, true);
    const preparation = await pipeline.importPreparationStatus(upload.jobId);
    expect(preparation).toMatchObject({ status: "SUCCEEDED" });
    const importId = String((preparation.result as { importId?: string }).importId ?? "");
    expect(importId).toBeTruthy();
    expect(await pipeline.inspectImport(importId)).toMatchObject({
      canCommit: true,
      scanStatus: "CLEAN",
      rowCount: 1,
    });
    expect(await rowCount(db, "menu_catalog_items")).toBe(0);
  });

  it("binds upload idempotency to the complete server-derived import request", async () => {
    const queuedMessages: unknown[] = [];
    const pipelineEnv: SerametEnv = {
      ...env,
      SERAMET_OBJECTS: memoryObjectStore(),
      SERAMET_SCANNER_EVIDENCE_SECRET: scannerSecret,
      SERAMET_SCAN_QUEUE: {
        async send(message) {
          queuedMessages.push(message);
        },
      },
      SERAMET_WORK_QUEUE: {
        async send(message) {
          queuedMessages.push(message);
        },
      },
    };
    const pipeline = new OnboardingService(db, actor(), pipelineEnv);
    const request = {
      targetMode: "SELECTED_BRANCHES" as const,
      targetBranchIds: [branchId],
      kind: "MENU" as const,
      originalName: "idempotent-menu.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "code,name,category,price,currency\nIDEMPOTENT-01,Idempotent meal,MAIN,1250,KES",
      ),
      duplicateStrategy: "ERROR" as const,
      idempotencyKey: "complete-upload-identity",
    };

    const first = await pipeline.queueImportPreparation(request);
    await expect(pipeline.queueImportPreparation(request)).resolves.toMatchObject({
      jobId: first.jobId,
      duplicate: true,
    });
    await expect(
      pipeline.queueImportPreparation({ ...request, duplicateStrategy: "SKIP" }),
    ).rejects.toThrow("identity was reused with a different request");

    expect(queuedMessages).toHaveLength(2);
    expect(await rowCount(db, "stored_objects")).toBe(1);
  });

  it("accepts authenticated menu uploads only through the queued quarantine route", async () => {
    const queuedMessages: unknown[] = [];
    const routeEnv: SerametEnv = {
      ...env,
      SERAMET_OBJECTS: memoryObjectStore(),
      SERAMET_SCANNER_EVIDENCE_SECRET: scannerSecret,
      SERAMET_SCAN_QUEUE: {
        async send(message) {
          queuedMessages.push(message);
        },
      },
      SERAMET_WORK_QUEUE: {
        async send(message) {
          queuedMessages.push(message);
        },
      },
      SERAMET_JWT_SECRET: jwtSecret,
      SERAMET_JWT_ISSUER: jwtIssuer,
      SERAMET_JWT_AUDIENCE: jwtAudience,
    };
    const sessionId = "session-menu-import-route";
    const issuedAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await db
      .prepare(
        `INSERT INTO auth_sessions
          (tenant_id,id,user_id,device_id,issued_at,expires_at,revoked_at,last_seen_at,
           token_version,ip_hash,metadata_json)
         VALUES (?,?,?,NULL,?,?,NULL,?,1,NULL,'{}')`,
      )
      .bind(tenantId, sessionId, `setup-user-${tenantId}`, issuedAt, expiresAt, issuedAt)
      .run();
    const token = await signTestToken({
      tid: tenantId,
      sub: `setup-user-${tenantId}`,
      sid: sessionId,
    });
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-seramet-branch-id": branchId,
    };
    const payload = {
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId],
      kind: "MENU",
      originalName: "route-menu.csv",
      mimeType: "text/csv",
      base64: Buffer.from(
        "code,name,category,price,currency\nROUTE-01,Route meal,MAIN,1250,KES",
      ).toString("base64"),
      duplicateStrategy: "ERROR",
      idempotencyKey: "route-menu-upload",
    };
    const response = await handleOnboardingApi(
      new Request("https://seramet.test/api/seramet/setup/imports/uploads", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }),
      routeEnv,
    );
    if (!response) throw new Error("Queued import upload route was not handled");
    const result = (await response.json()) as { job: { jobId: string; status: string } };

    expect(response.status).toBe(202);
    expect(result.job.status).toBe("PENDING");
    expect(queuedMessages).toHaveLength(1);
    expect(await rowCount(db, "setup_imports")).toBe(0);
    await expect(
      handleOnboardingApi(
        new Request("https://seramet.test/api/seramet/setup/imports/preview", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }),
        routeEnv,
      ),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("previews menu files without mutation, commits explicitly and deduplicates commit retries", async () => {
    const preview = await previewCsv(
      service,
      "MENU",
      "code,name,category,price,currency\nMENU-01,Configured meal,MAIN,1250,KES",
      "menu-preview-one",
    );
    expect(preview).toMatchObject({ rowCount: 1, validCount: 1, errorCount: 0, canCommit: true });
    expect(await rowCount(db, "menu_catalog_items")).toBe(0);
    expect(await completeMenuImport(service, db, env, preview)).toMatchObject({
      status: "COMMITTED",
      publishStatus: "PUBLISHED",
    });
    expect(await service.commitImport(preview.id, preview.commitKey)).toMatchObject({
      duplicate: true,
    });
    expect(await service.listMenuCatalog(branchId)).toContainEqual(
      expect.objectContaining({
        code: "MENU-01",
        name: "Configured meal",
        selling_price_minor: 125000,
      }),
    );
    expect(await auditCount(db, "SETUP_IMPORT_COMMITTED")).toBe(1);
  });

  it("queues a medium-sized menu import and exposes its progress without duplicate writes", async () => {
    const rows = Array.from(
      { length: 101 },
      (_, index) => `MEDIUM-${index + 1},Menu item ${index + 1},MAIN,450,KES`,
    );
    const preview = await previewCsv(
      service,
      "MENU",
      ["code,name,category,price,currency", ...rows].join("\n"),
      "medium-menu-import",
    );
    expect(preview).toMatchObject({ rowCount: 101, canCommit: true, errorCount: 0 });
    const result = await service.commitImport(preview.id, preview.commitKey);
    expect(result).toMatchObject({ status: "QUEUED", queued: true, rows: 101 });
    expect(await rowCount(db, "menu_catalog_items")).toBe(0);
    expect(await service.inspectImport(preview.id)).toMatchObject({ status: "COMMITTING" });
    expect(await service.importStatus(preview.id)).toMatchObject({
      status: "COMMITTING",
      rowCount: 101,
      progress: {
        total: 101,
        processed: 0,
        pending: 101,
        created: 0,
        skipped: 0,
        verified: false,
      },
      worker: { status: "PENDING", attempts: 0 },
    });
    expect(await service.recentMenuImports()).toContainEqual(
      expect.objectContaining({
        id: preview.id,
        status: "COMMITTING",
        rowCount: 101,
      }),
    );
    const restricted = new OnboardingService(
      db,
      actor(
        [secondBranchId],
        allPermissionCodes.filter(
          (permission) => permission !== permissions.tenantScopeAllBranches,
        ),
      ),
      env,
    );
    expect((await restricted.recentMenuImports()).some((entry) => entry.id === preview.id)).toBe(
      false,
    );
    await expect(restricted.inspectImport(preview.id)).rejects.toThrow(
      /branch|permission|access|denied/i,
    );
    await expect(service.commitImport(preview.id, preview.commitKey)).rejects.toThrow(
      "already being committed",
    );
    const otherTenant = new OnboardingService(db, { ...actor(), tenantId: secondTenantId }, env);
    await expect(otherTenant.importStatus(preview.id)).rejects.toThrow("Import not found");
  });

  it("follows the structured manual-item contract without bypassing file scanning", async () => {
    expect(
      createManualMenuCsv({
        code: "PILAU-001",
        name: "Beef Pilau",
        categoryCode: "MAIN",
        basePrice: "450.00",
        currency: "KES",
        stationCode: "MAIN",
      }),
    ).toContain("PILAU-001");
    expect(await service.listMenuCatalog(branchId)).toHaveLength(0);
    const saved = await service.createManualMenuItem({
      branchId,
      requestKey: "manual-item-pilau-001",
      code: "PILAU-001",
      name: "Beef Pilau",
      categoryCode: "MAIN",
      basePrice: "450.00",
      currency: "KES",
      stationCode: "MAIN",
    });
    expect(saved).toMatchObject({
      status: "ACTIVE",
      duplicate: false,
    });
    expect(
      await service.createManualMenuItem({
        branchId,
        requestKey: "manual-item-pilau-001",
        code: "PILAU-001",
        name: "Beef Pilau",
        categoryCode: "MAIN",
        basePrice: "450.00",
        currency: "KES",
        stationCode: "MAIN",
      }),
    ).toMatchObject({ duplicate: true });
    const branchCatalog = await service.listMenuCatalog(branchId);
    expect(branchCatalog).toContainEqual(
      expect.objectContaining({
        code: "PILAU-001",
        category_code: "MAIN",
        name: "Beef Pilau",
        selling_price_minor: 45_000,
        station_id: "station-main",
        branch_activated: 1,
      }),
    );
    const pos = await createMenuCatalogReader(db)(tenantId, branchId);
    expect(pos).toContainEqual(
      expect.objectContaining({ itemCode: "PILAU-001", price: 450, productionStation: "MAIN" }),
    );
    expect(await service.listMenuCatalog(secondBranchId)).toHaveLength(0);
  });

  it("imports an actual Excel workbook into the authoritative branch catalogue", async () => {
    const workbook = createXlsx([
      [
        "templateVersion",
        "itemCode",
        "name",
        "categoryCode",
        "basePrice",
        "currency",
        "stationCode",
        "sellable",
        "branchCode",
        "available",
      ],
      ["2", "XLSX-01", "Workbook meal", "MAIN", "875", "KES", "MAIN", "true", "A", "true"],
    ]);
    const preview = await service.previewImport({
      kind: "MENU",
      originalName: "menu.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: workbook,
      duplicateStrategy: "ERROR",
      idempotencyKey: "xlsx-menu-preview",
      targetMode: "ROW_BRANCHES",
    });
    expect(preview).toMatchObject({ rowCount: 1, errorCount: 0, canCommit: true });
    await completeMenuImport(service, db, env, preview);
    expect(await service.listMenuCatalog(branchId)).toContainEqual(
      expect.objectContaining({ code: "XLSX-01", selling_price_minor: 87_500 }),
    );
  });

  it("previews and commits a one-time previous POS sales migration without replaying live flows", async () => {
    const migration = new HistoricalSalesMigrationService(db, actor(), env);
    const preview = await migration.preview({
      sourceSystem: "Previous POS",
      originalName: "historical-sales.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "templateVersion,externalSaleReference,branchCode,businessDate,currency,grossAmount,discountAmount,refundAmount,taxAmount,serviceChargeAmount,netAmount,orderCount,channelCode\n" +
          "1,OLD-001,A,2026-08-01,KES,12500,500,0,1724.14,0,12000,12,DINE_IN",
      ),
    });
    expect(preview).toMatchObject({
      status: "VALIDATED",
      rowCount: 1,
      grossSalesMinor: 1_250_000,
      netSalesMinor: 1_200_000,
      orderCount: 12,
      canCommit: true,
    });
    expect(await rowCount(db, "historical_sales_records")).toBe(0);
    await migration.commit(preview.id, preview.commitKey);
    expect(await rowCount(db, "historical_sales_records")).toBe(1);
    expect(await rowCount(db, "orders")).toBe(0);
    expect(await rowCount(db, "invoices")).toBe(0);
    expect(await auditCount(db, "HISTORICAL_SALES_COMMITTED")).toBe(1);
    await new ManagementIntelligenceService(db, actor()).recalculateTenant(branchId, "2026-08-01");
    expect(
      await db
        .prepare(
          `SELECT gross_sales_minor,discounts_minor,net_sales_minor,order_count,quality_reasons_json
           FROM daily_branch_metrics WHERE tenant_id=? AND branch_id=? AND business_date=?`,
        )
        .bind(tenantId, branchId, "2026-08-01")
        .first(),
    ).toMatchObject({
      gross_sales_minor: 1_250_000,
      discounts_minor: 50_000,
      net_sales_minor: 1_200_000,
      order_count: 12,
      quality_reasons_json: expect.stringContaining("HISTORICAL_SALES_WITHOUT_OPERATIONAL_DETAIL"),
    });
    await expect(
      migration.preview({
        sourceSystem: "Another POS",
        originalName: "again.csv",
        mimeType: "text/csv",
        bytes: new TextEncoder().encode(
          "externalSaleReference,branchCode,businessDate,currency,grossAmount\nOLD-002,A,2026-08-02,KES,100",
        ),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      db
        .prepare("UPDATE historical_sales_records SET net_sales_minor=0 WHERE tenant_id=?")
        .bind(tenantId)
        .run(),
    ).rejects.toThrow("append-only");
  });

  it("allows the optional previous POS migration to be skipped without permanently disabling it", async () => {
    const migration = new HistoricalSalesMigrationService(db, actor(), env);
    await expect(migration.skip("No export is available yet")).resolves.toMatchObject({
      status: "SKIPPED",
      canImportLater: true,
    });
    const preview = await migration.preview({
      sourceSystem: "Previous POS",
      originalName: "later.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "externalSaleReference,branchCode,businessDate,currency,grossAmount\nOLD-003,A,2026-08-03,KES,100",
      ),
    });
    expect(preview.canCommit).toBe(true);
  });

  it("allows only one simultaneous previous POS migration commit", async () => {
    const migration = new HistoricalSalesMigrationService(db, actor(), env);
    const first = await migration.preview({
      sourceSystem: "Previous POS A",
      originalName: "history-a.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "externalSaleReference,branchCode,businessDate,currency,grossAmount\nA-001,A,2026-07-01,KES,100",
      ),
    });
    const second = await migration.preview({
      sourceSystem: "Previous POS B",
      originalName: "history-b.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "externalSaleReference,branchCode,businessDate,currency,grossAmount\nB-001,A,2026-07-02,KES,200",
      ),
    });
    const outcomes = await Promise.allSettled([
      migration.commit(first.id, first.commitKey),
      migration.commit(second.id, second.commitKey),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM historical_sales_migrations WHERE tenant_id=? AND status='COMMITTED'",
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(1);
    expect(await rowCount(db, "historical_sales_records")).toBe(1);
  });

  it("derives preview identity from file content and import configuration", async () => {
    const bytes = new TextEncoder().encode(
      "templateVersion,itemCode,name,categoryCode,basePrice,currency\n2,FINGERPRINT-1,Fingerprint item,MAIN,100,KES",
    );
    const base = {
      branchId,
      kind: "MENU" as const,
      originalName: "same-name.csv",
      mimeType: "text/csv",
      bytes,
      duplicateStrategy: "CREATE" as const,
      idempotencyKey: "client-key-is-not-authoritative",
    };
    const first = await service.previewImport(base);
    const retry = await service.previewImport({ ...base, idempotencyKey: "different-client-key" });
    const differentPolicy = await service.previewImport({
      ...base,
      duplicateStrategy: "ERROR",
      idempotencyKey: "third-client-key",
    });
    expect(retry.id).toBe(first.id);
    expect(retry.fingerprint).toBe(first.fingerprint);
    expect(differentPolicy.id).not.toBe(first.id);
    expect(differentPolicy.fingerprint).not.toBe(first.fingerprint);
  });

  it("keeps tenant-master menu items out of branch POS visibility until activation", async () => {
    const preview = await service.previewImport({
      targetMode: "TENANT_MASTER",
      kind: "MENU",
      originalName: "tenant-master.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "templateVersion,itemCode,name,categoryCode,basePrice,currency\n2,MASTER-ONLY,Master item,MAIN,100,KES",
      ),
      duplicateStrategy: "CREATE",
      idempotencyKey: "tenant-master-preview",
    });
    const committed = await completeMenuImport(service, db, env, preview);
    expect(committed).toMatchObject({
      status: "COMMITTED",
      publishStatus: "PUBLISHED",
      verification: { status: "VERIFIED", catalogueVerified: true, branchSettings: 0 },
    });
    expect(await service.listMenuCatalog()).toContainEqual(
      expect.objectContaining({ code: "MASTER-ONLY", branch_activated: 0 }),
    );
    expect(await service.listMenuCatalog(branchId)).not.toContainEqual(
      expect.objectContaining({ code: "MASTER-ONLY" }),
    );
    expect(await createMenuCatalogReader(db)(tenantId, branchId)).toHaveLength(0);
  });

  it("activates selected branches with mapped stations and branch prices", async () => {
    const preview = await service.previewImport({
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId, secondBranchId],
      kind: "MENU",
      originalName: "branch-menu.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "templateVersion,itemCode,name,categoryCode,basePrice,currency,stationCode,branchPrice\n2,BRANCH-ITEM,Branch item,MAIN,100,KES,KITCHEN,99.50",
      ),
      duplicateStrategy: "CREATE",
      idempotencyKey: "branch-menu-preview",
      referenceMap: { stations: { KITCHEN: "MAIN" } },
    });
    expect(preview).toMatchObject({ errorCount: 0, targetBranchIds: [branchId, secondBranchId] });
    const committed = await completeMenuImport(service, db, env, preview);
    expect(committed).toMatchObject({
      verification: { status: "VERIFIED", branchSettings: 2 },
    });
    const settings = await db
      .prepare(
        `SELECT branch_id,station_id,selling_price_minor FROM menu_item_branch_settings
         WHERE tenant_id=? AND menu_item_id='menu-branch-item' ORDER BY branch_id`,
      )
      .bind(tenantId)
      .all<{ branch_id: string; station_id: string; selling_price_minor: number }>();
    expect(settings.results).toEqual([
      { branch_id: branchId, station_id: "station-main", selling_price_minor: 9950 },
      { branch_id: secondBranchId, station_id: "station-main-b", selling_price_minor: 9950 },
    ]);
    expect(await createMenuCatalogReader(db)(tenantId, secondBranchId)).toContainEqual(
      expect.objectContaining({ itemCode: "BRANCH-ITEM", price: 99.5, productionStation: "MAIN" }),
    );
    expect(
      await db
        .prepare(
          `SELECT COUNT(*) count FROM setup_import_reference_aliases
           WHERE tenant_id=? AND source_value_normalized='KITCHEN'`,
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(2);
  });

  it("keeps explicitly unavailable branch items out of the operational catalogue", async () => {
    const preview = await service.previewImport({
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId],
      kind: "MENU",
      originalName: "unavailable.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        "itemCode,name,categoryCode,basePrice,currency,available\nUNAVAILABLE-1,Unavailable item,MAIN,100,KES,false",
      ),
      duplicateStrategy: "CREATE",
      idempotencyKey: "unavailable-preview",
    });
    await completeMenuImport(service, db, env, preview);
    expect(await service.listMenuCatalog(branchId)).toContainEqual(
      expect.objectContaining({ code: "UNAVAILABLE-1", available: 0 }),
    );
    expect(await createMenuCatalogReader(db)(tenantId, branchId)).not.toContainEqual(
      expect.objectContaining({ itemCode: "UNAVAILABLE-1" }),
    );
  });

  it("creates one tenant item for multiple row-branch assignments", async () => {
    const preview = await service.previewImport({
      targetMode: "ROW_BRANCHES",
      kind: "MENU",
      originalName: "row-branches.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(
        [
          "templateVersion,itemCode,name,categoryCode,basePrice,currency,stationCode,branchCode,branchPrice",
          "2,ROW-BRANCH-1,Row branch item,MAIN,100,KES,MAIN,A,95",
          "2,ROW-BRANCH-1,Row branch item,MAIN,100,KES,MAIN,B,105",
        ].join("\n"),
      ),
      duplicateStrategy: "CREATE",
      idempotencyKey: "row-branch-preview",
    });
    expect(preview).toMatchObject({ rowCount: 2, errorCount: 0 });
    const committed = await completeMenuImport(service, db, env, preview);
    expect(committed).toMatchObject({
      verification: { created: 1, updated: 0, branchSettings: 2, catalogueVerified: true },
    });
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=? AND code='ROW-BRANCH-1'",
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(1);
  });

  it("regresses the 343-row repeated-station import through the operational catalogue", async () => {
    const csv = [
      "templateVersion,itemCode,name,categoryCode,basePrice,currency,stationCode,available",
      ...Array.from(
        { length: 343 },
        (_, index) =>
          `2,REGRESSION-${index + 1},Imported item ${index + 1},MAIN,350,KES,Main Kitchen,true`,
      ),
    ].join("\n");
    const preview = await service.previewImport({
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [branchId],
      kind: "MENU",
      originalName: "real-menu-regression.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(csv),
      duplicateStrategy: "CREATE",
      idempotencyKey: "real-menu-regression-preview",
      referenceMap: { stations: { "Main Kitchen": "MAIN" } },
    });
    expect(preview).toMatchObject({ rowCount: 343, validCount: 343, errorCount: 0 });
    const queued = await service.commitImport(preview.id, preview.commitKey);
    expect(queued).toMatchObject({ status: "QUEUED", queued: true, rows: 343 });
    await expect(service.commitImport(preview.id, `${preview.commitKey}:altered`)).rejects.toThrow(
      "Commit idempotency key does not match the preview",
    );
    await drainImportJobs(db, env, preview.id, "SETUP_IMPORT_COMMIT");
    expect(await service.importStatus(preview.id)).toMatchObject({
      status: "COMMITTED",
      publishStatus: "READY",
      verification: {
        created: 343,
        failed: 0,
        branchSettings: 343,
        catalogueVerified: true,
      },
      worker: { status: "SUCCEEDED" },
    });
    await expect(service.commitImport(preview.id, `${preview.commitKey}:altered`)).rejects.toThrow(
      "Commit idempotency key does not match the preview",
    );
    expect(await createMenuCatalogReader(db)(tenantId, branchId)).toHaveLength(0);
    const staged = await service.inspectImport(preview.id);
    expect(await service.publishImport(preview.id, staged.publishKey!)).toMatchObject({
      status: "PUBLISHING",
      queued: true,
    });
    await drainImportJobs(db, env, preview.id, "SETUP_IMPORT_PUBLISH");
    expect(await service.importStatus(preview.id)).toMatchObject({ publishStatus: "PUBLISHED" });
    const operational = await createMenuCatalogReader(db)(tenantId, branchId);
    expect(operational).toHaveLength(343);
    expect(operational[0]).toMatchObject({
      price: 350,
      productionStation: "MAIN",
      out: false,
    });
    expect(
      await db
        .prepare(
          `SELECT COUNT(*) count FROM setup_import_reference_aliases
           WHERE tenant_id=? AND branch_id=? AND source_value_normalized='MAIN KITCHEN'`,
        )
        .bind(tenantId, branchId)
        .first("count"),
    ).toBe(1);
  });

  it("rejects expired and catalogue-stale previews before mutation", async () => {
    const expired = await previewCsv(
      service,
      "MENU",
      "itemCode,name,categoryCode,basePrice,currency\nEXPIRED-1,Expired item,MAIN,100,KES",
      "expired-menu-preview",
      "CREATE",
    );
    await db
      .prepare("UPDATE setup_imports SET expires_at=? WHERE tenant_id=? AND id=?")
      .bind("2020-01-01T00:00:00.000Z", tenantId, expired.id)
      .run();
    await expect(service.commitImport(expired.id, expired.commitKey)).rejects.toThrow(
      "preview expired",
    );

    const stale = await previewCsv(
      service,
      "MENU",
      "itemCode,name,categoryCode,basePrice,currency\nSTALE-1,Stale item,MAIN,100,KES",
      "stale-menu-preview",
      "CREATE",
    );
    await db
      .prepare(
        `INSERT INTO menu_catalog_items
          (tenant_id,id,code,name,category_code,selling_price_minor,currency,sellable,active,
           payload_json,created_at,updated_at)
         VALUES (?,'menu-external-change','EXTERNAL-CHANGE','External change','MAIN',10000,'KES',1,1,'{}',?,?)`,
      )
      .bind(tenantId, stamp, "2026-09-01T08:00:01.000Z")
      .run();
    await expect(service.commitImport(stale.id, stale.commitKey)).rejects.toThrow(
      "catalogue changed after preview",
    );
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=? AND code='STALE-1'",
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(0);
  });

  it("rejects publication when the live catalogue changes after commit verification", async () => {
    const preview = await previewCsv(
      service,
      "MENU",
      "itemCode,name,categoryCode,basePrice,currency\nPUBLISH-STALE-1,Stale publish item,MAIN,100,KES",
      "stale-menu-publication",
      "CREATE",
    );
    await service.commitImport(preview.id, preview.commitKey);
    await drainImportJobs(db, env, preview.id, "SETUP_IMPORT_COMMIT");
    const staged = await service.inspectImport(preview.id);
    await service.publishImport(preview.id, staged.publishKey!);
    await db
      .prepare(
        `INSERT INTO menu_catalog_items
          (tenant_id,id,code,name,category_code,selling_price_minor,currency,sellable,active,
           payload_json,created_at,updated_at)
         VALUES (?,'menu-publish-race','PUBLISH-RACE','Concurrent item','MAIN',10000,'KES',1,1,'{}',?,?)`,
      )
      .bind(tenantId, stamp, "2026-09-01T08:00:02.000Z")
      .run();

    await expect(
      service.publishImport(preview.id, staged.publishKey!, { worker: true }),
    ).rejects.toThrow("could not be verified for publication");
    expect(await service.importStatus(preview.id)).toMatchObject({ publishStatus: "FAILED" });
    expect(
      await db
        .prepare("SELECT pipeline_state FROM setup_imports WHERE tenant_id=? AND id=?")
        .bind(tenantId, preview.id)
        .first("pipeline_state"),
    ).toBe("VERIFICATION_FAILED");
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=? AND code='PUBLISH-STALE-1'",
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(0);
  });

  it("rejects branch activation outside the actor assignment", async () => {
    const restricted = new OnboardingService(db, actor([branchId]), env);
    await expect(
      restricted.previewImport({
        targetMode: "SELECTED_BRANCHES",
        targetBranchIds: [secondBranchId],
        kind: "MENU",
        originalName: "unauthorized-branch.csv",
        mimeType: "text/csv",
        bytes: new TextEncoder().encode(
          "itemCode,name,categoryCode,basePrice,currency\nDENIED,Denied item,MAIN,100,KES",
        ),
        duplicateStrategy: "CREATE",
        idempotencyKey: "unauthorized-branch-preview",
      }),
    ).rejects.toThrow("outside the authenticated import assignment");
  });

  it("rejects missing stable item codes and prevents committing a rejected preview", async () => {
    const preview = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\n,Missing code,MAIN,100",
      "menu-preview-invalid",
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "REQUIRED", field: "itemCode" }),
    );
    await expect(service.commitImport(preview.id, preview.commitKey)).rejects.toThrow(
      "validation errors",
    );
  });

  it("enforces explicit duplicate strategies against authoritative records", async () => {
    const first = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nMENU-02,First name,MAIN,100",
      "duplicate-first",
    );
    await completeMenuImport(service, db, env, first);
    const duplicate = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nMENU-02,Second name,MAIN,120",
      "duplicate-create",
      "CREATE",
    );
    expect(duplicate).toMatchObject({ status: "REJECTED", canCommit: false, errorCount: 1 });
    expect(duplicate.rows[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_ITEM", field: "itemCode" }),
    );
    const update = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nMENU-02,Second name,MAIN,120",
      "duplicate-update",
      "UPDATE",
    );
    await completeMenuImport(service, db, env, update);
    expect((await service.listMenuCatalog())[0]).toMatchObject({
      name: "Second name",
      selling_price_minor: 12000,
    });
  });

  it("imports inventory with exact rational conversion and supplier data through server preview", async () => {
    const inventory = await previewCsv(
      service,
      "INVENTORY",
      "code,name,baseUnit,purchaseUnit,dimension,factorNumerator,factorDenominator\nOIL,Oil,L,JERRICAN,VOLUME,20,1",
      "inventory-import",
    );
    await service.commitImport(inventory.id, inventory.commitKey);
    const supplier = await previewCsv(
      service,
      "SUPPLIER",
      "code,name,leadTimeDays,currency\nSUP-1,Configured supplier,2,KES",
      "supplier-import",
    );
    await service.commitImport(supplier.id, supplier.commitKey);
    expect(await rowCount(db, "inventory_items")).toBe(2);
    expect(await rowCount(db, "item_unit_conversions")).toBe(1);
    expect(await rowCount(db, "suppliers")).toBe(1);
  });

  it("rejects invalid rational inventory conversion during preview", async () => {
    const preview = await previewCsv(
      service,
      "INVENTORY",
      "code,name,baseUnit,purchaseUnit,dimension,factorNumerator,factorDenominator\nBAD,Invalid conversion,KG,BOX,MASS,1,0",
      "inventory-invalid-rational",
    );
    expect(preview).toMatchObject({ canCommit: false, errorCount: 1 });
    expect(preview.rows[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "INVALID_RATIONAL" }),
    );
  });

  it("rejects plaintext credentials in staff imports", async () => {
    const preview = await previewCsv(
      service,
      "STAFF",
      `employeeCode,name,role,branch,password\nEMP-02,Imported user,SETUP_ADMIN,${branchId},secret`,
      "staff-password-rejected",
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "PLAINTEXT_CREDENTIAL_FORBIDDEN" }),
    );
  });

  it("rejects unknown roles and branch assignments during staff preview", async () => {
    const preview = await previewCsv(
      service,
      "STAFF",
      "employeeCode,name,role,branch\nEMP-03,Invalid assignment,UNKNOWN_ROLE,UNKNOWN_BRANCH",
      "staff-invalid-assignment",
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_ROLE", "UNKNOWN_BRANCH"]),
    );
  });

  it("posts opening stock only after approval and creates one append-only movement", async () => {
    const opening = await service.createOpeningStock({
      branchId,
      warehouseId,
      businessDate: "2026-09-01",
      currency: "KES",
      idempotencyKey: "opening-stock-one",
      lines: [
        {
          inventoryItemId: "inventory-existing",
          unitId: "unit-kg",
          quantityMicro: 2_000_000,
          unitCostMinor: 50_000,
        },
      ],
    });
    await expect(service.postOpeningStock(opening.id)).rejects.toThrow("approved");
    await service.approveOpeningStock(opening.id, "Verified physical opening count");
    expect(await service.listOpeningStock(branchId)).toContainEqual(
      expect.objectContaining({
        id: opening.id,
        status: "APPROVED",
        approved_at: expect.any(String),
      }),
    );
    expect(await service.postOpeningStock(opening.id)).toMatchObject({
      movements: 1,
      duplicate: false,
    });
    expect(await service.postOpeningStock(opening.id)).toMatchObject({ duplicate: true });
    expect(await rowCount(db, "inventory_movements")).toBe(1);
    await expect(
      db
        .prepare("UPDATE inventory_movements SET quantity_minor=1 WHERE tenant_id=?")
        .bind(tenantId)
        .run(),
    ).rejects.toThrow("INVENTORY_MOVEMENT_IMMUTABLE");
  });

  it("validates recipe readiness from stored menu and recipe evidence", async () => {
    const preview = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nMENU-03,Recipe required,MAIN,500",
      "recipe-menu",
    );
    await completeMenuImport(service, db, env, preview);
    const result = await service.validateRecipes();
    expect(result.quality).toBe("LOW");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_RECIPE" }));
  });

  it("identifies persisted sub-recipe cycles during readiness validation", async () => {
    for (const [recipeId, menuId, versionId] of [
      ["recipe-cycle-a", "menu-cycle-a", "version-cycle-a"],
      ["recipe-cycle-b", "menu-cycle-b", "version-cycle-b"],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO recipes
            (tenant_id,id,menu_item_id,yield_minor,active,payload_json,name,current_version_id,updated_at)
           VALUES (?,?,?,1000000,1,'{}',?,?,?)`,
        )
        .bind(tenantId, recipeId, menuId, recipeId, versionId, stamp)
        .run();
      await db
        .prepare(
          `INSERT INTO recipe_versions
            (tenant_id,id,recipe_id,version,yield_quantity_minor,yield_unit_id,effective_from,active,
             packaging_cost_minor,production_overhead_minor,created_by,created_at)
           VALUES (?,?,?,1,1000000,'unit-kg','2026-09-01',1,0,0,?,?)`,
        )
        .bind(tenantId, versionId, recipeId, actor().id, stamp)
        .run();
    }
    await db
      .prepare(
        `INSERT INTO recipe_version_components
          (tenant_id,id,recipe_version_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps,optional)
         VALUES (?,'component-cycle-a','version-cycle-a','recipe-cycle-b',1000,'unit-kg',0,0),
                (?,'component-cycle-b','version-cycle-b','recipe-cycle-a',1000,'unit-kg',0,0)`,
      )
      .bind(tenantId, tenantId)
      .run();
    expect((await service.validateRecipes()).issues).toContainEqual(
      expect.objectContaining({ code: "RECIPE_CYCLE", severity: "CRITICAL" }),
    );
  });

  it("requires finance sign-off and rejects cross-tenant account mappings", async () => {
    await service.configureAccountMapping({
      mappingKey: "INVENTORY",
      requirement: "REQUIRED",
      accountId: "account-inventory",
      financeSignoff: "APPROVED",
    });
    expect(
      await db
        .prepare("SELECT finance_signoff_status FROM setup_account_mappings WHERE tenant_id=?")
        .bind(tenantId)
        .first("finance_signoff_status"),
    ).toBe("APPROVED");
    expect(
      await service.configureAccountMapping({
        mappingKey: "INVALID",
        requirement: "OPTIONAL",
        accountId: "account-other-tenant",
      }),
    ).toMatchObject({ status: "INVALID" });
  });

  it("persists configured tax and service-charge rules without inferring a rate", async () => {
    await service.configureTaxServiceRule({
      branchId,
      ruleType: "SERVICE_CHARGE",
      code: "SERVICE",
      name: "Configured service charge",
      rateBps: 725,
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-09-01",
      accountId: "account-revenue",
    });
    expect(
      await db
        .prepare("SELECT rate_bps,calculation_mode FROM tax_service_rules WHERE tenant_id=?")
        .bind(tenantId)
        .first(),
    ).toMatchObject({ rate_bps: 725, calculation_mode: "EXCLUSIVE" });
  });

  it("stores provider credentials only in the managed secret boundary and returns metadata", async () => {
    const result = await service.configureProviderConnection({
      id: "connection-daraja",
      branchId,
      providerId: "provider-daraja",
      environment: "SANDBOX",
      configuration: { shortcode: "configured-shortcode" },
      credentials: { consumerKey: "sensitive-key", consumerSecret: "sensitive-secret" },
    });
    expect(result).toMatchObject({ status: "CONFIGURED", secretConfigured: true });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect([...secretValues.values()][0]?.value).toContain("sensitive-secret");
    const connection = await db
      .prepare(
        "SELECT secret_reference,payload_json FROM provider_connections WHERE tenant_id=? AND id=?",
      )
      .bind(tenantId, result.id)
      .first<{ secret_reference: string; payload_json: string }>();
    expect(connection?.secret_reference).toMatch(/^managed:\/\//);
    expect(connection?.payload_json).not.toContain("sensitive");

    const updated = await service.configureProviderConnection({
      id: "connection-daraja",
      branchId,
      providerId: "provider-daraja",
      environment: "SANDBOX",
      configuration: { shortcode: "updated-shortcode" },
    });
    expect(updated).toMatchObject({ status: "CONFIGURED", secretConfigured: true });
    const preserved = await db
      .prepare(
        "SELECT secret_reference,payload_json FROM provider_connections WHERE tenant_id=? AND id=?",
      )
      .bind(tenantId, result.id)
      .first<{ secret_reference: string; payload_json: string }>();
    expect(preserved?.secret_reference).toBe(connection?.secret_reference);
    expect(preserved?.payload_json).toContain("updated-shortcode");
    expect(preserved?.payload_json).not.toContain("sensitive");
  });

  it("generates provider callbacks with the public provider code", async () => {
    const result = await service.configureProviderConnection({
      id: "connection-uber-sandbox",
      branchId,
      providerId: "provider-delivery-uber-eats",
      environment: "SANDBOX",
      configuration: { externalStoreId: "sandbox-store" },
      secretReference: "env://SERAMET_UBER_CREDENTIALS",
    });
    const connection = await db
      .prepare("SELECT payload_json FROM provider_connections WHERE tenant_id=? AND id=?")
      .bind(tenantId, result.id)
      .first<{ payload_json: string }>();

    expect(JSON.parse(connection!.payload_json)).toMatchObject({
      callbackUrl:
        "https://callbacks.example.test/api/seramet/integrations/webhooks/UBER_EATS/connection-uber-sandbox",
    });
  });

  it("does not claim a provider connection is configured without credentials", async () => {
    expect(
      await service.configureProviderConnection({
        id: "connection-pesapal-empty",
        branchId,
        providerId: "provider-pesapal",
        environment: "SANDBOX",
      }),
    ).toMatchObject({ status: "CREDENTIALS_REQUIRED", secretConfigured: false });
    expect(await service.integrationHealth()).toContainEqual(
      expect.objectContaining({
        connectionId: "connection-pesapal-empty",
        health: "CONFIG_REQUIRED",
      }),
    );
  });

  it("requires explicit review and tenant-valid identities for external mappings", async () => {
    await service.configureProviderConnection({
      id: "connection-mapping",
      branchId,
      providerId: "provider-delivery-glovo",
      environment: "SANDBOX",
      secretReference: "managed://configured/glovo",
    });
    await expect(
      service.configureExternalMapping({
        connectionId: "connection-mapping",
        branchId,
        resourceType: "STORE",
        internalId: branchId,
        externalId: "external-store",
        status: "MAPPED",
        reviewConfirmed: false,
      }),
    ).rejects.toThrow("explicit review");
    expect(
      await service.configureExternalMapping({
        connectionId: "connection-mapping",
        branchId,
        resourceType: "STORE",
        internalId: branchId,
        externalId: "external-store",
        status: "MAPPED",
        reviewConfirmed: true,
      }),
    ).toMatchObject({ status: "MAPPED" });
  });

  it("keeps device health unknown until observed and marks test documents", async () => {
    const device = await service.configureDevice({
      branchId,
      deviceType: "PRINTER",
      name: "Configured printer",
      role: "KOT",
      paperSize: "80mm",
    });
    expect(device).toMatchObject({ trustStatus: "PENDING", health: "UNKNOWN" });
    const test = await service.runTest({
      branchId,
      testType: "PRINT",
      targetType: "PRINTER",
      targetId: device.id,
      idempotencyKey: "print-test-pending",
    });
    expect(test).toMatchObject({ status: "DEVICE_OFFLINE", marker: "*** TEST PRINT ***" });
    expect(test.result).toMatchObject({ financialTransactionCreated: false });
  });

  it("runs a safe order test without financial, tax or inventory facts", async () => {
    const before = {
      orders: await rowCount(db, "orders"),
      movements: await rowCount(db, "inventory_movements"),
      journals: await rowCount(db, "journal_entries"),
    };
    const result = await service.runTest({
      branchId,
      testType: "ORDER",
      targetType: "POS",
      idempotencyKey: "safe-order-test",
    });
    expect(result).toMatchObject({ status: "SUCCESS", marker: "*** TEST ***" });
    expect(result.result).toMatchObject({
      financialFactsCreated: false,
      inventoryMovementsCreated: false,
      taxFactsCreated: false,
    });
    expect({
      orders: await rowCount(db, "orders"),
      movements: await rowCount(db, "inventory_movements"),
      journals: await rowCount(db, "journal_entries"),
    }).toEqual(before);
  });

  it("calculates deterministic readiness from authoritative evidence and persists snapshots", async () => {
    const first = await service.recalculateReadiness(branchId, true);
    const second = await service.recalculateReadiness(branchId, true);
    expect(second.overallScoreBps).toBe(first.overallScoreBps);
    expect(second.results.map((row) => [row.code, row.status])).toEqual(
      first.results.map((row) => [row.code, row.status]),
    );
    expect(first.results).toContainEqual(
      expect.objectContaining({ code: "VERIFIED_BACKUP_AVAILABLE", status: "WARNING" }),
    );
    expect(await rowCount(db, "setup_stage_snapshots")).toBe(18);
  });

  it("enforces explicit go-live transitions and blocks incomplete readiness progression", async () => {
    await expect(service.transitionGoLive({ toState: "READY_FOR_GO_LIVE" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(await service.transitionGoLive({ toState: "READY_FOR_REVIEW" })).toMatchObject({
      fromState: "SETUP",
      toState: "READY_FOR_REVIEW",
    });
    await expect(service.transitionGoLive({ toState: "READY_FOR_GO_LIVE" })).rejects.toThrow(
      "blockers",
    );
    expect(await auditCount(db, "GO_LIVE_STATE_CHANGED")).toBe(1);
  });

  it("requires separate override permission and a meaningful reason", async () => {
    await service.transitionGoLive({ toState: "READY_FOR_REVIEW" });
    const noOverride = new OnboardingService(
      db,
      actor(
        undefined,
        allPermissionCodes.filter((code) => code !== permissions.setupGoLiveOverride),
      ),
      env,
    );
    await expect(
      noOverride.transitionGoLive({
        toState: "READY_FOR_GO_LIVE",
        override: true,
        reason: "Reviewed operational blockers for pilot",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.transitionGoLive({
        toState: "READY_FOR_GO_LIVE",
        override: true,
        reason: "short",
      }),
    ).rejects.toThrow("requires a reason");
  });

  it("enforces setup permissions and assigned branch scope on direct service calls", async () => {
    const restricted = new OnboardingService(db, actor([branchId], [permissions.setupView]), env);
    await expect(
      restricted.updateBusinessProfile({
        legalName: "Denied",
        tradingName: "Denied",
        countryCode: "KE",
        defaultCurrency: "KES",
        timezone: "Africa/Nairobi",
        locale: "en-KE",
        accountingMode: "PERPETUAL",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(restricted.listMenuCatalog(secondBranchId)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(
      restricted.configureProviderConnection({
        providerId: "provider-daraja",
        environment: "SANDBOX",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      restricted.requestDataExport({
        entityTypes: ["menu"],
        rowLimit: 10,
        idempotencyKey: "unauthorized-export",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      restricted.setEntitlement({
        subscriptionId: "subscription-a",
        featureKey: "payments.providers",
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      restricted.configureDevice({
        branchId,
        deviceType: "PRINTER",
        name: "Unauthorized device",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("requires authentication before any setup API route is dispatched", async () => {
    await expect(
      handleOnboardingApi(new Request("https://seramet.test/api/seramet/setup/centre"), env),
    ).rejects.toMatchObject({ status: 401, message: "Bearer authentication required" });
  });

  it("enforces tenant isolation for configuration, imports and exports", async () => {
    const other = new OnboardingService(
      db,
      actor(["branch-other"], allPermissionCodes, secondTenantId),
      env,
    );
    expect(await other.listMenuCatalog()).toHaveLength(0);
    await expect(other.listMenuCatalog(branchId)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      other.commitImport("missing-from-other-tenant", "commit:anything"),
    ).rejects.toThrow("not found");
  });

  it("persists feature flags, entitlements and non-destructive subscription lifecycle events", async () => {
    await service.setFeatureFlag({ key: "payments.provider", enabled: true });
    await service.setEntitlement({
      subscriptionId: "subscription-a",
      featureKey: "payments.providers",
      enabled: true,
      limits: { connections: 2 },
    });
    await service.setSubscriptionLifecycle({
      subscriptionId: "subscription-a",
      status: "SUSPENDED",
      effectiveAt: stamp,
      reason: "Configured commercial suspension",
    });
    expect(await rowCount(db, "feature_flags")).toBe(1);
    expect(await rowCount(db, "feature_entitlements")).toBe(2);
    expect(await rowCount(db, "subscription_lifecycle_events")).toBe(1);
    expect(await rowCount(db, "menu_catalog_items")).toBe(0);
    await expect(service.assertEntitlement("payments.providers")).rejects.toThrow("not entitled");
  });

  it("returns redacted diagnostics and never includes secrets or session material", async () => {
    const diagnostics = await service.diagnostics();
    expect(diagnostics).toMatchObject({
      schema: { current: CURRENT_SCHEMA_VERSION, required: CURRENT_SCHEMA_VERSION, pending: 0 },
      redaction: { secrets: "EXCLUDED", tokens: "EXCLUDED", credentials: "EXCLUDED" },
    });
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive-secret");
  });

  it("generates a bounded tenant export through the durable worker and preserves tenant scope", async () => {
    const menu = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nEXPORT-1,Export item,MAIN,100",
      "export-menu",
    );
    await completeMenuImport(service, db, env, menu);
    const requested = await service.requestDataExport({
      entityTypes: ["menu"],
      rowLimit: 50,
      idempotencyKey: "tenant-export-one",
    });
    await processWorkerJob(db, env, requested.id);
    const exported = await service.getDataExport(requested.id, true);
    expect(exported).toMatchObject({ status: "READY" });
    expect(exported.manifest).toMatchObject({ counts: { menu: 1 }, exportedRows: 1 });
    expect(JSON.stringify(exported)).toContain("EXPORT-1");
    expect(JSON.stringify(exported)).not.toContain(secondTenantId);
    expect(await auditCount(db, "TENANT_DATA_EXPORT_REQUESTED")).toBe(1);
  });

  it("generates a redacted support diagnostic bundle through the durable worker", async () => {
    const requested = await service.requestDiagnosticsExport({
      scope: { setup: true },
      idempotencyKey: "diagnostics-one",
    });
    await processWorkerJob(db, env, requested.id);
    const result = await service.getDiagnosticsExport(requested.id);
    expect(result).toMatchObject({ status: "READY" });
    expect(JSON.stringify(result)).toContain('"cardData":"EXCLUDED"');
    expect(JSON.stringify(result).toLowerCase()).not.toContain("sensitive-secret");
  });

  it("rejects production demo reset and queues it only for explicit resettable demo tenants", async () => {
    await expect(
      new OnboardingService(db, actor(), {
        ...env,
        SERAMET_ENVIRONMENT: "production",
      }).resetDemoTenant({
        reason: "Controlled production reset attempt",
        idempotencyKey: "reset-production",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await db
      .prepare(
        "UPDATE tenant_onboarding_profiles SET demo_mode=1,demo_reset_allowed=1 WHERE tenant_id=?",
      )
      .bind(tenantId)
      .run();
    expect(
      await service.resetDemoTenant({
        reason: "Restore explicit demonstration baseline",
        idempotencyKey: "reset-development",
      }),
    ).toMatchObject({ queued: true, duplicate: false });
  });

  it("provisions a new organisation with isolated admin permissions and no restaurant-specific seed", async () => {
    const platform = new OnboardingService(db, actor(undefined, allPermissionCodes), env);
    const result = await platform.provisionOrganisation({
      slug: "configured-new-tenant",
      legalName: "New Legal Entity",
      tradingName: "New Restaurant",
      countryCode: "KE",
      defaultCurrency: "KES",
      timezone: "Africa/Nairobi",
      locale: "en-KE",
      accountingMode: "PERPETUAL",
      brandCode: "PRIMARY",
      brandName: "Primary brand",
      administratorEmail: "admin@example.test",
    });
    expect(result.goLiveState).toBe("SETUP");
    expect(
      await db
        .prepare("SELECT COUNT(*) count FROM role_permissions WHERE tenant_id=?")
        .bind(result.tenantId)
        .first("count"),
    ).toBe(allPermissionCodes.length);
    expect(
      await db
        .prepare("SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=?")
        .bind(result.tenantId)
        .first("count"),
    ).toBe(0);
  });

  it("schedules persisted setup readiness work without duplicate jobs", async () => {
    const sent: SerametWorkerMessage[] = [];
    const scheduledEnv: SerametEnv = {
      ...env,
      SERAMET_WORK_QUEUE: {
        async send(body) {
          sent.push(body as SerametWorkerMessage);
        },
        async sendBatch(messages) {
          sent.push(...messages.map((message) => message.body as SerametWorkerMessage));
        },
      },
    };
    const at = new Date("2026-09-01T08:30:00.000Z");
    await scheduleDurableWork(scheduledEnv, at);
    const firstCount = await workerCount(db, "SETUP_READINESS_RECALCULATION");
    await scheduleDurableWork(scheduledEnv, at);
    expect(await workerCount(db, "SETUP_READINESS_RECALCULATION")).toBe(firstCount);
    expect(sent.some((message) => message.kind === "worker-job")).toBe(true);
  });

  it("moves a repeatedly failing durable setup job to dead letter without duplicate execution", async () => {
    await db
      .prepare(
        `INSERT INTO worker_jobs
          (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,
           max_attempts,scheduled_at,created_at,updated_at)
         VALUES (?,'worker-failure','UNSUPPORTED_SETUP_JOB','{}','worker-failure','correlation-failure',
                 'PENDING',0,1,?,?,?)`,
      )
      .bind(tenantId, stamp, stamp, stamp)
      .run();
    await processWorkerJob(db, env, "worker-failure", true);
    expect(
      await db
        .prepare("SELECT status FROM worker_jobs WHERE tenant_id=? AND id='worker-failure'")
        .bind(tenantId)
        .first("status"),
    ).toBe("DEAD_LETTER");
    expect((await service.getSetupCentre()).counts.deadLetters).toBe(1);
  });

  it("retains existing financial, inventory, document and audit immutability triggers", async () => {
    const triggerNames = [
      "confirmed_payment_immutable",
      "posted_journal_immutable",
      "inventory_movement_no_update",
      "audit_events_no_update",
    ];
    for (const trigger of triggerNames) {
      expect(
        await db
          .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?")
          .bind(trigger)
          .first(),
        trigger,
      ).not.toBeNull();
    }
  });
});

async function previewCsv(
  service: OnboardingService,
  kind: "MENU" | "INVENTORY" | "SUPPLIER" | "STAFF",
  csv: string,
  idempotencyKey: string,
  duplicateStrategy: "CREATE" | "UPDATE" | "SKIP" | "ERROR" = "ERROR",
) {
  return service.previewImport({
    branchId,
    kind,
    originalName: `${idempotencyKey}.csv`,
    mimeType: "text/csv",
    bytes: new TextEncoder().encode(csv),
    duplicateStrategy,
    idempotencyKey,
  });
}

async function processWorkerJob(
  db: SqliteD1TestDatabase,
  env: SerametEnv,
  entityId: string,
  directJob = false,
) {
  const job = await db
    .prepare(
      directJob
        ? `SELECT id,correlation_id FROM worker_jobs WHERE tenant_id=? AND id=?`
        : `SELECT id,correlation_id FROM worker_jobs WHERE tenant_id=?
           AND json_extract(payload_json,'$.exportId')=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(tenantId, entityId)
    .first<{ id: string; correlation_id: string }>();
  if (!job) throw new Error("Expected durable worker job was not created");
  const state = { acknowledged: 0, retries: 0 };
  const message: DurableQueueMessage<SerametWorkerMessage> = {
    id: `message-${job.id}`,
    timestamp: new Date(stamp),
    body: { kind: "worker-job", tenantId, jobId: job.id, correlationId: job.correlation_id },
    attempts: 1,
    ack() {
      state.acknowledged += 1;
    },
    retry() {
      state.retries += 1;
    },
  };
  await handleWorkerQueue({ queue: "seramet-test", messages: [message] }, env);
  expect(state).toEqual({ acknowledged: 1, retries: 0 });
}

async function drainImportJobs(
  db: SqliteD1TestDatabase,
  env: SerametEnv,
  importId: string,
  jobType: "SETUP_IMPORT_COMMIT" | "SETUP_IMPORT_PUBLISH",
) {
  for (let batch = 0; batch < 2_000; batch += 1) {
    const job = await db
      .prepare(
        `SELECT id FROM worker_jobs WHERE tenant_id=? AND job_type=? AND status='PENDING'
           AND idempotency_key LIKE ? ORDER BY created_at,id LIMIT 1`,
      )
      .bind(tenantId, jobType, `setup-import-%:${importId}:%`)
      .first<{ id: string }>();
    if (!job) return;
    await processWorkerJob(db, env, job.id, true);
  }
  throw new Error("Import worker chain exceeded its bounded test limit");
}

async function completeMenuImport(
  service: OnboardingService,
  db: SqliteD1TestDatabase,
  env: SerametEnv,
  preview: ImportPreview,
) {
  await service.commitImport(preview.id, preview.commitKey);
  await drainImportJobs(db, env, preview.id, "SETUP_IMPORT_COMMIT");
  const staged = await service.inspectImport(preview.id);
  if (!staged.publishKey) throw new Error("Verified import did not expose its publish identity");
  await service.publishImport(staged.id, staged.publishKey);
  await drainImportJobs(db, env, staged.id, "SETUP_IMPORT_PUBLISH");
  return service.inspectImport(staged.id);
}

async function signTestToken(input: { tid: string; sub: string; sid: string }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    ...input,
    iss: jwtIssuer,
    aud: jwtAudience,
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

function actor(
  branches: string[] | undefined = [branchId, secondBranchId],
  permissionCodes = allPermissionCodes,
  selectedTenant = tenantId,
): ServerActor {
  const assigned = branches ?? [branchId, secondBranchId];
  return {
    id: `setup-user-${selectedTenant}`,
    name: "Configured setup administrator",
    tenantId: selectedTenant,
    roleIds: ["setup-admin"],
    permissions: [...permissionCodes],
    assignedBranchIds: assigned,
    assignedBranches: assigned.map((id) => ({ id, name: id })),
    branchScope: permissionCodes.includes(permissions.tenantScopeAllBranches)
      ? { type: "ALL" }
      : { type: "BRANCH", branchId: assigned[0] ?? "platform" },
    branchId: assigned[0] ?? "platform",
    branch: assigned[0] ?? "Platform",
    role: "Configured role",
  };
}

function testEnvironment(
  database: SqliteD1TestDatabase,
  secrets: Map<string, { value: string; version: string }>,
): SerametEnv {
  return {
    SERAMET_ENVIRONMENT: "test",
    SERAMET_DB: database,
    SERAMET_MALWARE_SCANNER: {
      async fetch(_input, init) {
        const headers = new Headers(init?.headers);
        const sha256 = headers.get("x-seramet-content-sha256") ?? "";
        return Response.json({
          verdict: "CLEAN",
          sha256,
          evidenceId: `test-clean-${headers.get("x-seramet-scan-job-id")}-${sha256.slice(0, 12)}`,
          scannerId: "seramet-test-scanner",
          engine: "seramet-test-scanner",
          signatureVersion: "test-signatures-1",
          scannedAt: new Date().toISOString(),
          jobId: headers.get("x-seramet-scan-job-id"),
          objectKey: headers.get("x-seramet-object-key"),
          objectVersion: headers.get("x-seramet-object-version"),
        });
      },
    },
    SERAMET_CALLBACK_BASE_URL: "https://callbacks.example.test",
    SERAMET_MANAGED_SECRET_STORE: {
      async get(reference: string) {
        return secrets.get(reference) ?? null;
      },
      async put(reference: string, value: string) {
        const version = `v${secrets.size + 1}`;
        secrets.set(reference, { value, version });
        return { version };
      },
    },
  };
}

async function authorizeQueuedImportScan(env: SerametEnv, jobId: string) {
  const row = await env
    .SERAMET_DB!.prepare(
      "SELECT tenant_id,correlation_id FROM worker_jobs WHERE id=? AND job_type='SETUP_IMPORT_PREPARE'",
    )
    .bind(jobId)
    .first<{ tenant_id: string; correlation_id: string }>();
  if (!row) throw new Error("Queued import job was not found");
  const claimPayload = {
    tenantId: row.tenant_id,
    jobId,
    correlationId: row.correlation_id,
  };
  const claim = await scannerRequest(env, "/api/seramet/internal/file-scanner/claim", claimPayload);
  const claimBody = (await claim.json()) as { job?: Record<string, unknown> };
  if (!claimBody.job) throw new Error("Scanner claim did not return the file identity");
  const verdict = await scannerRequest(env, "/api/seramet/internal/file-scanner/verdict", {
    ...claimBody.job,
    verdict: "CLEAN",
    evidenceId: `test-${jobId}`,
    scannerId: "seramet-test-clamav",
    engine: "ClamAV",
    engineVersion: "test",
    signatureVersion: "test-signatures",
    scannedAt: new Date().toISOString(),
  });
  if (verdict.status !== 202) throw new Error(`Scanner verdict failed (${verdict.status})`);
}

async function scannerRequest(env: SerametEnv, pathname: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const auth = await signScannerRequest({
    secret: scannerSecret,
    method: "POST",
    pathname,
    body,
  });
  const response = await handleScannerInternalApi(
    new Request(`https://scanner.test${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...scannerAuthRequestHeaders(auth) },
      body,
    }),
    env,
  );
  if (!response) throw new Error("Scanner route was not handled");
  return response;
}

function memoryObjectStore(): ObjectStoreBinding {
  const objects = new Map<
    string,
    {
      bytes: ArrayBuffer;
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    }
  >();
  return {
    async head(key) {
      return objects.get(key) ?? null;
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        arrayBuffer: async () => object.bytes.slice(0),
        ...(object.httpMetadata ? { httpMetadata: object.httpMetadata } : {}),
        ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}),
      };
    },
    async put(key, value, options) {
      let bytes: ArrayBuffer;
      if (typeof value === "string") {
        bytes = new TextEncoder().encode(value).buffer as ArrayBuffer;
      } else if (value instanceof ArrayBuffer) {
        bytes = value.slice(0);
      } else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
          .buffer as ArrayBuffer;
      } else {
        throw new Error("The test object store does not accept streaming values");
      }
      objects.set(key, {
        bytes,
        ...(options?.httpMetadata ? { httpMetadata: options.httpMetadata } : {}),
        ...(options?.customMetadata ? { customMetadata: options.customMetadata } : {}),
      });
      return { version: `memory:${key}` };
    },
    async delete(key) {
      for (const objectKey of Array.isArray(key) ? key : [key]) objects.delete(objectKey);
    },
  };
}

function seedFoundation(db: SqliteD1TestDatabase) {
  for (const [id, slug] of [
    [tenantId, "setup-a"],
    [secondTenantId, "setup-b"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .run(id, slug, `Legal ${slug}`, `Trading ${slug}`, stamp, stamp);
    db.sqlite
      .prepare(
        `INSERT INTO tenant_onboarding_profiles
          (tenant_id,country_code,accounting_mode,go_live_state,demo_mode,demo_reset_allowed,created_by,created_at,updated_by,updated_at)
         VALUES (?,'KE','PERPETUAL','SETUP',0,0,?,?,?,?)`,
      )
      .run(id, `setup-user-${id}`, stamp, `setup-user-${id}`, stamp);
  }
  db.sqlite
    .prepare(
      "INSERT INTO brands (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
    )
    .run(tenantId, "brand-setup-a", "PRIMARY", "Configured brand");
  for (const [id, code, warehouse] of [
    [branchId, "A", warehouseId],
    [secondBranchId, "B", "warehouse-setup-b"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO branches
          (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
         VALUES (?,?,?,?,?,'Africa/Nairobi',240,1,'{}')`,
      )
      .run(tenantId, id, "brand-setup-a", code, `Configured ${code}`);
    db.sqlite
      .prepare(
        `INSERT INTO branch_operating_profiles
          (tenant_id,branch_id,negative_stock_policy,operating_hours_json,service_modes_json,
           required_device_roles_json,payments_required,inventory_enabled,recipes_required,
           printing_required,kds_required,created_by,created_at,updated_by,updated_at)
         VALUES (?,?,'BLOCK','{}','[]','[]',0,1,0,0,0,?,?,?,?)`,
      )
      .run(tenantId, id, `setup-user-${tenantId}`, stamp, `setup-user-${tenantId}`, stamp);
    db.sqlite
      .prepare(
        "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,?,?,1,'{}')",
      )
      .run(tenantId, warehouse, id, `WH-${code}`, `Warehouse ${code}`);
  }
  db.sqlite
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')",
    )
    .run(secondTenantId, "branch-other", "OTHER", "Other tenant branch");
  db.sqlite
    .prepare(
      "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,?,?,1,'{}')",
    )
    .run(secondTenantId, "warehouse-other", "branch-other", "OTHER", "Other warehouse");

  for (const code of allPermissionCodes) {
    db.sqlite
      .prepare(
        "INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT(code) DO NOTHING",
      )
      .run(code, code);
  }
  seedUser(db, tenantId, `setup-user-${tenantId}`, branchId, secondBranchId);
  seedUser(db, secondTenantId, `setup-user-${secondTenantId}`, "branch-other");

  for (const [id, code, name, type, tenant] of [
    ["account-inventory", "INV", "Inventory", "ASSET", tenantId],
    ["account-revenue", "REV", "Revenue", "REVENUE", tenantId],
    ["account-other-tenant", "OTHER", "Other", "ASSET", secondTenantId],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO accounts
          (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
         VALUES (?,?,NULL,?,?,?,'KES',1,'{}')`,
      )
      .run(tenant, id, code, name, type);
  }
  db.sqlite
    .prepare(
      `INSERT INTO unit_definitions
        (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at)
       VALUES (?,'unit-kg','KG','Kilogram','kg','MASS',1,1,1,?,?)`,
    )
    .run(tenantId, stamp, stamp);
  db.sqlite
    .prepare(
      `INSERT INTO inventory_items
        (tenant_id,id,sku,name,unit,active,payload_json,code,base_unit_id,purchase_unit_id,
         storage_unit_id,issue_unit_id,track_inventory,track_expiry,updated_at)
       VALUES (?,'inventory-existing','EXISTING','Existing item','kg',1,'{}','EXISTING','unit-kg',
               'unit-kg','unit-kg','unit-kg',1,0,?)`,
    )
    .run(tenantId, stamp);
  db.sqlite
    .prepare(
      `INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
       VALUES (?,'station-main',?,'MAIN','Main station','KITCHEN',1,'{}')`,
    )
    .run(tenantId, branchId);
  db.sqlite
    .prepare(
      `INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
       VALUES (?,'station-main-b',?,'MAIN','Main station B','KITCHEN',1,'{}')`,
    )
    .run(tenantId, secondBranchId);
  db.sqlite
    .prepare(
      `INSERT INTO plan_definitions (id,code,name,status,created_at,updated_at)
       VALUES ('plan-professional','PROFESSIONAL','Professional','ACTIVE',?,?)`,
    )
    .run(stamp, stamp);
  db.sqlite
    .prepare(
      `INSERT INTO tenant_subscriptions
        (tenant_id,id,plan_id,status,starts_at,created_at,updated_at)
       VALUES (?,'subscription-a','plan-professional','ACTIVE',?,?,?)`,
    )
    .run(tenantId, stamp, stamp, stamp);
  for (const featureKey of ["payments.providers", "integrations.delivery"]) {
    db.sqlite
      .prepare(
        `INSERT INTO feature_entitlements
          (tenant_id,subscription_id,feature_key,enabled,limits_json)
         VALUES (?,'subscription-a',?,1,'{}')`,
      )
      .run(tenantId, featureKey);
  }
}

function seedUser(db: SqliteD1TestDatabase, tenant: string, userId: string, ...branches: string[]) {
  const roleId = `role-${tenant}`;
  db.sqlite
    .prepare(
      "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,'Setup administrator',1,'{}')",
    )
    .run(tenant, roleId, "SETUP_ADMIN");
  db.sqlite
    .prepare(
      `INSERT INTO users
        (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at)
       VALUES (?,?,NULL,'Setup administrator',1,1,'{}',?,?)`,
    )
    .run(tenant, userId, stamp, stamp);
  db.sqlite
    .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
    .run(tenant, userId, roleId);
  for (const code of allPermissionCodes) {
    db.sqlite
      .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
      .run(tenant, roleId, code);
  }
  for (const branch of branches) {
    db.sqlite
      .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
      .run(tenant, userId, branch);
  }
}

async function rowCount(db: SqliteD1TestDatabase, table: string) {
  return Number(
    await db
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?`)
      .bind(tenantId)
      .first("count"),
  );
}

async function auditCount(db: SqliteD1TestDatabase, action: string) {
  return Number(
    await db
      .prepare("SELECT COUNT(*) count FROM audit_events WHERE tenant_id=? AND action=?")
      .bind(tenantId, action)
      .first("count"),
  );
}

async function workerCount(db: SqliteD1TestDatabase, type: string) {
  return Number(
    await db
      .prepare("SELECT COUNT(*) count FROM worker_jobs WHERE tenant_id=? AND job_type=?")
      .bind(tenantId, type)
      .first("count"),
  );
}

function createXlsx(rows: string[][]) {
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${xlsxColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;
  return storedZip({
    "xl/workbook.xml":
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Menu" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet,
  });
}

function storedZip(entries: Record<string, string>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centralParts.length, true);
  endView.setUint16(10, centralParts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function xlsxColumn(index: number) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    output = String.fromCharCode(65 + ((value - 1) % 26)) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
