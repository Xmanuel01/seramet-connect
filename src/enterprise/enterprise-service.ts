import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import type {
  EnterpriseDashboard,
  EnterpriseNode,
  EnterpriseNodeType,
  EnterpriseOverview,
  PolicyState,
  PolicyTraceStep,
  ResolvedEnterprisePolicy,
} from "@/enterprise/types";

type RowKey =
  | "id"
  | "node_type"
  | "code"
  | "name"
  | "parent_id"
  | "legal_entity_id"
  | "brand_id"
  | "branch_id"
  | "warehouse_id"
  | "status"
  | "effective_from"
  | "effective_to"
  | "timezone"
  | "currency"
  | "depth"
  | "child_count"
  | "state"
  | "value_json"
  | "policy_id"
  | "scope_node_id"
  | "scope_name"
  | "minimum_value_minor"
  | "maximum_value_minor"
  | "selling_price_minor"
  | "requires_approval"
  | "approved_by"
  | "change_json"
  | "rollout_type"
  | "requisition_id"
  | "line_id"
  | "inventory_item_id"
  | "requested_quantity_minor"
  | "unit_id"
  | "base_unit_id"
  | "source_branch_id"
  | "destination_branch_id"
  | "transfer_price_policy_reference"
  | "relationship_id"
  | "basis_type"
  | "fixed_amount_minor"
  | "rate_bps"
  | "quality"
  | "business_date"
  | "gross_sales_minor"
  | "net_sales_minor"
  | "net_revenue_minor"
  | "branch_name"
  | "gross_profit_minor"
  | "contribution_minor"
  | "food_cost_bps"
  | "order_count"
  | "metadata_json"
  | "allowed_role_ids_json"
  | "allowed_permission_codes_json"
  | "descend_to_children"
  | "descendant_id"
  | "effect"
  | "node_id"
  | "active"
  | "count"
  | "factor_numerator"
  | "factor_denominator"
  | "target_hash"
  | "confirmation_hash"
  | "confirmed_at"
  | "created_by"
  | "policy_watermark"
  | "requested_by"
  | "export_type"
  | "fields_json"
  | "filters_json"
  | "row_limit"
  | "authorization_fingerprint"
  | "result_reference"
  | "result_json"
  | "manifest_json"
  | "completed_at"
  | "expires_at"
  | "error_json"
  | "created_at"
  | "metric_code"
  | "target_value"
  | "value_unit"
  | "override_state"
  | "minimum_value"
  | "maximum_value"
  | "approval_reference"
  | "value_schema_json"
  | "version"
  | "configuration_json"
  | "configuration_hash"
  | "template_id"
  | "template_name"
  | "brand_id"
  | "branch_brand_id"
  | "template_brand_id"
  | "adoption_status"
  | "assignment_id"
  | "template_version_id"
  | "applied_at"
  | "franchisee_legal_entity_id"
  | "maximum_scope_type";
type Row = Record<string, unknown> & Partial<Record<RowKey, unknown>>;

type NodeInput = {
  id?: string;
  type: EnterpriseNodeType;
  code: string;
  name: string;
  parentId?: string;
  legalEntityId?: string;
  brandId?: string;
  branchId?: string;
  warehouseId?: string;
  status: "ACTIVE" | "TEMPORARILY_CLOSED" | "SUSPENDED" | "CLOSED";
  effectiveFrom?: string;
  effectiveTo?: string;
  timezone?: string;
  currency?: string;
  metadata: Record<string, unknown>;
};

type PolicyAssignmentInput = {
  id?: string;
  policyCode: string;
  scopeNodeId: string;
  value?: unknown;
  state: PolicyState;
  minimumValueMinor?: number;
  maximumValueMinor?: number;
  approvalPolicy: Record<string, unknown>;
  approvedExceptionId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};

type BranchTemplateProvisionInput = {
  id?: string;
  nodeId?: string;
  templateVersionId: string;
  parentNodeId: string;
  legalEntityId: string;
  brandId: string;
  code: string;
  name: string;
  timezone: string;
  businessDayCutoffMinutes: number;
  currency: string;
  address?: string;
  phone?: string;
  email?: string;
  idempotencyKey: string;
};

type EnterpriseExportType =
  "HIERARCHY" | "MANAGEMENT_METRICS" | "FRANCHISE_COMPLIANCE" | "ENTERPRISE_AUDIT";

const exportFields: Record<EnterpriseExportType, readonly string[]> = {
  HIERARCHY: [
    "id",
    "type",
    "code",
    "name",
    "parentId",
    "legalEntityId",
    "brandId",
    "branchId",
    "warehouseId",
    "status",
    "effectiveFrom",
    "effectiveTo",
    "currency",
  ],
  MANAGEMENT_METRICS: [
    "branchId",
    "branchName",
    "businessDate",
    "currency",
    "netSalesMinor",
    "grossProfitMinor",
    "contributionMinor",
    "foodCostBps",
    "orderCount",
    "quality",
  ],
  FRANCHISE_COMPLIANCE: [
    "id",
    "franchiseRelationshipId",
    "branchId",
    "branchName",
    "checkCode",
    "status",
    "message",
    "calculatedAt",
  ],
  ENTERPRISE_AUDIT: [
    "id",
    "branch_id",
    "actor_id",
    "action",
    "entity_type",
    "entity_id",
    "reason",
    "correlation_id",
    "created_at",
    "metadata",
  ],
};

export class EnterpriseService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async createLegalEntity(input: {
    id?: string;
    code: string;
    legalName: string;
    tradingName?: string;
    registrationReference?: string;
    countryCode: string;
    baseCurrency: string;
    taxIdentifiers: Record<string, string>;
    fiscalConfiguration: Record<string, unknown>;
    accountingConfiguration: Record<string, unknown>;
    status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "CLOSED";
  }) {
    this.require(permissions.enterpriseOrganisationManage);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO legal_entities
            (tenant_id,id,code,legal_name,trading_name,registration_reference,tax_identifiers_json,
             country_code,base_currency,fiscal_configuration_json,accounting_configuration_json,
             status,created_by,created_at,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.toUpperCase(),
          input.legalName,
          input.tradingName ?? null,
          input.registrationReference ?? null,
          json(input.taxIdentifiers),
          input.countryCode.toUpperCase(),
          input.baseCurrency.toUpperCase(),
          json(input.fiscalConfiguration),
          json(input.accountingConfiguration),
          input.status,
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.audit("ENTERPRISE_LEGAL_ENTITY_CREATED", "LEGAL_ENTITY", id, { code: input.code }),
    ]);
    return { id };
  }

  async createIntercompanyConfiguration(input: {
    id?: string;
    sourceLegalEntityId: string;
    destinationLegalEntityId: string;
    currency: string;
    dueFromAccountId: string;
    dueToAccountId: string;
    inventoryAccountId?: string;
    revenueAccountId?: string;
    cogsAccountId?: string;
    transferPricePolicyReference: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) {
    this.require(permissions.enterpriseTransferManage);
    if (!this.actor.permissions.includes(permissions.tenantScopeAllBranches)) {
      throw denied("Intercompany configuration requires tenant-wide authority");
    }
    if (input.sourceLegalEntityId === input.destinationLegalEntityId) {
      throw validation("Intercompany entities must differ");
    }
    validateDateRange(input.effectiveFrom, input.effectiveTo, true);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO intercompany_configurations
            (tenant_id,id,source_legal_entity_id,destination_legal_entity_id,currency,
             due_from_account_id,due_to_account_id,inventory_account_id,revenue_account_id,
             cogs_account_id,transfer_price_policy_reference,active,effective_from,effective_to,
             created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.sourceLegalEntityId,
          input.destinationLegalEntityId,
          currencyCode(input.currency),
          input.dueFromAccountId,
          input.dueToAccountId,
          input.inventoryAccountId ?? null,
          input.revenueAccountId ?? null,
          input.cogsAccountId ?? null,
          required(input.transferPricePolicyReference, "transfer-price policy reference"),
          input.effectiveFrom ?? stamp,
          input.effectiveTo ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("INTERCOMPANY_CONFIGURATION_CREATED", "INTERCOMPANY_CONFIGURATION", id, {
        sourceLegalEntityId: input.sourceLegalEntityId,
        destinationLegalEntityId: input.destinationLegalEntityId,
      }),
    ]);
    return { id };
  }

  async createNode(input: NodeInput) {
    this.require(permissions.enterpriseOrganisationManage);
    if (input.parentId) await this.assertNodeAccess(input.parentId);
    else if (!this.actor.permissions.includes(permissions.tenantScopeAllBranches)) {
      throw denied("Creating a root enterprise node requires tenant-wide scope");
    }
    await this.validateNodeReferences(input);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO enterprise_nodes
            (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,
             warehouse_id,status,effective_from,effective_to,timezone,currency,metadata_json,
             created_by,created_at,updated_by,updated_at,version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.type,
          input.code.toUpperCase(),
          input.name,
          input.parentId ?? null,
          input.legalEntityId ?? null,
          input.brandId ?? null,
          input.branchId ?? null,
          input.warehouseId ?? null,
          input.status,
          input.effectiveFrom ?? stamp,
          input.effectiveTo ?? null,
          input.timezone ?? null,
          input.currency?.toUpperCase() ?? null,
          json(input.metadata),
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
           VALUES (?,?,?,0)`,
        )
        .bind(this.actor.tenantId, id, id),
    ];
    if (input.parentId) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
             SELECT tenant_id,ancestor_id,?,depth+1
             FROM enterprise_node_closure
             WHERE tenant_id=? AND descendant_id=?`,
          )
          .bind(id, this.actor.tenantId, input.parentId),
      );
    }
    statements.push(
      this.audit("ENTERPRISE_NODE_CREATED", "ENTERPRISE_NODE", id, {
        type: input.type,
        parentId: input.parentId ?? null,
      }),
    );
    await this.db.batch(statements);
    return this.getNode(id);
  }

  async listHierarchy(rootNodeId?: string, limit = 500): Promise<EnterpriseNode[]> {
    this.require(permissions.enterpriseView);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw validation("Invalid limit");
    if (rootNodeId) await this.assertNodeAccess(rootNodeId);
    const accessible = await this.authorizedNodeIds();
    const result = await this.db
      .prepare(
        `SELECT n.*,
                COALESCE((SELECT MAX(depth) FROM enterprise_node_closure c
                  WHERE c.tenant_id=n.tenant_id AND c.descendant_id=n.id),0) depth,
                (SELECT COUNT(*) FROM enterprise_nodes child
                  WHERE child.tenant_id=n.tenant_id AND child.parent_id=n.id) child_count
         FROM enterprise_nodes n
         WHERE n.tenant_id=?
           AND (? IS NULL OR EXISTS (SELECT 1 FROM enterprise_node_closure c
             WHERE c.tenant_id=n.tenant_id AND c.ancestor_id=? AND c.descendant_id=n.id))
         ORDER BY depth,n.node_type,n.name LIMIT ?`,
      )
      .bind(this.actor.tenantId, rootNodeId ?? null, rootNodeId ?? null, limit)
      .all<Row>();
    return (result.results ?? []).filter((row) => accessible.has(string(row.id))).map(mapNode);
  }

  async getNode(nodeId: string) {
    await this.assertNodeAccess(nodeId);
    const row = await this.db
      .prepare(
        `SELECT n.*,
                COALESCE((SELECT MAX(depth) FROM enterprise_node_closure c
                  WHERE c.tenant_id=n.tenant_id AND c.descendant_id=n.id),0) depth,
                (SELECT COUNT(*) FROM enterprise_nodes child
                  WHERE child.tenant_id=n.tenant_id AND child.parent_id=n.id) child_count
         FROM enterprise_nodes n WHERE n.tenant_id=? AND n.id=?`,
      )
      .bind(this.actor.tenantId, nodeId)
      .first<Row>();
    if (!row) throw notFound("Enterprise node not found");
    return mapNode(row);
  }

  async transitionNodeStatus(
    nodeId: string,
    status: "ACTIVE" | "TEMPORARILY_CLOSED" | "SUSPENDED" | "CLOSED",
    reason: string,
  ) {
    this.require(permissions.enterpriseOrganisationManage);
    const node = await this.getNode(nodeId);
    const allowed: Record<EnterpriseNode["status"], EnterpriseNode["status"][]> = {
      ACTIVE: ["TEMPORARILY_CLOSED", "SUSPENDED", "CLOSED"],
      TEMPORARILY_CLOSED: ["ACTIVE", "SUSPENDED", "CLOSED"],
      SUSPENDED: ["ACTIVE", "CLOSED"],
      CLOSED: [],
    };
    if (!allowed[node.status].includes(status))
      throw invalidState("Invalid enterprise node lifecycle transition");
    if (reason.trim().length < 3) throw validation("Enterprise lifecycle change requires a reason");
    const stamp = now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE enterprise_nodes SET status=?,updated_by=?,updated_at=?,version=version+1
           WHERE tenant_id=? AND id=? AND status=?`,
        )
        .bind(status, this.actor.id, stamp, this.actor.tenantId, nodeId, node.status),
    ];
    if (node.branchId && ["ACTIVE", "SUSPENDED", "CLOSED"].includes(status)) {
      statements.push(
        this.db
          .prepare("UPDATE branches SET active=? WHERE tenant_id=? AND id=?")
          .bind(status === "ACTIVE" ? 1 : 0, this.actor.tenantId, node.branchId),
      );
    }
    statements.push(
      this.audit("ENTERPRISE_NODE_STATUS_CHANGED", "ENTERPRISE_NODE", nodeId, {
        from: node.status,
        to: status,
        reason: reason.trim(),
      }),
    );
    const results = await this.db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1)
      throw invalidState("Enterprise node was changed concurrently");
    return this.getNode(nodeId);
  }

  async transitionFranchiseStatus(
    relationshipId: string,
    status: "PROSPECT" | "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "TERMINATED" | "EXPIRED",
    reason: string,
  ) {
    this.require(permissions.enterpriseFranchiseManage);
    if (reason.trim().length < 3) throw validation("Franchise lifecycle change requires a reason");
    const relationship = await this.db
      .prepare(
        "SELECT id,status,franchisee_legal_entity_id FROM franchise_relationships WHERE tenant_id=? AND id=?",
      )
      .bind(this.actor.tenantId, relationshipId)
      .first<Row>();
    if (!relationship) throw notFound("Franchise relationship not found");
    const branches = await this.db
      .prepare(
        "SELECT branch_id FROM franchise_branch_assignments WHERE tenant_id=? AND franchise_relationship_id=?",
      )
      .bind(this.actor.tenantId, relationshipId)
      .all<{ branch_id: string }>();
    for (const branch of branches.results ?? []) await this.assertBranchAccess(branch.branch_id);
    const current = string(relationship.status);
    const allowed: Record<string, string[]> = {
      PROSPECT: ["ONBOARDING", "TERMINATED"],
      ONBOARDING: ["ACTIVE", "SUSPENDED", "TERMINATED"],
      ACTIVE: ["SUSPENDED", "TERMINATED", "EXPIRED"],
      SUSPENDED: ["ACTIVE", "TERMINATED"],
      TERMINATED: [],
      EXPIRED: ["ACTIVE", "TERMINATED"],
    };
    if (!(allowed[current] ?? []).includes(status))
      throw invalidState("Invalid franchise lifecycle transition");
    const stamp = now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "UPDATE franchise_relationships SET status=?,updated_at=? WHERE tenant_id=? AND id=? AND status=?",
        )
        .bind(status, stamp, this.actor.tenantId, relationshipId, current),
    ];
    if (["SUSPENDED", "TERMINATED"].includes(status)) {
      statements.push(
        this.db
          .prepare(
            `UPDATE enterprise_role_assignments SET revoked_at=?,revoked_by=?
             WHERE tenant_id=? AND revoked_at IS NULL AND scope_node_id IN (
               SELECT c.descendant_id FROM enterprise_nodes root
               JOIN enterprise_node_closure c ON c.tenant_id=root.tenant_id AND c.ancestor_id=root.id
               WHERE root.tenant_id=? AND root.node_type='LEGAL_ENTITY' AND root.legal_entity_id=?
             )`,
          )
          .bind(
            stamp,
            this.actor.id,
            this.actor.tenantId,
            this.actor.tenantId,
            relationship.franchisee_legal_entity_id,
          ),
      );
    }
    statements.push(
      this.audit("FRANCHISE_STATUS_CHANGED", "FRANCHISE_RELATIONSHIP", relationshipId, {
        from: current,
        to: status,
        reason: reason.trim(),
      }),
    );
    const results = await this.db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1)
      throw invalidState("Franchise relationship was changed concurrently");
    return { id: relationshipId, status };
  }

  async createPolicyDefinition(input: {
    id?: string;
    code: string;
    name: string;
    category: string;
    valueSchema: Record<string, unknown>;
    sensitive: boolean;
  }) {
    this.require(permissions.enterprisePolicyManage);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_policy_definitions
            (tenant_id,id,code,name,category,value_schema_json,sensitive,active,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.toUpperCase(),
          input.name,
          input.category.toUpperCase(),
          json(input.valueSchema),
          bool(input.sensitive),
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("ENTERPRISE_POLICY_DEFINED", "ENTERPRISE_POLICY", id, { code: input.code }),
    ]);
    return { id, code: input.code.toUpperCase() };
  }

  async assignPolicy(input: PolicyAssignmentInput) {
    this.require(permissions.enterprisePolicyManage);
    if (input.effectiveFrom) assertIsoTimestamp(input.effectiveFrom, "effectiveFrom");
    if (input.effectiveTo) assertIsoTimestamp(input.effectiveTo, "effectiveTo");
    if (input.effectiveFrom && input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
      throw validation("effectiveTo must follow effectiveFrom");
    }
    if (input.state === "INHERIT" && input.value !== undefined) {
      throw validation("INHERIT policy assignments cannot define a local value");
    }
    if (
      input.state !== "INHERIT" &&
      input.state !== "NOT_APPLICABLE" &&
      input.value === undefined
    ) {
      throw validation("A policy value is required for this state");
    }
    if (input.minimumValueMinor !== undefined && !Number.isSafeInteger(input.minimumValueMinor)) {
      throw validation("Policy minimum must be a safe integer");
    }
    if (input.maximumValueMinor !== undefined && !Number.isSafeInteger(input.maximumValueMinor)) {
      throw validation("Policy maximum must be a safe integer");
    }
    if (
      input.minimumValueMinor !== undefined &&
      input.maximumValueMinor !== undefined &&
      input.minimumValueMinor > input.maximumValueMinor
    ) {
      throw validation("Policy minimum cannot exceed maximum");
    }
    const node = await this.getNode(input.scopeNodeId);
    const definition = await this.policyDefinition(input.policyCode);
    if (input.value !== undefined)
      assertPolicyValue(input.value, parseJsonObject(definition.value_schema_json));
    if (node.parentId) {
      const parent = await this.resolvePolicy(input.policyCode, node.parentId, input.effectiveFrom);
      await this.assertOverrideAllowed(parent, input, definition.id);
    }
    const versionRow = await this.db
      .prepare(
        `SELECT COALESCE(MAX(version),0)+1 version FROM enterprise_policy_assignments
         WHERE tenant_id=? AND policy_id=? AND scope_node_id=?`,
      )
      .bind(this.actor.tenantId, definition.id, input.scopeNodeId)
      .first<{ version: number }>();
    const version = Number(versionRow?.version ?? 1);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    const snapshot = {
      policyCode: string(definition.code),
      scopeNodeId: input.scopeNodeId,
      value: input.value ?? null,
      state: input.state,
      minimumValueMinor: input.minimumValueMinor ?? null,
      maximumValueMinor: input.maximumValueMinor ?? null,
      approvalPolicy: input.approvalPolicy,
      effectiveFrom: input.effectiveFrom ?? stamp,
      effectiveTo: input.effectiveTo ?? null,
      version,
    };
    const snapshotHash = await hashJson(snapshot);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_policy_assignments
            (tenant_id,id,policy_id,scope_node_id,value_json,state,minimum_value_minor,
             maximum_value_minor,approval_policy_json,effective_from,effective_to,version,
             created_by,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          definition.id,
          input.scopeNodeId,
          input.value === undefined ? null : json(input.value),
          input.state,
          input.minimumValueMinor ?? null,
          input.maximumValueMinor ?? null,
          json(input.approvalPolicy),
          input.effectiveFrom ?? stamp,
          input.effectiveTo ?? null,
          version,
          this.actor.id,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO enterprise_policy_versions
            (tenant_id,id,assignment_id,version,snapshot_json,snapshot_hash,created_by,created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          id,
          version,
          json(snapshot),
          snapshotHash,
          this.actor.id,
          stamp,
        ),
      this.audit("ENTERPRISE_POLICY_ASSIGNED", "ENTERPRISE_POLICY_ASSIGNMENT", id, {
        policyCode: input.policyCode,
        scopeNodeId: input.scopeNodeId,
        version,
        state: input.state,
      }),
    ]);
    return this.resolvePolicy(input.policyCode, input.scopeNodeId, input.effectiveFrom);
  }

  async resolvePolicy(
    policyCode: string,
    targetNodeId: string,
    effectiveAt = now(),
  ): Promise<ResolvedEnterprisePolicy> {
    this.requireAny([
      permissions.enterprisePolicyView,
      permissions.enterprisePolicyManage,
      permissions.enterpriseRolloutManage,
    ]);
    assertIsoTimestamp(effectiveAt, "effectiveAt");
    await this.assertNodeAccess(targetNodeId);
    const result = await this.db
      .prepare(
        `SELECT a.*,d.code,n.name scope_name,c.depth
         FROM enterprise_policy_definitions d
         JOIN enterprise_policy_assignments a ON a.tenant_id=d.tenant_id AND a.policy_id=d.id
         JOIN enterprise_nodes n ON n.tenant_id=a.tenant_id AND n.id=a.scope_node_id
         JOIN enterprise_node_closure c ON c.tenant_id=a.tenant_id
           AND c.ancestor_id=a.scope_node_id AND c.descendant_id=?
         WHERE d.tenant_id=? AND UPPER(d.code)=UPPER(?) AND d.active=1
           AND a.effective_from<=? AND (a.effective_to IS NULL OR a.effective_to>?)
           AND a.version=(SELECT MAX(newer.version) FROM enterprise_policy_assignments newer
             WHERE newer.tenant_id=a.tenant_id AND newer.policy_id=a.policy_id
               AND newer.scope_node_id=a.scope_node_id AND newer.effective_from<=?
               AND (newer.effective_to IS NULL OR newer.effective_to>?))
         ORDER BY c.depth DESC,a.effective_from,a.version`,
      )
      .bind(
        targetNodeId,
        this.actor.tenantId,
        policyCode.toUpperCase(),
        effectiveAt,
        effectiveAt,
        effectiveAt,
        effectiveAt,
      )
      .all<Row>();
    let effectiveValue: unknown;
    let source: Row | undefined;
    let locked = false;
    let inheritedRange: { min?: number; max?: number } | undefined;
    let approvalRequired = false;
    const trace: PolicyTraceStep[] = [];
    for (const row of result.results ?? []) {
      const state = string(row.state) as PolicyState;
      const value = parseJsonValue(row.value_json);
      let outcome: PolicyTraceStep["outcome"] = "APPLIED";
      if (state === "INHERIT") outcome = "INHERITED";
      else if (locked) outcome = "BLOCKED_LOCK";
      else if (
        approvalRequired &&
        !(await this.hasApprovedException(
          string(row.policy_id),
          string(row.scope_node_id),
          effectiveAt,
        ))
      ) {
        outcome = "APPROVAL_REQUIRED";
      } else if (inheritedRange && !withinRange(value, inheritedRange.min, inheritedRange.max)) {
        outcome = "BLOCKED_RANGE";
      } else {
        effectiveValue = value;
        source = row;
        approvalRequired = state === "APPROVAL_REQUIRED";
        if (state === "ALLOWED_WITHIN_RANGE") {
          inheritedRange = {
            ...(row.minimum_value_minor === null ? {} : { min: integer(row.minimum_value_minor) }),
            ...(row.maximum_value_minor === null ? {} : { max: integer(row.maximum_value_minor) }),
          };
        }
        if (state === "LOCKED" || state === "NOT_APPLICABLE") locked = true;
      }
      trace.push({
        scopeNodeId: string(row.scope_node_id),
        scopeName: string(row.scope_name),
        depth: integer(row.depth),
        assignmentId: string(row.id),
        state,
        value,
        outcome,
        effectiveFrom: string(row.effective_from),
      });
    }
    return {
      code: policyCode.toUpperCase(),
      targetNodeId,
      effectiveValue,
      ...(source
        ? {
            sourceScopeNodeId: string(source.scope_node_id),
            sourceScopeName: string(source.scope_name),
            sourceAssignmentId: string(source.id),
            state: string(source.state) as PolicyState,
          }
        : {}),
      locked,
      ...(inheritedRange?.min === undefined ? {} : { minimumValueMinor: inheritedRange.min }),
      ...(inheritedRange?.max === undefined ? {} : { maximumValueMinor: inheritedRange.max }),
      effectiveAt,
      trace,
    };
  }

  async createMetricTarget(input: {
    scopeNodeId: string;
    metricCode: string;
    targetValue: number;
    valueUnit: string;
    overrideState: "LOCKED" | "ALLOWED_OVERRIDE" | "ALLOWED_WITHIN_RANGE" | "APPROVAL_REQUIRED";
    minimumValue?: number;
    maximumValue?: number;
    approvalReference?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) {
    this.require(permissions.enterprisePolicyManage);
    const node = await this.getNode(input.scopeNodeId);
    if (!Number.isSafeInteger(input.targetValue))
      throw validation("Metric target must be a safe integer");
    if (input.minimumValue !== undefined && !Number.isSafeInteger(input.minimumValue))
      throw validation("Metric target minimum must be a safe integer");
    if (input.maximumValue !== undefined && !Number.isSafeInteger(input.maximumValue))
      throw validation("Metric target maximum must be a safe integer");
    if (
      input.minimumValue !== undefined &&
      input.maximumValue !== undefined &&
      input.minimumValue > input.maximumValue
    ) {
      throw validation("Metric target minimum cannot exceed maximum");
    }
    const effectiveFrom = input.effectiveFrom ?? now();
    assertIsoTimestamp(effectiveFrom, "effectiveFrom");
    if (input.effectiveTo) {
      assertIsoTimestamp(input.effectiveTo, "effectiveTo");
      if (input.effectiveTo <= effectiveFrom)
        throw validation("effectiveTo must follow effectiveFrom");
    }
    if (node.parentId) {
      const parent = await this.resolveMetricTarget(input.metricCode, node.parentId, effectiveFrom);
      if (parent.locked) throw denied("A locked higher-level metric target cannot be overridden");
      if (!withinRange(input.targetValue, parent.minimumValue, parent.maximumValue)) {
        throw validation("Metric target is outside the permitted higher-level range");
      }
      if (parent.overrideState === "APPROVAL_REQUIRED") {
        this.require(permissions.enterprisePolicyApprove);
        if (!input.approvalReference?.trim())
          throw denied("An approval reference is required for this target override");
      }
    }
    const id = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_metric_targets
            (tenant_id,id,scope_node_id,metric_code,target_value,value_unit,override_state,
             minimum_value,maximum_value,approval_reference,effective_from,effective_to,active,
             created_by,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.scopeNodeId,
          input.metricCode.toUpperCase(),
          input.targetValue,
          input.valueUnit.toUpperCase(),
          input.overrideState,
          input.minimumValue ?? null,
          input.maximumValue ?? null,
          input.approvalReference ?? null,
          effectiveFrom,
          input.effectiveTo ?? null,
          this.actor.id,
          stamp,
        ),
      this.audit("ENTERPRISE_METRIC_TARGET_CREATED", "ENTERPRISE_METRIC_TARGET", id, {
        scopeNodeId: input.scopeNodeId,
        metricCode: input.metricCode,
        targetValue: input.targetValue,
        approvalReference: input.approvalReference ? "RECORDED" : null,
      }),
    ]);
    return this.resolveMetricTarget(input.metricCode, input.scopeNodeId, effectiveFrom);
  }

  async resolveMetricTarget(metricCode: string, targetNodeId: string, effectiveAt = now()) {
    this.requireAny([
      permissions.enterprisePolicyView,
      permissions.enterprisePolicyManage,
      permissions.enterpriseFinanceView,
    ]);
    assertIsoTimestamp(effectiveAt, "effectiveAt");
    await this.assertNodeAccess(targetNodeId);
    const result = await this.db
      .prepare(
        `SELECT t.*,n.name scope_name,c.depth FROM enterprise_metric_targets t
         JOIN enterprise_nodes n ON n.tenant_id=t.tenant_id AND n.id=t.scope_node_id
         JOIN enterprise_node_closure c ON c.tenant_id=t.tenant_id
           AND c.ancestor_id=t.scope_node_id AND c.descendant_id=?
         WHERE t.tenant_id=? AND UPPER(t.metric_code)=UPPER(?) AND t.active=1
           AND t.effective_from<=? AND (t.effective_to IS NULL OR t.effective_to>?)
           AND t.effective_from=(SELECT MAX(newer.effective_from) FROM enterprise_metric_targets newer
             WHERE newer.tenant_id=t.tenant_id AND newer.scope_node_id=t.scope_node_id
               AND UPPER(newer.metric_code)=UPPER(t.metric_code) AND newer.active=1
               AND newer.effective_from<=? AND (newer.effective_to IS NULL OR newer.effective_to>?))
         ORDER BY c.depth DESC,t.effective_from`,
      )
      .bind(
        targetNodeId,
        this.actor.tenantId,
        metricCode,
        effectiveAt,
        effectiveAt,
        effectiveAt,
        effectiveAt,
      )
      .all<Row>();
    let effective: Row | undefined;
    let locked = false;
    let range: { min?: number; max?: number } | undefined;
    let approvalRequired = false;
    const trace: Array<Record<string, unknown>> = [];
    for (const row of result.results ?? []) {
      let outcome = "APPLIED";
      if (locked) outcome = "BLOCKED_LOCK";
      else if (approvalRequired && !row.approval_reference) outcome = "APPROVAL_REQUIRED";
      else if (!withinRange(integer(row.target_value), range?.min, range?.max))
        outcome = "BLOCKED_RANGE";
      else {
        effective = row;
        const state = string(row.override_state);
        locked = state === "LOCKED";
        approvalRequired = state === "APPROVAL_REQUIRED";
        range =
          state === "ALLOWED_WITHIN_RANGE"
            ? {
                ...(row.minimum_value === null ? {} : { min: integer(row.minimum_value) }),
                ...(row.maximum_value === null ? {} : { max: integer(row.maximum_value) }),
              }
            : undefined;
      }
      trace.push({
        assignmentId: row.id,
        scopeNodeId: row.scope_node_id,
        scopeName: row.scope_name,
        depth: integer(row.depth),
        value: integer(row.target_value),
        overrideState: row.override_state,
        outcome,
        effectiveFrom: row.effective_from,
      });
    }
    return {
      metricCode: metricCode.toUpperCase(),
      targetNodeId,
      targetValue: effective ? integer(effective.target_value) : undefined,
      valueUnit: effective ? string(effective.value_unit) : undefined,
      sourceScopeNodeId: effective ? string(effective.scope_node_id) : undefined,
      overrideState: effective ? string(effective.override_state) : undefined,
      locked,
      minimumValue: range?.min,
      maximumValue: range?.max,
      effectiveAt,
      trace,
    };
  }

  async requestPolicyException(input: {
    policyCode: string;
    scopeNodeId: string;
    requestType: string;
    requestedValue?: unknown;
    reason: string;
    validFrom?: string;
    validUntil?: string;
  }) {
    this.require(permissions.enterprisePolicyManage);
    if (input.validFrom) assertIsoTimestamp(input.validFrom, "validFrom");
    if (input.validUntil) assertIsoTimestamp(input.validUntil, "validUntil");
    if (input.validFrom && input.validUntil && input.validUntil <= input.validFrom) {
      throw validation("validUntil must follow validFrom");
    }
    await this.assertNodeAccess(input.scopeNodeId);
    const definition = await this.policyDefinition(input.policyCode);
    const id = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_policy_exceptions
            (tenant_id,id,policy_id,scope_node_id,requested_value_json,request_type,reason,status,
             valid_from,valid_until,requested_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'SUBMITTED',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          definition.id,
          input.scopeNodeId,
          input.requestedValue === undefined ? null : json(input.requestedValue),
          input.requestType,
          input.reason,
          input.validFrom ?? stamp,
          input.validUntil ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.exceptionEvent(id, "SUBMITTED", input.reason),
      this.audit("ENTERPRISE_POLICY_EXCEPTION_REQUESTED", "POLICY_EXCEPTION", id, {
        policyCode: input.policyCode,
        scopeNodeId: input.scopeNodeId,
      }),
    ]);
    return { id, status: "SUBMITTED" as const };
  }

  async transitionPolicyException(
    exceptionId: string,
    status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "REVOKED",
    note: string,
  ) {
    this.require(permissions.enterprisePolicyApprove);
    const row = await this.db
      .prepare("SELECT * FROM enterprise_policy_exceptions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, exceptionId)
      .first<Row>();
    if (!row) throw notFound("Policy exception not found");
    await this.assertNodeAccess(string(row.scope_node_id));
    const allowed: Record<string, string[]> = {
      SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
      UNDER_REVIEW: ["APPROVED", "REJECTED"],
      APPROVED: ["REVOKED"],
    };
    if (!(allowed[string(row.status)] ?? []).includes(status))
      throw invalidState("Invalid exception transition");
    if (status === "APPROVED" && string(row.requested_by) === this.actor.id) {
      throw denied("A policy exception requester cannot approve their own request");
    }
    const stamp = now();
    const eventId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_policy_exception_events
            (tenant_id,id,exception_id,status,actor_id,note,created_at)
           SELECT tenant_id,?,?,?, ?,?,? FROM enterprise_policy_exceptions
           WHERE tenant_id=? AND id=? AND status=?`,
        )
        .bind(
          eventId,
          exceptionId,
          status,
          this.actor.id,
          note,
          stamp,
          this.actor.tenantId,
          exceptionId,
          row.status,
        ),
      this.db
        .prepare(
          `UPDATE enterprise_policy_exceptions SET status=?,reviewed_by=?,reviewed_at=?,review_note=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status=? AND EXISTS (
             SELECT 1 FROM enterprise_policy_exception_events e
             WHERE e.tenant_id=enterprise_policy_exceptions.tenant_id AND e.id=?
           )`,
        )
        .bind(
          status,
          this.actor.id,
          stamp,
          note,
          stamp,
          this.actor.tenantId,
          exceptionId,
          row.status,
          eventId,
        ),
      this.conditionalAudit(
        auditId,
        eventId,
        "ENTERPRISE_POLICY_EXCEPTION_TRANSITIONED",
        "POLICY_EXCEPTION",
        exceptionId,
        {
          from: row.status,
          to: status,
        },
      ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      throw invalidState("Policy exception was already transitioned by another operation");
    }
    return { id: exceptionId, status };
  }

  async expirePolicyExceptions(effectiveAt = now()) {
    this.require(permissions.enterprisePolicyApprove);
    assertIsoTimestamp(effectiveAt, "effectiveAt");
    const rows = await this.db
      .prepare(
        `SELECT id,scope_node_id FROM enterprise_policy_exceptions
         WHERE tenant_id=? AND status='APPROVED' AND valid_until IS NOT NULL AND valid_until<=?
         ORDER BY valid_until,id LIMIT 1000`,
      )
      .bind(this.actor.tenantId, effectiveAt)
      .all<Row>();
    let expired = 0;
    for (const row of rows.results ?? []) {
      const eventId = crypto.randomUUID();
      const auditId = crypto.randomUUID();
      const exceptionId = string(row.id);
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO enterprise_policy_exception_events
              (tenant_id,id,exception_id,status,actor_id,note,created_at)
             SELECT tenant_id,?,id,'EXPIRED',?,'Validity period elapsed',?
             FROM enterprise_policy_exceptions
             WHERE tenant_id=? AND id=? AND status='APPROVED' AND valid_until<=?`,
          )
          .bind(eventId, this.actor.id, effectiveAt, this.actor.tenantId, exceptionId, effectiveAt),
        this.db
          .prepare(
            `UPDATE enterprise_policy_exceptions SET status='EXPIRED',reviewed_by=?,reviewed_at=?,
               review_note='Validity period elapsed',updated_at=?
             WHERE tenant_id=? AND id=? AND status='APPROVED' AND EXISTS (
               SELECT 1 FROM enterprise_policy_exception_events e
               WHERE e.tenant_id=enterprise_policy_exceptions.tenant_id AND e.id=?
             )`,
          )
          .bind(this.actor.id, effectiveAt, effectiveAt, this.actor.tenantId, exceptionId, eventId),
        this.conditionalAudit(
          auditId,
          eventId,
          "ENTERPRISE_POLICY_EXCEPTION_EXPIRED",
          "POLICY_EXCEPTION",
          exceptionId,
          {
            scopeNodeId: row.scope_node_id,
          },
        ),
      ]);
      if ((results[0]?.meta?.changes ?? 0) === 1) expired += 1;
    }
    return { expired };
  }

  async grantScopedRole(input: {
    id?: string;
    userId: string;
    roleId: string;
    scopeNodeId: string;
    descendToChildren: boolean;
    effect: "ALLOW" | "DENY";
    validFrom?: string;
    validUntil?: string;
    reason: string;
  }) {
    const canManage = this.actor.permissions.includes(permissions.enterpriseAccessManage);
    if (!canManage) this.require(permissions.enterpriseAccessDelegate);
    if (input.validFrom) assertIsoTimestamp(input.validFrom, "validFrom");
    if (input.validUntil) assertIsoTimestamp(input.validUntil, "validUntil");
    if (input.validFrom && input.validUntil && input.validUntil <= input.validFrom) {
      throw validation("validUntil must follow validFrom");
    }
    await this.assertNodeAccess(input.scopeNodeId);
    await this.assertRoleGrantAllowed(input.roleId, input.scopeNodeId, canManage);
    const target = await this.db
      .prepare("SELECT id FROM users WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, input.userId)
      .first();
    if (!target) throw notFound("Target user not found");
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_role_assignments
            (tenant_id,id,user_id,role_id,scope_node_id,descend_to_children,effect,valid_from,
             valid_until,granted_by,reason,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.userId,
          input.roleId,
          input.scopeNodeId,
          bool(input.descendToChildren),
          input.effect,
          input.validFrom ?? stamp,
          input.validUntil ?? null,
          this.actor.id,
          input.reason,
          stamp,
        ),
      this.audit("ENTERPRISE_ROLE_GRANTED", "ENTERPRISE_ROLE_ASSIGNMENT", id, {
        userId: input.userId,
        roleId: input.roleId,
        scopeNodeId: input.scopeNodeId,
        effect: input.effect,
      }),
    ]);
    return { id };
  }

  async createPriceRollout(input: {
    id?: string;
    scopeNodeId: string;
    menuItemId: string;
    priceMinor: number;
    currency: string;
    idempotencyKey: string;
    scheduledAt?: string;
    requiresApproval: boolean;
  }) {
    this.require(permissions.enterpriseRolloutManage);
    if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0)
      throw validation("Rollout price must be a non-negative safe integer");
    if (!/^[A-Z]{3}$/i.test(input.currency))
      throw validation("Rollout currency must be a three-letter code");
    if (input.scheduledAt) assertIsoTimestamp(input.scheduledAt, "scheduledAt");
    await this.assertNodeAccess(input.scopeNodeId);
    const existing = await this.db
      .prepare("SELECT id,status FROM enterprise_rollouts WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<Row>();
    if (existing) return this.rolloutSummary(string(existing.id), true);
    const item = await this.db
      .prepare(
        "SELECT selling_price_minor,currency FROM menu_catalog_items WHERE tenant_id=? AND id=? AND active=1",
      )
      .bind(this.actor.tenantId, input.menuItemId)
      .first<Row>();
    if (!item) throw notFound("Menu item not found");
    if (string(item.currency) !== input.currency.toUpperCase())
      throw validation("Rollout currency does not match menu item currency");
    const branches = await this.branchNodes(input.scopeNodeId);
    if (!branches.length) throw validation("Rollout scope contains no authorized branches");
    const approvalPolicy = await this.resolveOptionalPolicy(
      "ROLLOUT_APPROVAL_REQUIRED",
      input.scopeNodeId,
    );
    const requiresApproval = input.requiresApproval || approvalPolicy.effectiveValue === true;
    const rolloutId = input.id ?? crypto.randomUUID();
    const stamp = now();
    const rolloutItems: Array<{
      id: string;
      branchId: string;
      oldValue: number;
      status: "PENDING" | "BLOCKED";
      warning: string[];
      policyWatermark: string;
    }> = [];
    for (const branch of branches) {
      const setting = await this.db
        .prepare(
          "SELECT selling_price_minor FROM menu_item_branch_settings WHERE tenant_id=? AND branch_id=? AND menu_item_id=?",
        )
        .bind(this.actor.tenantId, branch.branchId, input.menuItemId)
        .first<{ selling_price_minor: number | null }>();
      const policy = await this.resolvePolicy(`MENU_PRICE:${input.menuItemId}`, branch.nodeId);
      const blocked =
        (policy.locked &&
          policy.effectiveValue !== undefined &&
          integer(policy.effectiveValue) !== input.priceMinor) ||
        !withinRange(input.priceMinor, policy.minimumValueMinor, policy.maximumValueMinor);
      rolloutItems.push({
        id: crypto.randomUUID(),
        branchId: branch.branchId,
        oldValue: Number(setting?.selling_price_minor ?? item.selling_price_minor),
        status: blocked ? "BLOCKED" : "PENDING",
        warning: blocked ? [policy.locked ? "LOCKED_POLICY" : "OUTSIDE_ALLOWED_RANGE"] : [],
        policyWatermark: await hashJson(policy.trace),
      });
    }
    const targetHash = await hashJson(rolloutItems.map((row) => row.branchId).sort());
    const policyWatermark = await hashJson(
      rolloutItems
        .map((row) => ({ branchId: row.branchId, watermark: row.policyWatermark }))
        .sort((left, right) => left.branchId.localeCompare(right.branchId)),
    );
    const status = rolloutItems.every((row) => row.status === "BLOCKED")
      ? "FAILED"
      : input.scheduledAt
        ? "SCHEDULED"
        : "READY";
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO enterprise_rollouts
            (tenant_id,id,rollout_type,scope_node_id,status,change_json,target_hash,idempotency_key,
             policy_watermark,requires_approval,scheduled_at,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          rolloutId,
          "MENU_PRICE",
          input.scopeNodeId,
          status,
          json({
            menuItemId: input.menuItemId,
            priceMinor: input.priceMinor,
            currency: input.currency.toUpperCase(),
          }),
          targetHash,
          input.idempotencyKey,
          policyWatermark,
          bool(requiresApproval),
          input.scheduledAt ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
    ];
    for (const row of rolloutItems) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO enterprise_rollout_items
              (tenant_id,id,rollout_id,branch_id,resource_type,resource_id,old_value_json,new_value_json,status,warning_json)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            row.id,
            rolloutId,
            row.branchId,
            "MENU_PRICE",
            input.menuItemId,
            json({ priceMinor: row.oldValue, currency: input.currency.toUpperCase() }),
            json({ priceMinor: input.priceMinor, currency: input.currency.toUpperCase() }),
            row.status,
            json(row.warning),
          ),
      );
    }
    statements.push(
      this.rolloutEvent(rolloutId, "PREVIEW_CREATED", { targetCount: rolloutItems.length, status }),
      this.audit("ENTERPRISE_ROLLOUT_PREVIEWED", "ENTERPRISE_ROLLOUT", rolloutId, {
        targetCount: rolloutItems.length,
        blockedCount: rolloutItems.filter((row) => row.status === "BLOCKED").length,
      }),
    );
    await this.db.batch(statements);
    return this.rolloutSummary(rolloutId, false);
  }

  async confirmRollout(rolloutId: string, confirmationHash: string) {
    this.require(permissions.enterpriseRolloutManage);
    const rollout = await this.getRollout(rolloutId);
    await this.assertNodeAccess(string(rollout.scope_node_id));
    if (!["READY", "SCHEDULED"].includes(string(rollout.status))) {
      throw invalidState("Only a validated rollout can be confirmed");
    }
    if (rollout.confirmed_at) return this.rolloutSummary(rolloutId, true);
    if (!confirmationHash || confirmationHash !== string(rollout.target_hash)) {
      throw validation("Rollout confirmation does not match the previewed target scope");
    }
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE enterprise_rollouts SET confirmation_hash=?,confirmed_by=?,confirmed_at=?,updated_at=?
           WHERE tenant_id=? AND id=? AND confirmed_at IS NULL AND status IN ('READY','SCHEDULED')`,
        )
        .bind(confirmationHash, this.actor.id, stamp, stamp, this.actor.tenantId, rolloutId),
      this.rolloutEvent(rolloutId, "CONFIRMED", { targetHash: confirmationHash }),
      this.audit("ENTERPRISE_ROLLOUT_CONFIRMED", "ENTERPRISE_ROLLOUT", rolloutId, {
        targetHash: confirmationHash,
      }),
    ]);
    return this.rolloutSummary(rolloutId, false);
  }

  async approveRollout(rolloutId: string) {
    this.require(permissions.enterpriseRolloutApprove);
    const rollout = await this.getRollout(rolloutId);
    await this.assertNodeAccess(string(rollout.scope_node_id));
    if (!["READY", "SCHEDULED"].includes(string(rollout.status)))
      throw invalidState("Rollout is not approvable");
    if (integer(rollout.requires_approval) !== 1)
      throw invalidState("Rollout does not require approval");
    if (string(rollout.created_by) === this.actor.id) {
      throw denied("Two-person approval requires an approver other than the rollout creator");
    }
    if (rollout.approved_by) return this.rolloutSummary(rolloutId, true);
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE enterprise_rollouts SET approved_by=?,approved_at=?,updated_at=? WHERE tenant_id=? AND id=? AND approved_by IS NULL",
        )
        .bind(this.actor.id, stamp, stamp, this.actor.tenantId, rolloutId),
      this.rolloutEvent(rolloutId, "APPROVED", {}),
      this.audit("ENTERPRISE_ROLLOUT_APPROVED", "ENTERPRISE_ROLLOUT", rolloutId, {}),
    ]);
    return this.rolloutSummary(rolloutId, false);
  }

  async executeRollout(rolloutId: string) {
    this.require(permissions.enterpriseRolloutManage);
    const rollout = await this.getRollout(rolloutId);
    await this.assertNodeAccess(string(rollout.scope_node_id));
    if (!["READY", "SCHEDULED", "PARTIAL"].includes(string(rollout.status))) {
      if (string(rollout.status) === "COMPLETE") return this.rolloutSummary(rolloutId, true);
      throw invalidState("Rollout is not executable");
    }
    if (!rollout.confirmed_at || !rollout.confirmation_hash) {
      throw invalidState(
        "Rollout must be explicitly confirmed against its preview before execution",
      );
    }
    if (integer(rollout.requires_approval) === 1 && !rollout.approved_by)
      throw invalidState("Rollout approval is required");
    const change = parseJsonObject(rollout.change_json);
    const allItems = await this.db
      .prepare(
        "SELECT * FROM enterprise_rollout_items WHERE tenant_id=? AND rollout_id=? ORDER BY branch_id",
      )
      .bind(this.actor.tenantId, rolloutId)
      .all<Row>();
    const currentTargetHash = await hashJson(
      (allItems.results ?? []).map((item) => string(item.branch_id)).sort(),
    );
    if (
      currentTargetHash !== string(rollout.target_hash) ||
      currentTargetHash !== string(rollout.confirmation_hash)
    ) {
      throw denied("Rollout target scope no longer matches the confirmed preview");
    }
    const currentPolicyWatermark = await this.priceRolloutPolicyWatermark(
      string(rollout.scope_node_id),
      string(change["menuItemId"]),
      allItems.results ?? [],
    );
    if (currentPolicyWatermark !== string(rollout.policy_watermark)) {
      throw invalidState(
        "Enterprise policy changed after preview; create and confirm a new rollout preview",
      );
    }
    const items = {
      results: (allItems.results ?? []).filter((item) =>
        ["PENDING", "FAILED"].includes(string(item.status)),
      ),
    };
    const claim = await this.db
      .prepare(
        "UPDATE enterprise_rollouts SET status='RUNNING',updated_at=? WHERE tenant_id=? AND id=? AND status IN ('READY','SCHEDULED','PARTIAL')",
      )
      .bind(now(), this.actor.tenantId, rolloutId)
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) {
      const current = await this.getRollout(rolloutId);
      if (string(current.status) === "COMPLETE") return this.rolloutSummary(rolloutId, true);
      throw invalidState("Rollout is already running or no longer executable");
    }
    for (const item of items.results ?? []) {
      try {
        await this.assertBranchAccess(string(item.branch_id));
        if (string(rollout.rollout_type) !== "MENU_PRICE")
          throw validation("Unsupported rollout type");
        await this.db.batch([
          this.db
            .prepare(
              `INSERT INTO menu_item_branch_settings
                (tenant_id,branch_id,menu_item_id,selling_price_minor,available,channel_availability_json,updated_at)
               VALUES (?,?,?,?,1,'{}',?)
               ON CONFLICT(tenant_id,branch_id,menu_item_id) DO UPDATE SET
                 selling_price_minor=excluded.selling_price_minor,updated_at=excluded.updated_at`,
            )
            .bind(
              this.actor.tenantId,
              item.branch_id,
              change["menuItemId"],
              integer(change["priceMinor"]),
              now(),
            ),
          this.db
            .prepare(
              "UPDATE enterprise_rollout_items SET status='SUCCEEDED',applied_at=?,error_code=NULL WHERE tenant_id=? AND id=?",
            )
            .bind(now(), this.actor.tenantId, item.id),
        ]);
      } catch (error) {
        await this.db
          .prepare(
            "UPDATE enterprise_rollout_items SET status='FAILED',error_code=? WHERE tenant_id=? AND id=?",
          )
          .bind(
            error instanceof Error ? error.message.slice(0, 160) : "ROLLOUT_ITEM_FAILED",
            this.actor.tenantId,
            item.id,
          )
          .run();
      }
    }
    const counts = await this.rolloutCounts(rolloutId);
    const finalStatus =
      counts.failed + counts.blocked > 0
        ? counts.succeeded > 0
          ? "PARTIAL"
          : "FAILED"
        : "COMPLETE";
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE enterprise_rollouts SET status=?,updated_at=? WHERE tenant_id=? AND id=? AND status='RUNNING'",
        )
        .bind(finalStatus, now(), this.actor.tenantId, rolloutId),
      this.rolloutEvent(rolloutId, "EXECUTION_FINISHED", { ...counts, status: finalStatus }),
      this.audit("ENTERPRISE_ROLLOUT_EXECUTED", "ENTERPRISE_ROLLOUT", rolloutId, {
        ...counts,
        status: finalStatus,
      }),
    ]);
    return this.rolloutSummary(rolloutId, false);
  }

  async createBranchTemplate(input: { code: string; name: string; brandId?: string }) {
    this.require(permissions.enterpriseRolloutManage);
    const id = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO branch_templates (tenant_id,id,code,name,brand_id,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'DRAFT',?,?,?)",
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.toUpperCase(),
          input.name,
          input.brandId ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("BRANCH_TEMPLATE_CREATED", "BRANCH_TEMPLATE", id, { code: input.code }),
    ]);
    return { id };
  }

  async createTemplateVersion(
    templateId: string,
    configuration: Record<string, unknown>,
    publish = false,
  ) {
    this.require(permissions.enterpriseRolloutManage);
    validateTemplateConfiguration(configuration);
    const template = await this.db
      .prepare("SELECT id FROM branch_templates WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, templateId)
      .first();
    if (!template) throw notFound("Branch template not found");
    const row = await this.db
      .prepare(
        "SELECT COALESCE(MAX(version),0)+1 version FROM branch_template_versions WHERE tenant_id=? AND template_id=?",
      )
      .bind(this.actor.tenantId, templateId)
      .first<{ version: number }>();
    const version = Number(row?.version ?? 1);
    const id = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO branch_template_versions (tenant_id,id,template_id,version,configuration_json,configuration_hash,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          this.actor.tenantId,
          id,
          templateId,
          version,
          json(configuration),
          await hashJson(configuration),
          publish ? "PUBLISHED" : "DRAFT",
          this.actor.id,
          stamp,
        ),
      this.db
        .prepare("UPDATE branch_templates SET status=?,updated_at=? WHERE tenant_id=? AND id=?")
        .bind(publish ? "ACTIVE" : "DRAFT", stamp, this.actor.tenantId, templateId),
      this.audit("BRANCH_TEMPLATE_VERSION_CREATED", "BRANCH_TEMPLATE_VERSION", id, {
        templateId,
        version,
        publish,
      }),
    ]);
    return { id, version, status: publish ? "PUBLISHED" : "DRAFT" };
  }

  async previewBranchTemplate(templateVersionId: string, branchId: string) {
    this.requireAny([permissions.enterpriseRolloutView, permissions.enterpriseRolloutManage]);
    await this.assertBranchAccess(branchId);
    const version = await this.db
      .prepare(
        `SELECT v.id,v.version,v.configuration_json,v.configuration_hash,v.status,t.id template_id,
           t.name template_name,t.brand_id,b.brand_id branch_brand_id
         FROM branch_template_versions v
         JOIN branch_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id
         JOIN branches b ON b.tenant_id=v.tenant_id AND b.id=?
         WHERE v.tenant_id=? AND v.id=?`,
      )
      .bind(branchId, this.actor.tenantId, templateVersionId)
      .first<Row>();
    if (!version) throw notFound("Branch template version not found");
    if (string(version.status) !== "PUBLISHED")
      throw invalidState("Only a published template version can be adopted");
    if (version.brand_id && string(version.brand_id) !== string(version.branch_brand_id)) {
      throw validation("Branch brand does not match the template brand");
    }
    const previous = await this.db
      .prepare(
        `SELECT v.configuration_json,v.version,t.name template_name
         FROM branch_template_assignments a
         JOIN branch_template_versions v ON v.tenant_id=a.tenant_id AND v.id=a.template_version_id
         JOIN branch_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id
         WHERE a.tenant_id=? AND a.branch_id=? AND a.adoption_status='APPLIED'
         ORDER BY a.applied_at DESC,a.updated_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, branchId)
      .first<Row>();
    const configuration = parseJsonObject(version.configuration_json);
    const previousConfiguration = parseJsonObject(previous?.configuration_json);
    const keys = [
      ...new Set([...Object.keys(previousConfiguration), ...Object.keys(configuration)]),
    ].sort();
    const differences = keys
      .filter(
        (key) =>
          stableStringify(previousConfiguration[key]) !== stableStringify(configuration[key]),
      )
      .map((key) => ({
        section: key,
        previous: previousConfiguration[key] ?? null,
        next: configuration[key] ?? null,
      }));
    const previewHash = await hashJson({
      tenantId: this.actor.tenantId,
      branchId,
      templateVersionId,
      configurationHash: version.configuration_hash,
      differences,
    });
    return {
      branchId,
      templateVersionId,
      templateId: string(version.template_id),
      templateName: string(version.template_name),
      version: integer(version.version),
      previousVersion: previous ? integer(previous.version) : null,
      differences,
      blockers: [],
      previewHash,
    };
  }

  async applyBranchTemplate(input: {
    templateVersionId: string;
    branchId: string;
    previewHash: string;
    idempotencyKey: string;
  }) {
    this.require(permissions.enterpriseRolloutManage);
    const existing = await this.db
      .prepare(
        "SELECT id,adoption_status FROM branch_template_assignments WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<Row>();
    if (existing)
      return { id: string(existing.id), status: string(existing.adoption_status), duplicate: true };
    const preview = await this.previewBranchTemplate(input.templateVersionId, input.branchId);
    if (preview.previewHash !== input.previewHash) {
      throw validation("Branch template application does not match the current preview");
    }
    if (preview.blockers.length) throw invalidState("Branch template preview contains blockers");
    const id = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO branch_template_assignments
            (tenant_id,id,branch_id,template_version_id,idempotency_key,preview_hash,adoption_status,
             applied_by,applied_at,differences_json,blockers_json,updated_at)
           VALUES (?,?,?,?,?,?,'APPLIED',?,?,?,'[]',?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.templateVersionId,
          input.idempotencyKey,
          input.previewHash,
          this.actor.id,
          stamp,
          json(preview.differences),
          stamp,
        ),
      this.audit("BRANCH_TEMPLATE_APPLIED", "BRANCH_TEMPLATE_ASSIGNMENT", id, {
        branchId: input.branchId,
        templateVersionId: input.templateVersionId,
        differenceCount: preview.differences.length,
      }),
    ]);
    return { id, status: "APPLIED" as const, duplicate: false, preview };
  }

  async provisionBranchFromTemplate(input: BranchTemplateProvisionInput) {
    this.require(permissions.enterpriseOrganisationManage);
    this.require(permissions.enterpriseRolloutManage);
    if (
      !this.actor.permissions.includes(permissions.tenantScopeAllBranches) ||
      this.actor.branchScope.type !== "ALL"
    ) {
      throw denied("Provisioning a branch requires tenant-wide authority");
    }
    await this.assertNodeAccess(input.parentNodeId);
    const existing = await this.db
      .prepare(
        `SELECT a.id assignment_id,a.branch_id,n.id node_id
         FROM branch_template_assignments a
         LEFT JOIN enterprise_nodes n ON n.tenant_id=a.tenant_id AND n.branch_id=a.branch_id
         WHERE a.tenant_id=? AND a.idempotency_key=?`,
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<Row>();
    if (existing) {
      return {
        assignmentId: string(existing.assignment_id),
        branchId: string(existing.branch_id),
        nodeId: string(existing.node_id),
        status: "APPLIED" as const,
        duplicate: true,
      };
    }

    const version = await this.db
      .prepare(
        `SELECT v.id,v.configuration_json,v.configuration_hash,v.status,t.brand_id template_brand_id
         FROM branch_template_versions v
         JOIN branch_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id
         WHERE v.tenant_id=? AND v.id=?`,
      )
      .bind(this.actor.tenantId, input.templateVersionId)
      .first<Row>();
    if (!version) throw notFound("Branch template version not found");
    if (string(version.status) !== "PUBLISHED")
      throw invalidState("Only a published template version can provision a branch");
    if (version.template_brand_id && string(version.template_brand_id) !== input.brandId) {
      throw validation("Branch brand does not match the template brand");
    }
    const configuration = parseJsonObject(version.configuration_json);
    validateTemplateConfiguration(configuration);
    const profile = branchOperatingProfile(configuration);

    const parent = await this.db
      .prepare(
        "SELECT node_type,legal_entity_id,brand_id,status FROM enterprise_nodes WHERE tenant_id=? AND id=?",
      )
      .bind(this.actor.tenantId, input.parentNodeId)
      .first<Row>();
    if (!parent) throw notFound("Parent enterprise node not found");
    if (["BRANCH", "WAREHOUSE", "COMMISSARY"].includes(string(parent.node_type))) {
      throw validation("A branch cannot be provisioned below this enterprise node type");
    }
    if (string(parent.status) !== "ACTIVE")
      throw invalidState("A branch can only be provisioned below an active enterprise node");
    if (parent.legal_entity_id && string(parent.legal_entity_id) !== input.legalEntityId) {
      throw validation("Branch legal entity conflicts with its parent scope");
    }
    if (parent.brand_id && string(parent.brand_id) !== input.brandId) {
      throw validation("Branch brand conflicts with its parent scope");
    }
    const legalEntity = await this.db
      .prepare("SELECT id FROM legal_entities WHERE tenant_id=? AND id=? AND status='ACTIVE'")
      .bind(this.actor.tenantId, input.legalEntityId)
      .first();
    if (!legalEntity) throw validation("Active legal entity does not exist in this tenant");
    const brand = await this.db
      .prepare("SELECT id FROM brands WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, input.brandId)
      .first();
    if (!brand) throw validation("Active brand does not exist in this tenant");

    const branchId = input.id ?? crypto.randomUUID();
    const nodeId = input.nodeId ?? crypto.randomUUID();
    const assignmentId = crypto.randomUUID();
    const stamp = now();
    const branchPayload = {
      address: input.address,
      phone: input.phone,
      email: input.email,
      serviceModes: profile.serviceModes,
      provisionedFromTemplateVersionId: input.templateVersionId,
    };
    const previewHash = await hashJson({
      tenantId: this.actor.tenantId,
      branchId,
      nodeId,
      parentNodeId: input.parentNodeId,
      templateVersionId: input.templateVersionId,
      configurationHash: version.configuration_hash,
      code: input.code.toUpperCase(),
    });
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO branches
            (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
           VALUES (?,?,?,?,?,?,?,1,?)`,
        )
        .bind(
          this.actor.tenantId,
          branchId,
          input.brandId,
          input.code.toUpperCase(),
          input.name.trim(),
          input.timezone,
          input.businessDayCutoffMinutes,
          json(branchPayload),
        ),
      this.db
        .prepare(
          `INSERT INTO branch_operating_profiles
            (tenant_id,branch_id,accounting_mode_override,negative_stock_policy,operating_hours_json,
             service_modes_json,required_device_roles_json,payments_required,inventory_enabled,
             recipes_required,printing_required,kds_required,created_by,created_at,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          branchId,
          profile.accountingModeOverride,
          profile.negativeStockPolicy,
          json(profile.operatingHours),
          json(profile.serviceModes),
          json(profile.requiredDeviceRoles),
          profile.paymentsRequired ? 1 : 0,
          profile.inventoryEnabled ? 1 : 0,
          profile.recipesRequired ? 1 : 0,
          profile.printingRequired ? 1 : 0,
          profile.kdsRequired ? 1 : 0,
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO enterprise_nodes
            (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,
             status,effective_from,timezone,currency,metadata_json,created_by,created_at,updated_by,updated_at,version)
           VALUES (?,?, 'BRANCH',?,?,?,?,?,?,'ACTIVE',?,?,?,'{}',?,?,?,?,1)`,
        )
        .bind(
          this.actor.tenantId,
          nodeId,
          input.code.toUpperCase(),
          input.name.trim(),
          input.parentNodeId,
          input.legalEntityId,
          input.brandId,
          branchId,
          stamp,
          input.timezone,
          currencyCode(input.currency),
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.db
        .prepare(
          "INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth) VALUES (?,?,?,0)",
        )
        .bind(this.actor.tenantId, nodeId, nodeId),
      this.db
        .prepare(
          `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
           SELECT tenant_id,ancestor_id,?,depth+1 FROM enterprise_node_closure
           WHERE tenant_id=? AND descendant_id=?`,
        )
        .bind(nodeId, this.actor.tenantId, input.parentNodeId),
      this.db
        .prepare(
          `INSERT INTO branch_template_assignments
            (tenant_id,id,branch_id,template_version_id,idempotency_key,preview_hash,adoption_status,
             applied_by,applied_at,differences_json,blockers_json,updated_at)
           VALUES (?,?,?,?,?,?,'APPLIED',?,?,'[]','[]',?)`,
        )
        .bind(
          this.actor.tenantId,
          assignmentId,
          branchId,
          input.templateVersionId,
          input.idempotencyKey,
          previewHash,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("BRANCH_PROVISIONED_FROM_TEMPLATE", "BRANCH", branchId, {
        nodeId,
        parentNodeId: input.parentNodeId,
        templateVersionId: input.templateVersionId,
      }),
      this.audit("BRANCH_TEMPLATE_APPLIED", "BRANCH_TEMPLATE_ASSIGNMENT", assignmentId, {
        branchId,
        templateVersionId: input.templateVersionId,
        provisioned: true,
      }),
    ]);
    return {
      assignmentId,
      branchId,
      nodeId,
      status: "APPLIED" as const,
      duplicate: false,
      previewHash,
    };
  }

  async effectiveBranchTemplate(branchId: string) {
    this.requireAny([
      permissions.enterpriseRolloutView,
      permissions.enterpriseRolloutManage,
      permissions.enterpriseReadinessView,
    ]);
    await this.assertBranchAccess(branchId);
    const row = await this.db
      .prepare(
        `SELECT a.id assignment_id,a.applied_at,v.id template_version_id,v.version,
           v.configuration_json,v.configuration_hash,t.id template_id,t.name template_name
         FROM branch_template_assignments a
         JOIN branch_template_versions v ON v.tenant_id=a.tenant_id AND v.id=a.template_version_id
         JOIN branch_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id
         WHERE a.tenant_id=? AND a.branch_id=? AND a.adoption_status='APPLIED'
         ORDER BY a.applied_at DESC,a.updated_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, branchId)
      .first<Row>();
    if (!row) return null;
    return {
      assignmentId: string(row.assignment_id),
      branchId,
      templateId: string(row.template_id),
      templateVersionId: string(row.template_version_id),
      templateName: string(row.template_name),
      version: integer(row.version),
      configuration: parseJsonObject(row.configuration_json),
      configurationHash: string(row.configuration_hash),
      appliedAt: string(row.applied_at),
    };
  }

  async aggregateRequisitions(input: {
    scopeNodeId: string;
    currency: string;
    idempotencyKey: string;
    requiredAt?: string;
  }) {
    this.require(permissions.enterpriseProcurementManage);
    if (!/^[A-Z]{3}$/i.test(input.currency))
      throw validation("Procurement currency must be a three-letter code");
    if (input.requiredAt) assertIsoTimestamp(input.requiredAt, "requiredAt");
    await this.assertNodeAccess(input.scopeNodeId);
    const duplicate = await this.db
      .prepare("SELECT id FROM central_requisition_batches WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<Row>();
    if (duplicate) return this.getRequisitionBatch(string(duplicate.id), true);
    const branches = await this.branchNodes(input.scopeNodeId);
    const branchIds = new Set(branches.map((row) => row.branchId));
    const requisitions = await this.db
      .prepare(
        `SELECT r.id requisition_id,r.branch_id,l.id line_id,l.inventory_item_id,
                l.requested_quantity_minor,l.unit_id,i.base_unit_id
         FROM purchase_requisitions r
         JOIN purchase_requisition_lines l ON l.tenant_id=r.tenant_id AND l.requisition_id=r.id
         JOIN inventory_items i ON i.tenant_id=l.tenant_id AND i.id=l.inventory_item_id
         WHERE r.tenant_id=? AND r.status='APPROVED' ORDER BY r.branch_id,l.inventory_item_id`,
      )
      .bind(this.actor.tenantId)
      .all<Row>();
    const sourceRows = (requisitions.results ?? []).filter((row) =>
      branchIds.has(string(row.branch_id)),
    );
    if (!sourceRows.length)
      throw validation("No approved requisitions exist in the selected scope");
    const batchId = crypto.randomUUID();
    const stamp = now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "INSERT INTO central_requisition_batches (tenant_id,id,scope_node_id,currency,required_at,status,idempotency_key,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'READY',?,?,?,?)",
        )
        .bind(
          this.actor.tenantId,
          batchId,
          input.scopeNodeId,
          input.currency.toUpperCase(),
          input.requiredAt ?? null,
          input.idempotencyKey,
          this.actor.id,
          stamp,
          stamp,
        ),
    ];
    for (const row of sourceRows) {
      const quantity = await this.toBaseQuantity(
        string(row.inventory_item_id),
        integer(row.requested_quantity_minor),
        string(row.unit_id),
        string(row.base_unit_id),
        stamp,
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO central_requisition_allocations
              (tenant_id,id,batch_id,requisition_id,requisition_line_id,branch_id,inventory_item_id,quantity_micro,unit_id,status)
             VALUES (?,?,?,?,?,?,?,?,?,'ALLOCATED')`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            batchId,
            row.requisition_id,
            row.line_id,
            row.branch_id,
            row.inventory_item_id,
            quantity,
            row.base_unit_id,
          ),
      );
    }
    statements.push(
      this.audit("CENTRAL_REQUISITION_AGGREGATED", "CENTRAL_REQUISITION_BATCH", batchId, {
        sourceCount: sourceRows.length,
      }),
    );
    await this.db.batch(statements);
    return this.getRequisitionBatch(batchId, false);
  }

  async createSupplierContract(input: {
    id?: string;
    supplierId: string;
    scopeNodeId: string;
    contractReference: string;
    inventoryItemId?: string;
    categoryReference?: string;
    purchaseUnitId?: string;
    negotiatedPriceMinor?: number;
    currency?: string;
    minimumQuantityMicro?: number;
    leadTimeDays?: number;
    effectiveFrom: string;
    effectiveTo?: string;
    status: "DRAFT" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
  }) {
    this.require(permissions.enterpriseProcurementManage);
    await this.assertNodeAccess(input.scopeNodeId);
    validateDateRange(input.effectiveFrom, input.effectiveTo, true);
    if (input.inventoryItemId && input.categoryReference) {
      throw validation("Supplier contract must target either an item or a category, not both");
    }
    for (const [label, value] of [
      ["negotiated price", input.negotiatedPriceMinor],
      ["minimum quantity", input.minimumQuantityMicro],
      ["lead time", input.leadTimeDays],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw validation(`${label} must be a non-negative safe integer`);
      }
    }
    if (input.negotiatedPriceMinor !== undefined && !input.currency) {
      throw validation("Negotiated price requires a currency");
    }
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO supplier_contracts
            (tenant_id,id,supplier_id,scope_node_id,contract_reference,inventory_item_id,
             category_reference,purchase_unit_id,negotiated_price_minor,currency,
             minimum_quantity_micro,lead_time_days,effective_from,effective_to,status,
             created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.supplierId,
          input.scopeNodeId,
          required(input.contractReference, "contract reference"),
          input.inventoryItemId ?? null,
          input.categoryReference ?? null,
          input.purchaseUnitId ?? null,
          input.negotiatedPriceMinor ?? null,
          input.currency ? currencyCode(input.currency) : null,
          input.minimumQuantityMicro ?? null,
          input.leadTimeDays ?? null,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.status,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("SUPPLIER_CONTRACT_CREATED", "SUPPLIER_CONTRACT", id, {
        supplierId: input.supplierId,
        scopeNodeId: input.scopeNodeId,
        status: input.status,
      }),
    ]);
    return { id, status: input.status };
  }

  async validateTransferAccounting(transferId: string) {
    this.requireAny([permissions.enterpriseTransferManage, permissions.inventoryTransfer]);
    const transfer = await this.db
      .prepare("SELECT * FROM stock_transfers WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, transferId)
      .first<Row>();
    if (!transfer) throw notFound("Transfer not found");
    await this.assertBranchAccess(string(transfer.source_branch_id));
    await this.assertBranchAccess(string(transfer.destination_branch_id));
    const entities = await this.db
      .prepare(
        `SELECT branch_id,legal_entity_id FROM enterprise_nodes
         WHERE tenant_id=? AND node_type='BRANCH' AND branch_id IN (?,?)`,
      )
      .bind(this.actor.tenantId, transfer.source_branch_id, transfer.destination_branch_id)
      .all<Row>();
    const source = (entities.results ?? []).find(
      (row) => row.branch_id === transfer.source_branch_id,
    );
    const destination = (entities.results ?? []).find(
      (row) => row.branch_id === transfer.destination_branch_id,
    );
    if (!source?.legal_entity_id || !destination?.legal_entity_id)
      throw validation("Transfer branches require legal-entity mapping");
    if (source.legal_entity_id === destination.legal_entity_id) {
      return { treatment: "INTRA_ENTITY" as const, configured: true };
    }
    const mapping = await this.db
      .prepare(
        `SELECT id,currency,transfer_price_policy_reference FROM intercompany_configurations
         WHERE tenant_id=? AND source_legal_entity_id=? AND destination_legal_entity_id=?
           AND active=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
         ORDER BY effective_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, source.legal_entity_id, destination.legal_entity_id, now(), now())
      .first<Row>();
    if (!mapping)
      throw validation(
        "Cross-entity transfer requires configured intercompany accounts and transfer-price policy",
      );
    return {
      treatment: "INTERCOMPANY" as const,
      configured: true,
      configurationId: string(mapping.id),
      currency: string(mapping.currency),
      transferPricePolicyReference: string(mapping.transfer_price_policy_reference),
    };
  }

  async createFranchiseRelationship(input: {
    id?: string;
    franchiseeLegalEntityId: string;
    franchisorLegalEntityId: string;
    brandId: string;
    branchIds: string[];
    agreementReference: string;
    effectiveFrom: string;
    effectiveTo?: string;
    status: "PROSPECT" | "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "TERMINATED" | "EXPIRED";
    reportingScope: Record<string, unknown>;
  }) {
    this.require(permissions.enterpriseFranchiseManage);
    validateDateRange(input.effectiveFrom, input.effectiveTo, true);
    const branchIds = [...new Set(input.branchIds)];
    for (const branchId of branchIds) await this.assertBranchAccess(branchId);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO franchise_relationships
            (tenant_id,id,franchisee_legal_entity_id,franchisor_legal_entity_id,brand_id,
             agreement_reference,effective_from,effective_to,status,reporting_scope_json,
             created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.franchiseeLegalEntityId,
          input.franchisorLegalEntityId,
          input.brandId,
          required(input.agreementReference, "agreement reference"),
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.status,
          json(input.reportingScope),
          this.actor.id,
          stamp,
          stamp,
        ),
    ];
    for (const branchId of branchIds) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO franchise_branch_assignments (tenant_id,franchise_relationship_id,branch_id) VALUES (?,?,?)",
          )
          .bind(this.actor.tenantId, id, branchId),
      );
    }
    statements.push(
      this.audit("FRANCHISE_RELATIONSHIP_CREATED", "FRANCHISE_RELATIONSHIP", id, {
        branchCount: branchIds.length,
        status: input.status,
      }),
    );
    await this.db.batch(statements);
    return { id, status: input.status, branchCount: branchIds.length };
  }

  async createFranchiseFeeDefinition(input: {
    id?: string;
    franchiseRelationshipId: string;
    code: string;
    name: string;
    feeType: "ROYALTY" | "MARKETING_LEVY" | "FIXED" | "OTHER";
    basisType: "GROSS_SALES" | "NET_SALES" | "CONFIGURED_REVENUE" | "FIXED_PERIODIC";
    rateBps?: number;
    fixedAmountMinor?: number;
    currency?: string;
    exclusions: unknown[];
    accountMapping: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string;
    active: boolean;
  }) {
    this.require(permissions.enterpriseFranchiseManage);
    validateDateRange(input.effectiveFrom, input.effectiveTo, true);
    const fixed = input.basisType === "FIXED_PERIODIC";
    if (
      fixed !== (input.fixedAmountMinor !== undefined) ||
      fixed === (input.rateBps !== undefined)
    ) {
      throw validation("Fixed fees require fixedAmountMinor; variable fees require rateBps");
    }
    if (
      input.rateBps !== undefined &&
      (!Number.isSafeInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10_000)
    ) {
      throw validation("Franchise fee rate must be between 0 and 10000 basis points");
    }
    if (
      input.fixedAmountMinor !== undefined &&
      (!Number.isSafeInteger(input.fixedAmountMinor) || input.fixedAmountMinor < 0)
    ) {
      throw validation("Fixed franchise fee must be a non-negative safe integer");
    }
    const relationship = await this.db
      .prepare("SELECT id FROM franchise_relationships WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.franchiseRelationshipId)
      .first();
    if (!relationship) throw notFound("Franchise relationship not found");
    const branches = await this.db
      .prepare(
        "SELECT branch_id FROM franchise_branch_assignments WHERE tenant_id=? AND franchise_relationship_id=?",
      )
      .bind(this.actor.tenantId, input.franchiseRelationshipId)
      .all<{ branch_id: string }>();
    for (const branch of branches.results ?? []) await this.assertBranchAccess(branch.branch_id);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO franchise_fee_definitions
            (tenant_id,id,franchise_relationship_id,code,name,fee_type,basis_type,rate_bps,
             fixed_amount_minor,currency,exclusions_json,account_mapping_json,effective_from,
             effective_to,active,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.franchiseRelationshipId,
          required(input.code, "fee code").toUpperCase(),
          required(input.name, "fee name"),
          input.feeType,
          input.basisType,
          input.rateBps ?? null,
          input.fixedAmountMinor ?? null,
          input.currency ? currencyCode(input.currency) : null,
          json(input.exclusions),
          json(input.accountMapping),
          input.effectiveFrom,
          input.effectiveTo ?? null,
          bool(input.active),
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("FRANCHISE_FEE_DEFINITION_CREATED", "FRANCHISE_FEE_DEFINITION", id, {
        franchiseRelationshipId: input.franchiseRelationshipId,
        feeType: input.feeType,
        basisType: input.basisType,
      }),
    ]);
    return { id };
  }

  async franchiseStatement(
    franchiseRelationshipId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    this.requireAny([permissions.enterpriseFranchiseView, permissions.enterpriseFinanceView]);
    validateDateRange(periodStart, periodEnd);
    const relationship = await this.db
      .prepare(
        `SELECT r.id,r.agreement_reference,r.status,fr.legal_name franchisee_name,
                fe.legal_name franchisor_name
         FROM franchise_relationships r
         JOIN legal_entities fr ON fr.tenant_id=r.tenant_id AND fr.id=r.franchisee_legal_entity_id
         JOIN legal_entities fe ON fe.tenant_id=r.tenant_id AND fe.id=r.franchisor_legal_entity_id
         WHERE r.tenant_id=? AND r.id=?`,
      )
      .bind(this.actor.tenantId, franchiseRelationshipId)
      .first<Record<string, unknown>>();
    if (!relationship) throw notFound("Franchise relationship not found");
    const branches = await this.db
      .prepare(
        "SELECT branch_id FROM franchise_branch_assignments WHERE tenant_id=? AND franchise_relationship_id=?",
      )
      .bind(this.actor.tenantId, franchiseRelationshipId)
      .all<{ branch_id: string }>();
    for (const branch of branches.results ?? []) await this.assertBranchAccess(branch.branch_id);
    const periods = await this.db
      .prepare(
        `SELECT p.id,d.code,d.name,d.fee_type,d.basis_type,p.currency,p.basis_minor,
                p.amount_minor,p.quality,p.status,p.calculated_at
         FROM franchise_fee_periods p
         JOIN franchise_fee_definitions d
           ON d.tenant_id=p.tenant_id AND d.id=p.fee_definition_id
         WHERE p.tenant_id=? AND d.franchise_relationship_id=?
           AND p.period_start>=? AND p.period_end<=?
         ORDER BY p.period_start,d.code`,
      )
      .bind(this.actor.tenantId, franchiseRelationshipId, periodStart, periodEnd)
      .all<Record<string, unknown>>();
    const currencies = new Set(
      (periods.results ?? []).map((row) => string(row["currency"])).filter(Boolean),
    );
    const comparable = currencies.size <= 1;
    return {
      documentType: "MANAGEMENT_FRANCHISE_STATEMENT" as const,
      statutoryInvoice: false,
      relationship: publicRow(relationship as Row),
      periodStart,
      periodEnd,
      currency: comparable ? [...currencies][0] : undefined,
      fees: (periods.results ?? []).map((row) => publicRow(row as Row)),
      totalFeeMinor: comparable
        ? (periods.results ?? []).reduce((total, row) => total + integer(row["amount_minor"]), 0)
        : null,
      payments: {
        available: false,
        reason: "No authoritative franchise settlement allocation is configured",
      },
      outstandingManagementBalanceMinor: null,
      quality: periods.results?.length ? "FACTUAL" : "INSUFFICIENT_DATA",
    };
  }

  async calculateFranchiseFee(input: {
    feeDefinitionId: string;
    periodStart: string;
    periodEnd: string;
  }) {
    this.require(permissions.enterpriseFranchiseManage);
    validateDateRange(input.periodStart, input.periodEnd);
    const definition = await this.db
      .prepare(
        `SELECT f.*,r.id relationship_id FROM franchise_fee_definitions f
         JOIN franchise_relationships r ON r.tenant_id=f.tenant_id AND r.id=f.franchise_relationship_id
         WHERE f.tenant_id=? AND f.id=? AND f.active=1`,
      )
      .bind(this.actor.tenantId, input.feeDefinitionId)
      .first<Row>();
    if (!definition) throw notFound("Franchise fee definition not found");
    const branches = await this.db
      .prepare(
        "SELECT branch_id FROM franchise_branch_assignments WHERE tenant_id=? AND franchise_relationship_id=?",
      )
      .bind(this.actor.tenantId, definition.relationship_id)
      .all<{ branch_id: string }>();
    for (const branch of branches.results ?? []) await this.assertBranchAccess(branch.branch_id);
    const metrics = await this.db
      .prepare(
        `SELECT m.branch_id,m.business_date,m.currency,m.gross_sales_minor,m.net_sales_minor,
                m.net_revenue_minor,m.quality
         FROM daily_branch_metrics m
         JOIN franchise_branch_assignments b ON b.tenant_id=m.tenant_id AND b.branch_id=m.branch_id
         WHERE m.tenant_id=? AND b.franchise_relationship_id=?
           AND m.business_date BETWEEN ? AND ? ORDER BY m.branch_id,m.business_date`,
      )
      .bind(this.actor.tenantId, definition.relationship_id, input.periodStart, input.periodEnd)
      .all<Row>();
    const rows = metrics.results ?? [];
    const currencies = new Set(rows.map((row) => string(row.currency)));
    if (currencies.size > 1)
      throw validation("Cross-currency franchise fee requires an authoritative FX basis");
    let basisMinor = 0;
    const basisType = string(definition.basis_type);
    if (basisType === "FIXED_PERIODIC") basisMinor = 0;
    else {
      const column =
        basisType === "GROSS_SALES"
          ? "gross_sales_minor"
          : basisType === "NET_SALES"
            ? "net_sales_minor"
            : "net_revenue_minor";
      basisMinor = rows.reduce((sum, row) => sum + integer(row[column]), 0);
    }
    const amountMinor =
      basisType === "FIXED_PERIODIC"
        ? integer(definition.fixed_amount_minor)
        : roundedBasisPoints(basisMinor, integer(definition.rate_bps));
    const expectedFacts = Math.max(
      1,
      dateSpan(input.periodStart, input.periodEnd) * Math.max(1, branches.results?.length ?? 0),
    );
    const quality =
      rows.length === 0
        ? "INSUFFICIENT_DATA"
        : rows.length < expectedFacts
          ? "PARTIAL"
          : rows.some((row) => row.quality === "LOW" || row.quality === "INSUFFICIENT_DATA")
            ? "LOW"
            : "HIGH";
    const sourceFacts = rows.map((row) => ({
      branchId: row.branch_id,
      businessDate: row.business_date,
      currency: row.currency,
      grossSalesMinor: row.gross_sales_minor,
      netSalesMinor: row.net_sales_minor,
      netRevenueMinor: row.net_revenue_minor,
      quality: row.quality,
    }));
    const id = stableId(
      "franchise-fee",
      `${input.feeDefinitionId}:${input.periodStart}:${input.periodEnd}`,
    );
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO franchise_fee_periods
            (tenant_id,id,fee_definition_id,period_start,period_end,currency,basis_minor,amount_minor,
             quality,source_facts_json,source_hash,status,calculated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'CALCULATED',?)
           ON CONFLICT(tenant_id,fee_definition_id,period_start,period_end) DO UPDATE SET
             currency=excluded.currency,basis_minor=excluded.basis_minor,amount_minor=excluded.amount_minor,
             quality=excluded.quality,source_facts_json=excluded.source_facts_json,
             source_hash=excluded.source_hash,calculated_at=excluded.calculated_at
           WHERE franchise_fee_periods.status IN ('CALCULATED','REVIEW')`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.feeDefinitionId,
          input.periodStart,
          input.periodEnd,
          string(definition.currency || currencies.values().next().value || ""),
          basisMinor,
          amountMinor,
          quality,
          json(sourceFacts),
          await hashJson(sourceFacts),
          stamp,
        ),
      this.audit("FRANCHISE_FEE_CALCULATED", "FRANCHISE_FEE_PERIOD", id, {
        basisMinor,
        amountMinor,
        quality,
      }),
    ]);
    return {
      id,
      basisMinor,
      amountMinor,
      quality,
      currency: string(definition.currency || currencies.values().next().value || ""),
    };
  }

  async dashboard(
    scopeNodeId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<EnterpriseDashboard> {
    this.requireAny([permissions.enterpriseView, permissions.enterpriseFinanceView]);
    validateDateRange(periodStart, periodEnd);
    const scope = await this.getNode(scopeNodeId);
    const branches = await this.branchNodes(scopeNodeId);
    const branchIds = new Set(branches.map((row) => row.branchId));
    const metrics = await this.db
      .prepare(
        `SELECT m.branch_id,b.name branch_name,m.currency,
                SUM(m.net_sales_minor) net_sales_minor,SUM(m.gross_profit_minor) gross_profit_minor,
                SUM(m.contribution_minor) contribution_minor,SUM(m.order_count) order_count,
                CASE WHEN SUM(m.net_revenue_minor)=0 THEN 0 ELSE
                  CAST((SUM(m.cogs_minor)*10000)/SUM(m.net_revenue_minor) AS INTEGER) END food_cost_bps,
                MIN(m.quality) quality
         FROM daily_branch_metrics m JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id
         WHERE m.tenant_id=? AND m.business_date BETWEEN ? AND ?
         GROUP BY m.branch_id,b.name,m.currency ORDER BY b.name LIMIT 1000`,
      )
      .bind(this.actor.tenantId, periodStart, periodEnd)
      .all<Row>();
    const rows = (metrics.results ?? []).filter((row) => branchIds.has(string(row.branch_id)));
    const currencies = new Set(rows.map((row) => string(row.currency)));
    const crossCurrency = currencies.size > 1;
    const actionCount = await this.scopedCount(
      "management_actions",
      "status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')",
      branchIds,
    );
    const rolloutIssueCount = await this.scopedRolloutIssueCount(branchIds);
    const dashboardCurrency = crossCurrency ? undefined : [...currencies][0];
    return {
      scope,
      periodStart,
      periodEnd,
      ...(dashboardCurrency ? { currency: dashboardCurrency } : {}),
      managementAggregation: true,
      crossCurrency,
      totals: {
        branchCount: branches.length,
        openBranchCount: branches.length,
        netSalesMinor: crossCurrency
          ? null
          : rows.reduce((sum, row) => sum + integer(row.net_sales_minor), 0),
        grossProfitMinor: crossCurrency
          ? null
          : rows.reduce((sum, row) => sum + integer(row.gross_profit_minor), 0),
        contributionMinor: crossCurrency
          ? null
          : rows.reduce((sum, row) => sum + integer(row.contribution_minor), 0),
        orderCount: rows.reduce((sum, row) => sum + integer(row.order_count), 0),
        actionCount,
        rolloutIssueCount,
      },
      branches: rows.map((row) => ({
        branchId: string(row.branch_id),
        branchName: string(row.branch_name),
        currency: string(row.currency),
        netSalesMinor: integer(row.net_sales_minor),
        grossProfitMinor: integer(row.gross_profit_minor),
        contributionMinor: integer(row.contribution_minor),
        foodCostBps: integer(row.food_cost_bps),
        orderCount: integer(row.order_count),
        quality: string(row.quality || "INSUFFICIENT_DATA"),
      })),
    };
  }

  async overview(): Promise<EnterpriseOverview> {
    this.require(permissions.enterpriseView);
    const nodes = await this.listHierarchy(undefined, 1000);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const [
      policies,
      rollouts,
      franchises,
      readiness,
      supplierContracts,
      templates,
      exceptions,
      franchiseFees,
      compliance,
    ] = await Promise.all([
      this.db
        .prepare(
          `SELECT d.code,d.name,d.category,a.scope_node_id,a.state,a.effective_from,a.effective_to
        FROM enterprise_policy_definitions d LEFT JOIN enterprise_policy_assignments a
          ON a.tenant_id=d.tenant_id AND a.policy_id=d.id
        WHERE d.tenant_id=? AND d.active=1 ORDER BY d.category,d.name LIMIT 250`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          "SELECT id,rollout_type,scope_node_id,status,scheduled_at,created_at,updated_at FROM enterprise_rollouts WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT r.id,r.brand_id,r.status,r.agreement_reference,fr.legal_name franchisee_name,
        fg.legal_name franchisor_name,COUNT(b.branch_id) branch_count,GROUP_CONCAT(b.branch_id) branch_ids
        FROM franchise_relationships r
        JOIN legal_entities fr ON fr.tenant_id=r.tenant_id AND fr.id=r.franchisee_legal_entity_id
        JOIN legal_entities fg ON fg.tenant_id=r.tenant_id AND fg.id=r.franchisor_legal_entity_id
        LEFT JOIN franchise_branch_assignments b ON b.tenant_id=r.tenant_id AND b.franchise_relationship_id=r.id
        WHERE r.tenant_id=? GROUP BY r.id,r.brand_id,r.status,r.agreement_reference,fr.legal_name,fg.legal_name
        ORDER BY fr.legal_name LIMIT 100`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          "SELECT scope_node_id,branch_id,check_code,status,severity,message,recommended_action,calculated_at FROM enterprise_readiness_results WHERE tenant_id=? ORDER BY severity DESC,calculated_at DESC LIMIT 200",
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT c.id,c.supplier_id,s.name supplier_name,c.scope_node_id,c.contract_reference,
        c.negotiated_price_minor,c.currency,c.lead_time_days,c.status,c.effective_from,c.effective_to
        FROM supplier_contracts c JOIN suppliers s ON s.tenant_id=c.tenant_id AND s.id=c.supplier_id
        WHERE c.tenant_id=? ORDER BY s.name LIMIT 100`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT t.id,t.code,t.name,t.brand_id,t.status,MAX(v.version) latest_version,
        MAX(CASE WHEN v.status='PUBLISHED' THEN v.version ELSE NULL END) published_version,
        COUNT(a.id) branch_count,GROUP_CONCAT(a.branch_id) branch_ids,t.updated_at
        FROM branch_templates t
        LEFT JOIN branch_template_versions v ON v.tenant_id=t.tenant_id AND v.template_id=t.id
        LEFT JOIN branch_template_assignments a ON a.tenant_id=t.tenant_id AND a.template_version_id=v.id
        WHERE t.tenant_id=? GROUP BY t.id,t.code,t.name,t.brand_id,t.status,t.updated_at
        ORDER BY t.name LIMIT 100`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT e.id,d.code policy_code,e.scope_node_id,n.name scope_name,e.request_type,
        e.reason,e.status,e.valid_from,e.valid_until,e.requested_by,e.reviewed_by,e.updated_at
        FROM enterprise_policy_exceptions e
        JOIN enterprise_policy_definitions d ON d.tenant_id=e.tenant_id AND d.id=e.policy_id
        JOIN enterprise_nodes n ON n.tenant_id=e.tenant_id AND n.id=e.scope_node_id
        WHERE e.tenant_id=? ORDER BY e.updated_at DESC LIMIT 100`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT p.id,d.name fee_name,d.fee_type,p.period_start,p.period_end,p.currency,
        p.basis_minor,p.amount_minor,p.quality,p.status,p.calculated_at,GROUP_CONCAT(b.branch_id) branch_ids
        FROM franchise_fee_periods p
        JOIN franchise_fee_definitions d ON d.tenant_id=p.tenant_id AND d.id=p.fee_definition_id
        JOIN franchise_relationships r ON r.tenant_id=d.tenant_id AND r.id=d.franchise_relationship_id
        LEFT JOIN franchise_branch_assignments b ON b.tenant_id=r.tenant_id AND b.franchise_relationship_id=r.id
        WHERE p.tenant_id=? GROUP BY p.id,d.name,d.fee_type,p.period_start,p.period_end,p.currency,
          p.basis_minor,p.amount_minor,p.quality,p.status,p.calculated_at
        ORDER BY p.period_end DESC LIMIT 100`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT c.id,c.franchise_relationship_id,c.branch_id,b.name branch_name,
        c.check_code,c.status,c.message,c.calculated_at
        FROM franchise_compliance_results c
        LEFT JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
        WHERE c.tenant_id=? ORDER BY c.calculated_at DESC LIMIT 150`,
        )
        .bind(this.actor.tenantId)
        .all<Row>(),
    ]);
    const visible = (rows: Row[]) =>
      rows
        .filter((row) => !row.scope_node_id || nodeIds.has(string(row.scope_node_id)))
        .map(publicRow);
    const branchIds = new Set(nodes.flatMap((node) => (node.branchId ? [node.branchId] : [])));
    const hasVisibleBranch = (row: Row) =>
      string(row["branch_ids"])
        .split(",")
        .filter(Boolean)
        .some((branchId) => branchIds.has(branchId));
    const tenantWide = this.actor.permissions.includes(permissions.tenantScopeAllBranches);
    const can = (...required: string[]) =>
      required.some((permission) => this.actor.permissions.includes(permission));
    return {
      rootNodes: nodes.filter((node) => !node.parentId),
      nodes,
      policies: can(permissions.enterprisePolicyView, permissions.enterprisePolicyManage)
        ? visible(policies.results ?? [])
        : [],
      rollouts: can(permissions.enterpriseRolloutView, permissions.enterpriseRolloutManage)
        ? visible(rollouts.results ?? [])
        : [],
      franchises: can(permissions.enterpriseFranchiseView, permissions.enterpriseFranchiseManage)
        ? (franchises.results ?? [])
            .filter((row) => tenantWide || hasVisibleBranch(row))
            .map(publicRow)
        : [],
      readiness: can(permissions.enterpriseReadinessView) ? visible(readiness.results ?? []) : [],
      supplierContracts: can(
        permissions.enterpriseProcurementView,
        permissions.enterpriseProcurementManage,
      )
        ? visible(supplierContracts.results ?? [])
        : [],
      templates: can(permissions.enterpriseRolloutView, permissions.enterpriseRolloutManage)
        ? (templates.results ?? [])
            .filter((row) => tenantWide || hasVisibleBranch(row))
            .map(publicRow)
        : [],
      policyExceptions: can(permissions.enterprisePolicyView, permissions.enterprisePolicyManage)
        ? visible(exceptions.results ?? [])
        : [],
      franchiseFees: can(permissions.enterpriseFinanceView, permissions.enterpriseFranchiseManage)
        ? (franchiseFees.results ?? [])
            .filter((row) => tenantWide || hasVisibleBranch(row))
            .map(publicRow)
        : [],
      compliance: can(permissions.enterpriseFranchiseView, permissions.enterpriseReadinessView)
        ? (compliance.results ?? [])
            .filter((row) => (row.branch_id ? branchIds.has(string(row.branch_id)) : tenantWide))
            .map(publicRow)
        : [],
      capabilityStatus: {
        oidc: "BOUNDARY_ONLY",
        saml: "BOUNDARY_ONLY",
        scim: "SPEC_REQUIRED",
        statutoryConsolidation: "NOT_SUPPORTED",
        authoritativeFx: "NOT_CONFIGURED",
      },
    };
  }

  async requestEnterpriseExport(input: {
    scopeNodeId: string;
    exportType: EnterpriseExportType;
    fields?: string[];
    filters?: { periodStart?: string; periodEnd?: string };
    rowLimit: number;
    idempotencyKey: string;
  }) {
    this.require(permissions.enterpriseExport);
    this.require(permissions.enterpriseView);
    this.requireExportDomainPermission(input.exportType);
    await this.assertNodeAccess(input.scopeNodeId);
    if (!Number.isSafeInteger(input.rowLimit) || input.rowLimit < 1 || input.rowLimit > 10_000) {
      throw validation("Enterprise export rowLimit must be between 1 and 10000");
    }
    validateDateRange(input.filters?.periodStart, input.filters?.periodEnd);
    const allowedFields = exportFields[input.exportType];
    const fields = input.fields?.length ? [...new Set(input.fields)] : [...allowedFields];
    if (!fields.length || fields.some((field) => !allowedFields.includes(field))) {
      throw validation("Enterprise export contains an unsupported field");
    }
    const existing = await this.db
      .prepare("SELECT id FROM enterprise_export_jobs WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<Row>();
    if (existing) return this.getEnterpriseExport(string(existing.id), true);
    const id = crypto.randomUUID();
    const stamp = now();
    const fingerprint = await this.authorizationFingerprint(input.scopeNodeId);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO enterprise_export_jobs
            (tenant_id,id,requested_by,scope_node_id,export_type,idempotency_key,fields_json,
             filters_json,status,row_limit,authorization_fingerprint,created_at,expires_at)
           VALUES (?,?,?,?,?,?,?,?,'PENDING',?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          this.actor.id,
          input.scopeNodeId,
          input.exportType,
          input.idempotencyKey,
          json(fields),
          json(input.filters ?? {}),
          input.rowLimit,
          fingerprint,
          stamp,
          new Date(Date.parse(stamp) + 24 * 60 * 60_000).toISOString(),
        ),
      this.audit("ENTERPRISE_EXPORT_REQUESTED", "ENTERPRISE_EXPORT", id, {
        scopeNodeId: input.scopeNodeId,
        exportType: input.exportType,
        rowLimit: input.rowLimit,
      }),
    ]);
    return this.getEnterpriseExport(id, false);
  }

  async runEnterpriseExport(exportId: string) {
    this.require(permissions.enterpriseExport);
    const job = await this.exportJob(exportId);
    if (string(job.requested_by) !== this.actor.id) {
      throw denied("Enterprise export must run with the requesting user's current authority");
    }
    await this.assertNodeAccess(string(job.scope_node_id));
    const fingerprint = await this.authorizationFingerprint(string(job.scope_node_id));
    if (fingerprint !== string(job.authorization_fingerprint)) {
      await this.db
        .prepare(
          "UPDATE enterprise_export_jobs SET status='FAILED',error_json=?,completed_at=? WHERE tenant_id=? AND id=? AND status<>'COMPLETE'",
        )
        .bind(json({ code: "AUTHORIZATION_CHANGED" }), now(), this.actor.tenantId, exportId)
        .run();
      throw denied("Enterprise export authority changed after the request was created");
    }
    if (string(job.status) === "COMPLETE") return this.getEnterpriseExport(exportId, true);
    if (!["PENDING", "CLAIMED", "FAILED"].includes(string(job.status))) {
      throw invalidState("Enterprise export is not runnable");
    }
    await this.db
      .prepare(
        "UPDATE enterprise_export_jobs SET status='CLAIMED',error_json=NULL WHERE tenant_id=? AND id=? AND status IN ('PENDING','CLAIMED','FAILED')",
      )
      .bind(this.actor.tenantId, exportId)
      .run();
    const exportType = string(job.export_type) as keyof typeof exportFields;
    this.requireExportDomainPermission(exportType);
    const fields = parseStringArray(job.fields_json);
    const filters = parseJsonObject(job.filters_json) as {
      periodStart?: string;
      periodEnd?: string;
    };
    const rowLimit = Math.min(integer(job.row_limit), 10_000);
    const records = await this.enterpriseExportRecords(
      string(job.scope_node_id),
      exportType,
      filters,
      rowLimit,
    );
    const projected = records.map((record) =>
      Object.fromEntries(fields.map((field) => [field, redactValue(field, record[field])])),
    );
    const stamp = now();
    const resultReference = `authoritative://enterprise-export/${exportId}`;
    const manifest = {
      schemaVersion: 1,
      exportType,
      scopeNodeId: string(job.scope_node_id),
      fields,
      rowCount: projected.length,
      truncated: records.length >= rowLimit,
      generatedAt: stamp,
    };
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE enterprise_export_jobs SET status='COMPLETE',result_reference=?,result_json=?,
             manifest_json=?,completed_at=? WHERE tenant_id=? AND id=? AND status='CLAIMED'`,
        )
        .bind(
          resultReference,
          json(projected),
          json(manifest),
          stamp,
          this.actor.tenantId,
          exportId,
        ),
      this.audit("ENTERPRISE_EXPORT_COMPLETED", "ENTERPRISE_EXPORT", exportId, {
        scopeNodeId: job.scope_node_id,
        exportType,
        rowCount: projected.length,
      }),
    ]);
    return this.getEnterpriseExport(exportId, false);
  }

  async getEnterpriseExport(exportId: string, duplicate = false) {
    this.require(permissions.enterpriseExport);
    const job = await this.exportJob(exportId);
    await this.assertNodeAccess(string(job.scope_node_id));
    if (
      string(job.requested_by) !== this.actor.id &&
      !this.actor.permissions.includes(permissions.enterpriseAccessManage)
    ) {
      throw denied("Enterprise export belongs to another user");
    }
    return {
      id: string(job.id),
      status: string(job.status),
      exportType: string(job.export_type),
      scopeNodeId: string(job.scope_node_id),
      rowLimit: integer(job.row_limit),
      duplicate,
      resultReference: job.result_reference ? string(job.result_reference) : undefined,
      manifest: parseJsonValue(job.manifest_json),
      result: string(job.status) === "COMPLETE" ? parseJsonValue(job.result_json) : undefined,
      error: parseJsonValue(job.error_json),
      createdAt: string(job.created_at),
      completedAt: job.completed_at ? string(job.completed_at) : undefined,
    };
  }

  async enterpriseAudit(
    scopeNodeId: string,
    options: {
      limit?: number;
      actorId?: string;
      branchId?: string;
      domain?: string;
      action?: string;
      from?: string;
      to?: string;
      correlationId?: string;
    } = {},
  ) {
    this.require(permissions.enterpriseAuditView);
    const branches = await this.branchNodes(scopeNodeId);
    const branchIds = new Set(branches.map((row) => row.branchId));
    if (options.branchId && !branchIds.has(options.branchId)) {
      throw denied("Audit branch filter is outside the authorized scope");
    }
    validateDateRange(options.from, options.to, true);
    const selectedBranches = options.branchId ? [options.branchId] : [...branchIds];
    const tenantWide = this.actor.permissions.includes(permissions.tenantScopeAllBranches);
    const branchPredicate = selectedBranches.length
      ? `(branch_id IN (${selectedBranches.map(() => "?").join(",")})${tenantWide && !options.branchId ? " OR branch_id IS NULL" : ""})`
      : tenantWide
        ? "branch_id IS NULL"
        : "0=1";
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const rows = await this.db
      .prepare(
        `SELECT id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at
         FROM audit_events WHERE tenant_id=? AND ${branchPredicate}
           AND (? IS NULL OR actor_id=?) AND (? IS NULL OR entity_type=?)
           AND (? IS NULL OR action=?) AND (? IS NULL OR created_at>=?)
           AND (? IS NULL OR created_at<=?) AND (? IS NULL OR correlation_id=?)
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(
        this.actor.tenantId,
        ...selectedBranches,
        options.actorId ?? null,
        options.actorId ?? null,
        options.domain?.toUpperCase() ?? null,
        options.domain?.toUpperCase() ?? null,
        options.action?.toUpperCase() ?? null,
        options.action?.toUpperCase() ?? null,
        options.from ?? null,
        options.from ?? null,
        options.to ?? null,
        options.to ?? null,
        options.correlationId ?? null,
        options.correlationId ?? null,
        limit,
      )
      .all<Row>();
    return (rows.results ?? []).map((row) => ({
      ...publicRow(row),
      metadata: redact(parseJsonObject(row.metadata_json)),
    }));
  }

  private async validateNodeReferences(input: NodeInput) {
    const checks: Array<[string | undefined, string, string]> = [
      [input.legalEntityId, "legal_entities", "legal entity"],
      [input.brandId, "brands", "brand"],
      [input.branchId, "branches", "branch"],
      [input.warehouseId, "warehouses", "warehouse"],
    ];
    for (const [id, table, label] of checks) {
      if (!id) continue;
      const row = await this.db
        .prepare(`SELECT id FROM ${table} WHERE tenant_id=? AND id=?`)
        .bind(this.actor.tenantId, id)
        .first();
      if (!row) throw validation(`Referenced ${label} does not exist in this tenant`);
    }
    if (input.type === "LEGAL_ENTITY" && !input.legalEntityId)
      throw validation("Legal entity node requires legalEntityId");
    if (input.type === "BRANCH" && !input.branchId)
      throw validation("Branch node requires branchId");
    if (input.type === "WAREHOUSE" && !input.warehouseId)
      throw validation("Warehouse node requires warehouseId");
  }

  private async exportJob(exportId: string) {
    const row = await this.db
      .prepare("SELECT * FROM enterprise_export_jobs WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, exportId)
      .first<Row>();
    if (!row) throw notFound("Enterprise export not found");
    return row;
  }

  private requireExportDomainPermission(exportType: keyof typeof exportFields) {
    const required = {
      HIERARCHY: permissions.enterpriseView,
      MANAGEMENT_METRICS: permissions.enterpriseFinanceView,
      FRANCHISE_COMPLIANCE: permissions.enterpriseFranchiseView,
      ENTERPRISE_AUDIT: permissions.enterpriseAuditView,
    }[exportType];
    this.require(required);
  }

  private async authorizationFingerprint(scopeNodeId: string) {
    const authorized = await this.authorizedNodeIds();
    const scoped = await this.db
      .prepare(
        `SELECT descendant_id FROM enterprise_node_closure
         WHERE tenant_id=? AND ancestor_id=? ORDER BY descendant_id LIMIT 1001`,
      )
      .bind(this.actor.tenantId, scopeNodeId)
      .all<{ descendant_id: string }>();
    const nodeIds = (scoped.results ?? [])
      .map((row) => row.descendant_id)
      .filter((id) => authorized.has(id));
    if (nodeIds.length > 1000)
      throw validation("Enterprise export scope exceeds the supported node limit");
    return hashJson({
      tenantId: this.actor.tenantId,
      actorId: this.actor.id,
      permissions: [...this.actor.permissions].sort(),
      nodeIds,
    });
  }

  private async enterpriseExportRecords(
    scopeNodeId: string,
    exportType: EnterpriseExportType,
    filters: { periodStart?: string; periodEnd?: string },
    rowLimit: number,
  ): Promise<Row[]> {
    if (exportType === "HIERARCHY") {
      return (await this.listHierarchy(scopeNodeId, Math.min(rowLimit, 1000))).map((node) => ({
        id: node.id,
        type: node.type,
        code: node.code,
        name: node.name,
        parentId: node.parentId ?? null,
        legalEntityId: node.legalEntityId ?? null,
        brandId: node.brandId ?? null,
        branchId: node.branchId ?? null,
        warehouseId: node.warehouseId ?? null,
        status: node.status,
        effectiveFrom: node.effectiveFrom,
        effectiveTo: node.effectiveTo ?? null,
        currency: node.currency ?? null,
      }));
    }
    const branches = await this.branchNodes(scopeNodeId);
    const branchIds = branches.map((branch) => branch.branchId);
    if (!branchIds.length) return [];
    const placeholders = branchIds.map(() => "?").join(",");
    if (exportType === "MANAGEMENT_METRICS") {
      const result = await this.db
        .prepare(
          `SELECT m.branch_id branchId,b.name branchName,m.business_date businessDate,m.currency,
             m.net_sales_minor netSalesMinor,m.gross_profit_minor grossProfitMinor,
             m.contribution_minor contributionMinor,m.food_cost_bps foodCostBps,
             m.order_count orderCount,m.quality
           FROM daily_branch_metrics m
           JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id
           WHERE m.tenant_id=? AND m.branch_id IN (${placeholders})
             AND (? IS NULL OR m.business_date>=?) AND (? IS NULL OR m.business_date<=?)
           ORDER BY m.business_date DESC,m.branch_id LIMIT ?`,
        )
        .bind(
          this.actor.tenantId,
          ...branchIds,
          filters.periodStart ?? null,
          filters.periodStart ?? null,
          filters.periodEnd ?? null,
          filters.periodEnd ?? null,
          rowLimit,
        )
        .all<Row>();
      return result.results ?? [];
    }
    if (exportType === "FRANCHISE_COMPLIANCE") {
      const result = await this.db
        .prepare(
          `SELECT c.id,c.franchise_relationship_id franchiseRelationshipId,c.branch_id branchId,
             b.name branchName,c.check_code checkCode,c.status,c.message,c.calculated_at calculatedAt
           FROM franchise_compliance_results c
           LEFT JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
           WHERE c.tenant_id=? AND c.branch_id IN (${placeholders})
           ORDER BY c.calculated_at DESC,c.id LIMIT ?`,
        )
        .bind(this.actor.tenantId, ...branchIds, rowLimit)
        .all<Row>();
      return result.results ?? [];
    }
    const events = await this.enterpriseAudit(scopeNodeId, {
      limit: Math.min(rowLimit, 1000),
      ...(filters.periodStart ? { from: `${filters.periodStart}T00:00:00.000Z` } : {}),
      ...(filters.periodEnd ? { to: `${filters.periodEnd}T23:59:59.999Z` } : {}),
    });
    return events as Row[];
  }

  private async policyDefinition(code: string) {
    const row = await this.db
      .prepare(
        "SELECT id,code,value_schema_json FROM enterprise_policy_definitions WHERE tenant_id=? AND UPPER(code)=UPPER(?) AND active=1",
      )
      .bind(this.actor.tenantId, code)
      .first<{ id: string; code: string; value_schema_json: string }>();
    if (!row) throw notFound("Enterprise policy definition not found");
    return row;
  }

  private async resolveOptionalPolicy(code: string, nodeId: string) {
    const definition = await this.db
      .prepare(
        "SELECT id FROM enterprise_policy_definitions WHERE tenant_id=? AND UPPER(code)=UPPER(?) AND active=1",
      )
      .bind(this.actor.tenantId, code)
      .first();
    return definition
      ? this.resolvePolicy(code, nodeId)
      : ({
          code,
          targetNodeId: nodeId,
          effectiveValue: undefined,
          locked: false,
          effectiveAt: now(),
          trace: [],
        } satisfies ResolvedEnterprisePolicy);
  }

  private async priceRolloutPolicyWatermark(scopeNodeId: string, menuItemId: string, items: Row[]) {
    const branchNodes = await this.branchNodes(scopeNodeId);
    const nodeByBranch = new Map(branchNodes.map((node) => [node.branchId, node.nodeId]));
    const watermarks: Array<{ branchId: string; watermark: string }> = [];
    for (const item of items) {
      const branchId = string(item.branch_id);
      const nodeId = nodeByBranch.get(branchId);
      if (!nodeId) throw denied("Rollout contains a branch outside the authorized target scope");
      const policy = await this.resolvePolicy(`MENU_PRICE:${menuItemId}`, nodeId);
      watermarks.push({ branchId, watermark: await hashJson(policy.trace) });
    }
    return hashJson(watermarks.sort((left, right) => left.branchId.localeCompare(right.branchId)));
  }

  private async assertOverrideAllowed(
    parent: ResolvedEnterprisePolicy,
    input: PolicyAssignmentInput,
    policyId: string,
  ) {
    if (!parent.sourceAssignmentId || input.state === "INHERIT") return;
    if (parent.locked) throw denied("A locked higher-level policy cannot be overridden");
    if (!withinRange(input.value, parent.minimumValueMinor, parent.maximumValueMinor)) {
      throw validation("Policy value is outside the permitted higher-level range");
    }
    if (parent.state === "APPROVAL_REQUIRED") {
      if (!input.approvedExceptionId) throw denied("An approved policy exception is required");
      const approved = await this.db
        .prepare(
          `SELECT id FROM enterprise_policy_exceptions WHERE tenant_id=? AND id=? AND policy_id=?
          AND scope_node_id=? AND status='APPROVED' AND (valid_until IS NULL OR valid_until>?)`,
        )
        .bind(
          this.actor.tenantId,
          input.approvedExceptionId,
          policyId,
          input.scopeNodeId,
          input.effectiveFrom ?? now(),
        )
        .first();
      if (!approved) throw denied("Approved policy exception is invalid or expired");
    }
  }

  private async hasApprovedException(policyId: string, scopeNodeId: string, at: string) {
    const row = await this.db
      .prepare(
        `SELECT id FROM enterprise_policy_exceptions WHERE tenant_id=? AND policy_id=?
        AND scope_node_id=? AND status='APPROVED' AND (valid_from IS NULL OR valid_from<=?)
        AND (valid_until IS NULL OR valid_until>?) LIMIT 1`,
      )
      .bind(this.actor.tenantId, policyId, scopeNodeId, at, at)
      .first();
    return Boolean(row);
  }

  private async assertRoleGrantAllowed(roleId: string, scopeNodeId: string, fullAdmin: boolean) {
    const rolePermissions = await this.db
      .prepare("SELECT permission_code FROM role_permissions WHERE tenant_id=? AND role_id=?")
      .bind(this.actor.tenantId, roleId)
      .all<{ permission_code: string }>();
    if (!rolePermissions.results?.length) throw notFound("Role not found or has no permissions");
    const missing = rolePermissions.results.filter(
      (row) => !this.actor.permissions.includes(row.permission_code),
    );
    if (missing.length) throw denied("Grantor cannot delegate permissions they do not possess");
    if (fullAdmin) return;
    const policy = await this.db
      .prepare(
        `SELECT allowed_role_ids_json,allowed_permission_codes_json,maximum_scope_type FROM delegated_admin_policies
        WHERE tenant_id=? AND delegator_user_id=? AND active=1 AND valid_from<=?
          AND (valid_until IS NULL OR valid_until>?) AND EXISTS (
            SELECT 1 FROM enterprise_node_closure c WHERE c.tenant_id=?
              AND c.ancestor_id=delegated_admin_policies.scope_node_id AND c.descendant_id=?
          ) ORDER BY valid_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, this.actor.id, now(), now(), this.actor.tenantId, scopeNodeId)
      .first<Row>();
    if (!policy) throw denied("No active delegated-administration policy covers this scope");
    const roles = parseStringArray(policy.allowed_role_ids_json);
    const allowedPermissions = new Set(parseStringArray(policy.allowed_permission_codes_json));
    if (
      !roles.includes(roleId) ||
      rolePermissions.results.some((row) => !allowedPermissions.has(row.permission_code))
    ) {
      throw denied("Role exceeds delegated-administration policy");
    }
    if (policy.maximum_scope_type) {
      const target = await this.db
        .prepare("SELECT node_type FROM enterprise_nodes WHERE tenant_id=? AND id=?")
        .bind(this.actor.tenantId, scopeNodeId)
        .first<{ node_type: EnterpriseNodeType }>();
      const maximumRank = scopeRank(string(policy.maximum_scope_type) as EnterpriseNodeType);
      const targetRank = scopeRank(target?.node_type ?? "GROUP");
      if (targetRank < maximumRank)
        throw denied("Requested scope is broader than delegated-administration policy");
    }
  }

  private async authorizedNodeIds() {
    const all = await this.db
      .prepare("SELECT id,branch_id FROM enterprise_nodes WHERE tenant_id=?")
      .bind(this.actor.tenantId)
      .all<{ id: string; branch_id: string | null }>();
    if (this.actor.permissions.includes(permissions.tenantScopeAllBranches))
      return new Set((all.results ?? []).map((row) => row.id));
    const result = await this.db
      .prepare(
        `SELECT a.scope_node_id,a.descend_to_children,a.effect,c.descendant_id
        FROM enterprise_role_assignments a
        LEFT JOIN enterprise_node_closure c ON c.tenant_id=a.tenant_id AND c.ancestor_id=a.scope_node_id
        WHERE a.tenant_id=? AND a.user_id=? AND a.revoked_at IS NULL AND a.valid_from<=?
          AND (a.valid_until IS NULL OR a.valid_until>?)`,
      )
      .bind(this.actor.tenantId, this.actor.id, now(), now())
      .all<Row>();
    const allowed = new Set<string>();
    const deniedIds = new Set<string>();
    for (const row of result.results ?? []) {
      const target =
        integer(row.descend_to_children) === 1
          ? string(row.descendant_id)
          : string(row.scope_node_id);
      if (!target) continue;
      (string(row.effect) === "DENY" ? deniedIds : allowed).add(target);
    }
    for (const row of all.results ?? [])
      if (row.branch_id && this.actor.assignedBranchIds.includes(row.branch_id))
        allowed.add(row.id);
    deniedIds.forEach((id) => allowed.delete(id));
    return allowed;
  }

  private async assertNodeAccess(nodeId: string) {
    const node = await this.db
      .prepare("SELECT id FROM enterprise_nodes WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, nodeId)
      .first();
    if (!node) throw notFound("Enterprise node not found");
    if (!(await this.authorizedNodeIds()).has(nodeId))
      throw denied("Enterprise node is outside the actor's authorized scope");
  }

  private async assertBranchAccess(branchId: string) {
    if (
      this.actor.permissions.includes(permissions.tenantScopeAllBranches) ||
      this.actor.assignedBranchIds.includes(branchId)
    )
      return;
    const node = await this.db
      .prepare("SELECT id FROM enterprise_nodes WHERE tenant_id=? AND branch_id=?")
      .bind(this.actor.tenantId, branchId)
      .first<{ id: string }>();
    if (node && (await this.authorizedNodeIds()).has(node.id)) return;
    throw denied("Branch is outside the actor's authorized scope");
  }

  private async branchNodes(scopeNodeId: string) {
    await this.assertNodeAccess(scopeNodeId);
    const accessible = await this.authorizedNodeIds();
    const rows = await this.db
      .prepare(
        `SELECT n.id node_id,n.branch_id,b.name,b.active FROM enterprise_node_closure c
        JOIN enterprise_nodes n ON n.tenant_id=c.tenant_id AND n.id=c.descendant_id
        JOIN branches b ON b.tenant_id=n.tenant_id AND b.id=n.branch_id
        WHERE c.tenant_id=? AND c.ancestor_id=? AND n.node_type='BRANCH' ORDER BY b.name`,
      )
      .bind(this.actor.tenantId, scopeNodeId)
      .all<Row>();
    return (rows.results ?? [])
      .filter((row) => accessible.has(string(row.node_id)))
      .map((row) => ({
        nodeId: string(row.node_id),
        branchId: string(row.branch_id),
        name: string(row.name),
        active: Boolean(row.active),
      }));
  }

  private async rolloutCounts(rolloutId: string) {
    const rows = await this.db
      .prepare(
        "SELECT status,COUNT(*) count FROM enterprise_rollout_items WHERE tenant_id=? AND rollout_id=? GROUP BY status",
      )
      .bind(this.actor.tenantId, rolloutId)
      .all<Row>();
    const count = (status: string) =>
      integer((rows.results ?? []).find((row) => row.status === status)?.count);
    return {
      pending: count("PENDING"),
      blocked: count("BLOCKED"),
      succeeded: count("SUCCEEDED"),
      failed: count("FAILED"),
    };
  }

  private async getRollout(id: string) {
    const row = await this.db
      .prepare("SELECT * FROM enterprise_rollouts WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<Row>();
    if (!row) throw notFound("Enterprise rollout not found");
    return row;
  }

  private async rolloutSummary(id: string, duplicate: boolean) {
    const rollout = await this.getRollout(id);
    return {
      id,
      status: string(rollout.status),
      duplicate,
      counts: await this.rolloutCounts(id),
      scopeNodeId: string(rollout.scope_node_id),
      rolloutType: string(rollout.rollout_type),
      confirmationHash: string(rollout.target_hash),
      confirmed: Boolean(rollout.confirmed_at),
      approved: Boolean(rollout.approved_by),
      requiresApproval: integer(rollout.requires_approval) === 1,
    };
  }

  private rolloutEvent(rolloutId: string, eventType: string, payload: Record<string, unknown>) {
    return this.db
      .prepare(
        "INSERT INTO enterprise_rollout_events (tenant_id,id,rollout_id,event_type,actor_id,correlation_id,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        rolloutId,
        eventType,
        this.actor.id,
        crypto.randomUUID(),
        json(payload),
        now(),
      );
  }

  private exceptionEvent(exceptionId: string, status: string, note: string) {
    return this.db
      .prepare(
        `INSERT INTO enterprise_policy_exception_events
          (tenant_id,id,exception_id,status,actor_id,note,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        exceptionId,
        status,
        this.actor.id,
        note,
        now(),
      );
  }

  private async getRequisitionBatch(id: string, duplicate: boolean) {
    const batch = await this.db
      .prepare("SELECT * FROM central_requisition_batches WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<Row>();
    if (!batch) throw notFound("Central requisition batch not found");
    const lines = await this.db
      .prepare(
        `SELECT inventory_item_id,unit_id,SUM(quantity_micro) quantity_micro,
      COUNT(DISTINCT branch_id) branch_count FROM central_requisition_allocations
      WHERE tenant_id=? AND batch_id=? GROUP BY inventory_item_id,unit_id ORDER BY inventory_item_id`,
      )
      .bind(this.actor.tenantId, id)
      .all<Row>();
    return {
      id,
      status: string(batch.status),
      duplicate,
      currency: string(batch.currency),
      lines: (lines.results ?? []).map(publicRow),
    };
  }

  private async toBaseQuantity(
    itemId: string,
    quantity: number,
    fromUnit: string,
    toUnit: string,
    at: string,
  ) {
    if (fromUnit === toUnit) return quantity;
    const conversion = await this.db
      .prepare(
        `SELECT factor_numerator,factor_denominator FROM item_unit_conversions
      WHERE tenant_id=? AND inventory_item_id=? AND from_unit_id=? AND to_unit_id=?
        AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) ORDER BY effective_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, itemId, fromUnit, toUnit, at, at)
      .first<Row>();
    if (!conversion)
      throw validation("Requisition line has no effective item-specific base-unit conversion");
    return rational(
      quantity,
      integer(conversion.factor_numerator),
      integer(conversion.factor_denominator),
    );
  }

  private async scopedCount(table: string, predicate: string, branchIds: Set<string>) {
    if (!branchIds.size) return 0;
    const rows = await this.db
      .prepare(`SELECT branch_id FROM ${table} WHERE tenant_id=? AND ${predicate}`)
      .bind(this.actor.tenantId)
      .all<Row>();
    return (rows.results ?? []).filter(
      (row) => !row.branch_id || branchIds.has(string(row.branch_id)),
    ).length;
  }

  private async scopedRolloutIssueCount(branchIds: Set<string>) {
    const rows = await this.db
      .prepare(
        "SELECT branch_id FROM enterprise_rollout_items WHERE tenant_id=? AND status IN ('BLOCKED','FAILED')",
      )
      .bind(this.actor.tenantId)
      .all<Row>();
    return (rows.results ?? []).filter(
      (row) => !row.branch_id || branchIds.has(string(row.branch_id)),
    ).length;
  }

  private audit(
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
      (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,correlation_id,session_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        this.actor.branchId ?? null,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        entityType,
        entityId,
        "Authenticated enterprise command",
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        json(metadata),
        now(),
      );
  }

  private conditionalAudit(
    auditId: string,
    exceptionEventId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
           correlation_id,session_id,metadata_json,created_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM enterprise_policy_exception_events
           WHERE tenant_id=? AND id=?
         )`,
      )
      .bind(
        this.actor.tenantId,
        auditId,
        this.actor.branchId ?? null,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        entityType,
        entityId,
        "Authenticated enterprise command",
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        json(metadata),
        now(),
        this.actor.tenantId,
        exceptionEventId,
      );
  }

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission))
      throw denied(`Permission ${permission} is required`);
  }

  private requireAny(required: string[]) {
    if (!required.some((permission) => this.actor.permissions.includes(permission)))
      throw denied(`One of ${required.join(", ")} is required`);
  }
}

function mapNode(row: Row): EnterpriseNode {
  return {
    id: string(row.id),
    type: string(row.node_type) as EnterpriseNodeType,
    code: string(row.code),
    name: string(row.name),
    ...(row.parent_id ? { parentId: string(row.parent_id) } : {}),
    ...(row.legal_entity_id ? { legalEntityId: string(row.legal_entity_id) } : {}),
    ...(row.brand_id ? { brandId: string(row.brand_id) } : {}),
    ...(row.branch_id ? { branchId: string(row.branch_id) } : {}),
    ...(row.warehouse_id ? { warehouseId: string(row.warehouse_id) } : {}),
    status: string(row.status) as EnterpriseNode["status"],
    effectiveFrom: string(row.effective_from),
    ...(row.effective_to ? { effectiveTo: string(row.effective_to) } : {}),
    ...(row.timezone ? { timezone: string(row.timezone) } : {}),
    ...(row.currency ? { currency: string(row.currency) } : {}),
    depth: integer(row.depth),
    childCount: integer(row.child_count),
  };
}

function publicRow(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !key.endsWith("_json") && !key.includes("secret") && key !== "branch_ids",
    ),
  ) as Row;
}

function redact(value: Record<string, unknown>) {
  const blocked = /secret|token|password|credential|authorization|cookie|pan|cvv|pin/i;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, blocked.test(key) ? "[REDACTED]" : item]),
  );
}

function withinRange(value: unknown, minimum?: number, maximum?: number) {
  if (minimum === undefined && maximum === undefined) return true;
  if (!Number.isSafeInteger(value)) return false;
  return (
    (minimum === undefined || Number(value) >= minimum) &&
    (maximum === undefined || Number(value) <= maximum)
  );
}

function rational(value: number, numerator: number, denominator: number) {
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  )
    throw validation("Unsafe unit conversion");
  const scaled = BigInt(value) * BigInt(numerator);
  const result = (scaled + BigInt(Math.trunc(denominator / 2))) / BigInt(denominator);
  const number = Number(result);
  if (!Number.isSafeInteger(number))
    throw validation("Converted quantity exceeds safe integer range");
  return number;
}

function roundedBasisPoints(value: number, rateBps: number) {
  const result = (BigInt(value) * BigInt(rateBps) + 5_000n) / 10_000n;
  const number = Number(result);
  if (!Number.isSafeInteger(number)) throw validation("Calculated fee exceeds safe integer range");
  return number;
}

function dateSpan(start: string, end: string) {
  const days =
    Math.trunc((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
    1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}

function assertIsoTimestamp(value: string, label: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw validation(`${label} must be an ISO-8601 timestamp with timezone`);
  }
}

function validateDateRange(start?: string, end?: string, timestamps = false) {
  if (
    start &&
    (timestamps ? Number.isNaN(Date.parse(start)) : !/^\d{4}-\d{2}-\d{2}$/.test(start))
  ) {
    throw validation("Range start is invalid");
  }
  if (end && (timestamps ? Number.isNaN(Date.parse(end)) : !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
    throw validation("Range end is invalid");
  }
  if (start && end && start > end) throw validation("Range end must not precede range start");
}

function redactValue(key: string, value: unknown) {
  return /secret|token|password|credential|authorization|cookie|pan|cvv|pin/i.test(key)
    ? "[REDACTED]"
    : value;
}

function assertPolicyValue(value: unknown, schema: Record<string, unknown>) {
  const expected = typeof schema["type"] === "string" ? schema["type"] : undefined;
  const valid =
    !expected ||
    (expected === "integer" && Number.isSafeInteger(value)) ||
    (expected === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (expected === "boolean" && typeof value === "boolean") ||
    (expected === "string" && typeof value === "string") ||
    (expected === "array" && Array.isArray(value)) ||
    (expected === "object" && Boolean(value) && typeof value === "object" && !Array.isArray(value));
  if (!valid) throw validation(`Policy value must match configured ${expected} schema`);
  const allowed = Array.isArray(schema["enum"]) ? schema["enum"] : undefined;
  if (
    allowed &&
    !allowed.some((candidate) => stableStringify(candidate) === stableStringify(value))
  ) {
    throw validation("Policy value is not in the configured allowed set");
  }
}

const templateSections = new Set([
  "operatingProfile",
  "roles",
  "permissions",
  "warehouses",
  "stations",
  "orderChannels",
  "menu",
  "recipes",
  "printerRoles",
  "documentTemplates",
  "paymentRequirements",
  "inventoryPolicies",
  "procurementPolicies",
  "managementThresholds",
  "reservationSettings",
  "guestProfile",
  "loyaltyConfiguration",
  "policies",
]);

function validateTemplateConfiguration(configuration: Record<string, unknown>) {
  const serialized = json(configuration);
  if (serialized.length > 64 * 1024)
    throw validation("Branch template configuration exceeds 64 KiB");
  const unsupported = Object.keys(configuration).filter((key) => !templateSections.has(key));
  if (unsupported.length)
    throw validation(`Unsupported branch template section: ${unsupported[0]}`);
  if (containsSensitiveKey(configuration)) {
    throw validation(
      "Branch templates may contain secret references, but never secret values or credentials",
    );
  }
}

function branchOperatingProfile(configuration: Record<string, unknown>) {
  const value = configuration["operatingProfile"];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validation(
      "A published branch template must define operatingProfile before it can provision a branch",
    );
  }
  const profile = value as Record<string, unknown>;
  const negativeStockPolicy = profile["negativeStockPolicy"];
  if (!["ALLOW_WITH_ALERT", "BLOCK", "MANAGER_OVERRIDE"].includes(String(negativeStockPolicy))) {
    throw validation("Template operatingProfile has an invalid negative-stock policy");
  }
  const accountingModeOverride = profile["accountingModeOverride"];
  if (
    accountingModeOverride !== undefined &&
    !["PERPETUAL", "PERIODIC"].includes(String(accountingModeOverride))
  ) {
    throw validation("Template operatingProfile has an invalid accounting mode");
  }
  const operatingHours = profile["operatingHours"];
  if (!operatingHours || typeof operatingHours !== "object" || Array.isArray(operatingHours)) {
    throw validation("Template operatingProfile must define operatingHours");
  }
  const serviceModes = requiredStringArray(profile["serviceModes"], "serviceModes");
  const requiredDeviceRoles = requiredStringArray(
    profile["requiredDeviceRoles"],
    "requiredDeviceRoles",
  );
  const requiredBooleans = [
    "paymentsRequired",
    "inventoryEnabled",
    "recipesRequired",
    "printingRequired",
    "kdsRequired",
  ] as const;
  for (const key of requiredBooleans) {
    if (typeof profile[key] !== "boolean")
      throw validation(`Template operatingProfile.${key} must be boolean`);
  }
  return {
    accountingModeOverride:
      accountingModeOverride === undefined ? null : String(accountingModeOverride),
    negativeStockPolicy: String(negativeStockPolicy),
    operatingHours: operatingHours as Record<string, unknown>,
    serviceModes,
    requiredDeviceRoles,
    paymentsRequired: Boolean(profile["paymentsRequired"]),
    inventoryEnabled: Boolean(profile["inventoryEnabled"]),
    recipesRequired: Boolean(profile["recipesRequired"]),
    printingRequired: Boolean(profile["printingRequired"]),
    kdsRequired: Boolean(profile["kdsRequired"]),
  };
}

function requiredStringArray(value: unknown, label: string) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw validation(`Template operatingProfile.${label} must be an array of non-empty strings`);
  }
  return value.map((entry) => String(entry).trim());
}

function containsSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      (/secret|password|credential|authorization|cookie|passkey|privatekey/i.test(key) &&
        !/(reference|ref)$/i.test(key)) ||
      containsSensitiveKey(child),
  );
}

function scopeRank(type: EnterpriseNodeType) {
  return {
    GROUP: 0,
    LEGAL_ENTITY: 1,
    BRAND: 2,
    REGION: 3,
    AREA: 4,
    BRANCH: 5,
    WAREHOUSE: 6,
    COMMISSARY: 6,
  }[type];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseStringArray(value: unknown) {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

async function hashJson(value: unknown) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function stableId(prefix: string, value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw validation(`${label} is required`);
  return normalized;
}

function currencyCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw validation("Currency must be a three-letter code");
  return normalized;
}

function now() {
  return new Date().toISOString();
}
function json(value: unknown) {
  return JSON.stringify(value);
}
function bool(value: boolean) {
  return value ? 1 : 0;
}
function string(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
function integer(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) ? number : 0;
}
function denied(message: string) {
  return new ServerOperationError("PERMISSION_DENIED", 403, message);
}
function validation(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 400, message);
}
function notFound(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 404, message);
}
function invalidState(message: string) {
  return new ServerOperationError("INVALID_STATE_TRANSITION", 409, message);
}
