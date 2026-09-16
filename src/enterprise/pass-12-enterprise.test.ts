import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnterpriseService } from "@/enterprise/enterprise-service";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import { IntelligenceEvidenceService } from "@/intelligence/evidence-tools";
import { classifyIntent, planIntelligenceQuery } from "@/intelligence/query-planner";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { enqueueEnterpriseWork, handleWorkerQueue, scheduleDurableWork } from "@/server/workers";

const tenantId = "tenant-demo-mona";
const branchWest = "branch-demo-westlands";
const branchNgong = "branch-demo-ngong-road";
const groupNode = "enterprise-demo-group";
const westNode = "enterprise-demo-branch-west";
const franchiseNode = "enterprise-demo-franchise";

describe.sequential("Pass 12 enterprise, franchise and HQ control", () => {
  let db: SqliteD1TestDatabase;
  let service: EnterpriseService;

  beforeEach(async () => {
    db = createDemoFixtureDatabase();
    await hydrateAuthoritativeConfiguration(db, {}, true);
    service = new EnterpriseService(db, manager());
  });

  afterEach(() => {
    db.close();
    setConfigurationRepositoryForTests();
  });

  it("applies the current schema with the complete authoritative enterprise table set", () => {
    expect(
      db.sqlite.prepare("SELECT MAX(version) version FROM schema_migrations").get(),
    ).toMatchObject({ version: 20 });
    const tables = db.sqlite
      .prepare(
        `SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN
         ('legal_entities','enterprise_nodes','enterprise_node_closure','enterprise_role_assignments',
          'enterprise_policy_assignments','enterprise_policy_versions','enterprise_rollouts',
          'branch_templates','supplier_contracts','central_requisition_batches',
          'franchise_relationships','franchise_fee_periods','enterprise_readiness_results')`,
      )
      .get() as { count: number };
    expect(tables.count).toBe(13);
  });

  it("keeps legal entities distinct from brands and operational branches", () => {
    const legal = db.sqlite
      .prepare("SELECT COUNT(*) count FROM legal_entities WHERE tenant_id=?")
      .get(tenantId) as { count: number };
    const brands = db.sqlite
      .prepare("SELECT COUNT(*) count FROM brands WHERE tenant_id=?")
      .get(tenantId) as { count: number };
    const branches = db.sqlite
      .prepare("SELECT COUNT(*) count FROM branches WHERE tenant_id=?")
      .get(tenantId) as { count: number };
    expect(legal.count).toBe(2);
    expect(brands.count).toBeGreaterThan(0);
    expect(branches.count).toBe(2);
  });

  it("enforces tenant-scoped hierarchy foreign keys in the database", () => {
    expect(() =>
      db.sqlite
        .prepare(
          `INSERT INTO enterprise_nodes
          (tenant_id,id,node_type,code,name,parent_id,status,effective_from,metadata_json,
           created_by,created_at,updated_by,updated_at)
         VALUES ('missing-tenant','invalid-node','GROUP','INVALID','Invalid',NULL,'ACTIVE',?,'{}','actor',?,'actor',?)`,
        )
        .run(stamp(), stamp(), stamp()),
    ).toThrow();
  });

  it("enforces unique branch and warehouse ownership in the hierarchy", () => {
    expect(() =>
      db.sqlite
        .prepare(
          `INSERT INTO enterprise_nodes
          (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,status,
           effective_from,metadata_json,created_by,created_at,updated_by,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,'{}','actor',?,'actor',?)`,
        )
        .run(
          tenantId,
          "duplicate-branch-node",
          "BRANCH",
          "DUP",
          "Duplicate",
          groupNode,
          "legal-demo-corporate",
          "brand-demo-mona",
          branchWest,
          stamp(),
          stamp(),
          stamp(),
        ),
    ).toThrow(/UNIQUE/i);
  });

  it("returns the effective hierarchy in correct root-to-leaf depth order", async () => {
    const nodes = await service.listHierarchy();
    expect(nodes[0]).toMatchObject({ id: groupNode, depth: 0 });
    expect(nodes.find((node) => node.id === westNode)).toMatchObject({ depth: 4 });
    expect(nodes.find((node) => node.id === "enterprise-demo-warehouse-west")).toMatchObject({
      depth: 5,
    });
  });

  it("creates a scoped child node and maintains the closure table atomically", async () => {
    const node = await service.createNode({
      id: "enterprise-area-test",
      type: "AREA",
      code: "AREA-TEST",
      name: "Configured Area",
      parentId: "enterprise-demo-region",
      legalEntityId: "legal-demo-corporate",
      brandId: "brand-demo-mona",
      status: "ACTIVE",
      metadata: {},
    });
    expect(node.depth).toBe(4);
    const ancestors = db.sqlite
      .prepare(
        "SELECT COUNT(*) count FROM enterprise_node_closure WHERE tenant_id=? AND descendant_id=?",
      )
      .get(tenantId, node.id) as { count: number };
    expect(ancestors.count).toBe(5);
  });

  it("prevents a branch-scoped actor from creating a new enterprise root", async () => {
    const limited = new EnterpriseService(
      db,
      scopedActor([permissions.enterpriseView, permissions.enterpriseOrganisationManage]),
    );
    await expect(
      limited.createNode({
        type: "GROUP",
        code: "ROOT-2",
        name: "Another Root",
        status: "ACTIVE",
        metadata: {},
      }),
    ).rejects.toThrow(/tenant-wide/i);
  });

  it("does not let branch scope climb to parent, sibling or franchise nodes", async () => {
    insertUser("user-branch-only");
    const actor = scopedActor([permissions.enterpriseView], "user-branch-only", [branchWest]);
    const nodes = await new EnterpriseService(db, actor).listHierarchy();
    expect(nodes.map((node) => node.id)).toEqual([westNode]);
  });

  it("applies explicit deny below an allowed enterprise scope", async () => {
    db.sqlite
      .prepare(
        `INSERT INTO enterprise_role_assignments
        (tenant_id,id,user_id,role_id,scope_node_id,descend_to_children,effect,valid_from,granted_by,reason,created_at)
       VALUES (?,?,?,?,?,1,'DENY',?,'actor','Explicit franchise exclusion',?)`,
      )
      .run(
        tenantId,
        "deny-franchise-test",
        "user-demo-emmanuel-obiambo",
        "role-demo-branch-manager",
        franchiseNode,
        "2026-01-01T00:00:00.000Z",
        stamp(),
      );
    const actor = scopedActor([permissions.enterpriseView], "user-demo-emmanuel-obiambo", [
      branchWest,
    ]);
    const nodes = await new EnterpriseService(db, actor).listHierarchy();
    expect(nodes.some((node) => node.id === "enterprise-demo-branch-ngong")).toBe(false);
    expect(nodes.some((node) => node.id === westNode)).toBe(true);
  });

  it("keeps granular overview data hidden without the underlying permissions", async () => {
    const actor = scopedActor([permissions.enterpriseView], "user-demo-emmanuel-obiambo", [
      branchWest,
    ]);
    const result = await new EnterpriseService(db, actor).overview();
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.policies).toEqual([]);
    expect(result.franchises).toEqual([]);
    expect(result.readiness).toEqual([]);
  });

  it("resolves locked policy inheritance and blocks a local override", async () => {
    const resolved = await service.resolvePolicy("PROCUREMENT.APPROVED_SUPPLIERS", westNode);
    expect(resolved).toMatchObject({ locked: true, sourceScopeNodeId: groupNode });
    await expect(
      service.assignPolicy({
        policyCode: "PROCUREMENT.APPROVED_SUPPLIERS",
        scopeNodeId: westNode,
        value: ["unapproved-supplier"],
        state: "LOCAL_VALUE",
        approvalPolicy: {},
      }),
    ).rejects.toThrow(/locked/i);
  });

  it("allows values inside an inherited range and rejects values outside it", async () => {
    const accepted = await service.assignPolicy({
      policyCode: "MENU_PRICE:menu-demo-biryani",
      scopeNodeId: westNode,
      value: 110_000,
      state: "LOCAL_VALUE",
      approvalPolicy: {},
    });
    expect(accepted.effectiveValue).toBe(110_000);
    await expect(
      service.assignPolicy({
        policyCode: "MENU_PRICE:menu-demo-biryani",
        scopeNodeId: westNode,
        value: 130_000,
        state: "LOCAL_VALUE",
        approvalPolicy: {},
      }),
    ).rejects.toThrow(/outside/i);
  });

  it("uses only the newest effective version at the same scope", async () => {
    await service.createPolicyDefinition({
      code: "OPS.TEST",
      name: "Operations test",
      category: "OPERATIONS",
      valueSchema: { type: "integer" },
      sensitive: false,
    });
    await service.assignPolicy({
      policyCode: "OPS.TEST",
      scopeNodeId: groupNode,
      value: 1,
      state: "LOCAL_VALUE",
      approvalPolicy: {},
    });
    await service.assignPolicy({
      policyCode: "OPS.TEST",
      scopeNodeId: groupNode,
      value: 2,
      state: "LOCAL_VALUE",
      approvalPolicy: {},
    });
    const resolved = await service.resolvePolicy("OPS.TEST", westNode);
    expect(resolved.effectiveValue).toBe(2);
    expect(resolved.trace).toHaveLength(1);
  });

  it("does not apply a future policy version before its effective date", async () => {
    await service.createPolicyDefinition({
      code: "OPS.FUTURE",
      name: "Future control",
      category: "OPERATIONS",
      valueSchema: {},
      sensitive: false,
    });
    await service.assignPolicy({
      policyCode: "OPS.FUTURE",
      scopeNodeId: groupNode,
      value: "future",
      state: "LOCAL_VALUE",
      approvalPolicy: {},
      effectiveFrom: "2035-01-01T00:00:00.000Z",
    });
    const resolved = await service.resolvePolicy(
      "OPS.FUTURE",
      westNode,
      "2034-12-31T23:59:59.000Z",
    );
    expect(resolved.sourceAssignmentId).toBeUndefined();
  });

  it("keeps policy version history append-only", () => {
    expect(() =>
      db.sqlite
        .prepare(
          "UPDATE enterprise_policy_versions SET snapshot_hash='tampered' WHERE id=(SELECT id FROM enterprise_policy_versions WHERE tenant_id=? LIMIT 1)",
        )
        .run(tenantId),
    ).toThrow(/append-only/i);
    expect(() =>
      db.sqlite
        .prepare(
          "DELETE FROM enterprise_policy_versions WHERE id=(SELECT id FROM enterprise_policy_versions WHERE tenant_id=? LIMIT 1)",
        )
        .run(tenantId),
    ).toThrow(/append-only/i);
  });

  it("inherits deterministic performance targets and enforces locked/range controls", async () => {
    const range = await service.createMetricTarget({
      scopeNodeId: groupNode,
      metricCode: "FOOD_COST_BPS",
      targetValue: 3200,
      valueUnit: "BPS",
      overrideState: "ALLOWED_WITHIN_RANGE",
      minimumValue: 2800,
      maximumValue: 3500,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    expect(range).toMatchObject({ targetValue: 3200, minimumValue: 2800, maximumValue: 3500 });
    await expect(
      service.createMetricTarget({
        scopeNodeId: westNode,
        metricCode: "FOOD_COST_BPS",
        targetValue: 4200,
        valueUnit: "BPS",
        overrideState: "ALLOWED_OVERRIDE",
        effectiveFrom: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/outside/i);
    const local = await service.createMetricTarget({
      scopeNodeId: westNode,
      metricCode: "FOOD_COST_BPS",
      targetValue: 3300,
      valueUnit: "BPS",
      overrideState: "ALLOWED_OVERRIDE",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
    });
    expect(local).toMatchObject({ targetValue: 3300, sourceScopeNodeId: westNode });
    expect(() =>
      db.sqlite
        .prepare("UPDATE enterprise_metric_targets SET target_value=1 WHERE tenant_id=?")
        .run(tenantId),
    ).toThrow(/append-only/i);
  });

  it("supports an auditable policy exception review lifecycle", async () => {
    const requester = new EnterpriseService(
      db,
      scopedActor([permissions.enterprisePolicyManage, permissions.enterprisePolicyView]),
    );
    const created = await requester.requestPolicyException({
      policyCode: "SECURITY.SESSION_POLICY",
      scopeNodeId: westNode,
      requestType: "TEMPORARY_OVERRIDE",
      requestedValue: { deviceTrustRequired: false },
      reason: "Controlled continuity test",
    });
    expect(created.status).toBe("SUBMITTED");
    await expect(
      service.transitionPolicyException(created.id, "APPROVED", "Approved for a bounded test"),
    ).resolves.toMatchObject({ status: "APPROVED" });
    await expect(
      service.transitionPolicyException(created.id, "UNDER_REVIEW", "Cannot move backwards"),
    ).rejects.toThrow(/invalid/i);
  });

  it("prevents delegated administrators from granting permissions they do not possess", async () => {
    const delegate = new EnterpriseService(
      db,
      scopedActor(
        [permissions.enterpriseView, permissions.enterpriseAccessDelegate],
        "user-demo-emmanuel-obiambo",
        [branchWest],
      ),
    );
    await expect(
      delegate.grantScopedRole({
        userId: "user-demo-emmanuel-obiambo",
        roleId: "role-demo-branch-manager",
        scopeNodeId: westNode,
        descendToChildren: true,
        effect: "ALLOW",
        reason: "Attempted excessive delegation",
      }),
    ).rejects.toThrow(/cannot delegate/i);
  });

  it("grants effective-dated scoped access and ignores it after expiry", async () => {
    insertUser("user-temp-enterprise");
    await service.grantScopedRole({
      id: "temporary-expired-scope",
      userId: "user-temp-enterprise",
      roleId: "role-demo-branch-manager",
      scopeNodeId: westNode,
      descendToChildren: true,
      effect: "ALLOW",
      validFrom: "2020-01-01T00:00:00.000Z",
      validUntil: "2020-01-02T00:00:00.000Z",
      reason: "Historical temporary assignment",
    });
    const actor = scopedActor([permissions.enterpriseView], "user-temp-enterprise", []);
    await expect(new EnterpriseService(db, actor).listHierarchy()).resolves.toEqual([]);
  });

  it("previews a price rollout with branch-level policy warnings", async () => {
    const rollout = await service.createPriceRollout({
      scopeNodeId: groupNode,
      menuItemId: "menu-demo-biryani",
      priceMinor: 130_000,
      currency: "KES",
      idempotencyKey: "pass12-price-preview-0001",
      requiresApproval: false,
    });
    expect(rollout.counts).toMatchObject({ blocked: 1, pending: 1 });
  });

  it("deduplicates rollout creation by authoritative idempotency key", async () => {
    const input = {
      scopeNodeId: groupNode,
      menuItemId: "menu-demo-biryani",
      priceMinor: 110_000,
      currency: "KES",
      idempotencyKey: "pass12-rollout-idempotency",
      requiresApproval: false,
    };
    const first = await service.createPriceRollout(input);
    const duplicate = await service.createPriceRollout(input);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    expect(count("enterprise_rollouts")).toBe(1);
  });

  it("requires explicit approval for a high-impact rollout", async () => {
    const rollout = await service.createPriceRollout({
      scopeNodeId: groupNode,
      menuItemId: "menu-demo-biryani",
      priceMinor: 110_000,
      currency: "KES",
      idempotencyKey: "pass12-approved-rollout",
      requiresApproval: true,
    });
    await expect(service.executeRollout(rollout.id)).rejects.toThrow(/confirmed/i);
    await service.confirmRollout(rollout.id, rollout.confirmationHash);
    await expect(service.executeRollout(rollout.id)).rejects.toThrow(/approval/i);
    await expect(service.approveRollout(rollout.id)).rejects.toThrow(/two-person/i);
    insertUser("user-pass12-approver");
    const approver = new EnterpriseService(db, { ...manager(), id: "user-pass12-approver" });
    await approver.approveRollout(rollout.id);
    await expect(service.executeRollout(rollout.id)).resolves.toMatchObject({ status: "COMPLETE" });
  });

  it("executes concurrent rollout retries once without duplicate branch effects", async () => {
    const rollout = await service.createPriceRollout({
      scopeNodeId: groupNode,
      menuItemId: "menu-demo-stew",
      priceMinor: 150_000,
      currency: "KES",
      idempotencyKey: "pass12-concurrent-rollout",
      requiresApproval: false,
    });
    await service.confirmRollout(rollout.id, rollout.confirmationHash);
    const results = await Promise.allSettled([
      service.executeRollout(rollout.id),
      service.executeRollout(rollout.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.some((result) => result.status === "fulfilled" && result.value.duplicate)).toBe(
      true,
    );
    const rows = db.sqlite
      .prepare(
        "SELECT branch_id,selling_price_minor FROM menu_item_branch_settings WHERE tenant_id=? AND menu_item_id=?",
      )
      .all(tenantId, "menu-demo-stew") as Array<{ branch_id: string; selling_price_minor: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.selling_price_minor === 150_000)).toBe(true);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM enterprise_rollout_events WHERE tenant_id=? AND rollout_id=? AND event_type='EXECUTION_FINISHED'",
        )
        .get(tenantId, rollout.id),
    ).toMatchObject({ count: 1 });
  });

  it("keeps rollout event history append-only", async () => {
    const rollout = await service.createPriceRollout({
      scopeNodeId: groupNode,
      menuItemId: "menu-demo-juice",
      priceMinor: 25_000,
      currency: "KES",
      idempotencyKey: "pass12-event-history",
      requiresApproval: false,
    });
    expect(() =>
      db.sqlite
        .prepare("DELETE FROM enterprise_rollout_events WHERE tenant_id=? AND rollout_id=?")
        .run(tenantId, rollout.id),
    ).toThrow(/append-only/i);
  });

  it("rejects a rollout confirmation or execution when its target scope is tampered", async () => {
    const rollout = await service.createPriceRollout({
      scopeNodeId: groupNode,
      menuItemId: "menu-demo-stew",
      priceMinor: 151_000,
      currency: "KES",
      idempotencyKey: "pass12-rollout-tamper",
      requiresApproval: false,
    });
    await expect(service.confirmRollout(rollout.id, "0".repeat(64))).rejects.toThrow(
      /previewed target scope/i,
    );
    await service.confirmRollout(rollout.id, rollout.confirmationHash);
    db.sqlite
      .prepare(
        "DELETE FROM enterprise_rollout_items WHERE tenant_id=? AND rollout_id=? AND branch_id=?",
      )
      .run(tenantId, rollout.id, branchNgong);
    await expect(service.executeRollout(rollout.id)).rejects.toThrow(/target scope/i);
  });

  it("versions branch templates without overwriting prior configuration", async () => {
    const template = await service.createBranchTemplate({
      code: "EXPRESS",
      name: "Express branch",
    });
    const published = await service.createTemplateVersion(
      template.id,
      { stations: ["SERVICE"] },
      true,
    );
    const second = await service.createTemplateVersion(
      template.id,
      { stations: ["SERVICE", "PICKUP"] },
      false,
    );
    expect(second).toMatchObject({ version: 2, status: "DRAFT" });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM branch_template_versions WHERE tenant_id=? AND template_id=?",
        )
        .get(tenantId, template.id),
    ).toMatchObject({ count: 2 });
    const preview = await service.previewBranchTemplate(published.id, branchWest);
    expect(preview).toMatchObject({ branchId: branchWest, version: 1, blockers: [] });
    const applied = await service.applyBranchTemplate({
      templateVersionId: published.id,
      branchId: branchWest,
      previewHash: preview.previewHash,
      idempotencyKey: "pass12-template-apply",
    });
    const duplicate = await service.applyBranchTemplate({
      templateVersionId: published.id,
      branchId: branchWest,
      previewHash: preview.previewHash,
      idempotencyKey: "pass12-template-apply",
    });
    expect(applied).toMatchObject({ status: "APPLIED", duplicate: false });
    expect(duplicate).toMatchObject({ id: applied.id, duplicate: true });
    await expect(service.effectiveBranchTemplate(branchWest)).resolves.toMatchObject({
      templateVersionId: published.id,
      configuration: { stations: ["SERVICE"] },
    });
  });

  it("provisions a new authoritative branch atomically from a published template", async () => {
    const template = await service.createBranchTemplate({
      code: "PROVISIONABLE",
      name: "Provisionable branch",
      brandId: "brand-demo-mona",
    });
    const version = await service.createTemplateVersion(
      template.id,
      {
        operatingProfile: {
          accountingModeOverride: "PERPETUAL",
          negativeStockPolicy: "MANAGER_OVERRIDE",
          operatingHours: { monday: [{ opensAt: "08:00", closesAt: "22:00" }] },
          serviceModes: ["DINE_IN", "PICKUP"],
          requiredDeviceRoles: ["POS"],
          paymentsRequired: true,
          inventoryEnabled: true,
          recipesRequired: true,
          printingRequired: true,
          kdsRequired: true,
        },
        stations: ["SERVICE"],
      },
      true,
    );
    const input = {
      id: "branch-pass12-provisioned",
      nodeId: "enterprise-pass12-provisioned",
      parentNodeId: groupNode,
      legalEntityId: "legal-demo-corporate",
      brandId: "brand-demo-mona",
      code: "P12-NEW",
      name: "Configured New Branch",
      timezone: "Africa/Nairobi",
      businessDayCutoffMinutes: 240,
      currency: "KES",
      idempotencyKey: "pass12-branch-provision",
    };
    const provisioned = await service.provisionBranchFromTemplate({
      templateVersionId: version.id,
      ...input,
    });
    const duplicate = await service.provisionBranchFromTemplate({
      templateVersionId: version.id,
      ...input,
    });

    expect(provisioned).toMatchObject({
      branchId: input.id,
      nodeId: input.nodeId,
      status: "APPLIED",
      duplicate: false,
    });
    expect(duplicate).toMatchObject({
      assignmentId: provisioned.assignmentId,
      branchId: input.id,
      nodeId: input.nodeId,
      duplicate: true,
    });
    expect(
      db.sqlite
        .prepare(
          "SELECT code,timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=?",
        )
        .get(tenantId, input.id),
    ).toMatchObject({
      code: "P12-NEW",
      timezone: "Africa/Nairobi",
      business_day_cutoff_minutes: 240,
    });
    expect(
      db.sqlite
        .prepare(
          "SELECT negative_stock_policy,kds_required FROM branch_operating_profiles WHERE tenant_id=? AND branch_id=?",
        )
        .get(tenantId, input.id),
    ).toMatchObject({
      negative_stock_policy: "MANAGER_OVERRIDE",
      kds_required: 1,
    });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM enterprise_node_closure WHERE tenant_id=? AND descendant_id=?",
        )
        .get(tenantId, input.nodeId),
    ).toMatchObject({ count: 2 });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM branches WHERE tenant_id=? AND id=?")
        .get(tenantId, input.id),
    ).toMatchObject({ count: 1 });
  });

  it("aggregates approved branch requisitions in base units and deduplicates retries", async () => {
    seedApprovedRequisitions();
    const input = {
      scopeNodeId: groupNode,
      currency: "KES",
      idempotencyKey: "pass12-central-requisition",
    };
    const result = await service.aggregateRequisitions(input);
    const duplicate = await service.aggregateRequisitions(input);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ quantity_micro: 300, branch_count: 2 });
    expect(duplicate).toMatchObject({ id: result.id, duplicate: true });
  });

  it("enforces the locked approved-supplier policy inside the existing procurement engine", async () => {
    db.sqlite
      .prepare(
        `INSERT INTO suppliers (tenant_id,id,code,name,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,'Unapproved supplier',1,'{}',?,?)`,
      )
      .run(tenantId, "supplier-pass12-unapproved", "PASS12-UNAPPROVED", stamp(), stamp());
    const inventory = new InventoryIntelligenceService(db, manager());
    await expect(
      inventory.createPurchaseOrder({
        branchId: branchWest,
        warehouseId: "warehouse-demo-westlands",
        supplierId: "supplier-pass12-unapproved",
        purchaseOrderNumber: "PO-PASS12-BLOCKED",
        currency: "KES",
        lines: [
          {
            inventoryItemId: "not-reached",
            purchaseUnitId: "not-reached",
            quantityMicro: 1_000_000,
            unitPriceMinor: 100,
          },
        ],
      }),
    ).rejects.toThrow(/not allowed/i);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM purchase_orders WHERE tenant_id=? AND purchase_order_number=?",
        )
        .get(tenantId, "PO-PASS12-BLOCKED"),
    ).toMatchObject({ count: 0 });
  });

  it("enforces locked central recipes in the existing recipe service", async () => {
    await service.createPolicyDefinition({
      code: "RECIPE:menu-pass12-locked",
      name: "Configured central recipe",
      category: "RECIPE",
      valueSchema: { type: "object" },
      sensitive: false,
    });
    await service.assignPolicy({
      policyCode: "RECIPE:menu-pass12-locked",
      scopeNodeId: groupNode,
      value: { version: 1 },
      state: "LOCKED",
      approvalPolicy: {},
    });
    const inventory = new InventoryIntelligenceService(db, manager());
    await expect(
      inventory.createRecipe({
        menuItemId: "menu-pass12-locked",
        branchOverrideId: branchWest,
        name: "Unauthorized local recipe",
      }),
    ).rejects.toThrow(/locked/i);
  });

  it("creates scoped supplier contracts through the enterprise workflow", async () => {
    const result = await service.createSupplierContract({
      supplierId: "supplier-demo-primary",
      scopeNodeId: westNode,
      contractReference: "PASS12-CONTRACT-WEST",
      negotiatedPriceMinor: 54_500,
      currency: "kes",
      minimumQuantityMicro: 2_000_000,
      leadTimeDays: 2,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      status: "ACTIVE",
    });
    expect(result.status).toBe("ACTIVE");
    expect(
      db.sqlite
        .prepare(
          "SELECT currency,negotiated_price_minor FROM supplier_contracts WHERE tenant_id=? AND id=?",
        )
        .get(tenantId, result.id),
    ).toMatchObject({ currency: "KES", negotiated_price_minor: 54_500 });
  });

  it("blocks cross-entity transfer accounting until explicit mappings exist", async () => {
    seedCrossEntityTransfer("transfer-cross-entity");
    await expect(service.validateTransferAccounting("transfer-cross-entity")).rejects.toThrow(
      /intercompany/i,
    );
    seedIntercompanyConfiguration();
    await expect(
      service.validateTransferAccounting("transfer-cross-entity"),
    ).resolves.toMatchObject({ treatment: "INTERCOMPANY", configured: true });
  });

  it("classifies same-entity stock movement as intra-entity without inventing intercompany entries", async () => {
    seedCorporateBranch();
    seedTransfer(
      "transfer-intra-entity",
      branchWest,
      "branch-pass12-corporate",
      "warehouse-demo-westlands",
      "warehouse-pass12-corporate",
    );
    await expect(service.validateTransferAccounting("transfer-intra-entity")).resolves.toEqual({
      treatment: "INTRA_ENTITY",
      configured: true,
    });
  });

  it("keeps staged transfer stock in transit until authoritative receipt", async () => {
    seedApprovedRequisitions();
    seedCorporateBranch();
    seedTransferBalance("item-pass12", 10_000_000, 25_000);
    db.sqlite
      .prepare(
        `INSERT INTO inventory_lots
        (tenant_id,id,branch_id,warehouse_id,inventory_item_id,lot_number,received_at,
         expiry_date,quantity_received_minor,quantity_remaining_minor,status,created_at,updated_at)
       VALUES (?,?,?,?,?,'LOT-PASS12',?,'2027-01-31',4000000,4000000,'AVAILABLE',?,?)`,
      )
      .run(
        tenantId,
        "lot-pass12-source",
        branchWest,
        "warehouse-demo-westlands",
        "item-pass12",
        stamp(),
        stamp(),
        stamp(),
      );
    const inventory = new InventoryIntelligenceService(db, manager());
    const dispatch = await inventory.dispatchTransfer({
      transferNumber: "TR-PASS12-STAGED",
      sourceBranchId: branchWest,
      sourceWarehouseId: "warehouse-demo-westlands",
      destinationBranchId: "branch-pass12-corporate",
      destinationWarehouseId: "warehouse-pass12-corporate",
      businessDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: "pass12-staged-dispatch",
      lines: [
        {
          inventoryItemId: "item-pass12",
          quantityMicro: 4_000_000,
          sourceLotId: "lot-pass12-source",
        },
      ],
    });
    const line = db.sqlite
      .prepare("SELECT id FROM stock_transfer_lines WHERE tenant_id=? AND transfer_id=?")
      .get(tenantId, dispatch.id) as { id: string };
    expect(inventoryQuantity(branchWest, "warehouse-demo-westlands", "item-pass12")).toBe(
      6_000_000,
    );
    expect(
      inventoryQuantity("branch-pass12-corporate", "warehouse-pass12-corporate", "item-pass12"),
    ).toBe(0);

    const partial = await inventory.receiveTransferShipment({
      shipmentId: dispatch.shipmentId,
      receiptReference: "TRR-PASS12-1",
      businessDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: "pass12-staged-receipt-1",
      final: false,
      lines: [{ transferLineId: line.id, receivedQuantityMicro: 2_000_000 }],
    });
    expect(partial.status).toBe("PARTIALLY_RECEIVED");
    expect(
      inventoryQuantity("branch-pass12-corporate", "warehouse-pass12-corporate", "item-pass12"),
    ).toBe(2_000_000);

    const final = await inventory.receiveTransferShipment({
      shipmentId: dispatch.shipmentId,
      receiptReference: "TRR-PASS12-2",
      businessDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: "pass12-staged-receipt-2",
      final: true,
      lines: [
        {
          transferLineId: line.id,
          receivedQuantityMicro: 1_500_000,
          missingQuantityMicro: 500_000,
        },
      ],
    });
    const duplicate = await inventory.receiveTransferShipment({
      shipmentId: dispatch.shipmentId,
      receiptReference: "TRR-PASS12-2",
      businessDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: "pass12-staged-receipt-2",
      final: true,
      lines: [
        {
          transferLineId: line.id,
          receivedQuantityMicro: 1_500_000,
          missingQuantityMicro: 500_000,
        },
      ],
    });
    expect(final).toMatchObject({
      status: "RECEIVED",
      variances: [expect.objectContaining({ missingQuantityMicro: 500_000 })],
    });
    expect(duplicate.duplicate).toBe(true);
    expect(
      inventoryQuantity("branch-pass12-corporate", "warehouse-pass12-corporate", "item-pass12"),
    ).toBe(3_500_000);
    expect(
      db.sqlite
        .prepare(
          "SELECT shortage_quantity_minor FROM stock_transfer_lines WHERE tenant_id=? AND id=?",
        )
        .get(tenantId, line.id),
    ).toMatchObject({ shortage_quantity_minor: 500_000 });
    expect(
      db.sqlite
        .prepare(
          "SELECT quantity_remaining_minor,status FROM inventory_lots WHERE tenant_id=? AND id=?",
        )
        .get(tenantId, "lot-pass12-source"),
    ).toMatchObject({ quantity_remaining_minor: 0, status: "CONSUMED" });
    expect(
      db.sqlite
        .prepare(
          "SELECT lot_number,expiry_date,quantity_remaining_minor FROM inventory_lots WHERE tenant_id=? AND branch_id=? AND inventory_item_id=?",
        )
        .get(tenantId, "branch-pass12-corporate", "item-pass12"),
    ).toMatchObject({
      lot_number: "LOT-PASS12",
      expiry_date: "2027-01-31",
      quantity_remaining_minor: 3_500_000,
    });
  });

  it("blocks staged cross-entity dispatch before any movement when intercompany mapping is absent", async () => {
    seedApprovedRequisitions();
    seedTransferBalance("item-pass12", 5_000_000, 10_000);
    const inventory = new InventoryIntelligenceService(db, manager());
    await expect(
      inventory.dispatchTransfer({
        transferNumber: "TR-PASS12-CROSS-BLOCK",
        sourceBranchId: branchWest,
        sourceWarehouseId: "warehouse-demo-westlands",
        destinationBranchId: branchNgong,
        destinationWarehouseId: "warehouse-pass12-ngong",
        businessDate: new Date().toISOString().slice(0, 10),
        idempotencyKey: "pass12-cross-dispatch-block",
        lines: [{ inventoryItemId: "item-pass12", quantityMicro: 1_000_000 }],
      }),
    ).rejects.toThrow(/intercompany/i);
    expect(inventoryQuantity(branchWest, "warehouse-demo-westlands", "item-pass12")).toBe(
      5_000_000,
    );
  });

  it("calculates royalty and marketing levy independently using integer basis points", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const royalty = await service.calculateFranchiseFee({
      feeDefinitionId: "franchise-fee-demo-royalty",
      periodStart: today,
      periodEnd: today,
    });
    const marketing = await service.calculateFranchiseFee({
      feeDefinitionId: "franchise-fee-demo-marketing",
      periodStart: today,
      periodEnd: today,
    });
    expect(royalty).toMatchObject({
      basisMinor: 3_815_000,
      amountMinor: 247_975,
      quality: "HIGH",
      currency: "KES",
    });
    expect(marketing.amountMinor).toBe(57_225);
    expect(count("franchise_fee_periods")).toBe(2);
  });

  it("does not fabricate a complete franchise fee when source facts are absent", async () => {
    const fee = await service.calculateFranchiseFee({
      feeDefinitionId: "franchise-fee-demo-royalty",
      periodStart: "2035-01-01",
      periodEnd: "2035-01-31",
    });
    expect(fee).toMatchObject({ basisMinor: 0, amountMinor: 0, quality: "INSUFFICIENT_DATA" });
  });

  it("creates data-driven franchise fees and labels the statement as management-only", async () => {
    const definition = await service.createFranchiseFeeDefinition({
      franchiseRelationshipId: "franchise-demo-relationship",
      code: "CONFIGURED_SUPPORT",
      name: "Configured support fee",
      feeType: "OTHER",
      basisType: "FIXED_PERIODIC",
      fixedAmountMinor: 75_000,
      currency: "KES",
      exclusions: [],
      accountMapping: {},
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      active: true,
    });
    const today = new Date().toISOString().slice(0, 10);
    await service.calculateFranchiseFee({
      feeDefinitionId: definition.id,
      periodStart: today,
      periodEnd: today,
    });
    const statement = await service.franchiseStatement("franchise-demo-relationship", today, today);
    expect(statement).toMatchObject({
      documentType: "MANAGEMENT_FRANCHISE_STATEMENT",
      statutoryInvoice: false,
      totalFeeMinor: 75_000,
      outstandingManagementBalanceMinor: null,
      payments: { available: false },
    });
  });

  it("creates tenant-scoped franchise relationships and preserves lifecycle history", async () => {
    const legal = await service.createLegalEntity({
      code: "PASS12NEWFR",
      legalName: "Configured franchise legal entity",
      countryCode: "TZ",
      baseCurrency: "TZS",
      taxIdentifiers: {},
      fiscalConfiguration: {},
      accountingConfiguration: {},
      status: "ACTIVE",
    });
    const relationship = await service.createFranchiseRelationship({
      franchiseeLegalEntityId: legal.id,
      franchisorLegalEntityId: "legal-demo-corporate",
      brandId: "brand-demo-mona",
      branchIds: [],
      agreementReference: "PASS12-AGREEMENT",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      status: "PROSPECT",
      reportingScope: { finance: "MANAGEMENT_ONLY" },
    });
    await expect(
      service.transitionFranchiseStatus(
        relationship.id,
        "ONBOARDING",
        "Approved onboarding workflow",
      ),
    ).resolves.toMatchObject({ status: "ONBOARDING" });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM audit_events WHERE tenant_id=? AND entity_id=?")
        .get(tenantId, relationship.id),
    ).toMatchObject({ count: 2 });
  });

  it("keeps posted franchise fee facts immutable", () => {
    db.sqlite
      .prepare(
        `INSERT INTO franchise_fee_periods
        (tenant_id,id,fee_definition_id,period_start,period_end,currency,basis_minor,amount_minor,quality,
         source_facts_json,source_hash,status,calculated_at)
       VALUES (?,?,?,?,?,'KES',1000,65,'HIGH','[]','hash','POSTED',?)`,
      )
      .run(
        tenantId,
        "fee-posted",
        "franchise-fee-demo-royalty",
        "2026-01-01",
        "2026-01-31",
        stamp(),
      );
    expect(() =>
      db.sqlite
        .prepare("UPDATE franchise_fee_periods SET amount_minor=1 WHERE tenant_id=? AND id=?")
        .run(tenantId, "fee-posted"),
    ).toThrow(/immutable/i);
  });

  it("labels group finance as management aggregation and fails closed on mixed currency totals", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const normal = await service.dashboard(groupNode, today, today);
    expect(normal).toMatchObject({
      managementAggregation: true,
      crossCurrency: false,
      currency: "KES",
    });
    expect(normal.totals.netSalesMinor).toBe(8_495_000);
    db.sqlite
      .prepare(
        "UPDATE daily_branch_metrics SET currency='USD' WHERE tenant_id=? AND branch_id=? AND business_date=?",
      )
      .run(tenantId, branchNgong, today);
    const mixed = await service.dashboard(groupNode, today, today);
    expect(mixed.crossCurrency).toBe(true);
    expect(mixed.totals.netSalesMinor).toBeNull();
    expect(mixed.currency).toBeUndefined();
  });

  it("returns honest capability boundaries for SSO, SCIM, FX and consolidation", async () => {
    const result = await service.overview();
    expect(result.capabilityStatus).toEqual({
      oidc: "BOUNDARY_ONLY",
      saml: "BOUNDARY_ONLY",
      scim: "SPEC_REQUIRED",
      statutoryConsolidation: "NOT_SUPPORTED",
      authoritativeFx: "NOT_CONFIGURED",
    });
  });

  it("scopes audit evidence and redacts sensitive metadata", async () => {
    insertAudit("audit-west", branchWest, { token: "secret", operation: "VISIBLE" });
    insertAudit("audit-ngong", branchNgong, { operation: "HIDDEN" });
    insertAudit("audit-tenant", null, { operation: "TENANT-WIDE" });
    const actor = scopedActor(
      [permissions.enterpriseView, permissions.enterpriseAuditView],
      "user-demo-emmanuel-obiambo",
      [branchWest],
    );
    db.sqlite
      .prepare("DELETE FROM enterprise_role_assignments WHERE tenant_id=? AND user_id=?")
      .run(tenantId, actor.id);
    const events = await new EnterpriseService(db, actor).enterpriseAudit(westNode);
    expect(events.some((row) => row.id === "audit-west")).toBe(true);
    expect(events.some((row) => row.id === "audit-ngong" || row.id === "audit-tenant")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("filters enterprise audit inside the authorized scope", async () => {
    insertAudit("audit-filter-one", branchWest, { operation: "ONE" });
    insertAudit("audit-filter-two", branchWest, { operation: "TWO" });
    const events = await service.enterpriseAudit(groupNode, {
      branchId: branchWest,
      action: "TEST",
      limit: 10,
    });
    expect(events.map((row) => row.id)).toEqual(
      expect.arrayContaining(["audit-filter-one", "audit-filter-two"]),
    );
    expect(events.every((row) => row.branch_id === branchWest)).toBe(true);
  });

  it("creates a bounded scoped export, projects allowlisted fields and deduplicates retries", async () => {
    const input = {
      scopeNodeId: groupNode,
      exportType: "HIERARCHY" as const,
      fields: ["id", "name", "status"],
      rowLimit: 100,
      idempotencyKey: "pass12-enterprise-export",
    };
    const requested = await service.requestEnterpriseExport(input);
    const duplicate = await service.requestEnterpriseExport(input);
    const completed = await service.runEnterpriseExport(requested.id);
    expect(duplicate).toMatchObject({ id: requested.id, duplicate: true });
    expect(completed.status).toBe("COMPLETE");
    expect(completed.manifest).toMatchObject({ exportType: "HIERARCHY", rowCount: 9 });
    expect(completed.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: groupNode, name: "Restaurant Group" }),
      ]),
    );
    expect(Object.keys((completed.result as Array<Record<string, unknown>>)[0]!).sort()).toEqual([
      "id",
      "name",
      "status",
    ]);
    expect(JSON.stringify(completed)).not.toMatch(/secret|credential|password/i);
  });

  it("rejects enterprise exports outside the actor's current hierarchy scope", async () => {
    insertUser("user-pass12-export-scoped");
    const actor = scopedActor(
      [permissions.enterpriseView, permissions.enterpriseExport],
      "user-pass12-export-scoped",
      [branchWest],
    );
    const scoped = new EnterpriseService(db, actor);
    await expect(
      scoped.requestEnterpriseExport({
        scopeNodeId: groupNode,
        exportType: "HIERARCHY",
        rowLimit: 10,
        idempotencyKey: "pass12-export-outside-scope",
      }),
    ).rejects.toThrow(/authorized scope/i);
  });

  it("expires approved policy exceptions server-side with append-only history", async () => {
    const requester = new EnterpriseService(
      db,
      scopedActor(
        [permissions.enterprisePolicyManage, permissions.enterprisePolicyView],
        "user-demo-emmanuel-obiambo",
        [branchWest, branchNgong],
      ),
    );
    const exception = await requester.requestPolicyException({
      policyCode: "MENU_PRICE:menu-demo-biryani",
      scopeNodeId: westNode,
      requestType: "PRICE_OVERRIDE",
      requestedValue: 115_000,
      reason: "Time-bounded local market test",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-01-02T00:00:00.000Z",
    });
    await service.transitionPolicyException(
      exception.id,
      "APPROVED",
      "Approved for a bounded trial",
    );
    await expect(
      requester.transitionPolicyException(exception.id, "REVOKED", "Requester cannot review"),
    ).rejects.toThrow(/permission/i);
    await expect(service.expirePolicyExceptions("2026-01-03T00:00:00.000Z")).resolves.toEqual({
      expired: 1,
    });
    expect(
      db.sqlite
        .prepare("SELECT status FROM enterprise_policy_exceptions WHERE tenant_id=? AND id=?")
        .get(tenantId, exception.id),
    ).toMatchObject({ status: "EXPIRED" });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM enterprise_policy_exception_events WHERE tenant_id=? AND exception_id=?",
        )
        .get(tenantId, exception.id),
    ).toMatchObject({ count: 3 });
    expect(() =>
      db.sqlite
        .prepare(
          "DELETE FROM enterprise_policy_exception_events WHERE tenant_id=? AND exception_id=?",
        )
        .run(tenantId, exception.id),
    ).toThrow(/append-only/i);
  });

  it("validates enterprise API input and rejects unknown mutation fields", async () => {
    const response = await api("/api/seramet/enterprise/nodes", {
      type: "AREA",
      code: "API-AREA",
      name: "API area",
      parentId: groupNode,
      status: "ACTIVE",
      metadata: {},
      tenantId: "forged-tenant",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/Unrecognized key/i),
    });
  });

  it("uses authenticated server tenant scope rather than a payload tenant", async () => {
    const response = await api("/api/seramet/enterprise/legal-entities", {
      code: "APIENTITY",
      legalName: "API Legal Entity",
      countryCode: "KE",
      baseCurrency: "KES",
      taxIdentifiers: {},
      fiscalConfiguration: {},
      accountingConfiguration: {},
      status: "ACTIVE",
    });
    expect(response.status).toBe(201);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM legal_entities WHERE tenant_id=? AND code='APIENTITY'")
        .get(tenantId),
    ).toMatchObject({ count: 1 });
  });

  it("queues allowlisted enterprise work durably and deduplicates delivery", async () => {
    const sent: unknown[] = [];
    const env = workerEnv(sent);
    const input = {
      tenantId,
      jobType: "ENTERPRISE_READINESS_RECALCULATION",
      idempotencyKey: "pass12-worker-idempotency",
      correlationId: "corr-pass12-worker",
    };
    const first = await enqueueEnterpriseWork(env, input);
    const duplicate = await enqueueEnterpriseWork(env, input);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(sent).toHaveLength(1);
    await expect(
      enqueueEnterpriseWork(env, {
        ...input,
        jobType: "UNSAFE_ARBITRARY_JOB",
        idempotencyKey: "different",
      }),
    ).rejects.toThrow(/allowlisted/i);
  });

  it("processes readiness work once and persists explainable branch checks", async () => {
    const sent: unknown[] = [];
    const env = workerEnv(sent);
    const queued = await enqueueEnterpriseWork(env, {
      tenantId,
      jobType: "ENTERPRISE_READINESS_RECALCULATION",
      idempotencyKey: "pass12-readiness-run",
    });
    const body = (
      sent[0] as {
        message: { kind: "worker-job"; tenantId: string; jobId: string; correlationId: string };
      }
    ).message;
    let acknowledged = 0;
    await handleWorkerQueue(
      {
        queue: "pass12-test",
        messages: [
          {
            body,
            id: queued.jobId,
            timestamp: new Date(),
            attempts: 1,
            ack: () => {
              acknowledged += 1;
            },
            retry: () => undefined,
          },
        ],
      },
      env,
    );
    expect(acknowledged).toBe(1);
    expect(
      db.sqlite
        .prepare("SELECT status FROM worker_jobs WHERE tenant_id=? AND id=?")
        .get(tenantId, queued.jobId),
    ).toMatchObject({ status: "SUCCEEDED" });
    expect(count("enterprise_readiness_results")).toBeGreaterThanOrEqual(8);
    expect(count("management_actions")).toBeGreaterThan(0);
  });

  it("schedules enterprise readiness independently of an open browser", async () => {
    const sent: unknown[] = [];
    await scheduleDurableWork(workerEnv(sent), new Date("2026-09-09T10:55:00.000Z"));
    const jobs = db.sqlite
      .prepare(
        "SELECT job_type FROM worker_jobs WHERE tenant_id=? AND job_type='ENTERPRISE_READINESS_RECALCULATION'",
      )
      .all(tenantId) as Array<{ job_type: string }>;
    expect(jobs).toHaveLength(1);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("classifies enterprise questions and retrieves only authorized branch evidence", async () => {
    expect(classifyIntent("Show HQ franchise rollout readiness")).toBe("ENTERPRISE_OVERVIEW");
    const actor = scopedActor(
      [permissions.intelligenceOwner, permissions.enterpriseView],
      "user-demo-emmanuel-obiambo",
      [branchWest],
    );
    db.sqlite
      .prepare(
        "INSERT INTO enterprise_role_assignments (tenant_id,id,user_id,role_id,scope_node_id,descend_to_children,effect,valid_from,granted_by,reason,created_at) VALUES (?,?,?,?,?,1,'DENY',?,'actor','Intelligence scope test',?)",
      )
      .run(
        tenantId,
        "deny-intelligence-franchise",
        actor.id,
        "role-demo-branch-manager",
        franchiseNode,
        "2026-01-01T00:00:00.000Z",
        stamp(),
      );
    const plan = await planIntelligenceQuery(
      db,
      actor,
      "Show HQ franchise rollout readiness today",
    );
    const evidence = await new IntelligenceEvidenceService(db, actor).build(plan);
    expect(evidence.intent).toBe("ENTERPRISE_OVERVIEW");
    expect(evidence.authorizedBranchIds).toEqual([branchWest]);
    expect(evidence.branchLabels).toEqual(["Westlands"]);
    expect(JSON.stringify(evidence)).not.toContain("Ngong Road");
  });

  it("does not let intelligence bypass enterprise source permission", async () => {
    const actor = scopedActor([permissions.intelligenceOwner], "user-demo-emmanuel-obiambo", [
      branchWest,
    ]);
    const plan = await planIntelligenceQuery(db, actor, "Show enterprise performance today");
    await expect(new IntelligenceEvidenceService(db, actor).build(plan)).rejects.toThrow(
      /enterprise.view/i,
    );
  });

  function count(table: string) {
    return (
      db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?`).get(tenantId) as {
        count: number;
      }
    ).count;
  }

  function insertUser(id: string) {
    db.sqlite
      .prepare(
        "INSERT INTO users (tenant_id,id,name,active,payload_json,created_at,updated_at) VALUES (?,?,?,1,'{}',?,?)",
      )
      .run(tenantId, id, "Configured user", stamp(), stamp());
  }

  function seedApprovedRequisitions() {
    db.sqlite
      .prepare(
        "INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,updated_at) VALUES (?,?,?,'Configured unit','u','COUNT',1,1,1,?)",
      )
      .run(tenantId, "unit-pass12-base", "PASS12-UNIT", stamp());
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json,code,base_unit_id,track_inventory,track_expiry,updated_at) VALUES (?,?,?,'Configured item','u',1,'{}',?,?,1,0,?)",
      )
      .run(tenantId, "item-pass12", "SKU-PASS12", "ITEM-PASS12", "unit-pass12-base", stamp());
    const item = { id: "item-pass12", base_unit_id: "unit-pass12-base" };
    db.sqlite
      .prepare(
        "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,'NGONG-MAIN','Ngong main store',1,'{}')",
      )
      .run(tenantId, "warehouse-pass12-ngong", branchNgong);
    for (const [id, branchId, warehouseId, quantity] of [
      ["req-pass12-west", branchWest, "warehouse-demo-westlands", 100],
      ["req-pass12-ngong", branchNgong, "warehouse-pass12-ngong", 200],
    ] as const) {
      db.sqlite
        .prepare(
          `INSERT INTO purchase_requisitions
        (tenant_id,id,branch_id,warehouse_id,requisition_number,source_type,status,requested_by,approved_by,approved_at,payload_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'MANUAL_REQUEST','APPROVED','actor','actor',?,'{}',?,?)`,
        )
        .run(tenantId, id, branchId, warehouseId, `PR-${id}`, stamp(), stamp(), stamp());
      db.sqlite
        .prepare(
          "INSERT INTO purchase_requisition_lines (tenant_id,id,requisition_id,inventory_item_id,requested_quantity_minor,unit_id,ordered_quantity_minor) VALUES (?,?,?,?,?,?,0)",
        )
        .run(tenantId, `${id}-line`, id, item.id, quantity, item.base_unit_id);
    }
  }

  function seedCrossEntityTransfer(id: string) {
    db.sqlite
      .prepare(
        "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,'NGONG-XFER','Ngong transfer store',1,'{}')",
      )
      .run(tenantId, "warehouse-pass12-ngong", branchNgong);
    seedTransfer(id, branchWest, branchNgong, "warehouse-demo-westlands", "warehouse-pass12-ngong");
  }

  function seedTransfer(
    id: string,
    sourceBranch: string,
    destinationBranch: string,
    sourceWarehouse: string,
    destinationWarehouse: string,
  ) {
    db.sqlite
      .prepare(
        `INSERT INTO stock_transfers
      (tenant_id,id,transfer_number,source_branch_id,source_warehouse_id,destination_branch_id,destination_warehouse_id,status,requested_by,payload_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'APPROVED','actor','{}',?,?)`,
      )
      .run(
        tenantId,
        id,
        `TR-${id}`,
        sourceBranch,
        sourceWarehouse,
        destinationBranch,
        destinationWarehouse,
        stamp(),
        stamp(),
      );
  }

  function seedIntercompanyConfiguration() {
    const accounts = db.sqlite
      .prepare("SELECT id FROM accounts WHERE tenant_id=? ORDER BY id LIMIT 2")
      .all(tenantId) as Array<{ id: string }>;
    expect(accounts).toHaveLength(2);
    db.sqlite
      .prepare(
        `INSERT INTO intercompany_configurations
      (tenant_id,id,source_legal_entity_id,destination_legal_entity_id,currency,due_from_account_id,due_to_account_id,
       transfer_price_policy_reference,active,effective_from,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,'actor',?,?)`,
      )
      .run(
        tenantId,
        "intercompany-pass12",
        "legal-demo-corporate",
        "legal-demo-franchise",
        "KES",
        accounts[0]!.id,
        accounts[1]!.id,
        "CONFIGURED-COST-BASIS",
        "2026-01-01T00:00:00.000Z",
        stamp(),
        stamp(),
      );
  }

  function seedTransferBalance(itemId: string, quantityMicro: number, unitCostMinor: number) {
    db.sqlite
      .prepare(
        `INSERT INTO inventory_balances
        (tenant_id,branch_id,warehouse_id,item_id,quantity_minor,quantity_reserved_minor,
         average_unit_cost_minor,total_value_minor,version,updated_at,last_movement_at,payload_json)
       VALUES (?,?,?,?,?,0,?,?,1,?,?,'{}')`,
      )
      .run(
        tenantId,
        branchWest,
        "warehouse-demo-westlands",
        itemId,
        quantityMicro,
        unitCostMinor,
        Math.trunc((quantityMicro * unitCostMinor) / 1_000_000),
        stamp(),
        stamp(),
      );
  }

  function inventoryQuantity(branchId: string, warehouseId: string, itemId: string) {
    const row = db.sqlite
      .prepare(
        "SELECT quantity_minor FROM inventory_balances WHERE tenant_id=? AND branch_id=? AND warehouse_id=? AND item_id=?",
      )
      .get(tenantId, branchId, warehouseId, itemId) as { quantity_minor: number } | undefined;
    return row?.quantity_minor ?? 0;
  }

  function seedCorporateBranch() {
    db.sqlite
      .prepare(
        "INSERT INTO branches (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,?,'Africa/Nairobi',240,1,'{}')",
      )
      .run(
        tenantId,
        "branch-pass12-corporate",
        "brand-demo-mona",
        "CORP-2",
        "Configured Corporate Branch",
      );
    db.sqlite
      .prepare(
        "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,'MAIN','Main store',1,'{}')",
      )
      .run(tenantId, "warehouse-pass12-corporate", "branch-pass12-corporate");
    db.sqlite
      .prepare(
        `INSERT INTO enterprise_nodes
      (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,status,effective_from,metadata_json,created_by,created_at,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,'{}','actor',?,'actor',?)`,
      )
      .run(
        tenantId,
        "enterprise-branch-pass12-corporate",
        "BRANCH",
        "CORP-BRANCH-2",
        "Configured Corporate Branch",
        "enterprise-demo-region",
        "legal-demo-corporate",
        "brand-demo-mona",
        "branch-pass12-corporate",
        "2026-01-01T00:00:00.000Z",
        stamp(),
        stamp(),
      );
    db.sqlite
      .prepare(
        "INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth) SELECT tenant_id,ancestor_id,?,depth+1 FROM enterprise_node_closure WHERE tenant_id=? AND descendant_id=?",
      )
      .run("enterprise-branch-pass12-corporate", tenantId, "enterprise-demo-region");
    db.sqlite
      .prepare(
        "INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth) VALUES (?,?,?,0)",
      )
      .run(tenantId, "enterprise-branch-pass12-corporate", "enterprise-branch-pass12-corporate");
  }

  function insertAudit(id: string, branchId: string | null, metadata: Record<string, unknown>) {
    db.sqlite
      .prepare(
        `INSERT INTO audit_events
      (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
      VALUES (?,?,?,'actor','TEST','TEST','test','Test audit','correlation',?,?)`,
      )
      .run(tenantId, id, branchId, JSON.stringify(metadata), stamp());
  }

  function api(path: string, body: unknown) {
    return handleSerametApiRequest(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: devHeaders(),
        body: JSON.stringify(body),
      }),
      {
        SERAMET_ENVIRONMENT: "development",
        SERAMET_ENABLE_DEV_AUTH: "true",
        SERAMET_DB: db,
      },
    );
  }

  function workerEnv(sent: unknown[]): SerametEnv {
    return {
      SERAMET_ENVIRONMENT: "development",
      SERAMET_DB: db,
      SERAMET_ENABLE_DEV_AUTH: "true",
      SERAMET_WORK_QUEUE: {
        send: async (message, options) => {
          sent.push({ message, options });
        },
        sendBatch: async (messages) => {
          sent.push(...messages);
        },
      },
    };
  }
});

function manager(): ServerActor {
  return {
    id: "manager-pass12",
    name: "Configured enterprise manager",
    tenantId,
    roleIds: ["role-demo-branch-manager"],
    permissions: [
      ...allPermissionCodes,
      permissions.tenantScopeAllBranches,
      "tenant.scope.all_branches",
    ],
    assignedBranchIds: [branchWest, branchNgong],
    assignedBranches: [
      { id: branchWest, name: "Westlands" },
      { id: branchNgong, name: "Ngong Road" },
    ],
    branchScope: { type: "ALL" },
    branchId: branchWest,
    role: "Configured Manager",
    branch: "Westlands",
  };
}

function scopedActor(
  permissionCodes: string[],
  id = "user-demo-emmanuel-obiambo",
  branches = [branchWest],
): ServerActor {
  return {
    id,
    name: "Scoped enterprise user",
    tenantId,
    roleIds: ["role-demo-branch-manager"],
    permissions: permissionCodes,
    assignedBranchIds: branches,
    assignedBranches: branches.map((branchId) => ({ id: branchId, name: branchId })),
    branchScope: { type: "BRANCH", branchId: branches[0] ?? branchWest },
    branchId: branches[0] ?? branchWest,
    role: "Configured role",
    branch: "Authorized branch",
  };
}

function devHeaders() {
  return {
    "content-type": "application/json",
    "x-seramet-dev-auth": "enabled",
    "x-seramet-user-id": "user-demo-emmanuel-obiambo",
    "x-seramet-tenant-id": tenantId,
    "x-seramet-branch-id": branchWest,
    "x-seramet-role": "Branch Manager",
    "x-seramet-branch-scope": "ALL",
  };
}

function stamp() {
  return new Date().toISOString();
}
