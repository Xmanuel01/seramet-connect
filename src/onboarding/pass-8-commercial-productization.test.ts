import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SerametEnv, ServerActor } from "@/lib/seramet-auth";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import type { DurableQueueMessage } from "@/server/environment";
import {
  handleWorkerQueue,
  scheduleDurableWork,
  type SerametWorkerMessage,
} from "@/server/workers";
import { handleOnboardingApi } from "@/server/onboarding-api";

const tenantId = "tenant-setup-a";
const secondTenantId = "tenant-setup-b";
const branchId = "branch-setup-a";
const secondBranchId = "branch-setup-b";
const warehouseId = "warehouse-setup-a";
const stamp = "2026-09-01T08:00:00.000Z";

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
    ).toBe(17);
    for (const table of [
      "tenant_onboarding_profiles",
      "branch_operating_profiles",
      "setup_stage_snapshots",
      "setup_readiness_results",
      "setup_imports",
      "setup_import_rows",
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

  it("previews menu files without mutation, commits explicitly and deduplicates commit retries", async () => {
    const preview = await previewCsv(
      service,
      "MENU",
      "code,name,category,price,currency\nMENU-01,Configured meal,MAIN,1250,KES",
      "menu-preview-one",
    );
    expect(preview).toMatchObject({ rowCount: 1, validCount: 1, errorCount: 0, canCommit: true });
    expect(await rowCount(db, "menu_catalog_items")).toBe(0);
    expect(await service.commitImport(preview.id, preview.commitKey)).toMatchObject({
      duplicate: false,
      rows: 1,
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

  it("rejects missing stable item codes and prevents committing a rejected preview", async () => {
    const preview = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\n,Missing code,MAIN,100",
      "menu-preview-invalid",
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "REQUIRED", field: "code" }),
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
    await service.commitImport(first.id, first.commitKey);
    const duplicate = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nMENU-02,Second name,MAIN,120",
      "duplicate-create",
      "CREATE",
    );
    await expect(service.commitImport(duplicate.id, duplicate.commitKey)).rejects.toThrow(
      "cannot be created twice",
    );
    const update = await previewCsv(
      service,
      "MENU",
      "code,name,category,price\nMENU-02,Second name,MAIN,120",
      "duplicate-update",
      "UPDATE",
    );
    await service.commitImport(update.id, update.commitKey);
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
    await service.commitImport(preview.id, preview.commitKey);
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
      schema: { current: 17, required: 17, pending: 0 },
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
    await service.commitImport(menu.id, menu.commitKey);
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
