import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import type { ManualMenuItemCreateInput } from "@/onboarding/manual-menu-item";
import { isCurrentFlow, onboardingStepNumber } from "@/onboarding/onboarding-steps";
import { parseCsvRows, parseXlsxRows } from "@/lib/menu-import-export";
import { getProviderRegistry } from "@/integrations/provider-registry";
import { createIntegrationRepository } from "@/integrations/runtime/integration-repository";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { CURRENT_SCHEMA_VERSION } from "@/server/database/schema-version";
import { validateImportFile } from "@/server/file-import-security";
import {
  requireCleanMalwareScan,
  scannerConfigured,
  scannerPipelineConfigured,
  type CleanScanEvidence,
} from "@/server/malware-scanner";
import { TenantObjectStorage } from "@/server/object-storage";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { ServerOperationError } from "@/server/errors";
import { createSecretStore } from "@/server/secrets";
import { resolveRuntimeConfiguration, validateRuntimeConfiguration } from "@/server/environment";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import { parseMajorAmount } from "@/payments/money";
import {
  MENU_IMPORTER_VERSION,
  MENU_IMPORT_TEMPLATE_VERSION,
  menuTemplateVersion,
  normalizeMenuImportHeader,
  resolveMenuImportHeader,
  unsupportedPopulatedMenuColumns,
  type MenuImportTargetMode,
} from "@/onboarding/menu-import-schema";
import {
  setupSections,
  type AccountingMappingInput,
  type BranchSetupInput,
  type BrandSetupInput,
  type BusinessProfileInput,
  type DeviceHealthRow,
  type DeviceSetupInput,
  type DocumentTemplateSetupInput,
  type ExternalMappingInput,
  type GoLiveDecision,
  type GoLiveState,
  type ImportIssue,
  type ImportPreview,
  type ImportPreviewInput,
  type ImportPreviewRow,
  type ImportTargetMode,
  type IntegrationHealthRow,
  type OpeningStockInput,
  type OrganisationProvisionInput,
  type ProviderSetupInput,
  type ReadinessResult,
  type ReadinessSeverity,
  type ReadinessStatus,
  type RecipeValidationIssue,
  type SetupSection,
  type SetupStage,
  type SetupSummary,
  type StationSetupInput,
  type TaxServiceRuleInput,
  type TestRun,
} from "@/onboarding/types";

type CountRow = { count: number };
type RowField =
  | "id"
  | "provider_id"
  | "status"
  | "dead_letters"
  | "branch_id"
  | "environment"
  | "last_success"
  | "last_failure"
  | "last_webhook"
  | "pending_queue"
  | "credentials_age_days"
  | "name"
  | "device_type"
  | "trust_status"
  | "health_status"
  | "last_seen_at"
  | "last_successful_operation_at"
  | "warning"
  | "version"
  | "completed_at"
  | "verified_at"
  | "trading_name"
  | "legal_name"
  | "go_live_state"
  | "demo_mode"
  | "country_code"
  | "accounting_mode"
  | "default_currency"
  | "timezone"
  | "import_kind"
  | "original_name"
  | "duplicate_strategy"
  | "row_count"
  | "valid_count"
  | "warning_count"
  | "error_count"
  | "row_number"
  | "row_key"
  | "normalized_json"
  | "errors_json"
  | "warnings_json"
  | "created_at"
  | "test_type"
  | "target_type"
  | "target_id"
  | "test_marker"
  | "result_json";
type Row = { [Key in RowField]?: unknown };
type ImportValue = {
  code?: unknown;
  employeeCode?: unknown;
  name?: unknown;
  categoryCode?: unknown;
  sellingPriceMinor?: unknown;
  stationCode?: unknown;
  stationId?: unknown;
  baseUnitCode?: unknown;
  baseUnitId?: unknown;
  purchaseUnitId?: unknown;
  categoryId?: unknown;
  purchaseUnitCode?: unknown;
  dimension?: unknown;
  factorNumerator?: unknown;
  factorDenominator?: unknown;
  leadTimeDays?: unknown;
  roleCode?: unknown;
  roleId?: unknown;
  branchCode?: unknown;
  branchId?: unknown;
  sku?: unknown;
  description?: unknown;
  currency?: unknown;
  taxRuleId?: unknown;
  serviceChargeApplicable?: unknown;
  recipeReference?: unknown;
  modifierGroupReference?: unknown;
  barcode?: unknown;
  sellable?: unknown;
  available?: unknown;
  channelAvailability?: unknown;
  trackExpiry?: unknown;
  warehouseId?: unknown;
  legalName?: unknown;
  phone?: unknown;
  email?: unknown;
  taxNumber?: unknown;
  address?: unknown;
  paymentTermsDays?: unknown;
  minimumOrderMinor?: unknown;
  preferred?: unknown;
  employmentStatus?: unknown;
  department?: unknown;
  jobTitle?: unknown;
  shiftGroup?: unknown;
  parMicro?: unknown;
  safetyStockMicro?: unknown;
  templateVersion?: unknown;
  menuSection?: unknown;
  costPriceMinor?: unknown;
  taxCode?: unknown;
  unitOfMeasure?: unknown;
  kitchenPrinterGroup?: unknown;
  prepMinutes?: unknown;
  parLevel?: unknown;
  imageFilename?: unknown;
  branchPriceMinor?: unknown;
  onlinePriceMinor?: unknown;
  channelCodes?: unknown;
  onlinePriceChannelCodes?: unknown;
  targetBranchIds?: unknown;
  stationIdsByBranch?: unknown;
  recipePending?: unknown;
  existingId?: unknown;
  before?: unknown;
  rawBasePrice?: unknown;
  rawCostPrice?: unknown;
  rawBranchPrice?: unknown;
  rawOnlinePrice?: unknown;
};

const sectionLabels: Record<SetupSection, string> = {
  BUSINESS_PROFILE: "Business profile",
  BRANCHES: "Branches",
  USERS_ROLES: "Users & roles",
  MENU: "Menu",
  INVENTORY: "Inventory",
  RECIPES_UOM: "Recipes / UOM",
  SUPPLIERS: "Suppliers",
  ACCOUNTING: "Accounting",
  TAX_SERVICE: "Taxes / service charges",
  PAYMENTS: "Payments",
  DELIVERY_INTEGRATIONS: "Delivery integrations",
  KITCHEN_STATIONS: "Kitchen / stations / KDS",
  PRINTERS_DEVICES: "Printers / devices",
  DOCUMENTS: "Documents",
  OPENING_STOCK: "Opening stock",
  TESTING: "Testing",
  READINESS: "Readiness",
  GO_LIVE: "Go live",
};

const defaultWeights: Record<SetupSection, number> = {
  BUSINESS_PROFILE: 800,
  BRANCHES: 700,
  USERS_ROLES: 600,
  MENU: 800,
  INVENTORY: 700,
  RECIPES_UOM: 700,
  SUPPLIERS: 300,
  ACCOUNTING: 900,
  TAX_SERVICE: 500,
  PAYMENTS: 700,
  DELIVERY_INTEGRATIONS: 300,
  KITCHEN_STATIONS: 500,
  PRINTERS_DEVICES: 600,
  DOCUMENTS: 500,
  OPENING_STOCK: 600,
  TESTING: 500,
  READINESS: 200,
  GO_LIVE: 200,
};

const requiredAccountMappings = [
  "INVENTORY",
  "COGS",
  "SALES_REVENUE",
  "CUSTOMER_RECEIVABLE",
  "TAX_PAYABLE",
  "SERVICE_CHARGE",
  "DISCOUNTS",
  "REFUNDS",
  "WASTAGE",
  "INVENTORY_VARIANCE",
  "SUPPLIER_PAYABLE",
  "PAYMENT_PROCESSING_FEES",
  "MARKETPLACE_COMMISSION",
  "DELIVERY_FEES",
  "RECOVERABLE_TAX",
  "CASH",
  "PAYMENT_CLEARING",
  "OPENING_BALANCE",
] as const;

export class OnboardingService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
    private readonly env: SerametEnv = {},
  ) {}

  async provisionOrganisation(input: OrganisationProvisionInput) {
    this.require(permissions.platformTenantsProvision);
    if (
      resolveRuntimeConfiguration(this.env).environment === "production" &&
      input.slug.startsWith("demo-")
    ) {
      throw validation(
        "Demo organisation provisioning is not permitted through the production setup command",
      );
    }
    const existing = await this.db
      .prepare("SELECT id FROM tenants WHERE slug=?")
      .bind(input.slug)
      .first<{ id: string }>();
    if (existing) throw validation("Organisation slug is already in use");
    const tenantId = crypto.randomUUID();
    const brandId = stableId("brand", input.brandCode);
    const roleId = stableId("role", "tenant-administrator");
    const stamp = now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO tenants
            (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
        )
        .bind(
          tenantId,
          input.slug,
          clean(input.legalName),
          clean(input.tradingName),
          input.defaultCurrency,
          input.timezone,
          input.locale,
          json({ countryCode: input.countryCode, contact: input.contact ?? {} }),
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          "INSERT INTO brands (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
        )
        .bind(tenantId, brandId, input.brandCode.toUpperCase(), clean(input.brandName)),
      this.db
        .prepare(
          `INSERT INTO tenant_onboarding_profiles
            (tenant_id,country_code,accounting_mode,tax_configuration_reference,logo_asset_reference,
             default_document_footer,fiscal_settings_json,contact_json,legal_identifiers_json,
             document_branding_json,go_live_state,demo_mode,demo_reset_allowed,created_by,created_at,
             updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'SETUP',0,0,?,?,?,?)`,
        )
        .bind(
          tenantId,
          input.countryCode,
          input.accountingMode,
          input.taxConfigurationReference ?? null,
          input.logoAssetReference ?? null,
          input.defaultDocumentFooter ?? null,
          json(input.fiscalSettings ?? {}),
          json(input.contact ?? {}),
          json(input.legalIdentifiers ?? {}),
          json(input.documentBranding ?? {}),
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.db
        .prepare(
          "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,'Tenant Administrator',1,'{}')",
        )
        .bind(tenantId, roleId, "TENANT_ADMINISTRATOR"),
      this.db
        .prepare(
          `INSERT INTO users
            (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,1,1,?,?,?)`,
        )
        .bind(
          tenantId,
          this.actor.id,
          input.administratorEmail ?? null,
          this.actor.name,
          json({
            invitationRequired: Boolean(input.administratorEmail),
            provisionedByTenant: this.actor.tenantId,
          }),
          stamp,
          stamp,
        ),
      this.db
        .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
        .bind(tenantId, this.actor.id, roleId),
    ];
    for (const code of allPermissionCodes) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT(code) DO NOTHING",
          )
          .bind(code, code),
        this.db
          .prepare(
            "INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)",
          )
          .bind(tenantId, roleId, code),
      );
    }
    statements.push(
      this.auditForTenant(tenantId, "ORGANISATION_PROVISIONED", "TENANT", tenantId, {
        slug: input.slug,
        brandId,
        provisionedByTenant: this.actor.tenantId,
      }),
    );
    await this.db.batch(statements);
    return { tenantId, brandId, administratorUserId: this.actor.id, goLiveState: "SETUP" as const };
  }

  async createBrand(input: BrandSetupInput) {
    this.require(permissions.settingsOrganisationManage);
    const id = input.id ?? stableId("brand", input.code);
    const nodeId = stableId("enterprise-brand", input.code);
    const stamp = now();
    const tenant = await this.db
      .prepare("SELECT default_currency,timezone FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string; timezone: string }>();
    if (!tenant) throw notFound("Tenant not found");
    const parent = await this.db
      .prepare(
        `SELECT id,legal_entity_id FROM enterprise_nodes
         WHERE tenant_id=? AND node_type='LEGAL_ENTITY' AND status='ACTIVE' LIMIT 1`,
      )
      .bind(this.actor.tenantId)
      .first<{ id: string; legal_entity_id: string | null }>();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO brands (tenant_id,id,code,name,active,payload_json)
           VALUES (?,?,?,?,?,'{}')
           ON CONFLICT(tenant_id,id) DO UPDATE SET code=excluded.code,name=excluded.name,active=excluded.active`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.toUpperCase(),
          clean(input.name),
          bool(input.active ?? true),
        ),
      this.db
        .prepare(
          `INSERT INTO enterprise_nodes
            (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,warehouse_id,
             status,effective_from,effective_to,timezone,currency,metadata_json,created_by,created_at,
             updated_by,updated_at,version)
           VALUES (?,?,'BRAND',?,?,?,?,?,NULL,NULL,?,?,NULL,?,?,'{}',?,?,?,?,1)
           ON CONFLICT(tenant_id,id) DO UPDATE SET name=excluded.name,status=excluded.status,
             updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=enterprise_nodes.version+1`,
        )
        .bind(
          this.actor.tenantId,
          nodeId,
          `BRAND-${input.code.toUpperCase()}`,
          clean(input.name),
          parent?.id ?? null,
          parent?.legal_entity_id ?? null,
          id,
          input.active === false ? "CLOSED" : "ACTIVE",
          stamp,
          tenant.timezone,
          tenant.default_currency,
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      ...(parent
        ? [
            this.db
              .prepare(
                `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
                 SELECT tenant_id,ancestor_id,?,depth+1 FROM enterprise_node_closure
                 WHERE tenant_id=? AND descendant_id=? ON CONFLICT DO NOTHING`,
              )
              .bind(nodeId, this.actor.tenantId, parent.id),
          ]
        : []),
      this.db
        .prepare(
          `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
           VALUES (?,?,?,0) ON CONFLICT DO NOTHING`,
        )
        .bind(this.actor.tenantId, nodeId, nodeId),
      this.audit("BRAND_CONFIGURED", "BRAND", id, { code: input.code.toUpperCase() }),
    ];
    await this.db.batch(statements);
    return { id };
  }

  async getSetupCentre(branchId?: string): Promise<SetupSummary> {
    if (branchId) await this.assertBranch(branchId);
    return this.recalculateReadiness(branchId, false);
  }

  async listBrandsAndBranches() {
    this.require(permissions.setupView);
    const brands = await this.db
      .prepare("SELECT id,code,name,active FROM brands WHERE tenant_id=? ORDER BY name LIMIT 250")
      .bind(this.actor.tenantId)
      .all<{ id: string; code: string; name: string; active: number }>();
    const branches = await this.db
      .prepare(
        `SELECT b.id,b.brand_id,b.code,b.name,b.timezone,b.business_day_cutoff_minutes,b.active,
                b.lifecycle_state,b.is_bootstrap,b.version,
                p.negative_stock_policy,p.inventory_enabled,p.recipes_required,p.payments_required,
                p.printing_required,p.kds_required
         FROM branches b LEFT JOIN branch_operating_profiles p
           ON p.tenant_id=b.tenant_id AND p.branch_id=b.id
         WHERE b.tenant_id=? ORDER BY b.name LIMIT 500`,
      )
      .bind(this.actor.tenantId)
      .all<{
        id: string;
        brand_id: string | null;
        code: string;
        name: string;
        timezone: string;
        business_day_cutoff_minutes: number;
        active: number;
        lifecycle_state: string;
        is_bootstrap: number;
        version: number;
        negative_stock_policy: string | null;
        inventory_enabled: number | null;
        recipes_required: number | null;
        payments_required: number | null;
        printing_required: number | null;
        kds_required: number | null;
      }>();
    return {
      brands: brands.results ?? [],
      branches: (branches.results ?? [])
        .filter((branch) => this.canReadBranch(branch.id))
        .map((branch) => ({
          id: branch.id,
          brandId: branch.brand_id,
          code: branch.code,
          name: branch.name,
          timezone: branch.timezone,
          businessDayCutoffMinutes: branch.business_day_cutoff_minutes,
          active: Boolean(branch.active),
          lifecycleState: branch.lifecycle_state,
          isBootstrap: Boolean(branch.is_bootstrap),
          version: branch.version,
          negativeStockPolicy: branch.negative_stock_policy ?? "UNCONFIGURED",
          inventoryEnabled:
            branch.inventory_enabled === null ? null : Boolean(branch.inventory_enabled),
          recipesRequired:
            branch.recipes_required === null ? null : Boolean(branch.recipes_required),
          paymentsRequired:
            branch.payments_required === null ? null : Boolean(branch.payments_required),
          printingRequired:
            branch.printing_required === null ? null : Boolean(branch.printing_required),
          kdsRequired: branch.kds_required === null ? null : Boolean(branch.kds_required),
        })),
    };
  }

  async getBusinessProfile() {
    this.require(permissions.setupView);
    const row = await this.db
      .prepare(
        `SELECT t.legal_name,t.trading_name,t.default_currency,t.timezone,t.locale,
                p.country_code,p.accounting_mode,p.tax_configuration_reference,
                p.logo_asset_reference,p.default_document_footer,p.fiscal_settings_json,
                p.contact_json,p.legal_identifiers_json,p.document_branding_json
         FROM tenants t LEFT JOIN tenant_onboarding_profiles p ON p.tenant_id=t.id
         WHERE t.id=?`,
      )
      .bind(this.actor.tenantId)
      .first<Record<string, unknown>>();
    if (!row) throw notFound("Business profile not found");
    return {
      legalName: string(row["legal_name"]),
      tradingName: string(row["trading_name"]),
      defaultCurrency: string(row["default_currency"]),
      timezone: string(row["timezone"]),
      locale: string(row["locale"]),
      countryCode: string(row["country_code"]),
      accountingMode: string(row["accounting_mode"] || "PERPETUAL"),
      taxConfigurationReference: optionalString(row["tax_configuration_reference"]),
      logoAssetReference: optionalString(row["logo_asset_reference"]),
      defaultDocumentFooter: optionalString(row["default_document_footer"]),
      fiscalSettings: parseJson(string(row["fiscal_settings_json"]), {}),
      contact: parseJson(string(row["contact_json"]), {}),
      legalIdentifiers: parseJson(string(row["legal_identifiers_json"]), {}),
      documentBranding: parseJson(string(row["document_branding_json"]), {}),
    };
  }

  async setupOptions(branchId?: string) {
    this.require(permissions.setupView);
    if (branchId) await this.assertBranch(branchId);
    const [accounts, roles, warehouses, stations, templates, inventoryItems, units, taxRules] =
      await Promise.all([
        this.db
          .prepare(
            "SELECT id,code,name,account_type,currency,active FROM accounts WHERE tenant_id=? ORDER BY code LIMIT 1000",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            "SELECT id,code,name,active FROM roles WHERE tenant_id=? ORDER BY name LIMIT 250",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            "SELECT id,branch_id,code,name,active FROM warehouses WHERE tenant_id=? ORDER BY name LIMIT 500",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            "SELECT id,branch_id,code,name,station_type,active FROM stations WHERE tenant_id=? ORDER BY name LIMIT 500",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            "SELECT id,branch_id,document_type,layout_version,active,payload_json FROM document_templates WHERE tenant_id=? ORDER BY document_type LIMIT 500",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            "SELECT id,sku,code,name,base_unit_id,active FROM inventory_items WHERE tenant_id=? ORDER BY name LIMIT 5000",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            "SELECT id,code,name,symbol,dimension,active FROM unit_definitions WHERE tenant_id=? ORDER BY code LIMIT 500",
          )
          .bind(this.actor.tenantId)
          .all(),
        this.db
          .prepare(
            `SELECT id,branch_id,rule_type,code,name,rate_bps,calculation_mode,effective_from,active
             FROM tax_service_rules WHERE tenant_id=? AND active=1 ORDER BY rule_type,code LIMIT 200`,
          )
          .bind(this.actor.tenantId)
          .all(),
      ]);
    return {
      accounts: accounts.results ?? [],
      roles: roles.results ?? [],
      warehouses: (warehouses.results ?? []).filter((row) =>
        this.canReadBranch(string((row as Record<string, unknown>)["branch_id"])),
      ),
      stations: (stations.results ?? []).filter((row) =>
        this.canReadBranch(string((row as Record<string, unknown>)["branch_id"])),
      ),
      documentTemplates: (templates.results ?? []).filter((row) => {
        const target = string((row as Record<string, unknown>)["branch_id"]);
        return !target || this.canReadBranch(target);
      }),
      inventoryItems: inventoryItems.results ?? [],
      units: units.results ?? [],
      taxRules: (taxRules.results ?? []).filter((row) => {
        const target = string((row as Record<string, unknown>)["branch_id"]);
        return !target || this.canReadBranch(target);
      }),
    };
  }

  async listMenuCatalog(branchId?: string) {
    this.require(permissions.setupView);
    const scopedBranchId =
      branchId ?? (this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : undefined);
    if (scopedBranchId) await this.assertBranch(scopedBranchId);
    const rows = await this.db
      .prepare(
        `SELECT m.id,m.code,m.sku,m.name,m.category_code,m.description,m.selling_price_minor,
                m.currency,COALESCE(bs.station_id,m.station_id) station_id,
                m.recipe_reference,m.sellable,m.active,
                bs.selling_price_minor branch_price_minor,bs.available,
                CASE WHEN bs.menu_item_id IS NULL THEN 0 ELSE 1 END branch_activated
         FROM menu_catalog_items m
         LEFT JOIN menu_item_branch_settings bs ON bs.tenant_id=m.tenant_id AND bs.menu_item_id=m.id
           AND bs.branch_id=?
         WHERE m.tenant_id=? AND m.active=1 AND (? IS NULL OR bs.menu_item_id IS NOT NULL)
         ORDER BY m.category_code,m.name LIMIT 5000`,
      )
      .bind(scopedBranchId ?? null, this.actor.tenantId, scopedBranchId ?? null)
      .all<{
        id: string;
        code: string;
        sku: string | null;
        name: string;
        category_code: string;
        description: string | null;
        selling_price_minor: number;
        currency: string;
        station_id: string | null;
        recipe_reference: string | null;
        sellable: number;
        active: number;
        branch_price_minor: number | null;
        available: number | null;
        branch_activated: number;
      }>();
    return rows.results ?? [];
  }

  async listOpeningStock(branchId?: string) {
    this.require(permissions.setupView);
    if (branchId) await this.assertBranch(branchId);
    const rows = await this.db
      .prepare(
        `SELECT id,branch_id,warehouse_id,business_date,currency,status,total_value_minor,
                approved_at,posted_at,created_at
         FROM opening_stock_batches WHERE tenant_id=? AND (? IS NULL OR branch_id=?)
         ORDER BY created_at DESC LIMIT 250`,
      )
      .bind(this.actor.tenantId, branchId ?? null, branchId ?? null)
      .all();
    return rows.results ?? [];
  }

  async setSectionWeight(section: SetupSection, weightBps: number) {
    this.require(permissions.setupManage);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO setup_section_weights (tenant_id,section_key,weight_bps,updated_by,updated_at)
           VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,section_key) DO UPDATE SET
             weight_bps=excluded.weight_bps,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(this.actor.tenantId, section, weightBps, this.actor.id, now()),
      this.audit("SETUP_WEIGHT_CHANGED", "SETUP_SECTION", section, { weightBps }),
    ]);
    return { section, weightBps };
  }

  async updateBusinessProfile(input: BusinessProfileInput) {
    this.require(permissions.setupManage);
    const stamp = now();
    const tenant = await this.db
      .prepare("SELECT id,slug,created_at FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ id: string; slug: string; created_at: string }>();
    if (!tenant) throw notFound("Tenant not found");
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE tenants SET legal_name=?,trading_name=?,default_currency=?,timezone=?,locale=?,
             payload_json=?,updated_at=? WHERE id=?`,
        )
        .bind(
          clean(input.legalName),
          clean(input.tradingName),
          input.defaultCurrency,
          input.timezone,
          input.locale,
          json({ countryCode: input.countryCode, contact: input.contact ?? {} }),
          stamp,
          this.actor.tenantId,
        ),
      this.db
        .prepare(
          `INSERT INTO tenant_onboarding_profiles
            (tenant_id,country_code,accounting_mode,tax_configuration_reference,logo_asset_reference,
             default_document_footer,fiscal_settings_json,contact_json,legal_identifiers_json,
             document_branding_json,go_live_state,demo_mode,demo_reset_allowed,created_by,created_at,
             updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'SETUP',0,0,?,?,?,?)
           ON CONFLICT(tenant_id) DO UPDATE SET country_code=excluded.country_code,
             accounting_mode=excluded.accounting_mode,
             tax_configuration_reference=excluded.tax_configuration_reference,
             logo_asset_reference=excluded.logo_asset_reference,
             default_document_footer=excluded.default_document_footer,
             fiscal_settings_json=excluded.fiscal_settings_json,contact_json=excluded.contact_json,
             legal_identifiers_json=excluded.legal_identifiers_json,
             document_branding_json=excluded.document_branding_json,
             updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          input.countryCode,
          input.accountingMode,
          input.taxConfigurationReference ?? null,
          input.logoAssetReference ?? null,
          input.defaultDocumentFooter ?? null,
          json(input.fiscalSettings ?? {}),
          json(input.contact ?? {}),
          json(input.legalIdentifiers ?? {}),
          json(input.documentBranding ?? {}),
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.audit("BUSINESS_PROFILE_UPDATED", "TENANT", this.actor.tenantId, {
        countryCode: input.countryCode,
        accountingMode: input.accountingMode,
      }),
    ]);
    return this.recalculateReadiness(undefined, true);
  }

  async createBranch(input: BranchSetupInput) {
    this.require(permissions.settingsBranchManage);
    if (this.actor.branchScope.type !== "ALL") {
      throw denied("Creating a branch requires all-branch tenant scope");
    }
    const requestHash = await sha256Text(stableJson(input));
    const existingAttempt = await this.db
      .prepare(
        `SELECT request_hash,response_json FROM branch_creation_attempts
         WHERE tenant_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ request_hash: string; response_json: string }>();
    if (existingAttempt) {
      if (existingAttempt.request_hash !== requestHash) {
        throw new ServerOperationError(
          "CONFLICT",
          409,
          "Branch idempotency key was reused with different details",
        );
      }
      return JSON.parse(existingAttempt.response_json) as {
        id: string;
        warehouseId: string | null;
        duplicate: boolean;
      };
    }
    const unresolvedBootstrap = await this.db
      .prepare(
        `SELECT id FROM branches WHERE tenant_id=? AND is_bootstrap=1
         AND lifecycle_state IN ('DRAFT','CONFIGURING') LIMIT 1`,
      )
      .bind(this.actor.tenantId)
      .first<{ id: string }>();
    if (unresolvedBootstrap) {
      const wizard = await this.db
        .prepare("SELECT status FROM onboarding_wizard_progress WHERE tenant_id=?")
        .bind(this.actor.tenantId)
        .first<{ status: string }>();
      if (wizard?.status !== "COMPLETED") {
        throw invalidTransition(
          "Complete the first branch's guided onboarding before adding another branch",
        );
      }
    }
    const brand = await this.db
      .prepare("SELECT id FROM brands WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, input.brandId)
      .first();
    if (!brand) throw validation("Brand does not exist in this tenant");
    const likelyDuplicate = await this.db
      .prepare(
        `SELECT id,name FROM branches WHERE tenant_id=? AND lifecycle_state<>'CLOSED'
         AND (UPPER(TRIM(code))=UPPER(TRIM(?)) OR LOWER(TRIM(name))=LOWER(TRIM(?))) LIMIT 1`,
      )
      .bind(this.actor.tenantId, input.code, input.name)
      .first<{ id: string; name: string }>();
    if (likelyDuplicate && !input.confirmPossibleDuplicate) {
      throw new ServerOperationError(
        "DUPLICATE",
        409,
        `A branch with a similar code or name already exists (${likelyDuplicate.name}). Confirm the duplicate review before creating another location.`,
      );
    }
    const branchId = input.id ?? stableId("branch", input.code);
    const warehouseId = input.createWarehouse
      ? stableId("warehouse", input.createWarehouse.code)
      : null;
    const stamp = now();
    const hierarchyParent = await this.db
      .prepare(
        `SELECT id,legal_entity_id FROM enterprise_nodes
         WHERE tenant_id=? AND node_type='BRAND' AND brand_id=? AND status='ACTIVE' LIMIT 1`,
      )
      .bind(this.actor.tenantId, input.brandId)
      .first<{ id: string; legal_entity_id: string | null }>();
    if (!hierarchyParent) throw validation("Brand hierarchy node is missing");
    const nodeId = crypto.randomUUID();
    const branchPayload = {
      address: input.address,
      phone: input.phone,
      email: input.email,
      serviceModes: input.serviceModes ?? [],
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO branches
            (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json,
             lifecycle_state,is_bootstrap,version)
           VALUES (?,?,?,?,?,?,?,1,?,'CONFIGURING',0,1)`,
        )
        .bind(
          this.actor.tenantId,
          branchId,
          input.brandId,
          input.code.toUpperCase(),
          clean(input.name),
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
          input.accountingModeOverride ?? null,
          input.negativeStockPolicy,
          json(input.operatingHours ?? {}),
          json(input.serviceModes ?? []),
          json(input.requiredDeviceRoles ?? []),
          bool(input.paymentsRequired ?? true),
          bool(input.inventoryEnabled ?? true),
          bool(input.recipesRequired ?? true),
          bool(input.printingRequired ?? true),
          bool(input.kdsRequired ?? false),
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.audit("BRANCH_CREATED", "BRANCH", branchId, { code: input.code }),
      this.db
        .prepare(
          `INSERT INTO enterprise_nodes
            (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,warehouse_id,
             status,effective_from,effective_to,timezone,currency,metadata_json,created_by,created_at,
             updated_by,updated_at,version)
           SELECT ?,?,'BRANCH',?,?,?,legal_entity_id,?, ?,NULL,'ACTIVE',?,NULL,?,t.default_currency,
                  '{}',?,?,?,?,1
           FROM enterprise_nodes parent JOIN tenants t ON t.id=parent.tenant_id
           WHERE parent.tenant_id=? AND parent.id=?`,
        )
        .bind(
          this.actor.tenantId,
          nodeId,
          `BRANCH-${input.code.toUpperCase()}`,
          clean(input.name),
          hierarchyParent.id,
          input.brandId,
          branchId,
          stamp,
          input.timezone,
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
          this.actor.tenantId,
          hierarchyParent.id,
        ),
      this.db
        .prepare(
          `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
           SELECT tenant_id,ancestor_id,?,depth+1 FROM enterprise_node_closure
           WHERE tenant_id=? AND descendant_id=?`,
        )
        .bind(nodeId, this.actor.tenantId, hierarchyParent.id),
      this.db
        .prepare(
          `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
           VALUES (?,?,?,0)`,
        )
        .bind(this.actor.tenantId, nodeId, nodeId),
      this.db
        .prepare(
          `INSERT INTO user_branches (tenant_id,user_id,branch_id)
           SELECT tenant_id,user_id,? FROM account_owners
           WHERE tenant_id=? AND status='ACTIVE'
           ON CONFLICT DO NOTHING`,
        )
        .bind(branchId, this.actor.tenantId),
    ];
    if (warehouseId && input.createWarehouse) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
             VALUES (?,?,?,?,?,1,'{}')`,
          )
          .bind(
            this.actor.tenantId,
            warehouseId,
            branchId,
            input.createWarehouse.code.toUpperCase(),
            clean(input.createWarehouse.name),
          ),
      );
    }
    const result = { id: branchId, warehouseId, duplicate: Boolean(likelyDuplicate) };
    if (likelyDuplicate) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO branch_duplicate_reviews
              (tenant_id,id,candidate_branch_id,existing_branch_id,status,evidence_json,reviewed_by,
               reviewed_at,reason,created_at)
             VALUES (?,?,?,?,'CONFIRMED_DISTINCT',?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            branchId,
            likelyDuplicate.id,
            JSON.stringify({ matchedName: likelyDuplicate.name, requestedCode: input.code }),
            this.actor.id,
            stamp,
            "Explicit duplicate confirmation during branch creation",
            stamp,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO branch_creation_attempts
            (tenant_id,idempotency_key,request_hash,status,branch_id,response_json,created_by,created_at,updated_at)
           VALUES (?,?,?,'COMPLETED',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          input.idempotencyKey,
          requestHash,
          branchId,
          JSON.stringify(result),
          this.actor.id,
          stamp,
          stamp,
        ),
    );
    try {
      await this.db.batch(statements);
      return result;
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT request_hash,response_json FROM branch_creation_attempts
           WHERE tenant_id=? AND idempotency_key=?`,
        )
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ request_hash: string; response_json: string }>();
      if (raced?.request_hash === requestHash)
        return JSON.parse(raced.response_json) as typeof result;
      throw error;
    }
  }

  async previewDuplicateBranches() {
    this.require(permissions.branchesReconcile);
    const rows = await this.db
      .prepare(
        `SELECT id,code,name,payload_json,lifecycle_state,is_bootstrap
         FROM branches WHERE tenant_id=? AND lifecycle_state<>'CLOSED'
         ORDER BY is_bootstrap DESC,name LIMIT 250`,
      )
      .bind(this.actor.tenantId)
      .all<Record<string, unknown>>();
    const branches = rows.results ?? [];
    const pairs: Array<Record<string, unknown>> = [];
    for (let leftIndex = 0; leftIndex < branches.length; leftIndex += 1) {
      const left = branches[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < branches.length; rightIndex += 1) {
        const right = branches[rightIndex]!;
        const leftAddress = normalizedAddress(left["payload_json"]);
        const rightAddress = normalizedAddress(right["payload_json"]);
        const matchedSignals = [
          normalizeComparable(left["code"]) === normalizeComparable(right["code"]) ? "CODE" : null,
          normalizeComparable(left["name"]) === normalizeComparable(right["name"]) ? "NAME" : null,
          leftAddress && leftAddress === rightAddress ? "ADDRESS" : null,
        ].filter(Boolean);
        if (!matchedSignals.length) continue;
        const candidate =
          Number(left["is_bootstrap"]) > Number(right["is_bootstrap"]) ? left : right;
        const existing = candidate === left ? right : left;
        const [candidateCounts, existingCounts] = await Promise.all([
          this.branchDependencyCounts(String(candidate["id"])),
          this.branchDependencyCounts(String(existing["id"])),
        ]);
        pairs.push({
          candidate: branchSummary(candidate),
          existing: branchSummary(existing),
          matchedSignals,
          candidateCounts,
          existingCounts,
          canDeactivateCandidate: Object.values(candidateCounts).every((count) => count === 0),
        });
      }
    }
    return { pairs };
  }

  async deactivateEmptyDuplicateBranch(branchId: string, reason: string) {
    this.require(permissions.branchesReconcile);
    if (this.actor.branchScope.type !== "ALL")
      throw denied("Duplicate branch review requires all-branch scope");
    if (reason.trim().length < 8) throw validation("A reconciliation reason is required");
    const branch = await this.db
      .prepare(
        `SELECT id,code,name,lifecycle_state FROM branches
         WHERE tenant_id=? AND id=? AND lifecycle_state<>'CLOSED'`,
      )
      .bind(this.actor.tenantId, branchId)
      .first<{ id: string; code: string; name: string; lifecycle_state: string }>();
    if (!branch) throw notFound("Branch was not found");
    const counts = await this.branchDependencyCounts(branchId);
    if (Object.values(counts).some((count) => count > 0)) {
      const stamp = now();
      await this.db
        .prepare(
          `INSERT INTO branch_duplicate_reviews
            (tenant_id,id,candidate_branch_id,existing_branch_id,status,evidence_json,reviewed_by,
             reviewed_at,reason,created_at)
           VALUES (?,?,?,?,'BLOCKED_HAS_DATA',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          branchId,
          branchId,
          json({ dependencyCounts: counts }),
          this.actor.id,
          stamp,
          reason.trim(),
          stamp,
        )
        .run();
      throw invalidTransition(
        "Branch contains operational data and cannot be deactivated automatically",
      );
    }
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE branches SET lifecycle_state='CLOSED',active=0,version=version+1
           WHERE tenant_id=? AND id=? AND lifecycle_state<>'CLOSED'`,
        )
        .bind(this.actor.tenantId, branchId),
      this.db
        .prepare(
          `UPDATE enterprise_nodes SET status='CLOSED',updated_by=?,updated_at=?,version=version+1
           WHERE tenant_id=? AND branch_id=? AND node_type='BRANCH' AND status<>'CLOSED'`,
        )
        .bind(this.actor.id, stamp, this.actor.tenantId, branchId),
      this.db
        .prepare(
          `INSERT INTO branch_duplicate_reviews
            (tenant_id,id,candidate_branch_id,existing_branch_id,status,evidence_json,reviewed_by,
             reviewed_at,reason,created_at)
           VALUES (?,?,?,?,'DEACTIVATED_EMPTY',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          branchId,
          branchId,
          json({ dependencyCounts: counts }),
          this.actor.id,
          stamp,
          reason.trim(),
          stamp,
        ),
      this.audit("EMPTY_DUPLICATE_BRANCH_DEACTIVATED", "BRANCH", branchId, {
        reason: reason.trim(),
        dependencyCounts: counts,
      }),
    ]);
    return { branchId, status: "CLOSED" as const, dependencyCounts: counts };
  }

  private async branchDependencyCounts(branchId: string) {
    const row = await this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM orders WHERE tenant_id=? AND branch_id=?) AS orders_count,
          (SELECT COUNT(*) FROM invoices WHERE tenant_id=? AND branch_id=?) AS invoices_count,
          (SELECT COUNT(*) FROM payment_transactions WHERE tenant_id=? AND branch_id=?) AS payments_count,
          (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id=? AND branch_id=?) AS inventory_count,
          (SELECT COUNT(*) FROM hardware_devices WHERE tenant_id=? AND branch_id=?) AS devices_count`,
      )
      .bind(
        this.actor.tenantId,
        branchId,
        this.actor.tenantId,
        branchId,
        this.actor.tenantId,
        branchId,
        this.actor.tenantId,
        branchId,
        this.actor.tenantId,
        branchId,
      )
      .first<Record<string, unknown>>();
    return {
      orders: Number(row?.["orders_count"] ?? 0),
      invoices: Number(row?.["invoices_count"] ?? 0),
      payments: Number(row?.["payments_count"] ?? 0),
      inventoryMovements: Number(row?.["inventory_count"] ?? 0),
      devices: Number(row?.["devices_count"] ?? 0),
    };
  }

  async queueImportPreparation(input: ImportPreviewInput) {
    this.require(permissions.setupImport);
    if (
      !scannerPipelineConfigured({
        scanQueue: this.env.SERAMET_SCAN_QUEUE,
        workQueue: this.env.SERAMET_WORK_QUEUE,
        objectStorage: this.env.SERAMET_OBJECTS,
        evidenceSecret: this.env.SERAMET_SCANNER_EVIDENCE_SECRET,
      })
    ) {
      throw new ServerOperationError(
        "EXTERNAL_SERVICE_UNAVAILABLE",
        503,
        "File imports are unavailable until security scanning, quarantine storage and durable workers are configured",
      );
    }
    if (input.kind === "INVENTORY" && !input.branchId)
      throw validation("Select one authorized branch for inventory imports");
    const file = await validateImportFile({
      kind: input.kind,
      filename: input.originalName,
      contentType: input.mimeType,
      bytes: input.bytes,
    });
    const target =
      input.kind === "MENU"
        ? await this.resolveMenuImportTarget(input)
        : {
            mode: (input.branchId ? "SELECTED_BRANCHES" : "TENANT_MASTER") as ImportTargetMode,
            branchIds: input.branchId ? [input.branchId] : [],
          };
    if (input.kind !== "MENU" && input.branchId) await this.assertBranch(input.branchId);
    const requestDigest = await sha256Text(
      stableJson({
        tenantId: this.actor.tenantId,
        kind: input.kind,
        fileChecksum: file.digest,
        originalName: file.filename,
        mimeType: input.mimeType,
        duplicateStrategy: input.duplicateStrategy,
        targetMode: target.mode,
        targetBranchIds: [...target.branchIds].sort(),
        columnMap: normalizeStringRecord(input.columnMap),
        referenceMap: normalizeReferenceMap(input.referenceMap),
        branchId: input.branchId ?? null,
      }),
    );
    const jobKey = `setup-import-prepare:${input.idempotencyKey}`;
    const existing = await this.db
      .prepare(
        `SELECT id,payload_json,status,result_json,correlation_id FROM worker_jobs
         WHERE tenant_id=? AND idempotency_key=? AND job_type='SETUP_IMPORT_PREPARE'`,
      )
      .bind(this.actor.tenantId, jobKey)
      .first<{
        id: string;
        payload_json: string;
        status: string;
        result_json: string;
        correlation_id: string;
      }>();
    if (existing) {
      const payload = parseJson<{ requestDigest?: string }>(existing.payload_json, {});
      if (payload.requestDigest !== requestDigest) {
        throw invalidTransition("Import upload identity was reused with a different request");
      }
      if (["PENDING", "RETRY_PENDING"].includes(existing.status)) {
        await this.dispatchScanJob(existing.id, existing.correlation_id);
      }
      return {
        jobId: existing.id,
        status: existing.status,
        duplicate: true,
        result: parseJson(existing.result_json, {}),
      };
    }

    const storage = new TenantObjectStorage(this.db, this.env.SERAMET_OBJECTS!);
    const stored = await storage.store({
      tenantId: this.actor.tenantId,
      ...(target.branchIds.length === 1 ? { branchId: target.branchIds[0] } : {}),
      actorId: this.actor.id,
      objectClass: "IMPORT_QUARANTINE",
      fileName: file.filename,
      contentType: input.mimeType,
      bytes: input.bytes.slice().buffer as ArrayBuffer,
    });
    const correlationId = crypto.randomUUID();
    const jobId = stableId("worker", jobKey);
    try {
      await this.db.batch([
        this.enqueueJobStatement(
          "SETUP_IMPORT_PREPARE",
          input.branchId ?? "",
          jobKey,
          correlationId,
          {
            objectId: stored.id,
            objectKey: stored.objectKey,
            objectVersion: stored.objectVersion,
            fileChecksum: file.digest,
            requestDigest,
            kind: input.kind,
            originalName: file.filename,
            mimeType: input.mimeType,
            duplicateStrategy: input.duplicateStrategy,
            idempotencyKey: input.idempotencyKey,
            targetMode: target.mode,
            targetBranchIds: target.branchIds,
            columnMap: normalizeStringRecord(input.columnMap),
            referenceMap: normalizeReferenceMap(input.referenceMap),
            actorId: this.actor.id,
            ...(input.branchId ? { branchId: input.branchId } : {}),
          },
          "9999-12-31T23:59:59.999Z",
        ),
        this.audit("SETUP_IMPORT_UPLOAD_QUARANTINED", "WORKER_JOB", jobId, {
          objectId: stored.id,
          fileChecksum: file.digest,
          correlationId,
        }),
        this.importStateEvent("QUARANTINED", {
          jobId,
          objectId: stored.id,
          evidence: {
            objectKey: stored.objectKey,
            objectVersion: stored.objectVersion,
            fileChecksum: file.digest,
          },
        }),
      ]);
    } catch (error) {
      await storage.remove(this.actor.tenantId, stored.id).catch(() => undefined);
      throw error;
    }
    await this.dispatchScanJob(jobId, correlationId);
    return { jobId, status: "PENDING" as const, duplicate: false, result: {} };
  }

  async createManualMenuItem(input: ManualMenuItemCreateInput) {
    this.require(permissions.setupImport);
    await this.assertImportBranch(input.branchId);
    const payloadDigest = await sha256Text(
      stableJson({
        branchId: input.branchId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        categoryCode: input.categoryCode.trim().toUpperCase(),
        basePrice: input.basePrice.trim(),
        currency: input.currency.trim().toUpperCase(),
        description: input.description?.trim() ?? "",
        sku: input.sku?.trim() ?? "",
        stationCode: input.stationCode?.trim() ?? "",
        branchPrice: input.branchPrice?.trim() ?? "",
        onlinePrice: input.onlinePrice?.trim() ?? "",
        taxCode: input.taxCode?.trim() ?? "",
        unitOfMeasure: input.unitOfMeasure?.trim() ?? "",
        recipeCode: input.recipeCode?.trim() ?? "",
        serviceChargeApplicable: Boolean(input.serviceChargeApplicable),
      }),
    );
    const prior = await this.db
      .prepare(
        `SELECT payload_digest,result_json FROM manual_menu_item_requests
         WHERE tenant_id=? AND request_key=?`,
      )
      .bind(this.actor.tenantId, input.requestKey)
      .first<{ payload_digest: string; result_json: string }>();
    if (prior) {
      if (prior.payload_digest !== payloadDigest) {
        throw invalidTransition("Manual menu request identity was reused with different values");
      }
      return { ...parseJson<Record<string, unknown>>(prior.result_json, {}), duplicate: true };
    }
    const raw = {
      templateVersion: String(MENU_IMPORT_TEMPLATE_VERSION),
      itemCode: input.code,
      name: input.name,
      categoryCode: input.categoryCode,
      menuSection: input.categoryCode,
      description: input.description ?? "",
      basePrice: input.basePrice,
      currency: input.currency,
      stationCode: input.stationCode ?? "",
      branchPrice: input.branchPrice ?? "",
      onlinePrice: input.onlinePrice ?? "",
      taxCode: input.taxCode ?? "",
      unitOfMeasure: input.unitOfMeasure ?? "",
      recipeCode: input.recipeCode ?? "",
      serviceChargeApplicable: input.serviceChargeApplicable ? "true" : "false",
      sku: input.sku?.trim() || input.code,
      sellable: "true",
      available: "true",
      prepMinutes: "0",
      parLevel: "0",
    };
    const rows = await this.validateRows("MENU", [raw], input.branchId, undefined, {
      targetMode: "SELECTED_BRANCHES",
      targetBranchIds: [input.branchId],
      referenceMap: undefined,
      templateVersion: MENU_IMPORT_TEMPLATE_VERSION,
      unsupportedColumns: [],
      duplicateStrategy: "ERROR",
    });
    const row = rows[0];
    if (!row || row.status === "ERROR") {
      throw validation(
        row?.errors.map((issue) => issue.message).join("; ") || "Manual menu item is invalid",
      );
    }
    const built = await this.buildImportStatements("MENU", "ERROR", null, row.normalized, {});
    const result = {
      id: built.entityId,
      code: string(row.normalized["code"]),
      branchId: input.branchId,
      status: "ACTIVE" as const,
      duplicate: false,
    };
    const stamp = now();
    await this.db.batch([
      ...built.statements,
      this.db
        .prepare(
          `INSERT INTO manual_menu_item_requests
            (tenant_id,request_key,payload_digest,menu_item_id,result_json,created_by,created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          input.requestKey,
          payloadDigest,
          built.entityId,
          json(result),
          this.actor.id,
          stamp,
        ),
      this.audit("MANUAL_MENU_ITEM_CREATED", "MENU", built.entityId, {
        branchId: input.branchId,
        requestKey: input.requestKey,
      }),
    ]);
    return result;
  }

  async previewImport(
    input: ImportPreviewInput,
    options: {
      cleanEvidence?: CleanScanEvidence;
      sourceObjectId?: string;
      createdBy?: string;
    } = {},
  ): Promise<ImportPreview> {
    this.require(permissions.setupImport);
    const file = await validateImportFile({
      kind: input.kind,
      filename: input.originalName,
      contentType: input.mimeType,
      bytes: input.bytes,
    });
    if (input.kind === "INVENTORY" && !input.branchId)
      throw validation("Select one authorized branch for inventory imports");
    const scanEvidence = options.cleanEvidence
      ? options.cleanEvidence
      : await requireCleanMalwareScan({
          scanner: this.env.SERAMET_MALWARE_SCANNER,
          bytes: input.bytes,
          sha256: file.digest,
          contentType: input.mimeType,
          fileName: file.filename,
          subject: {
            jobId: `inline-preview:${file.digest}`,
            objectKey: `inline://${this.actor.tenantId}/${file.digest}`,
            objectVersion: file.digest,
          },
        });
    if (scanEvidence.sha256 !== file.digest || scanEvidence.verdict !== "CLEAN") {
      throw invalidTransition("File security evidence does not match the uploaded file");
    }
    let rawRows: Array<Record<string, string>>;
    try {
      rawRows = await parseRows(input.bytes, file.extension);
    } catch {
      throw validation("Import file could not be parsed within the safe workbook limits");
    }
    if (rawRows.length > file.maxRows) throw validation("Import row limit exceeded");
    assertSafeParsedRows(rawRows);
    const target =
      input.kind === "MENU"
        ? await this.resolveMenuImportTarget(input)
        : {
            mode: (input.branchId ? "SELECTED_BRANCHES" : "TENANT_MASTER") as ImportTargetMode,
            branchIds: input.branchId ? [input.branchId] : [],
          };
    if (input.kind !== "MENU" && input.branchId) await this.assertBranch(input.branchId);
    const template =
      input.kind === "MENU" ? menuTemplateVersion(rawRows) : { version: 1, legacy: false };
    const catalogueRevision =
      input.kind === "MENU" ? await this.menuCatalogueRevision() : "not-applicable";
    const fingerprint = await sha256Text(
      stableJson({
        tenantId: this.actor.tenantId,
        kind: input.kind,
        fileDigest: file.digest,
        templateVersion: template.version,
        importerVersion: input.kind === "MENU" ? MENU_IMPORTER_VERSION : "setup-import-v1",
        scanEvidenceId: scanEvidence.evidenceId,
        columnMap: normalizeStringRecord(input.columnMap),
        duplicateStrategy: input.duplicateStrategy,
        targetMode: target.mode,
        targetBranchIds: [...target.branchIds].sort(),
        referenceMap: normalizeReferenceMap(input.referenceMap),
      }),
    );
    const effectiveKey =
      input.kind === "MENU" ? `menu-preview:${fingerprint}` : input.idempotencyKey;
    const existing = await this.db
      .prepare(
        input.kind === "MENU"
          ? "SELECT id FROM setup_imports WHERE tenant_id=? AND preview_fingerprint=?"
          : "SELECT id FROM setup_imports WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.kind === "MENU" ? fingerprint : effectiveKey)
      .first<{ id: string }>();
    if (existing) return this.getImport(existing.id);
    const rows = await this.validateRows(input.kind, rawRows, input.branchId, input.columnMap, {
      targetMode: target.mode,
      targetBranchIds: target.branchIds,
      referenceMap: input.referenceMap,
      templateVersion: template.version,
      unsupportedColumns:
        input.kind === "MENU"
          ? unsupportedPopulatedMenuColumns(rawRows).filter(
              (header) =>
                !Object.values(input.columnMap ?? {}).some(
                  (mapped) =>
                    normalizeMenuImportHeader(mapped) === normalizeMenuImportHeader(header),
                ),
            )
          : [],
      duplicateStrategy: input.duplicateStrategy,
    });
    const id = crypto.randomUUID();
    const stamp = now();
    const errorCount = rows.filter((row) => row.status === "ERROR").length;
    const warningCount = rows.filter((row) => row.status === "WARNING").length;
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO setup_imports
            (tenant_id,id,branch_id,import_kind,original_name,mime_type,file_checksum,duplicate_strategy,
              status,row_count,valid_count,warning_count,error_count,report_json,idempotency_key,
              created_by,created_at,updated_at,template_version,preview_fingerprint,importer_version,
              target_mode,target_branch_ids_json,column_map_json,reference_map_json,catalogue_revision,
              expires_at,verification_status,verification_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          target.branchIds.length === 1 ? target.branchIds[0] : null,
          input.kind,
          file.filename,
          input.mimeType,
          file.digest,
          input.duplicateStrategy,
          errorCount ? "REJECTED" : "VALIDATED",
          rows.length,
          rows.length - errorCount,
          warningCount,
          errorCount,
          json({
            requiresPreview: true,
            extension: file.extension,
            fileValidationPolicy: "authenticated-clean-v1",
            scanEvidenceId: scanEvidence.evidenceId,
            legacyTemplate: template.legacy,
            unsupportedColumns:
              input.kind === "MENU" ? unsupportedPopulatedMenuColumns(rawRows) : [],
          }),
          effectiveKey,
          options.createdBy ?? this.actor.id,
          stamp,
          stamp,
          template.version,
          fingerprint,
          input.kind === "MENU" ? MENU_IMPORTER_VERSION : "setup-import-v1",
          target.mode,
          json(target.branchIds),
          json(normalizeStringRecord(input.columnMap)),
          json(normalizeReferenceMap(input.referenceMap)),
          catalogueRevision,
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          "PENDING",
          "{}",
        ),
      ...rows.map((row) =>
        this.db
          .prepare(
            `INSERT INTO setup_import_rows
              (tenant_id,import_id,row_number,row_key,status,normalized_json,errors_json,warnings_json,
               action,before_json,after_json)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            id,
            row.rowNumber,
            row.rowKey,
            row.status,
            json(row.normalized),
            json(row.errors),
            json(row.warnings),
            row.action ?? (row.status === "ERROR" ? "ERROR" : "CREATE"),
            json((row.normalized["before"] as Record<string, unknown> | undefined) ?? {}),
            json(row.normalized),
          ),
      ),
      this.db
        .prepare(
          `UPDATE setup_imports SET scan_status='CLEAN',scan_evidence_json=?,source_object_id=?,
             pipeline_state=?
           WHERE tenant_id=? AND id=?`,
        )
        .bind(
          json(scanEvidence),
          options.sourceObjectId ?? null,
          errorCount ? "VALIDATION_FAILED" : "STAGED",
          this.actor.tenantId,
          id,
        ),
      this.audit("SETUP_IMPORT_PREVIEWED", "SETUP_IMPORT", id, {
        kind: input.kind,
        rows: rows.length,
        errors: errorCount,
      }),
    ];
    await this.db.batch(statements);
    return this.getImport(id);
  }

  async commitImport(importId: string, idempotencyKey: string, options: { worker?: boolean } = {}) {
    this.require(permissions.setupImport);
    const record = await this.db
      .prepare(
        `SELECT i.branch_id,i.import_kind,i.duplicate_strategy,i.status,i.idempotency_key,i.row_count,
                i.target_mode,i.target_branch_ids_json,i.catalogue_revision,i.expires_at,
                i.verification_json,i.report_json,i.created_by,i.file_checksum,i.scan_status,
                i.scan_evidence_json,i.approved_plan_digest,i.approved_by,i.approved_at,
                i.batch_size,i.publish_status,i.publish_idempotency_key,i.source_object_id,
                o.object_key,o.object_version,
                o.scan_evidence_id,o.status object_status
         FROM setup_imports i
         LEFT JOIN stored_objects o ON o.tenant_id=i.tenant_id AND o.id=i.source_object_id
         WHERE i.tenant_id=? AND i.id=?`,
      )
      .bind(this.actor.tenantId, importId)
      .first<{
        branch_id: string | null;
        import_kind: string;
        duplicate_strategy: string;
        status: string;
        idempotency_key: string;
        row_count: number;
        target_mode: ImportTargetMode;
        target_branch_ids_json: string;
        catalogue_revision: string | null;
        expires_at: string | null;
        verification_json: string;
        report_json: string;
        created_by: string;
        file_checksum: string;
        scan_status: string;
        scan_evidence_json: string;
        approved_plan_digest: string | null;
        approved_by: string | null;
        approved_at: string | null;
        batch_size: number;
        publish_status: string;
        publish_idempotency_key: string | null;
        source_object_id: string | null;
        object_key: string | null;
        object_version: string | null;
        scan_evidence_id: string | null;
        object_status: string | null;
      }>();
    if (!record) throw notFound("Import preview not found");
    const targetBranchIds = parseJson<string[]>(record.target_branch_ids_json, []);
    if (options.worker) {
      await this.assertQueuedImportAuthority(record.created_by, targetBranchIds);
    }
    for (const targetBranchId of targetBranchIds) await this.assertImportBranch(targetBranchId);
    if (record.branch_id && record.import_kind !== "MENU")
      await this.assertBranch(record.branch_id);
    if (idempotencyKey !== `commit:${record.idempotency_key}`) {
      throw validation("Commit idempotency key does not match the preview");
    }
    if (record.status === "COMMITTED") {
      return {
        id: importId,
        duplicate: true,
        queued: false,
        status: "COMMITTED" as const,
        verification: parseJson(record.verification_json, {}),
      };
    }
    const productionLike = resolveRuntimeConfiguration(this.env).productionLike;
    if (
      (productionLike && !record.source_object_id) ||
      !hasValidCleanEvidence(record.file_checksum, record.scan_status, record.scan_evidence_json, {
        ...(record.source_object_id
          ? {
              objectKey: record.object_key,
              objectVersion: record.object_version,
              evidenceId: record.scan_evidence_id,
              objectStatus: record.object_status,
            }
          : {}),
      })
    ) {
      throw invalidTransition(
        "Import preview has no valid file security scan; upload the file again",
      );
    }
    if (record.status !== "VALIDATED" && !(options.worker && record.status === "COMMITTING")) {
      throw validation("Import has validation errors or is already being committed");
    }
    if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) {
      throw invalidTransition("Import preview expired; create a new preview before committing");
    }
    if (record.import_kind === "MENU") {
      const currentRevision = await this.menuCatalogueRevision();
      if (record.catalogue_revision && record.catalogue_revision !== currentRevision) {
        throw invalidTransition(
          "Menu catalogue changed after preview; review a fresh preview before commit",
        );
      }
    }
    // Every menu import uses the same durable path. Approval freezes the exact
    // server-side plan; workers then apply bounded batches without replaying rows.
    if (["MENU", "INVENTORY"].includes(record.import_kind) && !options.worker) {
      const planDigest = await this.importPlanDigest(importId, record.file_checksum);
      if (record.approved_plan_digest && record.approved_plan_digest !== planDigest) {
        throw invalidTransition("Approved import plan no longer matches its staged rows");
      }
      const jobKey = `setup-import-commit:${importId}:0`;
      const jobId = stableId("worker", jobKey);
      const correlationId = crypto.randomUUID();
      const stamp = now();
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE setup_imports SET status='COMMITTING',pipeline_state='COMMITTING',
               approved_plan_digest=?,approved_by=?,approved_at=COALESCE(approved_at,?),
               plan_revision=CASE WHEN approved_plan_digest IS NULL THEN plan_revision+1 ELSE plan_revision END,
               updated_at=?
             WHERE tenant_id=? AND id=? AND status IN ('VALIDATED','COMMITTING')
               AND (approved_plan_digest IS NULL OR approved_plan_digest=?)`,
          )
          .bind(planDigest, this.actor.id, stamp, stamp, this.actor.tenantId, importId, planDigest),
        this.enqueueJobStatement("SETUP_IMPORT_COMMIT", importId, jobKey, correlationId, {
          importId,
          commitKey: idempotencyKey,
          planDigest,
        }),
        this.audit("SETUP_IMPORT_PLAN_APPROVED", "SETUP_IMPORT", importId, {
          rows: record.row_count,
          jobId,
          correlationId,
          planDigest,
        }),
        this.importStateEvent("APPROVED", {
          importId,
          evidence: { planDigest, approvedBy: this.actor.id },
        }),
        this.importStateEvent("COMMITTING", {
          importId,
          evidence: { jobId, batchSize: record.batch_size },
        }),
      ]);
      await this.dispatchWorkerJob(jobId, correlationId);
      return {
        id: importId,
        duplicate: false,
        queued: true,
        status: "QUEUED" as const,
        jobId,
        rows: record.row_count,
      };
    }
    if (
      options.worker &&
      ["MENU", "INVENTORY"].includes(record.import_kind) &&
      (!record.approved_plan_digest ||
        record.approved_plan_digest !==
          (await this.importPlanDigest(importId, record.file_checksum)))
    ) {
      throw invalidTransition("Worker rejected a changed or unapproved import plan");
    }
    if (record.import_kind === "INVENTORY")
      return this.commitInventoryPlan(importId, idempotencyKey, record.row_count);
    const rowLimit =
      record.import_kind === "MENU" ? Math.max(10, Math.min(25, record.batch_size)) : 100000;
    const rows = await this.db
      .prepare(
        `SELECT row_number,row_key,normalized_json,action FROM setup_import_rows
         WHERE tenant_id=? AND import_id=? AND status IN ('VALID','WARNING')
         ORDER BY row_number LIMIT ${rowLimit}`,
      )
      .bind(this.actor.tenantId, importId)
      .all<{ row_number: number; row_key: string; normalized_json: string; action: string }>();
    const statements: D1PreparedStatement[] = [];
    const expectedEntityIds = new Set<string>();
    const expectedBranchSettings = new Set<string>();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of rows.results ?? []) {
      const value = parseJson<Record<string, unknown>>(row.normalized_json, {});
      if (row.action === "SKIP" || row.action === "NO_CHANGE") {
        skipped += 1;
        statements.push(
          this.db
            .prepare(
              `UPDATE setup_import_rows SET status='SKIPPED',committed_entity_type=?,committed_entity_id=?
               WHERE tenant_id=? AND import_id=? AND row_number=?`,
            )
            .bind(
              record.import_kind,
              optionalString(value["existingId"]),
              this.actor.tenantId,
              importId,
              row.row_number,
            ),
        );
        continue;
      }
      const plannedMenuEntityId =
        record.import_kind === "MENU"
          ? stableId("menu", string(value["code"]).toUpperCase())
          : undefined;
      const committed =
        record.import_kind === "MENU"
          ? this.buildMenuStageStatements(
              importId,
              row.row_number,
              row.action,
              value,
              record.approved_plan_digest!,
            )
          : await this.buildImportStatements(
              record.import_kind,
              record.duplicate_strategy,
              record.branch_id,
              value,
              {
                masterAlreadyPlanned: Boolean(
                  plannedMenuEntityId && expectedEntityIds.has(plannedMenuEntityId),
                ),
              },
            );
      expectedEntityIds.add(committed.entityId);
      for (const key of committed.branchSettingKeys ?? []) expectedBranchSettings.add(key);
      if (committed.created) created += 1;
      else if (committed.masterChanged) updated += 1;
      statements.push(...committed.statements);
      statements.push(
        this.db
          .prepare(
            `UPDATE setup_import_rows SET status=?,committed_entity_type=?,committed_entity_id=?
             WHERE tenant_id=? AND import_id=? AND row_number=?`,
          )
          .bind(
            committed.skipped ? "SKIPPED" : "COMMITTED",
            committed.entityType,
            committed.entityId,
            this.actor.tenantId,
            importId,
            row.row_number,
          ),
      );
      if (record.import_kind === "MENU") {
        statements.push(
          this.db
            .prepare(
              `UPDATE setup_import_rows SET materialized_at=?
               WHERE tenant_id=? AND import_id=? AND row_number=?`,
            )
            .bind(now(), this.actor.tenantId, importId, row.row_number),
        );
      }
    }
    const stamp = now();
    statements.push(
      this.db
        .prepare(
          `UPDATE setup_imports SET status='COMMITTING',pipeline_state='COMMITTING',updated_at=?
           WHERE tenant_id=? AND id=? AND status IN ('VALIDATED','COMMITTING')`,
        )
        .bind(stamp, this.actor.tenantId, importId),
      this.audit("SETUP_IMPORT_APPLIED", "SETUP_IMPORT", importId, {
        kind: record.import_kind,
        rows: rows.results?.length ?? 0,
      }),
      this.importStateEvent("COMMITTING", {
        importId,
        evidence: { rows: rows.results?.length ?? 0 },
      }),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      const failedAt = now();
      const failedVerification: NonNullable<ImportPreview["verification"]> = {
        status: "FAILED",
        created: 0,
        updated: 0,
        skipped,
        failed: rows.results?.length ?? 0,
        branchSettings: 0,
        catalogueVerified: false,
        warnings: ["Atomic import commit failed and was rolled back"],
      };
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE setup_imports SET status='FAILED',pipeline_state='COMMIT_FAILED',
               verification_status='FAILED',
               verification_json=?,updated_at=? WHERE tenant_id=? AND id=?`,
          )
          .bind(json(failedVerification), failedAt, this.actor.tenantId, importId),
        this.audit("SETUP_IMPORT_COMMIT_FAILED", "SETUP_IMPORT", importId, {
          kind: record.import_kind,
          errorCode: error instanceof Error ? error.name : "DATABASE_ERROR",
        }),
        this.importStateEvent("COMMIT_FAILED", {
          importId,
          evidence: { errorCode: error instanceof Error ? error.name : "DATABASE_ERROR" },
        }),
      ]);
      throw invalidTransition("Import commit failed; no synchronous changes were committed");
    }
    if (record.import_kind === "MENU") {
      const remaining = await count(
        this.db,
        `SELECT COUNT(*) count FROM setup_import_rows
         WHERE tenant_id=? AND import_id=? AND status IN ('VALID','WARNING')`,
        this.actor.tenantId,
        importId,
      );
      if (remaining > 0) {
        const processed = record.row_count - remaining;
        const nextKey = `setup-import-commit:${importId}:${processed}`;
        const correlationId = crypto.randomUUID();
        await this.db.batch([
          this.enqueueJobStatement("SETUP_IMPORT_COMMIT", importId, nextKey, correlationId, {
            importId,
            commitKey: idempotencyKey,
            planDigest: record.approved_plan_digest,
          }),
          this.audit("SETUP_IMPORT_BATCH_COMMITTED", "SETUP_IMPORT", importId, {
            processed,
            remaining,
            batchSize: rows.results?.length ?? 0,
            correlationId,
          }),
        ]);
        await this.dispatchWorkerJob(stableId("worker", nextKey), correlationId);
        return {
          id: importId,
          duplicate: false,
          queued: true,
          status: "QUEUED" as const,
          jobId: stableId("worker", nextKey),
          rows: rows.results?.length ?? 0,
        };
      }
    }
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE setup_imports SET pipeline_state='VERIFYING',updated_at=? WHERE tenant_id=? AND id=? AND status='COMMITTING'",
        )
        .bind(now(), this.actor.tenantId, importId),
      this.importStateEvent("VERIFYING", { importId, evidence: {} }),
    ]);
    const completion =
      record.import_kind === "MENU"
        ? await this.menuImportCompletionContext(importId)
        : { expectedEntityIds, expectedBranchSettings, created, updated, skipped };
    const verification =
      record.import_kind === "MENU"
        ? await this.verifyStagedMenuImport(
            importId,
            completion.expectedEntityIds,
            completion.expectedBranchSettings,
            {
              created: completion.created,
              updated: completion.updated,
              skipped: completion.skipped,
            },
          )
        : {
            status: "VERIFIED" as const,
            created,
            updated,
            skipped,
            failed: 0,
            branchSettings: 0,
            catalogueVerified: true,
            warnings: [] as string[],
          };
    const committedAt = now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE setup_imports SET status=?,pipeline_state=?,verification_status=?,verification_json=?,
             publish_status=?,committed_at=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status='COMMITTING'`,
        )
        .bind(
          verification.status === "VERIFIED" ? "COMMITTED" : "FAILED",
          verification.status === "VERIFIED" ? "READY_TO_PUBLISH" : "VERIFICATION_FAILED",
          verification.status,
          json(verification),
          verification.status === "VERIFIED" ? "READY" : "FAILED",
          verification.status === "VERIFIED" ? committedAt : null,
          committedAt,
          this.actor.tenantId,
          importId,
        ),
      this.audit(
        verification.status === "VERIFIED"
          ? "SETUP_IMPORT_COMMITTED"
          : "SETUP_IMPORT_VERIFICATION_FAILED",
        "SETUP_IMPORT",
        importId,
        { kind: record.import_kind, ...verification },
      ),
      this.importStateEvent(
        verification.status === "VERIFIED" ? "READY_TO_PUBLISH" : "VERIFICATION_FAILED",
        { importId, evidence: verification },
      ),
    ]);
    if (verification.status !== "VERIFIED") {
      throw invalidTransition("Import data could not be verified in the authoritative catalogue");
    }
    return {
      id: importId,
      duplicate: false,
      queued: false,
      status: "COMMITTED" as const,
      rows: rows.results?.length ?? 0,
      verification,
    };
  }

  private async commitInventoryPlan(importId: string, commitKey: string, rowCount: number) {
    const batch = await this.db
      .prepare(
        `SELECT row_number,action,after_json FROM setup_import_rows
      WHERE tenant_id=? AND import_id=? AND status IN ('VALID','WARNING') ORDER BY row_number LIMIT 20`,
      )
      .bind(this.actor.tenantId, importId)
      .all<{ row_number: number; action: string; after_json: string }>();
    const stamp = now();
    await this.db.batch(
      (batch.results ?? []).map((row) => {
        const value = parseJson<Record<string, unknown>>(row.after_json, {});
        return this.db
          .prepare(
            `UPDATE setup_import_rows SET status=?,committed_entity_type='INVENTORY',committed_entity_id=?,materialized_at=?
        WHERE tenant_id=? AND import_id=? AND row_number=? AND status IN ('VALID','WARNING')`,
          )
          .bind(
            row.action === "SKIP" ? "SKIPPED" : "COMMITTED",
            value.existingId ?? stableId("inventory", string(value.code).toUpperCase()),
            stamp,
            this.actor.tenantId,
            importId,
            row.row_number,
          );
      }),
    );
    const remaining = await count(
      this.db,
      "SELECT COUNT(*) count FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND status IN ('VALID','WARNING')",
      this.actor.tenantId,
      importId,
    );
    if (remaining) {
      const jobKey = `setup-import-commit:${importId}:${rowCount - remaining}`;
      const correlationId = crypto.randomUUID();
      await this.db.batch([
        this.enqueueJobStatement("SETUP_IMPORT_COMMIT", importId, jobKey, correlationId, {
          importId,
          commitKey,
        }),
        this.audit("INVENTORY_IMPORT_BATCH_STAGED", "SETUP_IMPORT", importId, { remaining }),
      ]);
      await this.dispatchWorkerJob(stableId("worker", jobKey), correlationId);
      return { id: importId, duplicate: false, queued: true, status: "QUEUED" as const };
    }
    const totals = await this.db
      .prepare(
        `SELECT COUNT(*) count,
      SUM(CASE WHEN status='COMMITTED' THEN 1 ELSE 0 END) created,
      SUM(CASE WHEN status='SKIPPED' THEN 1 ELSE 0 END) skipped FROM setup_import_rows WHERE tenant_id=? AND import_id=?`,
      )
      .bind(this.actor.tenantId, importId)
      .first<{ count: number; created: number; skipped: number }>();
    if (
      !totals ||
      totals.count !== rowCount ||
      totals.created + totals.skipped !== rowCount ||
      !rowCount
    )
      throw invalidTransition("The complete approved inventory plan was not staged");
    const verification = {
      status: "VERIFIED" as const,
      created: totals.created,
      updated: 0,
      skipped: totals.skipped,
      failed: 0,
      branchSettings: 0,
      catalogueVerified: true,
      warnings: [] as string[],
    };
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE setup_imports SET status='COMMITTED',pipeline_state='READY_TO_PUBLISH',verification_status='VERIFIED',
        verification_json=?,publish_status='READY',committed_at=?,updated_at=? WHERE tenant_id=? AND id=? AND status='COMMITTING'`,
        )
        .bind(json(verification), stamp, stamp, this.actor.tenantId, importId),
      this.audit("INVENTORY_IMPORT_PLAN_VERIFIED", "SETUP_IMPORT", importId, verification),
    ]);
    return {
      id: importId,
      duplicate: false,
      queued: false,
      status: "COMMITTED" as const,
      verification,
    };
  }

  private async publishInventoryPlan(importId: string, publishKey: string, worker: boolean) {
    const record = await this.db
      .prepare(
        `SELECT i.*,o.object_key,o.object_version,o.scan_evidence_id,o.status object_status
      FROM setup_imports i LEFT JOIN stored_objects o ON o.tenant_id=i.tenant_id AND o.id=i.source_object_id
      WHERE i.tenant_id=? AND i.id=? AND i.import_kind='INVENTORY'`,
      )
      .bind(this.actor.tenantId, importId)
      .first<Record<string, unknown>>();
    if (!record || !record.branch_id) throw notFound("Branch inventory import was not found");
    await this.assertImportBranch(string(record.branch_id));
    if (worker) {
      await this.assertQueuedImportAuthority(string(record.created_by), [string(record.branch_id)]);
      await this.assertQueuedImportAuthority(string(record.approved_by), [
        string(record.branch_id),
      ]);
    }
    const digest = string(record.approved_plan_digest);
    if (
      !digest ||
      publishKey !== `publish:${digest}` ||
      digest !== (await this.importPlanDigest(importId, string(record.file_checksum)))
    )
      throw invalidTransition("Publication does not match the approved immutable inventory plan");
    if (record.publish_status === "PUBLISHED")
      return { id: importId, duplicate: true, queued: false, status: "PUBLISHED" as const };
    if (
      record.status !== "COMMITTED" ||
      record.verification_status !== "VERIFIED" ||
      !["READY", "PUBLISHING"].includes(string(record.publish_status))
    )
      throw invalidTransition("Inventory import is not fully verified for publication");
    if (
      !hasValidCleanEvidence(
        string(record.file_checksum),
        string(record.scan_status),
        string(record.scan_evidence_json),
        record.source_object_id
          ? {
              objectKey: string(record.object_key),
              objectVersion: string(record.object_version),
              evidenceId: string(record.scan_evidence_id),
              objectStatus: string(record.object_status),
            }
          : {},
      )
    )
      throw invalidTransition(
        "Inventory publication requires matching authenticated CLEAN evidence",
      );
    if (resolveRuntimeConfiguration(this.env).productionLike && !record.source_object_id)
      throw invalidTransition("Quarantined source object is required");
    const stamp = now();
    if (!worker) {
      const jobKey = `setup-import-publish:${importId}:0`;
      const correlationId = crypto.randomUUID();
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE setup_imports SET publish_status='PUBLISHING',pipeline_state='PUBLISHING',publish_idempotency_key=?,updated_at=?
          WHERE tenant_id=? AND id=? AND publish_status IN ('READY','PUBLISHING') AND (publish_idempotency_key IS NULL OR publish_idempotency_key=?)`,
          )
          .bind(publishKey, stamp, this.actor.tenantId, importId, publishKey),
        this.enqueueJobStatement("SETUP_IMPORT_PUBLISH", importId, jobKey, correlationId, {
          importId,
          publishKey,
        }),
        this.audit("INVENTORY_IMPORT_PUBLISH_APPROVED", "SETUP_IMPORT", importId, {
          digest,
          correlationId,
        }),
      ]);
      await this.dispatchWorkerJob(stableId("worker", jobKey), correlationId);
      return { id: importId, duplicate: false, queued: true, status: "PUBLISHING" as const };
    }
    if (record.publish_status !== "PUBLISHING")
      throw invalidTransition("Inventory publication is not authorized");
    // Verification work is bounded. The final set-based insert and visibility change share
    // one database transaction, so partially published stock masters cannot become live.
    const pending = await this.db
      .prepare(
        `SELECT row_number FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND status='COMMITTED'
      AND publication_verified_at IS NULL ORDER BY row_number LIMIT 20`,
      )
      .bind(this.actor.tenantId, importId)
      .all<{ row_number: number }>();
    if (pending.results?.length)
      await this.db.batch(
        pending.results.map((row) =>
          this.db
            .prepare(
              `UPDATE setup_import_rows SET publication_verified_at=?
      WHERE tenant_id=? AND import_id=? AND row_number=? AND status='COMMITTED'`,
            )
            .bind(stamp, this.actor.tenantId, importId, row.row_number),
        ),
      );
    const left = await count(
      this.db,
      "SELECT COUNT(*) count FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND status='COMMITTED' AND publication_verified_at IS NULL",
      this.actor.tenantId,
      importId,
    );
    if (left) {
      const jobKey = `setup-import-publish:${importId}:${Number(record.row_count) - left}`;
      const correlationId = crypto.randomUUID();
      await this.db.batch([
        this.enqueueJobStatement("SETUP_IMPORT_PUBLISH", importId, jobKey, correlationId, {
          importId,
          publishKey,
        }),
      ]);
      await this.dispatchWorkerJob(stableId("worker", jobKey), correlationId);
      return { id: importId, duplicate: false, queued: true, status: "PUBLISHING" as const };
    }
    const approvedRows = await count(
      this.db,
      "SELECT COUNT(*) count FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND status IN ('COMMITTED','SKIPPED')",
      this.actor.tenantId,
      importId,
    );
    if (!approvedRows || approvedRows !== Number(record.row_count))
      throw invalidTransition("Inventory publication is incomplete");
    const results = await this.db.batch([
      // Lock the authoritative import before examining its current publication state.
      this.db
        .prepare(
          "UPDATE setup_imports SET updated_at=? WHERE tenant_id=? AND id=? AND publish_status='PUBLISHING'",
        )
        .bind(stamp, this.actor.tenantId, importId),
      ...["base", "purchase"].map((unit) =>
        this.db
          .prepare(
            `INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,active,created_at,updated_at)
        SELECT r.tenant_id,json_extract(r.after_json,'$.${unit}UnitId'),json_extract(r.after_json,'$.${unit}UnitCode'),
          json_extract(r.after_json,'$.${unit}UnitCode'),json_extract(r.after_json,'$.${unit}UnitCode'),json_extract(r.after_json,'$.dimension'),1,?,?
        FROM setup_import_rows r JOIN setup_imports i ON i.tenant_id=r.tenant_id AND i.id=r.import_id
        WHERE r.tenant_id=? AND r.import_id=? AND r.status='COMMITTED' AND i.publish_status='PUBLISHING'
        ON CONFLICT(tenant_id,code) DO NOTHING`,
          )
          .bind(stamp, stamp, this.actor.tenantId, importId),
      ),
      this.db
        .prepare(
          `INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json,code,description,base_unit_id,purchase_unit_id,
        storage_unit_id,issue_unit_id,track_inventory,track_expiry,default_warehouse_id,barcode,category_id,updated_at)
        SELECT r.tenant_id,r.committed_entity_id,UPPER(json_extract(r.after_json,'$.code')),json_extract(r.after_json,'$.name'),
          json_extract(r.after_json,'$.baseUnitCode'),1,?,UPPER(json_extract(r.after_json,'$.code')),json_extract(r.after_json,'$.description'),
          json_extract(r.after_json,'$.baseUnitId'),json_extract(r.after_json,'$.purchaseUnitId'),json_extract(r.after_json,'$.baseUnitId'),json_extract(r.after_json,'$.baseUnitId'),
          1,CASE WHEN CAST(json_extract(r.after_json,'$.trackExpiry') AS TEXT) IN ('1','true') THEN 1 ELSE 0 END,
          json_extract(r.after_json,'$.warehouseId'),json_extract(r.after_json,'$.barcode'),json_extract(r.after_json,'$.categoryId'),?
        FROM setup_import_rows r JOIN setup_imports i ON i.tenant_id=r.tenant_id AND i.id=r.import_id
        WHERE r.tenant_id=? AND r.import_id=? AND r.status='COMMITTED' AND i.publish_status='PUBLISHING'`,
        )
        .bind(json({ imported: true, importId }), stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `INSERT INTO item_unit_conversions (tenant_id,id,inventory_item_id,from_unit_id,to_unit_id,factor_numerator,factor_denominator,effective_from,created_at)
        SELECT r.tenant_id,r.committed_entity_id || ':purchase',r.committed_entity_id,json_extract(r.after_json,'$.purchaseUnitId'),
          json_extract(r.after_json,'$.baseUnitId'),CAST(json_extract(r.after_json,'$.factorNumerator') AS INTEGER),CAST(json_extract(r.after_json,'$.factorDenominator') AS INTEGER),'1970-01-01',?
        FROM setup_import_rows r JOIN setup_imports i ON i.tenant_id=r.tenant_id AND i.id=r.import_id
        WHERE r.tenant_id=? AND r.import_id=? AND r.status='COMMITTED' AND i.publish_status='PUBLISHING'
          AND json_extract(r.after_json,'$.purchaseUnitId')<>json_extract(r.after_json,'$.baseUnitId')`,
        )
        .bind(stamp, this.actor.tenantId, importId),
      // The existing publication trigger aborts the entire batch if even one created
      // item or required reference cannot be independently verified here.
      this.db
        .prepare(
          `UPDATE setup_import_rows SET publication_verified_at=CASE WHEN EXISTS (
        SELECT 1 FROM inventory_items m JOIN warehouses w ON w.tenant_id=m.tenant_id AND w.id=m.default_warehouse_id AND w.active=1
        JOIN unit_definitions u ON u.tenant_id=m.tenant_id AND u.id=m.base_unit_id AND u.active=1
        JOIN unit_definitions p ON p.tenant_id=m.tenant_id AND p.id=m.purchase_unit_id AND p.active=1
        JOIN inventory_categories c ON c.tenant_id=m.tenant_id AND c.id=m.category_id AND c.active=1
        WHERE m.tenant_id=setup_import_rows.tenant_id AND m.id=setup_import_rows.committed_entity_id AND m.active=1
        AND m.name=json_extract(setup_import_rows.after_json,'$.name') AND m.sku=UPPER(json_extract(setup_import_rows.after_json,'$.code'))
        AND w.branch_id=? AND w.id=json_extract(setup_import_rows.after_json,'$.warehouseId')
        AND u.id=json_extract(setup_import_rows.after_json,'$.baseUnitId') AND c.id=json_extract(setup_import_rows.after_json,'$.categoryId')
        AND p.id=json_extract(setup_import_rows.after_json,'$.purchaseUnitId') AND u.dimension=json_extract(setup_import_rows.after_json,'$.dimension') AND p.dimension=u.dimension
        AND (p.id=u.id OR EXISTS (SELECT 1 FROM item_unit_conversions v WHERE v.tenant_id=m.tenant_id AND v.inventory_item_id=m.id
          AND v.from_unit_id=p.id AND v.to_unit_id=u.id AND v.factor_numerator=CAST(json_extract(setup_import_rows.after_json,'$.factorNumerator') AS INTEGER)
          AND v.factor_denominator=CAST(json_extract(setup_import_rows.after_json,'$.factorDenominator') AS INTEGER)))
      ) THEN ? ELSE NULL END,published_at=? WHERE tenant_id=? AND import_id=? AND status='COMMITTED'
        AND EXISTS (SELECT 1 FROM setup_imports i WHERE i.tenant_id=setup_import_rows.tenant_id
          AND i.id=setup_import_rows.import_id AND i.publish_status='PUBLISHING')`,
        )
        .bind(record.branch_id, stamp, stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `UPDATE setup_imports SET publish_status='PUBLISHED',pipeline_state='PUBLISHED',published_at=?,updated_at=?
        WHERE tenant_id=? AND id=? AND publish_status='PUBLISHING'`,
        )
        .bind(stamp, stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
        VALUES (?,?,?,?,'INVENTORY_IMPORT_PUBLISHED','SETUP_IMPORT',?,'Explicit approved publication',?,'{}',?) ON CONFLICT(tenant_id,id) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          `inventory-publish:${importId}`,
          record.branch_id,
          this.actor.id,
          importId,
          importId,
          stamp,
        ),
    ]);
    return {
      id: importId,
      duplicate: (results[0]?.meta?.changes ?? 0) === 0,
      queued: false,
      status: "PUBLISHED" as const,
    };
  }

  async publishImport(
    importId: string,
    idempotencyKey: string,
    options: { worker?: boolean } = {},
  ) {
    this.require(permissions.setupImport);
    const kind = await this.db
      .prepare("SELECT import_kind FROM setup_imports WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, importId)
      .first<{ import_kind: string }>();
    if (kind?.import_kind === "INVENTORY")
      return this.publishInventoryPlan(importId, idempotencyKey, options.worker === true);
    const record = await this.db
      .prepare(
        `SELECT status,verification_status,approved_plan_digest,publish_status,catalogue_revision,
                publish_idempotency_key,duplicate_strategy,target_branch_ids_json,created_by,
                batch_size
         FROM setup_imports WHERE tenant_id=? AND id=? AND import_kind='MENU'`,
      )
      .bind(this.actor.tenantId, importId)
      .first<{
        status: string;
        verification_status: string;
        approved_plan_digest: string | null;
        catalogue_revision: string | null;
        publish_status: string;
        publish_idempotency_key: string | null;
        duplicate_strategy: string;
        target_branch_ids_json: string;
        created_by: string;
        batch_size: number;
      }>();
    if (!record) throw notFound("Menu import not found");
    const branchIds = parseJson<string[]>(record.target_branch_ids_json, []);
    if (options.worker) await this.assertQueuedImportAuthority(record.created_by, branchIds);
    for (const branchId of branchIds) await this.assertImportBranch(branchId);
    if (!record.approved_plan_digest || record.verification_status !== "VERIFIED") {
      throw invalidTransition("Menu import plan is not approved and verified for publication");
    }
    const expectedKey = `publish:${record.approved_plan_digest}`;
    if (idempotencyKey !== expectedKey) {
      throw validation("Publish idempotency key does not match the approved import plan");
    }
    if (record.publish_status === "PUBLISHED") {
      return { id: importId, duplicate: true, queued: false, status: "PUBLISHED" as const };
    }
    if (record.publish_idempotency_key && record.publish_idempotency_key !== idempotencyKey) {
      throw invalidTransition("Menu import publication identity has already been assigned");
    }
    if (!options.worker) {
      if (
        record.status !== "COMMITTED" ||
        !["READY", "PUBLISHING"].includes(record.publish_status)
      ) {
        throw invalidTransition("Menu import is not ready to publish");
      }
      const key = `setup-import-publish:${importId}:0`;
      const correlationId = crypto.randomUUID();
      const stamp = now();
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE setup_imports SET publish_status='PUBLISHING',pipeline_state='PUBLISHING',
               publish_idempotency_key=?,updated_at=?
             WHERE tenant_id=? AND id=? AND publish_status IN ('READY','PUBLISHING')`,
          )
          .bind(idempotencyKey, stamp, this.actor.tenantId, importId),
        this.enqueueJobStatement("SETUP_IMPORT_PUBLISH", importId, key, correlationId, {
          importId,
          publishKey: idempotencyKey,
          planDigest: record.approved_plan_digest,
        }),
        this.audit("SETUP_IMPORT_PUBLISH_QUEUED", "SETUP_IMPORT", importId, {
          correlationId,
          planDigest: record.approved_plan_digest,
        }),
        this.importStateEvent("PUBLISHING", {
          importId,
          evidence: { planDigest: record.approved_plan_digest },
        }),
      ]);
      await this.dispatchWorkerJob(stableId("worker", key), correlationId);
      return {
        id: importId,
        duplicate: false,
        queued: true,
        status: "PUBLISHING" as const,
        jobId: stableId("worker", key),
      };
    }
    if (record.publish_status !== "PUBLISHING") {
      throw invalidTransition("Menu import publication is not active");
    }

    const rowLimit = Math.max(10, Math.min(25, record.batch_size));
    const rows = await this.db
      .prepare(
        `SELECT row_number,committed_entity_id
         FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND status='COMMITTED'
           AND publication_verified_at IS NULL ORDER BY row_number LIMIT ${rowLimit}`,
      )
      .bind(this.actor.tenantId, importId)
      .all<{
        row_number: number;
        committed_entity_id: string;
      }>();
    const statements: D1PreparedStatement[] = [];
    for (const row of rows.results ?? []) {
      const staged = await count(
        this.db,
        `SELECT COUNT(*) count FROM menu_import_staged_items
         WHERE tenant_id=? AND import_id=? AND menu_item_id=? AND plan_digest=?`,
        this.actor.tenantId,
        importId,
        row.committed_entity_id,
        record.approved_plan_digest,
      );
      if (staged !== 1) {
        throw invalidTransition("Approved menu import plan changed before publication");
      }
      statements.push(
        this.db
          .prepare(
            `UPDATE setup_import_rows SET publication_verified_at=?
             WHERE tenant_id=? AND import_id=? AND row_number=?
               AND publication_verified_at IS NULL`,
          )
          .bind(now(), this.actor.tenantId, importId, row.row_number),
      );
    }
    if (statements.length) await this.db.batch(statements);

    const remaining = await count(
      this.db,
      `SELECT COUNT(*) count FROM setup_import_rows
       WHERE tenant_id=? AND import_id=? AND status='COMMITTED'
         AND publication_verified_at IS NULL`,
      this.actor.tenantId,
      importId,
    );
    if (remaining > 0) {
      const published = await count(
        this.db,
        `SELECT COUNT(*) count FROM setup_import_rows
         WHERE tenant_id=? AND import_id=? AND publication_verified_at IS NOT NULL`,
        this.actor.tenantId,
        importId,
      );
      const key = `setup-import-publish:${importId}:${published}`;
      const correlationId = crypto.randomUUID();
      await this.db.batch([
        this.enqueueJobStatement("SETUP_IMPORT_PUBLISH", importId, key, correlationId, {
          importId,
          publishKey: idempotencyKey,
          planDigest: record.approved_plan_digest,
        }),
        this.audit("SETUP_IMPORT_PUBLISH_BATCH_COMPLETED", "SETUP_IMPORT", importId, {
          published,
          remaining,
          correlationId,
        }),
      ]);
      await this.dispatchWorkerJob(stableId("worker", key), correlationId);
      return {
        id: importId,
        duplicate: false,
        queued: true,
        status: "PUBLISHING" as const,
        jobId: stableId("worker", key),
      };
    }

    const completion = await this.menuImportCompletionContext(importId);
    const approvedPlanRows = await count(
      this.db,
      `SELECT COUNT(*) count FROM setup_import_rows
       WHERE tenant_id=? AND import_id=? AND status='COMMITTED'`,
      this.actor.tenantId,
      importId,
    );
    const verifiedCommittedRows = await count(
      this.db,
      `SELECT COUNT(*) count FROM setup_import_rows
       WHERE tenant_id=? AND import_id=? AND status='COMMITTED'
         AND publication_verified_at IS NOT NULL`,
      this.actor.tenantId,
      importId,
    );
    const stagedVerification = await this.verifyStagedMenuImport(
      importId,
      completion.expectedEntityIds,
      completion.expectedBranchSettings,
      {
        created: completion.created,
        updated: completion.updated,
        skipped: completion.skipped,
      },
    );
    const publicationInvariant = {
      ...stagedVerification,
      approvedPlanRows,
      verifiedCommittedRows,
      requiredBranchActivations: completion.expectedBranchSettings.size,
      verifiedBranchActivations: stagedVerification.branchSettings,
    };
    const currentCatalogueRevision = await this.menuCatalogueRevision();
    const catalogueRevisionVerified =
      !record.catalogue_revision || record.catalogue_revision === currentCatalogueRevision;
    const publicationEvidence = {
      ...publicationInvariant,
      status:
        stagedVerification.status === "VERIFIED" && catalogueRevisionVerified
          ? "VERIFIED"
          : "FAILED",
      catalogueRevisionVerified,
      expectedCatalogueRevision: record.catalogue_revision,
      currentCatalogueRevision,
      warnings: [
        ...stagedVerification.warnings,
        ...(catalogueRevisionVerified
          ? []
          : ["The live menu catalogue changed after this import was approved"]),
      ],
    };
    const stamp = now();
    if (
      stagedVerification.status !== "VERIFIED" ||
      approvedPlanRows !== verifiedCommittedRows ||
      stagedVerification.branchSettings !== completion.expectedBranchSettings.size ||
      !catalogueRevisionVerified
    ) {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE setup_imports SET publish_status='FAILED',pipeline_state='VERIFICATION_FAILED',
             verification_status='FAILED',
             verification_json=?,updated_at=? WHERE tenant_id=? AND id=?`,
          )
          .bind(json(publicationEvidence), stamp, this.actor.tenantId, importId),
        this.audit("SETUP_IMPORT_PUBLICATION_REJECTED", "SETUP_IMPORT", importId, {
          catalogueRevisionVerified,
          approvedPlanRows,
          verifiedCommittedRows,
        }),
        this.importStateEvent("VERIFICATION_FAILED", {
          importId,
          evidence: publicationEvidence,
        }),
      ]);
      throw invalidTransition("Complete menu import plan could not be verified for publication");
    }
    await this.db.batch([
      ...this.publishMenuPlanStatements(importId, stamp),
      this.db
        .prepare(
          `UPDATE setup_import_rows SET published_at=?
           WHERE tenant_id=? AND import_id=? AND status='COMMITTED'
             AND publication_verified_at IS NOT NULL`,
        )
        .bind(stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `UPDATE setup_imports SET publish_status='PUBLISHED',pipeline_state='PUBLISHED',
             published_at=?,verification_json=?,updated_at=?
           WHERE tenant_id=? AND id=? AND publish_status='PUBLISHING'`,
        )
        .bind(stamp, json(publicationEvidence), stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `INSERT INTO realtime_events
            (tenant_id,id,branch_id,topic,entity_type,entity_id,event_type,correlation_id,
             payload_json,created_at,expires_at)
           VALUES (?,?,NULL,'menu','SETUP_IMPORT',?,'MENU_IMPORT_PUBLISHED',?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          importId,
          crypto.randomUUID(),
          json({ importId, branchIds }),
          stamp,
          new Date(Date.parse(stamp) + 24 * 60 * 60 * 1000).toISOString(),
        ),
      this.audit("SETUP_IMPORT_PUBLISHED", "SETUP_IMPORT", importId, publicationInvariant),
      this.importStateEvent("PUBLISHED", {
        importId,
        evidence: publicationInvariant,
      }),
    ]);
    const verification = await this.verifyMenuImport(
      completion.expectedEntityIds,
      completion.expectedBranchSettings,
      {
        created: completion.created,
        updated: completion.updated,
        skipped: completion.skipped,
      },
    );
    if (verification.status !== "VERIFIED") {
      throw invalidTransition("Published menu failed authoritative post-write verification");
    }
    return {
      id: importId,
      duplicate: false,
      queued: false,
      status: "PUBLISHED" as const,
      verification,
    };
  }

  /** Existing previews are recoverable by authorized users; never re-upload just to inspect. */
  async recentMenuImports() {
    this.require(permissions.setupImport);
    const results = await this.db
      .prepare(
        `SELECT id,original_name,status,row_count,template_version,duplicate_strategy,
                target_branch_ids_json,created_at,updated_at
         FROM setup_imports WHERE tenant_id=? AND import_kind='MENU'
         ORDER BY created_at DESC LIMIT 20`,
      )
      .bind(this.actor.tenantId)
      .all<{
        id: string;
        original_name: string;
        status: ImportPreview["status"];
        row_count: number;
        template_version: number;
        duplicate_strategy: ImportPreview["duplicateStrategy"];
        target_branch_ids_json: string;
        created_at: string;
        updated_at: string;
      }>();
    return (results.results ?? [])
      .filter((record) => {
        const branches = parseJson<string[]>(record.target_branch_ids_json, []);
        return branches.length
          ? branches.every((branchId) => this.canReadBranch(branchId))
          : this.actor.branchScope.type === "ALL";
      })
      .map((record) => ({
        id: record.id,
        originalName: record.original_name,
        status: record.status,
        rowCount: record.row_count,
        templateVersion: record.template_version,
        duplicateStrategy: record.duplicate_strategy,
        targetBranchIds: parseJson<string[]>(record.target_branch_ids_json, []),
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      }));
  }

  /** Read-only inspection of an existing import; never replays a commit. */
  async inspectImport(importId: string) {
    this.require(permissions.setupImport);
    const preview = await this.getImport(importId);
    for (const id of preview.targetBranchIds ?? []) await this.assertImportBranch(id);
    return preview;
  }

  /** Cheap polling response, tenant-scoped and guarded by the import permission. */
  async importStatus(importId: string) {
    this.require(permissions.setupImport);
    const record = await this.db
      .prepare(
        `SELECT status,row_count,verification_json,updated_at,target_branch_ids_json,publish_status,
                published_at
         FROM setup_imports WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, importId)
      .first<{
        status: ImportPreview["status"];
        row_count: number;
        verification_json: string;
        updated_at: string;
        target_branch_ids_json: string;
        publish_status: ImportPreview["publishStatus"];
        published_at: string | null;
      }>();
    if (!record) throw notFound("Import not found");
    for (const id of parseJson<string[]>(record.target_branch_ids_json, [])) {
      await this.assertImportBranch(id);
    }
    const worker = await this.db
      .prepare(
        `SELECT status,attempt_count,updated_at FROM worker_jobs
         WHERE tenant_id=? AND idempotency_key LIKE ?
           AND job_type IN ('SETUP_IMPORT_COMMIT','SETUP_IMPORT_PUBLISH')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, `setup-import-%:${importId}:%`)
      .first<{ status: string; attempt_count: number; updated_at: string }>();
    const counts = await this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status='COMMITTED' AND action='UPDATE' THEN 1 ELSE 0 END),0) updated,
          COALESCE(SUM(CASE WHEN status='COMMITTED' AND action<>'UPDATE' THEN 1 ELSE 0 END),0) created,
          COALESCE(SUM(CASE WHEN status='SKIPPED' THEN 1 ELSE 0 END),0) skipped,
          COALESCE(SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END),0) failed,
          COALESCE(SUM(CASE WHEN status IN ('WAITING_FOR_REVIEW','REVIEW_REQUIRED')
            THEN 1 ELSE 0 END),0) needs_review
         FROM setup_import_rows WHERE tenant_id=? AND import_id=?`,
      )
      .bind(this.actor.tenantId, importId)
      .first<{
        created: number;
        updated: number;
        skipped: number;
        failed: number;
        needs_review: number;
      }>();
    const verification = parseJson<ImportPreview["verification"]>(
      record.verification_json,
      undefined,
    );
    const created = number(counts?.created);
    const updated = number(counts?.updated);
    const skipped = number(counts?.skipped);
    const failed = number(counts?.failed);
    const needsReview = number(counts?.needs_review);
    const processed = created + updated + skipped + failed;
    return {
      id: importId,
      status: record.status,
      rowCount: record.row_count,
      updatedAt: record.updated_at,
      publishStatus: record.publish_status,
      publishedAt: record.published_at,
      verification,
      progress: {
        total: record.row_count,
        created,
        updated,
        skipped,
        failed,
        needsReview,
        pending: Math.max(0, record.row_count - processed - needsReview),
        processed,
        revision: processed,
        verified: verification?.status === "VERIFIED" && record.status === "COMMITTED",
      },
      worker: worker
        ? { status: worker.status, attempts: worker.attempt_count, updatedAt: worker.updated_at }
        : null,
    };
  }

  async importPreparationStatus(jobId: string) {
    this.require(permissions.setupImport);
    const job = await this.db
      .prepare(
        `SELECT id,status,attempt_count,last_error,result_json,updated_at
         FROM worker_jobs WHERE tenant_id=? AND id=? AND job_type='SETUP_IMPORT_PREPARE'`,
      )
      .bind(this.actor.tenantId, jobId)
      .first<{
        id: string;
        status: string;
        attempt_count: number;
        last_error: string | null;
        result_json: string;
        updated_at: string;
      }>();
    if (!job) throw notFound("Import preparation job not found");
    return {
      id: job.id,
      status: job.status,
      attempts: job.attempt_count,
      updatedAt: job.updated_at,
      ...(job.status === "SUCCEEDED" ? { result: parseJson(job.result_json, {}) } : {}),
      ...(job.status === "FAILED" || job.status === "DEAD_LETTER"
        ? { error: "File preparation failed; the quarantined file was not parsed" }
        : {}),
    };
  }

  async createOpeningStock(input: OpeningStockInput) {
    this.require(permissions.setupOpeningStock);
    await this.assertBranch(input.branchId);
    const warehouse = await this.db
      .prepare("SELECT id FROM warehouses WHERE tenant_id=? AND id=? AND branch_id=? AND active=1")
      .bind(this.actor.tenantId, input.warehouseId, input.branchId)
      .first();
    if (!warehouse) throw validation("Warehouse does not belong to the selected branch");
    const existing = await this.db
      .prepare(
        "SELECT id,status FROM opening_stock_batches WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; status: string }>();
    if (existing) return { ...existing, duplicate: true };
    const ids = new Set(input.lines.map((line) => line.inventoryItemId));
    if (ids.size !== input.lines.length) throw validation("Opening stock contains duplicate items");
    const batchId = crypto.randomUUID();
    const stamp = now();
    const statements: D1PreparedStatement[] = [];
    let totalValueMinor = 0;
    for (const line of input.lines) {
      const normalized = await this.normalizeOpeningStockLine(line);
      const totalCostMinor = multiplyMicroCost(normalized.baseQuantityMicro, line.unitCostMinor);
      totalValueMinor += totalCostMinor;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO opening_stock_lines
              (tenant_id,batch_id,id,inventory_item_id,unit_id,quantity_micro,base_quantity_micro,
               unit_cost_minor,total_cost_minor)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            batchId,
            crypto.randomUUID(),
            line.inventoryItemId,
            line.unitId,
            line.quantityMicro,
            normalized.baseQuantityMicro,
            line.unitCostMinor,
            totalCostMinor,
          ),
      );
    }
    statements.unshift(
      this.db
        .prepare(
          `INSERT INTO opening_stock_batches
            (tenant_id,id,branch_id,warehouse_id,business_date,currency,status,total_value_minor,
             idempotency_key,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,'REVIEW',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          batchId,
          input.branchId,
          input.warehouseId,
          input.businessDate,
          input.currency,
          totalValueMinor,
          input.idempotencyKey,
          this.actor.id,
          stamp,
          stamp,
        ),
    );
    statements.push(
      this.audit("OPENING_STOCK_PREPARED", "OPENING_STOCK", batchId, { totalValueMinor }),
    );
    await this.db.batch(statements);
    return { id: batchId, status: "REVIEW", totalValueMinor, duplicate: false };
  }

  async approveOpeningStock(batchId: string, reason: string) {
    this.require(permissions.setupOpeningStockApprove);
    if (reason.trim().length < 8) throw validation("Approval reason is required");
    const result = await this.db
      .prepare(
        `UPDATE opening_stock_batches SET status='APPROVED',approved_by=?,approved_at=?,approval_reason=?,updated_at=?
         WHERE tenant_id=? AND id=? AND status='REVIEW'`,
      )
      .bind(this.actor.id, now(), clean(reason), now(), this.actor.tenantId, batchId)
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      throw validation("Opening stock is not awaiting approval");
    await this.db.batch([this.audit("OPENING_STOCK_APPROVED", "OPENING_STOCK", batchId, {})]);
    return { id: batchId, status: "APPROVED" };
  }

  async postOpeningStock(batchId: string) {
    this.require(permissions.setupOpeningStockApprove);
    const batch = await this.db
      .prepare(
        `SELECT branch_id,warehouse_id,business_date,status FROM opening_stock_batches
         WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, batchId)
      .first<{ branch_id: string; warehouse_id: string; business_date: string; status: string }>();
    if (!batch) throw notFound("Opening stock batch not found");
    await this.assertBranch(batch.branch_id);
    if (batch.status === "POSTED") return { id: batchId, status: "POSTED", duplicate: true };
    if (batch.status !== "APPROVED")
      throw validation("Opening stock must be approved before posting");
    const lines = await this.db
      .prepare(
        `SELECT id,inventory_item_id,base_quantity_micro,unit_cost_minor,total_cost_minor
         FROM opening_stock_lines WHERE tenant_id=? AND batch_id=?`,
      )
      .bind(this.actor.tenantId, batchId)
      .all<{
        id: string;
        inventory_item_id: string;
        base_quantity_micro: number;
        unit_cost_minor: number;
        total_cost_minor: number;
      }>();
    const stamp = now();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    for (const line of lines.results ?? []) {
      const movementId = stableId("opening-movement", `${batchId}:${line.id}`);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_movements
              (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,source_type,
               source_id,idempotency_key,correlation_id,payload_json,created_at,unit_cost_minor,
               total_cost_minor,business_date,occurred_at,actor_id,reason,negative_override)
             VALUES (?,?,?,?,?,'OPENING',?,'OPENING_STOCK',?,?,?,?,?,?,?,?,?,?,?,0)
             ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
          )
          .bind(
            this.actor.tenantId,
            movementId,
            batch.branch_id,
            batch.warehouse_id,
            line.inventory_item_id,
            line.base_quantity_micro,
            batchId,
            `opening-stock:${batchId}:${line.id}`,
            correlationId,
            json({ setup: true }),
            stamp,
            line.unit_cost_minor,
            line.total_cost_minor,
            batch.business_date,
            stamp,
            this.actor.id,
            "Approved opening stock",
          ),
        this.db
          .prepare("UPDATE opening_stock_lines SET movement_id=? WHERE tenant_id=? AND id=?")
          .bind(movementId, this.actor.tenantId, line.id),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE opening_stock_batches SET status='POSTED',posted_at=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status='APPROVED'`,
        )
        .bind(stamp, stamp, this.actor.tenantId, batchId),
      this.audit("OPENING_STOCK_POSTED", "OPENING_STOCK", batchId, {
        movements: lines.results?.length ?? 0,
        correlationId,
      }),
    );
    await this.db.batch(statements);
    return {
      id: batchId,
      status: "POSTED",
      duplicate: false,
      movements: lines.results?.length ?? 0,
    };
  }

  async validateRecipes(): Promise<{ quality: string; issues: RecipeValidationIssue[] }> {
    this.require(permissions.setupView);
    const issues: RecipeValidationIssue[] = [];
    const inventory = new InventoryIntelligenceService(this.db, this.actor);
    const menu = await this.db
      .prepare(
        "SELECT id,name,selling_price_minor,recipe_reference FROM menu_catalog_items WHERE tenant_id=? AND active=1",
      )
      .bind(this.actor.tenantId)
      .all<{
        id: string;
        name: string;
        selling_price_minor: number;
        recipe_reference: string | null;
      }>();
    for (const item of menu.results ?? []) {
      const recipe = await this.db
        .prepare(
          `SELECT r.id,r.current_version_id,rv.yield_quantity_minor
           FROM recipes r LEFT JOIN recipe_versions rv
             ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id
           WHERE r.tenant_id=? AND r.menu_item_id=? AND r.active=1`,
        )
        .bind(this.actor.tenantId, item.id)
        .first<{
          id: string;
          current_version_id: string | null;
          yield_quantity_minor: number | null;
        }>();
      if (!recipe) {
        issues.push(
          issue(
            "MISSING_RECIPE",
            "CRITICAL",
            `${item.name} has no active recipe`,
            { menuItemId: item.id },
            item.id,
          ),
        );
        continue;
      }
      if (!recipe.current_version_id || !recipe.yield_quantity_minor) {
        issues.push(
          issue(
            "MISSING_RECIPE_YIELD",
            "CRITICAL",
            `${item.name} has no valid recipe yield`,
            { recipeId: recipe.id },
            item.id,
            recipe.id,
          ),
        );
      }
      let totalCostMinor: number | null = null;
      if (recipe.current_version_id) {
        try {
          totalCostMinor = await inventory.recipeCostMinor(recipe.current_version_id);
        } catch {
          totalCostMinor = null;
        }
      }
      if (totalCostMinor === null) {
        issues.push(
          issue(
            "MISSING_RECIPE_COST",
            "WARNING",
            `${item.name} recipe cost is unavailable`,
            { recipeId: recipe.id },
            item.id,
            recipe.id,
          ),
        );
      } else if (totalCostMinor > item.selling_price_minor) {
        issues.push(
          issue(
            "MENU_PRICE_BELOW_COST",
            "WARNING",
            `${item.name} selling price is below recipe cost`,
            { priceMinor: item.selling_price_minor, costMinor: totalCostMinor },
            item.id,
            recipe.id,
          ),
        );
      }
    }
    const invalidConversions = await this.db
      .prepare(
        `SELECT id,inventory_item_id FROM item_unit_conversions
         WHERE tenant_id=? AND (factor_numerator<=0 OR factor_denominator<=0 OR from_unit_id=to_unit_id AND factor_numerator<>factor_denominator)`,
      )
      .bind(this.actor.tenantId)
      .all<{ id: string; inventory_item_id: string }>();
    for (const conversion of invalidConversions.results ?? []) {
      issues.push(
        issue("INVALID_UOM_CONVERSION", "CRITICAL", "An item conversion is invalid", conversion),
      );
    }
    const cycles = await this.detectRecipeCycles();
    for (const cycle of cycles)
      issues.push(
        issue("RECIPE_CYCLE", "CRITICAL", "Recipe dependency cycle detected", { path: cycle }),
      );
    return {
      quality: issues.some((row) => row.severity === "CRITICAL")
        ? "LOW"
        : issues.length
          ? "MEDIUM"
          : "HIGH",
      issues,
    };
  }

  async configureAccountMapping(input: AccountingMappingInput) {
    this.require(permissions.setupAccountingManage);
    if (input.branchId) await this.assertBranch(input.branchId);
    let status: "MISSING" | "CONFIGURED" | "INVALID" = input.accountId ? "CONFIGURED" : "MISSING";
    if (input.accountId) {
      const account = await this.db
        .prepare("SELECT id,active FROM accounts WHERE tenant_id=? AND id=?")
        .bind(this.actor.tenantId, input.accountId)
        .first<{ id: string; active: number }>();
      if (!account?.active) status = "INVALID";
    }
    const id = stableId("account-map", `${input.branchId ?? "tenant"}:${input.mappingKey}`);
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO setup_account_mappings
            (tenant_id,id,branch_id,scope_key,mapping_key,requirement,account_id,status,finance_signoff_status,
             signed_off_by,signed_off_at,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,scope_key,mapping_key) DO UPDATE SET
             requirement=excluded.requirement,account_id=excluded.account_id,status=excluded.status,
             finance_signoff_status=excluded.finance_signoff_status,signed_off_by=excluded.signed_off_by,
             signed_off_at=excluded.signed_off_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.branchId ? `BRANCH:${input.branchId}` : "TENANT",
          input.mappingKey,
          input.requirement,
          status === "CONFIGURED" ? (input.accountId ?? null) : null,
          status,
          status === "CONFIGURED" ? (input.financeSignoff ?? "PENDING") : "PENDING",
          status === "CONFIGURED" && input.financeSignoff === "APPROVED" ? this.actor.id : null,
          status === "CONFIGURED" && input.financeSignoff === "APPROVED" ? stamp : null,
          this.actor.id,
          stamp,
        ),
      this.audit("ACCOUNT_MAPPING_CHANGED", "ACCOUNT_MAPPING", id, {
        mappingKey: input.mappingKey,
        status,
      }),
    ]);
    return { id, status };
  }

  async configureTaxServiceRule(input: TaxServiceRuleInput) {
    this.require(permissions.setupAccountingManage);
    if (input.branchId) await this.assertBranch(input.branchId);
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw validation("effectiveTo must not precede effectiveFrom");
    if (input.accountId) {
      const account = await this.db
        .prepare("SELECT id FROM accounts WHERE tenant_id=? AND id=? AND active=1")
        .bind(this.actor.tenantId, input.accountId)
        .first();
      if (!account) throw validation("Mapped account is not active in this tenant");
    }
    const id =
      input.id ??
      stableId("tax-rule", `${input.branchId ?? "tenant"}:${input.code}:${input.effectiveFrom}`);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO tax_service_rules
            (tenant_id,id,branch_id,rule_type,code,name,rate_bps,calculation_mode,effective_from,
             effective_to,account_id,rounding_mode,active,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET branch_id=excluded.branch_id,rule_type=excluded.rule_type,
             code=excluded.code,name=excluded.name,rate_bps=excluded.rate_bps,
             calculation_mode=excluded.calculation_mode,effective_from=excluded.effective_from,
             effective_to=excluded.effective_to,account_id=excluded.account_id,
             rounding_mode=excluded.rounding_mode,active=excluded.active,updated_by=excluded.updated_by,
             updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.ruleType,
          input.code,
          input.name,
          input.rateBps,
          input.calculationMode,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.accountId ?? null,
          input.roundingMode ?? "HALF_AWAY_FROM_ZERO",
          bool(input.active ?? true),
          this.actor.id,
          now(),
        ),
      this.audit("TAX_SERVICE_RULE_CHANGED", "TAX_SERVICE_RULE", id, {
        code: input.code,
        rateBps: input.rateBps,
      }),
    ]);
    return { id };
  }

  /** Create or update a branch preparation station; stations route orders to kitchen screens. */
  async configureStation(input: StationSetupInput) {
    this.require(permissions.setupManage);
    await this.assertBranch(input.branchId);
    const existing = await this.db
      .prepare("SELECT id FROM stations WHERE tenant_id=? AND branch_id=? AND code=?")
      .bind(this.actor.tenantId, input.branchId, input.code)
      .first<{ id: string }>();
    const id = existing?.id ?? stableId("station", `${input.branchId}:${input.code}`);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
           VALUES (?,?,?,?,?,?,?,'{}')
           ON CONFLICT(tenant_id,id) DO UPDATE SET name=excluded.name,
             station_type=excluded.station_type,active=excluded.active`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.code,
          input.name,
          input.stationType,
          bool(input.active ?? true),
        ),
      this.audit(existing ? "STATION_UPDATED" : "STATION_CREATED", "STATION", id, {
        branchId: input.branchId,
        code: input.code,
        stationType: input.stationType,
        active: input.active ?? true,
      }),
    ]);
    return { id, created: !existing };
  }

  /** New values replace stored ones; blank fields keep what the restaurant saved before. */
  private async mergedProviderCredentials(
    reference: string | undefined,
    submitted: Record<string, string>,
    needsWebhookKey: boolean,
  ) {
    let current: Record<string, string> = {};
    if (reference?.startsWith("managed://")) {
      try {
        const stored = JSON.parse((await createSecretStore(this.env).resolve(reference)).value);
        if (stored && typeof stored === "object") current = stored as Record<string, string>;
      } catch {
        current = {};
      }
    }
    const merged: Record<string, string> = { ...current };
    for (const [key, value] of Object.entries(submitted))
      if (value.trim()) merged[key] = value.trim();
    if (needsWebhookKey && !merged["webhookSecret"]) merged["webhookSecret"] = randomToken();
    return merged;
  }

  async configureProviderConnection(input: ProviderSetupInput) {
    this.require(permissions.settingsIntegrationManage);
    if (input.branchId) await this.assertBranch(input.branchId);
    const provider = getProviderRegistry().get(input.providerId);
    if (!provider) throw validation("Provider is not registered in this deployment");
    await this.assertEntitledWhenManaged(
      provider.definition.category === "DELIVERY" ? "integrations.delivery" : "payments.providers",
    );
    const id =
      input.id ?? stableId("connection", `${input.providerId}:${input.branchId ?? "tenant"}`);
    const existing = await this.db
      .prepare(
        `SELECT provider_id,branch_id,secret_reference
         FROM provider_connections WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<{ provider_id: string; branch_id: string | null; secret_reference: string | null }>();
    const requestedBranchId = input.branchId ?? null;
    if (
      existing &&
      (existing.provider_id !== input.providerId || existing.branch_id !== requestedBranchId)
    ) {
      throw validation("Provider connection identity cannot be reassigned");
    }
    let secretReference = input.secretReference ?? existing?.secret_reference ?? undefined;
    let secretVersion: string | undefined;
    const isDaraja = provider.definition.code === "DARAJA";
    if (isDaraja)
      input = { ...input, configuration: darajaSetupConfiguration(input.configuration) };
    // M-Pesa always needs a callback key, so its credentials are stored even when unchanged.
    const credentials =
      input.credentials || isDaraja
        ? await this.mergedProviderCredentials(secretReference, input.credentials ?? {}, isDaraja)
        : undefined;
    if (credentials) {
      const store = createSecretStore(this.env);
      if (!store.store)
        throw validation(
          "Configured secret store is read-only; provision the secret outside Seramet and submit its reference",
        );
      secretReference =
        secretReference && secretReference.startsWith("managed://")
          ? secretReference
          : `managed://seramet/${this.actor.tenantId}/${id}`;
      const stored = await store.store(secretReference, json(credentials));
      secretVersion = stored.version;
    }
    const status =
      input.enabled === false
        ? "DISABLED"
        : secretReference && (!isDaraja || darajaCredentialsComplete(credentials))
          ? "CONFIGURED"
          : "CREDENTIALS_REQUIRED";
    const stamp = now();
    const callback = this.env.SERAMET_CALLBACK_BASE_URL
      ? `${this.env.SERAMET_CALLBACK_BASE_URL.replace(/\/$/, "")}/api/seramet/integrations/webhooks/${encodeURIComponent(provider.definition.code)}/${encodeURIComponent(id)}`
      : undefined;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO provider_connections
            (tenant_id,id,branch_id,provider_id,environment,status,secret_reference,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET branch_id=excluded.branch_id,
             provider_id=excluded.provider_id,environment=excluded.environment,status=excluded.status,
             secret_reference=excluded.secret_reference,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.providerId,
          input.environment,
          status,
          secretReference ?? null,
          json({
            configuration: input.configuration ?? {},
            callbackUrl: callback,
            capabilities: provider.definition.capabilities,
          }),
          stamp,
          stamp,
        ),
      ...(secretReference && (credentials || input.secretReference)
        ? [
            this.db
              .prepare(
                `INSERT INTO provider_secret_metadata
                  (tenant_id,connection_id,secret_reference,active_version,rotated_at,updated_by,updated_at)
                 VALUES (?,?,?,?,?,?,?)
                 ON CONFLICT(tenant_id,connection_id) DO UPDATE SET
                   previous_version=provider_secret_metadata.active_version,
                   active_version=excluded.active_version,rotated_at=excluded.rotated_at,
                   updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
              )
              .bind(
                this.actor.tenantId,
                id,
                secretReference,
                secretVersion ?? null,
                stamp,
                this.actor.id,
                stamp,
              ),
          ]
        : []),
      this.audit(
        status === "DISABLED" ? "PROVIDER_CONNECTION_DISABLED" : "PROVIDER_CONNECTION_CONFIGURED",
        "PROVIDER_CONNECTION",
        id,
        {
          providerId: input.providerId,
          environment: input.environment,
          hasSecretReference: Boolean(secretReference),
        },
      ),
    ]);
    return {
      id,
      status,
      providerId: input.providerId,
      capabilities: provider.definition.capabilities,
      secretConfigured: Boolean(secretReference),
    };
  }

  providerDefinitions() {
    this.require(permissions.setupView);
    return getProviderRegistry()
      .list()
      .map((adapter) => ({
        id: adapter.definition.id,
        code: adapter.definition.code,
        displayName: adapter.definition.displayName,
        category: adapter.definition.category,
        version: adapter.definition.version,
        countries: adapter.definition.supportedCountries ?? [],
        capabilities: adapter.definition.capabilities,
        configurationSchema: adapter.definition.configurationSchema,
        credentialFields: adapter.definition.secretFields,
        enabled: adapter.definition.enabled,
        documentationUrl: adapter.definition.adapterMetadata?.documentationUrl,
      }));
  }

  async configureExternalMapping(input: ExternalMappingInput) {
    this.require(permissions.integrationsMappingManage);
    const connection = await this.db
      .prepare("SELECT provider_id,branch_id FROM provider_connections WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.connectionId)
      .first<{ provider_id: string; branch_id: string | null }>();
    if (!connection) throw validation("Provider connection does not belong to this tenant");
    const branchId = input.branchId ?? connection.branch_id ?? undefined;
    if (branchId) await this.assertBranch(branchId);
    if (connection.branch_id && branchId !== connection.branch_id) {
      throw validation("Mapping branch does not match the provider connection branch");
    }
    if (input.status === "MAPPED" && !input.reviewConfirmed) {
      throw validation("Authoritative mappings require explicit review confirmation");
    }
    if (input.resourceType === "STORE") {
      if (!branchId || input.internalId !== branchId) {
        throw validation("External store mappings must target the reviewed Seramet branch");
      }
    } else if (input.resourceType === "ITEM") {
      const item = await this.db
        .prepare("SELECT id FROM menu_catalog_items WHERE tenant_id=? AND id=? AND active=1")
        .bind(this.actor.tenantId, input.internalId)
        .first();
      if (!item) throw validation("Mapped menu item is not active in this tenant");
    }
    const provider = getProviderRegistry().get(connection.provider_id);
    const id = stableId(
      "mapping",
      `${input.connectionId}:${input.resourceType}:${input.externalId}`,
    );
    const stamp = now();
    await createIntegrationRepository(this.db).upsertMapping({
      id,
      tenantId: this.actor.tenantId,
      ...(branchId ? { branchId } : {}),
      connectionId: input.connectionId,
      providerId: connection.provider_id,
      resourceType: input.resourceType,
      internalId: input.internalId,
      externalId: input.externalId,
      status: input.status,
      syncStatus: input.status === "MAPPED" ? "NOT_SYNCED" : "CONFLICT",
      metadata: {
        ...(input.metadata ?? {}),
        reviewConfirmed: input.reviewConfirmed,
        confidenceBps: input.confidenceBps ?? null,
        availabilitySyncSupported: provider.definition.capabilities.includes("SYNC_AVAILABILITY"),
      },
      createdAt: stamp,
      updatedAt: stamp,
    });
    await this.db.batch([
      this.audit("PROVIDER_MAPPING_CONFIGURED", "PROVIDER_MAPPING", id, {
        connectionId: input.connectionId,
        resourceType: input.resourceType,
        status: input.status,
        reviewConfirmed: input.reviewConfirmed,
      }),
      this.enqueueJobStatement(
        "SETUP_READINESS_RECALCULATION",
        id,
        `setup-mapping-readiness:${id}:${stamp}`,
        crypto.randomUUID(),
        { branchId: branchId ?? null, reason: "PROVIDER_MAPPING_CHANGED" },
      ),
    ]);
    return {
      id,
      status: input.status,
      availabilitySyncSupported: provider.definition.capabilities.includes("SYNC_AVAILABILITY"),
    };
  }

  async listExternalMappings(connectionId?: string) {
    this.require(permissions.setupView);
    if (connectionId) {
      const connection = await this.db
        .prepare("SELECT branch_id FROM provider_connections WHERE tenant_id=? AND id=?")
        .bind(this.actor.tenantId, connectionId)
        .first<{ branch_id: string | null }>();
      if (!connection) throw validation("Provider connection does not belong to this tenant");
      if (connection.branch_id) await this.assertBranch(connection.branch_id);
    }
    const rows = await createIntegrationRepository(this.db).listMappings(
      this.actor.tenantId,
      connectionId,
    );
    return rows.filter((row) => !row.branchId || this.canReadBranch(row.branchId)).slice(0, 1000);
  }

  async configureDevice(input: DeviceSetupInput) {
    this.require(permissions.settingsHardwareManage);
    await this.assertBranch(input.branchId);
    const id = input.id ?? crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO hardware_devices
            (tenant_id,id,branch_id,device_type,name,trust_status,registered_by,registered_at,payload_json)
           VALUES (?,?,?,?,?,'PENDING',?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET branch_id=excluded.branch_id,
             device_type=excluded.device_type,name=excluded.name,payload_json=excluded.payload_json`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.deviceType,
          input.name,
          this.actor.id,
          stamp,
          json({
            stationId: input.stationId,
            role: input.role,
            networkIdentifier: input.networkIdentifier,
            paperSize: input.paperSize,
            capabilities: input.capabilities ?? [],
            fallbackDeviceId: input.fallbackDeviceId,
          }),
        ),
      this.audit("DEVICE_CONFIGURED", "HARDWARE_DEVICE", id, {
        deviceType: input.deviceType,
        branchId: input.branchId,
      }),
    ]);
    return { id, trustStatus: "PENDING", health: "UNKNOWN" };
  }

  async configureDocumentTemplate(input: DocumentTemplateSetupInput) {
    this.require(permissions.settingsHardwareManage);
    if (input.branchId) await this.assertBranch(input.branchId);
    const id =
      input.id ??
      stableId(
        "document-template",
        `${input.branchId ?? "tenant"}:${input.documentType}:${input.layoutVersion}`,
      );
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO document_templates
            (tenant_id,id,branch_id,document_type,layout_version,active,payload_json)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET branch_id=excluded.branch_id,
             document_type=excluded.document_type,layout_version=excluded.layout_version,
             active=excluded.active,payload_json=excluded.payload_json`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.documentType,
          input.layoutVersion,
          bool(input.active),
          json({
            ...input.configuration,
            width: input.width,
            copies: input.copies,
            logoAssetReference: input.logoAssetReference,
            footerMessage: input.footerMessage,
            paymentInstructions: input.paymentInstructions,
            showCustomer: input.showCustomer,
            showTable: input.showTable,
            showCashier: input.showCashier,
            showKotPrices: input.showKotPrices,
            showQrCode: input.showQrCode,
          }),
        ),
      this.audit("DOCUMENT_TEMPLATE_CHANGED", "DOCUMENT_TEMPLATE", id, {
        documentType: input.documentType,
      }),
    ]);
    return { id };
  }

  async runTest(input: {
    branchId?: string;
    testType: TestRun["testType"];
    targetType: string;
    targetId?: string;
    idempotencyKey: string;
  }): Promise<TestRun> {
    this.require(
      input.testType === "PRINT" || input.testType === "DEVICE"
        ? permissions.settingsHardwareManage
        : permissions.setupManage,
    );
    if (input.branchId) await this.assertBranch(input.branchId);
    const existing = await this.db
      .prepare("SELECT * FROM setup_test_runs WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<Row>();
    if (existing) return mapTestRun(existing);
    let status: TestRun["status"] = "UNKNOWN";
    let result: Record<string, unknown> = {};
    if (input.testType === "PRINT") {
      const device = input.targetId
        ? await this.db
            .prepare(
              "SELECT trust_status,last_seen_at FROM hardware_devices WHERE tenant_id=? AND id=?",
            )
            .bind(this.actor.tenantId, input.targetId)
            .first<{ trust_status: string; last_seen_at: string | null }>()
        : null;
      status =
        device?.trust_status === "ACTIVE" && device.last_seen_at ? "UNKNOWN" : "DEVICE_OFFLINE";
      result = {
        documentMarker: "*** TEST PRINT ***",
        financialTransactionCreated: false,
        deviceObserved: Boolean(device),
      };
    } else if (input.testType === "ORDER") {
      status = "SUCCESS";
      result = {
        sandbox: true,
        financialFactsCreated: false,
        inventoryMovementsCreated: false,
        taxFactsCreated: false,
      };
    } else if (input.testType === "INTEGRATION") {
      const connection = input.targetId
        ? await this.db
            .prepare("SELECT status FROM provider_connections WHERE tenant_id=? AND id=?")
            .bind(this.actor.tenantId, input.targetId)
            .first<{ status: string }>()
        : null;
      status =
        connection?.status === "CONFIGURED" || connection?.status === "CONNECTED"
          ? "SUCCESS"
          : "UNKNOWN";
      result = { providerStatus: connection?.status ?? "UNKNOWN", externalMutation: false };
    } else {
      const health = input.targetId
        ? await this.db
            .prepare(
              "SELECT health_status FROM device_health_snapshots WHERE tenant_id=? AND device_id=?",
            )
            .bind(this.actor.tenantId, input.targetId)
            .first<{ health_status: string }>()
        : null;
      status = health?.health_status === "ONLINE" ? "SUCCESS" : health ? "FAILED" : "UNKNOWN";
      result = { observedHealth: health?.health_status ?? "UNKNOWN" };
    }
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO setup_test_runs
            (tenant_id,id,branch_id,test_type,target_type,target_id,status,test_marker,result_json,
             correlation_id,idempotency_key,created_by,created_at,completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.testType,
          input.targetType,
          input.targetId ?? null,
          status,
          input.testType === "PRINT" ? "*** TEST PRINT ***" : "*** TEST ***",
          json(result),
          correlationId,
          input.idempotencyKey,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("SETUP_TEST_RUN", "SETUP_TEST", id, {
        testType: input.testType,
        status,
        correlationId,
      }),
    ]);
    return {
      id,
      testType: input.testType,
      targetType: input.targetType,
      ...(input.targetId ? { targetId: input.targetId } : {}),
      status,
      marker: input.testType === "PRINT" ? "*** TEST PRINT ***" : "*** TEST ***",
      result,
      createdAt: stamp,
    };
  }

  async integrationHealth(): Promise<IntegrationHealthRow[]> {
    this.require(permissions.setupView);
    const rows = await this.db
      .prepare(
        `SELECT c.id,c.branch_id,c.provider_id,c.environment,c.status,c.payload_json,
                sm.credentials_age_days,
                (SELECT COUNT(*) FROM integration_outbox o WHERE o.tenant_id=c.tenant_id AND o.connection_id=c.id AND o.status IN ('PENDING','RETRY_PENDING','CLAIMED')) pending_queue,
                (SELECT COUNT(*) FROM integration_dead_letters d WHERE d.tenant_id=c.tenant_id AND d.connection_id=c.id AND d.status='OPEN') dead_letters,
                (SELECT MAX(received_at) FROM provider_events e WHERE e.tenant_id=c.tenant_id AND e.connection_id=c.id AND e.status='PROCESSED') last_success,
                (SELECT MAX(received_at) FROM provider_events e WHERE e.tenant_id=c.tenant_id AND e.connection_id=c.id AND e.status='FAILED') last_failure,
                (SELECT MAX(received_at) FROM provider_events e WHERE e.tenant_id=c.tenant_id AND e.connection_id=c.id AND e.direction='INBOUND') last_webhook
         FROM provider_connections c
         LEFT JOIN provider_secret_metadata sm ON sm.tenant_id=c.tenant_id AND sm.connection_id=c.id
         WHERE c.tenant_id=? ORDER BY c.provider_id,c.id LIMIT 500`,
      )
      .bind(this.actor.tenantId)
      .all<Row>();
    return (rows.results ?? []).map((row) => {
      const adapter = getProviderRegistry().get(string(row.provider_id));
      const health = providerHealth(string(row.status), number(row.dead_letters));
      return {
        connectionId: string(row.id),
        providerId: string(row.provider_id),
        displayName: adapter?.definition.displayName ?? string(row.provider_id),
        category: adapter?.definition.category ?? "OTHER",
        ...(row.branch_id ? { branchId: string(row.branch_id) } : {}),
        environment: string(row.environment),
        status: string(row.status),
        health,
        capabilities: adapter?.definition.capabilities ?? [],
        ...(row.last_success ? { lastSuccess: string(row.last_success) } : {}),
        ...(row.last_failure ? { lastFailure: string(row.last_failure) } : {}),
        ...(row.last_webhook ? { lastWebhook: string(row.last_webhook) } : {}),
        pendingQueue: number(row.pending_queue),
        deadLetters: number(row.dead_letters),
        ...(row.credentials_age_days !== null && row.credentials_age_days !== undefined
          ? { credentialsAgeDays: number(row.credentials_age_days) }
          : {}),
      };
    });
  }

  async deviceHealth(): Promise<DeviceHealthRow[]> {
    this.require(permissions.setupView);
    const rows = await this.db
      .prepare(
        `SELECT d.id,d.name,d.branch_id,d.device_type,d.trust_status,d.last_seen_at,d.payload_json,
                h.health_status,h.last_successful_operation_at,h.warning,h.version
         FROM hardware_devices d LEFT JOIN device_health_snapshots h
           ON h.tenant_id=d.tenant_id AND h.device_id=d.id
         WHERE d.tenant_id=? ORDER BY d.branch_id,d.name LIMIT 1000`,
      )
      .bind(this.actor.tenantId)
      .all<Row>();
    return (rows.results ?? [])
      .filter((row) => this.canReadBranch(string(row.branch_id)))
      .map((row) => ({
        deviceId: string(row.id),
        name: string(row.name),
        branchId: string(row.branch_id),
        deviceType: string(row.device_type),
        trustStatus: string(row.trust_status),
        health: (row.health_status
          ? string(row.health_status)
          : "UNKNOWN") as DeviceHealthRow["health"],
        ...(row.last_seen_at ? { lastSeen: string(row.last_seen_at) } : {}),
        ...(row.last_successful_operation_at
          ? { lastSuccessfulOperation: string(row.last_successful_operation_at) }
          : {}),
        ...(row.warning ? { warning: string(row.warning) } : {}),
        ...(row.version ? { version: string(row.version) } : {}),
      }));
  }

  async setFeatureFlag(input: {
    key: string;
    enabled: boolean;
    configuration?: Record<string, unknown>;
  }) {
    this.require(permissions.setupEntitlementsManage);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO feature_flags (tenant_id,key,enabled,configuration_json,updated_by,updated_at)
           VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET enabled=excluded.enabled,
             configuration_json=excluded.configuration_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          input.key,
          bool(input.enabled),
          json(input.configuration ?? {}),
          this.actor.id,
          now(),
        ),
      this.audit("FEATURE_FLAG_CHANGED", "FEATURE_FLAG", input.key, { enabled: input.enabled }),
    ]);
    return { key: input.key, enabled: input.enabled };
  }

  async setEntitlement(input: {
    subscriptionId: string;
    featureKey: string;
    enabled: boolean;
    limits?: Record<string, unknown>;
  }) {
    this.require(permissions.setupEntitlementsManage);
    const subscription = await this.db
      .prepare("SELECT id FROM tenant_subscriptions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.subscriptionId)
      .first();
    if (!subscription) throw validation("Subscription does not belong to this tenant");
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO feature_entitlements (tenant_id,subscription_id,feature_key,enabled,limits_json)
           VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,subscription_id,feature_key) DO UPDATE SET
             enabled=excluded.enabled,limits_json=excluded.limits_json`,
        )
        .bind(
          this.actor.tenantId,
          input.subscriptionId,
          input.featureKey,
          bool(input.enabled),
          json(input.limits ?? {}),
        ),
      this.audit("ENTITLEMENT_CHANGED", "FEATURE_ENTITLEMENT", input.featureKey, {
        enabled: input.enabled,
      }),
    ]);
    return { featureKey: input.featureKey, enabled: input.enabled };
  }

  async setSubscriptionLifecycle(input: {
    subscriptionId: string;
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
    effectiveAt: string;
    reason: string;
  }) {
    this.require(permissions.setupEntitlementsManage);
    const subscription = await this.db
      .prepare("SELECT id FROM tenant_subscriptions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.subscriptionId)
      .first();
    if (!subscription) throw validation("Subscription does not belong to this tenant");
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO subscription_lifecycle_events
            (tenant_id,id,subscription_id,status,effective_at,reason,changed_by,created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.subscriptionId,
          input.status,
          input.effectiveAt,
          input.reason,
          this.actor.id,
          now(),
        ),
      this.audit("SUBSCRIPTION_STATE_CHANGED", "TENANT_SUBSCRIPTION", input.subscriptionId, {
        status: input.status,
        effectiveAt: input.effectiveAt,
        dataPreserved: true,
      }),
    ]);
    return { id, status: input.status, dataPreserved: true, exportAllowed: true };
  }

  async assertEntitlement(featureKey: string) {
    const row = await this.db
      .prepare(
        `SELECT e.enabled,l.status FROM tenant_subscriptions s
         JOIN feature_entitlements e ON e.tenant_id=s.tenant_id AND e.subscription_id=s.id
         LEFT JOIN subscription_lifecycle_events l ON l.tenant_id=s.tenant_id AND l.subscription_id=s.id
           AND l.effective_at=(SELECT MAX(l2.effective_at) FROM subscription_lifecycle_events l2 WHERE l2.tenant_id=s.tenant_id AND l2.subscription_id=s.id)
         WHERE s.tenant_id=? AND e.feature_key=? ORDER BY s.updated_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, featureKey)
      .first<{ enabled: number; status: string | null }>();
    if (!row?.enabled || ["SUSPENDED", "CANCELLED"].includes(row.status ?? "")) {
      throw denied("Feature is not entitled for this tenant");
    }
  }

  async diagnostics() {
    this.require(permissions.setupDiagnosticsView);
    const runtime = resolveRuntimeConfiguration(this.env);
    const schemaVersion = await this.db
      .prepare("SELECT MAX(version) version FROM schema_migrations")
      .first<{ version: number }>();
    const queue = await this.db
      .prepare("SELECT status,COUNT(*) count FROM worker_jobs WHERE tenant_id=? GROUP BY status")
      .bind(this.actor.tenantId)
      .all<{ status: string; count: number }>();
    const flags = await this.db
      .prepare("SELECT key,enabled FROM feature_flags WHERE tenant_id=? ORDER BY key LIMIT 500")
      .bind(this.actor.tenantId)
      .all<{ key: string; enabled: number }>();
    const backup = await this.db
      .prepare(
        "SELECT status,completed_at,verified_at FROM backup_records WHERE tenant_id=? ORDER BY started_at DESC LIMIT 1",
      )
      .bind(this.actor.tenantId)
      .first<Row>();
    return {
      appVersion: runtime.appVersion,
      buildId: runtime.buildId,
      environment: runtime.environment,
      schema: {
        current: schemaVersion?.version ?? 0,
        required: CURRENT_SCHEMA_VERSION,
        pending: Math.max(0, CURRENT_SCHEMA_VERSION - (schemaVersion?.version ?? 0)),
      },
      runtimeIssues: validateRuntimeConfiguration(this.env).map((value) => value.code),
      database: this.env.SERAMET_DB ? "READY" : "UNKNOWN",
      workers: Object.fromEntries((queue.results ?? []).map((row) => [row.status, row.count])),
      integrations: await this.integrationHealth(),
      devices: await this.deviceHealth(),
      featureFlags: (flags.results ?? []).map((row) => ({
        key: row.key,
        enabled: Boolean(row.enabled),
      })),
      backup: backup
        ? {
            status: string(backup.status),
            completedAt: optionalString(backup.completed_at),
            verifiedAt: optionalString(backup.verified_at),
          }
        : { status: "UNKNOWN" },
      redaction: {
        secrets: "EXCLUDED",
        tokens: "EXCLUDED",
        credentials: "EXCLUDED",
        cardData: "EXCLUDED",
      },
    };
  }

  async requestDiagnosticsExport(input: {
    scope?: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    this.require(permissions.setupDiagnosticsView);
    const existing = await this.db
      .prepare(
        "SELECT id,status FROM support_diagnostic_exports WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; status: string }>();
    if (existing) return { ...existing, duplicate: true };
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO support_diagnostic_exports
            (tenant_id,id,status,scope_json,idempotency_key,correlation_id,created_by,created_at)
           VALUES (?,?,'PENDING',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          json(input.scope ?? {}),
          input.idempotencyKey,
          correlationId,
          this.actor.id,
          stamp,
        ),
      this.enqueueJobStatement(
        "SUPPORT_DIAGNOSTIC_EXPORT",
        id,
        `support-diagnostic:${input.idempotencyKey}`,
        correlationId,
        { exportId: id },
      ),
      this.audit("SUPPORT_DIAGNOSTIC_EXPORT_REQUESTED", "SUPPORT_DIAGNOSTIC_EXPORT", id, {
        correlationId,
      }),
    ]);
    return { id, status: "PENDING", duplicate: false };
  }

  async getDiagnosticsExport(id: string) {
    this.require(permissions.setupDiagnosticsView);
    const row = await this.db
      .prepare(
        `SELECT id,status,redacted_payload_json,created_at,completed_at,expires_at
         FROM support_diagnostic_exports WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<{
        id: string;
        status: string;
        redacted_payload_json: string | null;
        created_at: string;
        completed_at: string | null;
        expires_at: string | null;
      }>();
    if (!row) throw notFound("Diagnostics export not found");
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      ...(row.status === "READY"
        ? { diagnostics: parseJson(row.redacted_payload_json ?? "{}", {}) }
        : {}),
    };
  }

  async requestDataExport(input: {
    entityTypes: string[];
    periodStart?: string;
    periodEnd?: string;
    rowLimit: number;
    idempotencyKey: string;
  }) {
    this.require(permissions.setupExport);
    const allowed = new Set([
      "menu",
      "inventory",
      "suppliers",
      "customers",
      "staff",
      "orders",
      "invoices",
      "payments",
      "journals",
      "audit",
      "historicalSales",
    ]);
    const invalid = input.entityTypes.filter((value) => !allowed.has(value));
    if (invalid.length) throw validation(`Unsupported export entities: ${invalid.join(", ")}`);
    const existing = await this.db
      .prepare(
        "SELECT id,status FROM tenant_data_export_jobs WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; status: string }>();
    if (existing) return { ...existing, duplicate: true };
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO tenant_data_export_jobs
            (tenant_id,id,status,entity_types_json,period_start,period_end,row_limit,idempotency_key,
             correlation_id,created_by,created_at)
           VALUES (?,?,'PENDING',?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          json(input.entityTypes),
          input.periodStart ?? null,
          input.periodEnd ?? null,
          input.rowLimit,
          input.idempotencyKey,
          correlationId,
          this.actor.id,
          stamp,
        ),
      this.enqueueJobStatement(
        "TENANT_DATA_EXPORT",
        id,
        `tenant-export:${input.idempotencyKey}`,
        correlationId,
        { exportId: id },
      ),
      this.audit("TENANT_DATA_EXPORT_REQUESTED", "TENANT_DATA_EXPORT", id, {
        entityTypes: input.entityTypes,
        correlationId,
      }),
    ]);
    return { id, status: "PENDING", duplicate: false };
  }

  async getDataExport(id: string, includePayload = false) {
    this.require(permissions.setupExport);
    const row = await this.db
      .prepare(
        `SELECT id,status,entity_types_json,result_reference,manifest_json,created_at,completed_at,expires_at
         FROM tenant_data_export_jobs WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<{
        id: string;
        status: string;
        entity_types_json: string;
        result_reference: string | null;
        manifest_json: string | null;
        created_at: string;
        completed_at: string | null;
        expires_at: string | null;
      }>();
    if (!row) throw notFound("Tenant data export not found");
    let payload: unknown;
    if (includePayload && row.status === "READY" && row.result_reference) {
      const record = await this.db
        .prepare(
          `SELECT payload_json FROM authoritative_records
           WHERE tenant_id=? AND entity_type='setup:tenant-data-export' AND entity_id=?`,
        )
        .bind(this.actor.tenantId, id)
        .first<{ payload_json: string }>();
      payload = record ? parseJson(record.payload_json, {}) : undefined;
    }
    return {
      id: row.id,
      status: row.status,
      entityTypes: parseJson(row.entity_types_json, []),
      manifest: parseJson(row.manifest_json ?? "{}", {}),
      createdAt: row.created_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      ...(includePayload && payload ? { payload } : {}),
    };
  }

  async resetDemoTenant(input: { reason: string; idempotencyKey: string }) {
    this.require(permissions.setupDemoReset);
    const runtime = resolveRuntimeConfiguration(this.env);
    if (!["development", "test"].includes(runtime.environment)) {
      throw denied("Demo reset is available only in explicit development or test environments");
    }
    const profile = await this.db
      .prepare(
        "SELECT demo_mode,demo_reset_allowed FROM tenant_onboarding_profiles WHERE tenant_id=?",
      )
      .bind(this.actor.tenantId)
      .first<{ demo_mode: number; demo_reset_allowed: number }>();
    if (!profile?.demo_mode || !profile.demo_reset_allowed) {
      throw denied("This tenant is not an explicitly resettable demo tenant");
    }
    const jobId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const stamp = now();
    const result = await this.db
      .prepare(
        `INSERT INTO worker_jobs
          (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,
           max_attempts,scheduled_at,created_at,updated_at)
         VALUES (?,?,'DEMO_TENANT_RESET',?,?,?,'PENDING',0,3,?,?,?)
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        this.actor.tenantId,
        jobId,
        json({ reason: input.reason, requestedBy: this.actor.id }),
        input.idempotencyKey,
        correlationId,
        stamp,
        stamp,
        stamp,
      )
      .run();
    if ((result.meta?.changes ?? 0) > 0) {
      await this.db.batch([
        this.audit("DEMO_RESET_REQUESTED", "TENANT", this.actor.tenantId, {
          jobId,
          correlationId,
        }),
      ]);
    }
    return {
      jobId,
      queued: (result.meta?.changes ?? 0) > 0,
      duplicate: (result.meta?.changes ?? 0) === 0,
    };
  }

  async transitionGoLive(input: {
    toState: GoLiveState;
    override?: boolean;
    reason?: string;
  }): Promise<GoLiveDecision> {
    this.require(permissions.setupGoLiveApprove);
    const summary = await this.recalculateReadiness(undefined, true);
    const profile = await this.db
      .prepare("SELECT go_live_state FROM tenant_onboarding_profiles WHERE tenant_id=?")
      .bind(this.actor.tenantId)
      .first<{ go_live_state: GoLiveState }>();
    const fromState = profile?.go_live_state ?? "SETUP";
    const transitions: Record<GoLiveState, GoLiveState[]> = {
      SETUP: ["READY_FOR_REVIEW", "SUSPENDED"],
      READY_FOR_REVIEW: ["SETUP", "READY_FOR_GO_LIVE", "SUSPENDED"],
      READY_FOR_GO_LIVE: ["READY_FOR_REVIEW", "LIVE", "SUSPENDED"],
      LIVE: ["SUSPENDED"],
      SUSPENDED: ["READY_FOR_REVIEW"],
    };
    if (!transitions[fromState].includes(input.toState)) {
      throw invalidTransition(`Go-live state cannot move from ${fromState} to ${input.toState}`);
    }
    const blockers = summary.results.filter((row) => row.status === "BLOCKED");
    const hardBlockers = blockers.filter(
      (row) => row.severity === "SECURITY" || row.severity === "SCHEMA",
    );
    const requiresReadiness = input.toState === "READY_FOR_GO_LIVE" || input.toState === "LIVE";
    if (requiresReadiness && hardBlockers.length)
      throw validation("Security and schema blockers cannot be overridden");
    if (requiresReadiness && blockers.length && !input.override)
      throw validation("Critical readiness blockers prevent go-live progression");
    if (input.override) {
      this.require(permissions.setupGoLiveOverride);
      if (!input.reason || input.reason.trim().length < 8)
        throw validation("A go-live override requires a reason");
      if (blockers.some((row) => !row.overrideAllowed))
        throw validation("One or more blockers cannot be overridden");
    }
    if (requiresReadiness && summary.overallScoreBps < 8000 && !input.override)
      throw validation("Readiness score is below the configured go-live threshold");
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE tenant_onboarding_profiles SET go_live_state=?,updated_by=?,updated_at=? WHERE tenant_id=?",
        )
        .bind(input.toState, this.actor.id, stamp, this.actor.tenantId),
      this.db
        .prepare(
          `UPDATE branches SET lifecycle_state=?,is_bootstrap=CASE WHEN ?='LIVE' THEN 0 ELSE is_bootstrap END,
             version=version+1
           WHERE tenant_id=? AND lifecycle_state<>'CLOSED'`,
        )
        .bind(
          input.toState === "LIVE"
            ? "ACTIVE"
            : input.toState === "SUSPENDED"
              ? "SUSPENDED"
              : "CONFIGURING",
          input.toState,
          this.actor.tenantId,
        ),
      this.db
        .prepare(
          `INSERT INTO go_live_events
            (tenant_id,id,from_state,to_state,readiness_score_bps,blocker_codes_json,override_used,
             reason,approved_by,correlation_id,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          fromState,
          input.toState,
          summary.overallScoreBps,
          json(blockers.map((row) => row.code)),
          bool(Boolean(input.override)),
          input.reason ?? null,
          this.actor.id,
          correlationId,
          stamp,
        ),
      this.audit(
        input.override ? "GO_LIVE_OVERRIDE_APPROVED" : "GO_LIVE_STATE_CHANGED",
        "TENANT",
        this.actor.tenantId,
        { fromState, toState: input.toState, correlationId },
      ),
    ]);
    return {
      fromState,
      toState: input.toState,
      scoreBps: summary.overallScoreBps,
      blockers: blockers.map((row) => row.code),
      overrideUsed: Boolean(input.override),
    };
  }

  async recalculateReadiness(branchId?: string, persist = true): Promise<SetupSummary> {
    this.require(permissions.setupView);
    if (branchId) await this.assertBranch(branchId);
    const scopeKey = branchId ? `BRANCH:${branchId}` : "TENANT";
    const stamp = now();
    const tenant = await this.db
      .prepare(
        `SELECT t.legal_name,t.trading_name,t.default_currency,t.timezone,t.locale,
                p.country_code,p.accounting_mode,p.go_live_state,p.demo_mode
         FROM tenants t LEFT JOIN tenant_onboarding_profiles p ON p.tenant_id=t.id WHERE t.id=?`,
      )
      .bind(this.actor.tenantId)
      .first<Row>();
    if (!tenant) throw notFound("Tenant not found");
    const counts = await this.countSetupFacts(branchId);
    const results = await this.buildReadinessResults(branchId, tenant, counts);
    const weights = await this.sectionWeights();
    const stages: SetupStage[] = setupSections.map((section) => {
      const sectionResults = results.filter((row) => row.section === section);
      const blockers = sectionResults.filter((row) => row.status === "BLOCKED").length;
      const warnings = sectionResults.filter((row) => row.status === "WARNING").length;
      const ready = sectionResults.filter((row) => row.status === "READY").length;
      const applicable = sectionResults.filter((row) => row.status !== "NOT_APPLICABLE").length;
      const progressBps = applicable === 0 ? 10000 : Math.round((ready / applicable) * 10000);
      const readinessStatus: ReadinessStatus = blockers
        ? "BLOCKED"
        : warnings
          ? "WARNING"
          : applicable
            ? "READY"
            : "NOT_APPLICABLE";
      return {
        section,
        label: sectionLabels[section],
        status: blockers
          ? "BLOCKED"
          : progressBps === 10000
            ? "COMPLETE"
            : ready
              ? "IN_PROGRESS"
              : "NOT_STARTED",
        readinessStatus,
        progressBps,
        weightBps: weights[section],
        blockers,
        warnings,
        evidence: { checks: sectionResults.length, ready },
      };
    });
    const totalWeight = stages.reduce((sum, stage) => sum + stage.weightBps, 0) || 1;
    const weighted = stages.reduce((sum, stage) => sum + stage.progressBps * stage.weightBps, 0);
    const overallScoreBps = Math.round(weighted / totalWeight);
    const status: ReadinessStatus = results.some((row) => row.status === "BLOCKED")
      ? "BLOCKED"
      : results.some((row) => row.status === "WARNING")
        ? "WARNING"
        : "READY";
    if (persist) {
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare("DELETE FROM setup_readiness_results WHERE tenant_id=? AND scope_key=?")
          .bind(this.actor.tenantId, scopeKey),
      ];
      for (const row of results) statements.push(this.readinessStatement(row, scopeKey, stamp));
      for (const stage of stages) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO setup_stage_snapshots
                (tenant_id,id,branch_id,scope_key,section_key,status,readiness_status,progress_bps,evidence_json,calculated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id,scope_key,section_key) DO UPDATE SET status=excluded.status,
                 readiness_status=excluded.readiness_status,progress_bps=excluded.progress_bps,
                 evidence_json=excluded.evidence_json,calculated_at=excluded.calculated_at`,
            )
            .bind(
              this.actor.tenantId,
              stableId("setup-stage", `${scopeKey}:${stage.section}`),
              branchId ?? null,
              scopeKey,
              stage.section,
              stage.status,
              stage.readinessStatus,
              stage.progressBps,
              json(stage.evidence),
              stamp,
            ),
        );
      }
      await this.db.batch(statements);
    }
    return {
      tenantId: this.actor.tenantId,
      ...(branchId ? { branchId } : {}),
      organisationName: string(tenant.trading_name || tenant.legal_name),
      goLiveState: (tenant.go_live_state ? string(tenant.go_live_state) : "SETUP") as GoLiveState,
      demoMode: Boolean(tenant.demo_mode),
      overallScoreBps,
      status,
      stages,
      results,
      counts,
      calculatedAt: stamp,
    };
  }

  private async buildReadinessResults(
    branchId: string | undefined,
    tenant: Row,
    counts: SetupSummary["counts"],
  ): Promise<ReadinessResult[]> {
    // Independent counts run together: each is a database round trip, and run one after
    // another they made Setup Centre take many seconds to load.
    const [
      activeAdmins,
      unassignedBranches,
      taxCount,
      paymentCount,
      invalidProviderPaymentMethods,
      deliveryCount,
      stationCount,
      deviceCount,
      documentCount,
      successfulTests,
      verifiedBackups,
    ] = await Promise.all([
      count(
        this.db,
        `SELECT COUNT(DISTINCT u.id) count FROM users u
         JOIN user_roles ur ON ur.tenant_id=u.tenant_id AND ur.user_id=u.id
         JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.active=1
         JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
         WHERE u.tenant_id=? AND u.active=1 AND rp.permission_code=?`,
        this.actor.tenantId,
        permissions.setupManage,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM branches b WHERE b.tenant_id=? AND b.active=1
         AND NOT EXISTS (
           SELECT 1 FROM user_branches ub JOIN users u ON u.tenant_id=ub.tenant_id AND u.id=ub.user_id AND u.active=1
           WHERE ub.tenant_id=b.tenant_id AND ub.branch_id=b.id
         )`,
        this.actor.tenantId,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM tax_service_rules WHERE tenant_id=? AND active=1 AND (branch_id=? OR branch_id IS NULL)`,
        this.actor.tenantId,
        branchId ?? null,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM payment_methods WHERE tenant_id=? AND active=1`,
        this.actor.tenantId,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM payment_methods pm
         LEFT JOIN provider_connections pc ON pc.tenant_id=pm.tenant_id AND pc.id=pm.provider_connection_id
         WHERE pm.tenant_id=? AND pm.active=1 AND pm.provider_connection_id IS NOT NULL
         AND (pc.id IS NULL OR pc.status NOT IN ('CONFIGURED','CONNECTED') OR pc.secret_reference IS NULL)`,
        this.actor.tenantId,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM order_channels WHERE tenant_id=? AND active=1 AND channel_type='MARKETPLACE'`,
        this.actor.tenantId,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM stations WHERE tenant_id=? AND active=1 AND (? IS NULL OR branch_id=?)`,
        this.actor.tenantId,
        branchId ?? null,
        branchId ?? null,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM hardware_devices WHERE tenant_id=? AND trust_status='ACTIVE' AND (? IS NULL OR branch_id=?)`,
        this.actor.tenantId,
        branchId ?? null,
        branchId ?? null,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM document_templates WHERE tenant_id=? AND active=1 AND (branch_id=? OR branch_id IS NULL)`,
        this.actor.tenantId,
        branchId ?? null,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM setup_test_runs WHERE tenant_id=? AND status='SUCCESS' AND (? IS NULL OR branch_id=?)`,
        this.actor.tenantId,
        branchId ?? null,
        branchId ?? null,
      ),
      count(
        this.db,
        `SELECT COUNT(*) count FROM backup_records WHERE tenant_id=? AND status IN ('SUCCEEDED','VERIFIED') AND verified_at IS NOT NULL`,
        this.actor.tenantId,
      ),
    ]);
    const rows: ReadinessResult[] = [];
    const add = (
      section: SetupSection,
      code: string,
      ok: boolean,
      message: string,
      action: string,
      options: {
        warning?: boolean;
        severity?: ReadinessSeverity;
        evidence?: Record<string, unknown>;
        overrideAllowed?: boolean;
      } = {},
    ) => {
      const status: ReadinessStatus = ok ? "READY" : options.warning ? "WARNING" : "BLOCKED";
      rows.push({
        id: stableId("readiness", `${branchId ?? "tenant"}:${code}`),
        code,
        section,
        scope: branchId ? "BRANCH" : "TENANT",
        ...(branchId ? { branchId } : {}),
        status,
        severity: ok ? "INFO" : (options.severity ?? (options.warning ? "WARNING" : "CRITICAL")),
        message,
        evidence: options.evidence ?? {},
        recommendedAction: action,
        overrideAllowed: ok
          ? false
          : (options.overrideAllowed ??
            (options.severity !== "SECURITY" && options.severity !== "SCHEMA")),
      });
    };
    add(
      "BUSINESS_PROFILE",
      "BUSINESS_PROFILE_COMPLETE",
      Boolean(
        tenant.country_code && tenant.accounting_mode && tenant.default_currency && tenant.timezone,
      ),
      "Business profile contains country, currency, timezone and accounting mode",
      "Complete the business profile",
      {
        evidence: {
          countryCode: tenant.country_code ?? null,
          accountingMode: tenant.accounting_mode ?? null,
        },
      },
    );
    add(
      "BRANCHES",
      "ACTIVE_BRANCH_EXISTS",
      counts.branches > 0,
      `${counts.branches} active branch configuration(s) found`,
      "Create and configure at least one branch",
      { evidence: { count: counts.branches } },
    );
    add(
      "USERS_ROLES",
      "ACTIVE_ADMIN_EXISTS",
      activeAdmins > 0,
      `${activeAdmins} active setup administrator(s) found`,
      "Invite an active administrator with setup management permission",
      { evidence: { activeAdmins, activeUsers: counts.users } },
    );
    add(
      "USERS_ROLES",
      "BRANCH_ACCESS_ASSIGNED",
      unassignedBranches === 0,
      `${unassignedBranches} active branch(es) have no active user assignment`,
      "Assign at least one active user to every branch",
      { evidence: { unassignedBranches } },
    );
    add(
      "MENU",
      "MENU_CATALOG_READY",
      counts.menuItems > 0,
      `${counts.menuItems} active menu item(s) found`,
      "Preview and commit the menu import",
      { evidence: { count: counts.menuItems } },
    );
    const branchPolicy = branchId
      ? await this.branchPolicy(branchId)
      : await this.combinedBranchPolicy();
    const inventoryApplicable = branchPolicy?.inventory_enabled !== 0;
    if (inventoryApplicable)
      add(
        "INVENTORY",
        "INVENTORY_MASTER_READY",
        counts.inventoryItems > 0,
        `${counts.inventoryItems} active inventory item(s) found`,
        "Import inventory master data",
        { evidence: { count: counts.inventoryItems } },
      );
    else rows.push(notApplicable("INVENTORY", "INVENTORY_NOT_ENABLED", branchId));
    if (inventoryApplicable && branchPolicy?.recipes_required !== 0) {
      const validationResult = await this.validateRecipes();
      const critical = validationResult.issues.filter((value) => value.severity === "CRITICAL");
      add(
        "RECIPES_UOM",
        "RECIPES_VALID",
        counts.menuItems > 0 && critical.length === 0,
        critical.length
          ? `${critical.length} critical recipe/UOM issue(s) remain`
          : "Recipes and UOMs are valid",
        "Resolve missing recipes, invalid conversions and cycles",
        { evidence: { critical: critical.length, total: validationResult.issues.length } },
      );
    } else rows.push(notApplicable("RECIPES_UOM", "RECIPES_NOT_REQUIRED", branchId));
    // Suppliers feed procurement, which only applies once stock is tracked.
    if (inventoryApplicable)
      add(
        "SUPPLIERS",
        "SUPPLIER_MASTER_AVAILABLE",
        counts.suppliers > 0,
        `${counts.suppliers} active supplier(s) found`,
        "Import suppliers when procurement is enabled",
        { warning: true, evidence: { count: counts.suppliers } },
      );
    else rows.push(notApplicable("SUPPLIERS", "SUPPLIERS_NOT_REQUIRED", branchId));
    const mappingCounts = await this.db
      .prepare(
        `SELECT COUNT(*) count FROM setup_account_mappings WHERE tenant_id=? AND status='CONFIGURED' AND finance_signoff_status='APPROVED' AND requirement='REQUIRED' AND (branch_id=? OR branch_id IS NULL)`,
      )
      .bind(this.actor.tenantId, branchId ?? null)
      .first<CountRow>();
    add(
      "ACCOUNTING",
      "ACCOUNT_MAPPINGS_COMPLETE",
      number(mappingCounts?.count) >= requiredAccountMappings.length,
      `${number(mappingCounts?.count)} of ${requiredAccountMappings.length} required account mappings configured and approved`,
      "Configure and obtain finance sign-off for required accounts",
      {
        evidence: {
          configuredAndApproved: number(mappingCounts?.count),
          required: requiredAccountMappings.length,
        },
      },
    );
    const noTaxSignedOff = taxCount === 0 && (await this.ownerSignedOffNoTax());
    add(
      "TAX_SERVICE",
      "TAX_SERVICE_REVIEWED",
      taxCount > 0 || noTaxSignedOff,
      noTaxSignedOff
        ? "The owner confirmed during onboarding that no tax or service charge applies"
        : `${taxCount} active tax/service rule(s) found`,
      "Configure tax and service charge rules or explicitly sign off not applicable",
      { warning: true, evidence: { count: taxCount, noTaxSignedOff } },
    );
    const paymentRequired = branchPolicy?.payments_required !== 0;
    if (paymentRequired)
      add(
        "PAYMENTS",
        "PAYMENT_CONFIGURATION_READY",
        paymentCount > 0 && invalidProviderPaymentMethods === 0,
        `${paymentCount} active payment method(s); ${invalidProviderPaymentMethods} provider-backed method(s) missing verified configuration`,
        "Configure a payment method and required provider credentials",
        { evidence: { count: paymentCount, invalidProviderPaymentMethods } },
      );
    else rows.push(notApplicable("PAYMENTS", "PAYMENTS_NOT_REQUIRED", branchId));
    if (deliveryCount)
      add(
        "DELIVERY_INTEGRATIONS",
        "DELIVERY_CONNECTIONS_HEALTHY",
        counts.providerConnections > 0,
        `${counts.providerConnections} provider connection(s) found`,
        "Complete branch, store and product mapping",
        {
          warning: counts.providerConnections === 0,
          evidence: { channels: deliveryCount, connections: counts.providerConnections },
        },
      );
    else rows.push(notApplicable("DELIVERY_INTEGRATIONS", "DELIVERY_NOT_ENABLED", branchId));
    add(
      "KITCHEN_STATIONS",
      "STATIONS_CONFIGURED",
      stationCount > 0,
      `${stationCount} active station(s) found`,
      "Configure production stations and KDS routing",
      { evidence: { count: stationCount } },
    );
    const printingRequired = branchPolicy?.printing_required !== 0;
    if (printingRequired)
      add(
        "PRINTERS_DEVICES",
        "REQUIRED_DEVICES_CONFIGURED",
        deviceCount > 0,
        `${deviceCount} configured device(s) found`,
        "Register required printers/devices and record real health",
        { evidence: { count: deviceCount } },
      );
    else rows.push(notApplicable("PRINTERS_DEVICES", "PRINTING_NOT_REQUIRED", branchId));
    add(
      "DOCUMENTS",
      "DOCUMENT_TEMPLATES_READY",
      documentCount >= 4,
      `${documentCount} active document template(s) found`,
      "Configure KOT, bill, receipt and invoice templates",
      { evidence: { count: documentCount } },
    );
    if (inventoryApplicable) {
      const openingCount = await count(
        this.db,
        `SELECT COUNT(*) count FROM opening_stock_batches WHERE tenant_id=? AND status='POSTED' AND (? IS NULL OR branch_id=?)`,
        this.actor.tenantId,
        branchId ?? null,
        branchId ?? null,
      );
      add(
        "OPENING_STOCK",
        "OPENING_STOCK_POSTED",
        openingCount > 0,
        `${openingCount} posted opening-stock batch(es) found`,
        "Approve and post opening stock through the movement ledger",
        { evidence: { count: openingCount } },
      );
    } else rows.push(notApplicable("OPENING_STOCK", "OPENING_STOCK_NOT_APPLICABLE", branchId));
    add(
      "TESTING",
      "REQUIRED_TESTS_PASSED",
      successfulTests > 0,
      `${successfulTests} successful setup test(s) found`,
      "Run safe test print/order/integration checks",
      { evidence: { count: successfulTests } },
    );
    if (printingRequired) {
      const printTests = await count(
        this.db,
        `SELECT COUNT(*) count FROM setup_test_runs WHERE tenant_id=? AND test_type='PRINT' AND status='SUCCESS' AND (? IS NULL OR branch_id=?)`,
        this.actor.tenantId,
        branchId ?? null,
        branchId ?? null,
      );
      add(
        "TESTING",
        "PRINT_TEST_PASSED",
        printTests > 0,
        `${printTests} successful test print(s) found`,
        "Complete a marked test print on the required branch device",
        { evidence: { count: printTests } },
      );
    }
    if (branchPolicy?.kds_required) {
      const kdsDevices = await count(
        this.db,
        `SELECT COUNT(*) count FROM hardware_devices WHERE tenant_id=? AND device_type='KDS' AND trust_status='ACTIVE' AND (? IS NULL OR branch_id=?)`,
        this.actor.tenantId,
        branchId ?? null,
        branchId ?? null,
      );
      add(
        "TESTING",
        "KDS_DEVICE_READY",
        kdsDevices > 0,
        `${kdsDevices} active KDS device(s) found`,
        "Register and authorize the required KDS device",
        { evidence: { count: kdsDevices } },
      );
    }
    const runtime = resolveRuntimeConfiguration(this.env);
    const runtimeIssues = validateRuntimeConfiguration(this.env);
    const schema = await this.db
      .prepare("SELECT MAX(version) version FROM schema_migrations")
      .first<{ version: number }>();
    add(
      "READINESS",
      "SCHEMA_VERSION_CURRENT",
      number(schema?.version) >= CURRENT_SCHEMA_VERSION,
      `Schema version ${number(schema?.version)}; required ${CURRENT_SCHEMA_VERSION}`,
      "Apply deployment-controlled migrations",
      {
        severity: "SCHEMA",
        evidence: { current: number(schema?.version), required: CURRENT_SCHEMA_VERSION },
        overrideAllowed: false,
      },
    );
    add(
      "READINESS",
      "PRODUCTION_SECURITY_READY",
      runtimeIssues.length === 0 || runtime.environment === "development",
      runtimeIssues.length
        ? `${runtimeIssues.length} runtime readiness issue(s) detected`
        : "Production runtime controls are ready",
      "Resolve production database, identity, queue, HTTPS and secret-store configuration",
      {
        severity: "SECURITY",
        evidence: { issueCodes: runtimeIssues.map((value) => value.code) },
        overrideAllowed: false,
      },
    );
    add(
      "READINESS",
      "VERIFIED_BACKUP_AVAILABLE",
      verifiedBackups > 0,
      `${verifiedBackups} verified backup record(s) found`,
      "Complete and verify a recoverable database backup before pilot",
      {
        warning: !runtime.productionLike,
        severity: "SECURITY",
        evidence: { count: verifiedBackups },
        overrideAllowed: !runtime.productionLike,
      },
    );
    add(
      "GO_LIVE",
      "NO_DEAD_LETTERS",
      counts.deadLetters === 0,
      `${counts.deadLetters} open dead-letter record(s)`,
      "Resolve critical worker/integration failures before go-live",
      { warning: counts.deadLetters > 0, evidence: { count: counts.deadLetters } },
    );
    return rows;
  }

  private async countSetupFacts(branchId?: string): Promise<SetupSummary["counts"]> {
    const scoped = branchId ? " AND branch_id=?" : "";
    const branchArgs = branchId ? [branchId] : [];
    // Started together and awaited once; see buildReadinessResults.
    const pending = {
      branches: branchId
        ? count(
            this.db,
            "SELECT COUNT(*) count FROM branches WHERE tenant_id=? AND id=? AND active=1",
            this.actor.tenantId,
            branchId,
          )
        : count(
            this.db,
            "SELECT COUNT(*) count FROM branches WHERE tenant_id=? AND active=1",
            this.actor.tenantId,
          ),
      users: count(
        this.db,
        "SELECT COUNT(*) count FROM users WHERE tenant_id=? AND active=1",
        this.actor.tenantId,
      ),
      menuItems: count(
        this.db,
        "SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=? AND active=1",
        this.actor.tenantId,
      ),
      inventoryItems: count(
        this.db,
        "SELECT COUNT(*) count FROM inventory_items WHERE tenant_id=? AND active=1",
        this.actor.tenantId,
      ),
      suppliers: count(
        this.db,
        "SELECT COUNT(*) count FROM suppliers WHERE tenant_id=? AND active=1",
        this.actor.tenantId,
      ),
      recipes: count(
        this.db,
        "SELECT COUNT(*) count FROM recipes WHERE tenant_id=? AND active=1",
        this.actor.tenantId,
      ),
      providerConnections: count(
        this.db,
        `SELECT COUNT(*) count FROM provider_connections WHERE tenant_id=?${scoped}`,
        this.actor.tenantId,
        ...branchArgs,
      ),
      devices: count(
        this.db,
        `SELECT COUNT(*) count FROM hardware_devices WHERE tenant_id=?${scoped}`,
        this.actor.tenantId,
        ...branchArgs,
      ),
      openImports: count(
        this.db,
        "SELECT COUNT(*) count FROM setup_imports WHERE tenant_id=? AND status NOT IN ('COMMITTED','REJECTED','FAILED')",
        this.actor.tenantId,
      ),
      deadLetters: count(
        this.db,
        `SELECT
          (SELECT COUNT(*) FROM integration_dead_letters WHERE tenant_id=? AND status='OPEN') +
          (SELECT COUNT(*) FROM worker_jobs WHERE tenant_id=? AND status='DEAD_LETTER') count`,
        this.actor.tenantId,
        this.actor.tenantId,
      ),
    };
    const values = await Promise.all(Object.values(pending));
    return Object.fromEntries(
      Object.keys(pending).map((key, index) => [key, values[index]]),
    ) as SetupSummary["counts"];
  }

  private async sectionWeights() {
    const rows = await this.db
      .prepare("SELECT section_key,weight_bps FROM setup_section_weights WHERE tenant_id=?")
      .bind(this.actor.tenantId)
      .all<{ section_key: SetupSection; weight_bps: number }>();
    const configured = Object.fromEntries(
      (rows.results ?? []).map((row) => [row.section_key, row.weight_bps]),
    );
    return Object.fromEntries(
      setupSections.map((section) => [section, configured[section] ?? defaultWeights[section]]),
    ) as Record<SetupSection, number>;
  }

  private async validateRows(
    kind: string,
    rawRows: Array<Record<string, string>>,
    branchId?: string,
    columnMap?: Record<string, string>,
    menuOptions?: {
      targetMode: ImportTargetMode;
      targetBranchIds: string[];
      referenceMap?: { stations?: Record<string, string> };
      templateVersion: number;
      unsupportedColumns: string[];
      duplicateStrategy: ImportPreview["duplicateStrategy"];
    },
  ): Promise<ImportPreviewRow[]> {
    if (kind === "MENU" && menuOptions) {
      return this.validateMenuImportRows(rawRows, columnMap, menuOptions);
    }
    const rows: ImportPreviewRow[] = [];
    const seen = new Set<string>();
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string }>();
    const defaultCurrency = tenant?.default_currency?.toUpperCase();
    for (let index = 0; index < rawRows.length; index += 1) {
      const source = applyColumnMap(rawRows[index]!, columnMap);
      const normalized = normalizeImportRow(kind, source, branchId, defaultCurrency);
      const errors: ImportIssue[] = [];
      const warnings: ImportIssue[] = [];
      const suppliedIdentity = string(normalized.code || normalized.employeeCode).trim();
      const rowKey = (suppliedIdentity || `${kind}-ROW-${index + 1}`).toUpperCase();
      if (seen.has(rowKey))
        errors.push(importIssue("code", "DUPLICATE_ROW_KEY", "Duplicate row key in import"));
      seen.add(rowKey);
      if (!suppliedIdentity)
        errors.push(importIssue("code", "REQUIRED", "A stable code is required"));
      if (!normalized.name) errors.push(importIssue("name", "REQUIRED", "Name is required"));
      if (kind === "MENU") {
        if (!normalized.categoryCode)
          errors.push(importIssue("category", "REQUIRED", "Category is required"));
        if (
          !Number.isInteger(normalized.sellingPriceMinor) ||
          number(normalized.sellingPriceMinor) < 0
        )
          errors.push(
            importIssue("price", "INVALID_MONEY", "Selling price must be valid non-negative money"),
          );
        if (normalized.stationCode) {
          const station = await this.db
            .prepare(
              "SELECT id FROM stations WHERE tenant_id=? AND (id=? OR UPPER(code)=UPPER(?)) AND active=1",
            )
            .bind(this.actor.tenantId, normalized.stationCode, normalized.stationCode)
            .first<{ id: string }>();
          if (!station)
            errors.push(importIssue("station", "UNKNOWN_STATION", "Station is not configured"));
          else normalized.stationId = station.id;
        }
      } else if (kind === "INVENTORY") {
        if (!normalized.baseUnitCode)
          errors.push(importIssue("baseUnit", "REQUIRED", "Base unit code is required"));
        if (!normalized.dimension)
          errors.push(importIssue("dimension", "REQUIRED", "Unit dimension is required"));
        const numerator = number(normalized.factorNumerator ?? 1);
        const denominator = number(normalized.factorDenominator ?? 1);
        if (
          !Number.isSafeInteger(numerator) ||
          !Number.isSafeInteger(denominator) ||
          numerator <= 0 ||
          denominator <= 0
        )
          errors.push(
            importIssue(
              "conversion",
              "INVALID_RATIONAL",
              "Conversion numerator and denominator must be positive integers",
            ),
          );
        if (normalized.purchaseUnitCode === normalized.baseUnitCode && numerator !== denominator)
          errors.push(
            importIssue(
              "conversion",
              "AMBIGUOUS_BASE_UNIT",
              "A base unit cannot have a non-identity conversion to itself",
            ),
          );
        const unit = await this.db
          .prepare(
            "SELECT id,dimension FROM unit_definitions WHERE tenant_id=? AND UPPER(code)=? AND active=1",
          )
          .bind(this.actor.tenantId, normalized.baseUnitCode)
          .first<{ id: string; dimension: string }>();
        if (
          !["MASS", "VOLUME", "COUNT", "LENGTH", "OTHER"].includes(string(normalized.dimension)) ||
          (unit && unit.dimension !== normalized.dimension)
        )
          errors.push(
            importIssue(
              "baseUnit",
              "INVALID_UNIT_DIMENSION",
              "Unit dimension must match the configured unit",
            ),
          );
        normalized.baseUnitId = unit?.id ?? stableId("unit", string(normalized.baseUnitCode));
        const purchase = await this.db
          .prepare(
            "SELECT id,dimension FROM unit_definitions WHERE tenant_id=? AND UPPER(code)=? AND active=1",
          )
          .bind(this.actor.tenantId, normalized.purchaseUnitCode)
          .first<{ id: string; dimension: string }>();
        if (purchase && purchase.dimension !== normalized.dimension)
          errors.push(
            importIssue(
              "purchaseUnit",
              "INVALID_UNIT_DIMENSION",
              "Purchase unit dimension must match the base unit",
            ),
          );
        normalized.purchaseUnitId =
          purchase?.id ?? stableId("unit", string(normalized.purchaseUnitCode));
        const warehouse = await this.db
          .prepare(
            "SELECT id FROM warehouses WHERE tenant_id=? AND branch_id=? AND active=1 AND (id=? OR UPPER(code)=UPPER(?))",
          )
          .bind(
            this.actor.tenantId,
            branchId ?? "",
            normalized.warehouseId ?? "",
            normalized.warehouseId ?? "",
          )
          .first<{ id: string }>();
        if (!warehouse)
          errors.push(
            importIssue(
              "warehouse",
              "UNKNOWN_WAREHOUSE",
              "Choose an active warehouse in the selected branch",
            ),
          );
        else normalized.warehouseId = warehouse.id;
        const category = await this.db
          .prepare(
            "SELECT id FROM inventory_categories WHERE tenant_id=? AND active=1 AND (id=? OR UPPER(code)=UPPER(?))",
          )
          .bind(this.actor.tenantId, normalized.categoryCode ?? "", normalized.categoryCode ?? "")
          .first<{ id: string }>();
        if (!category)
          errors.push(
            importIssue(
              "category",
              "UNKNOWN_CATEGORY",
              "Configure the inventory category before importing",
            ),
          );
        else normalized.categoryId = category.id;
        const existing = await this.db
          .prepare("SELECT id FROM inventory_items WHERE tenant_id=? AND UPPER(sku)=UPPER(?)")
          .bind(this.actor.tenantId, suppliedIdentity)
          .first<{ id: string }>();
        if (existing) {
          if (menuOptions?.duplicateStrategy === "SKIP") normalized.existingId = existing.id;
          else
            errors.push(
              importIssue(
                "code",
                "EXISTING_ITEM",
                "Item exists; use Skip existing or edit the item separately",
              ),
            );
        }
        if (menuOptions?.duplicateStrategy === "UPDATE")
          errors.push(
            importIssue(
              "duplicateStrategy",
              "UPDATE_REQUIRES_REVIEW",
              "Spreadsheet updates to existing stock masters are not supported; edit reviewed item settings instead",
            ),
          );
      } else if (kind === "SUPPLIER") {
        if (number(normalized.leadTimeDays ?? 0) < 0)
          errors.push(importIssue("leadTimeDays", "INVALID", "Lead time cannot be negative"));
      } else if (kind === "STAFF") {
        if (
          Object.keys(source).some((key) =>
            ["password", "pin", "passwordhash"].includes(key.toLowerCase()),
          )
        )
          errors.push(
            importIssue(
              "credentials",
              "PLAINTEXT_CREDENTIAL_FORBIDDEN",
              "Passwords and PINs cannot be imported",
            ),
          );
        const role = await this.db
          .prepare(
            "SELECT id FROM roles WHERE tenant_id=? AND (id=? OR UPPER(code)=UPPER(?)) AND active=1",
          )
          .bind(this.actor.tenantId, normalized.roleCode, normalized.roleCode)
          .first<{ id: string }>();
        if (!role) errors.push(importIssue("role", "UNKNOWN_ROLE", "Role is not configured"));
        else normalized.roleId = role.id;
        const targetBranch = normalized.branchCode
          ? await this.db
              .prepare(
                "SELECT id FROM branches WHERE tenant_id=? AND (id=? OR UPPER(code)=UPPER(?)) AND active=1",
              )
              .bind(this.actor.tenantId, normalized.branchCode, normalized.branchCode)
              .first<{ id: string }>()
          : null;
        if (!targetBranch)
          errors.push(importIssue("branch", "UNKNOWN_BRANCH", "Branch is not configured"));
        else normalized.branchId = targetBranch.id;
      }
      rows.push({
        rowNumber: index + 1,
        rowKey,
        status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "VALID",
        normalized,
        errors,
        warnings,
        ...(kind === "INVENTORY"
          ? {
              action: errors.length
                ? ("ERROR" as const)
                : normalized.existingId
                  ? ("SKIP" as const)
                  : ("CREATE" as const),
            }
          : {}),
      });
    }
    return rows;
  }

  private async validateMenuImportRows(
    rawRows: Array<Record<string, string>>,
    columnMap: Record<string, string> | undefined,
    options: {
      targetMode: ImportTargetMode;
      targetBranchIds: string[];
      referenceMap?: { stations?: Record<string, string> };
      templateVersion: number;
      unsupportedColumns: string[];
      duplicateStrategy: ImportPreview["duplicateStrategy"];
    },
  ): Promise<ImportPreviewRow[]> {
    const [
      tenant,
      branchesResult,
      stationsResult,
      catalogResult,
      taxesResult,
      unitsResult,
      channelsResult,
      recipesResult,
      currenciesResult,
      acceptedCurrenciesResult,
      stationAliasesResult,
    ] = await Promise.all([
      this.db
        .prepare("SELECT default_currency FROM tenants WHERE id=?")
        .bind(this.actor.tenantId)
        .first<{ default_currency: string }>(),
      this.db
        .prepare("SELECT id,code,name FROM branches WHERE tenant_id=? AND active=1")
        .bind(this.actor.tenantId)
        .all<{ id: string; code: string; name: string }>(),
      this.db
        .prepare("SELECT id,branch_id,code,name FROM stations WHERE tenant_id=? AND active=1")
        .bind(this.actor.tenantId)
        .all<{ id: string; branch_id: string; code: string; name: string }>(),
      this.db
        .prepare(
          `SELECT id,code,sku,barcode,name,category_code,selling_price_minor,currency,station_id,
                    tax_rule_id,sellable,payload_json FROM menu_catalog_items WHERE tenant_id=?`,
        )
        .bind(this.actor.tenantId)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          "SELECT id,branch_id,code FROM tax_service_rules WHERE tenant_id=? AND rule_type='TAX' AND active=1",
        )
        .bind(this.actor.tenantId)
        .all<{ id: string; branch_id: string | null; code: string }>(),
      this.db
        .prepare("SELECT id,code FROM unit_definitions WHERE tenant_id=? AND active=1")
        .bind(this.actor.tenantId)
        .all<{ id: string; code: string }>(),
      this.db
        .prepare("SELECT id,code FROM order_channels WHERE tenant_id=? AND active=1")
        .bind(this.actor.tenantId)
        .all<{ id: string; code: string }>(),
      this.db
        .prepare("SELECT id FROM recipes WHERE tenant_id=? AND active=1")
        .bind(this.actor.tenantId)
        .all<{ id: string }>(),
      this.db.prepare("SELECT code FROM currency_reference WHERE active=1").all<{ code: string }>(),
      this.db
        .prepare(
          "SELECT currency_code FROM tenant_accepted_currencies WHERE tenant_id=? AND status='ACTIVE'",
        )
        .bind(this.actor.tenantId)
        .all<{ currency_code: string }>(),
      this.db
        .prepare(
          `SELECT branch_id,source_value_normalized,target_id
           FROM setup_import_reference_aliases
           WHERE tenant_id=? AND reference_type='STATION' AND active=1`,
        )
        .bind(this.actor.tenantId)
        .all<{ branch_id: string | null; source_value_normalized: string; target_id: string }>(),
    ]);
    const branches = branchesResult.results ?? [];
    const branchByReference = new Map<string, { id: string; code: string; name: string }>();
    for (const branch of branches) {
      branchByReference.set(branch.id.toUpperCase(), branch);
      branchByReference.set(branch.code.toUpperCase(), branch);
    }
    const stations = stationsResult.results ?? [];
    const catalog = catalogResult.results ?? [];
    const existingByCode = new Map(catalog.map((row) => [string(row["code"]).toUpperCase(), row]));
    const existingBySku = new Map(
      catalog.flatMap((row) =>
        string(row["sku"]) ? [[string(row["sku"]).toUpperCase(), row] as const] : [],
      ),
    );
    const existingByBarcode = new Map(
      catalog.flatMap((row) =>
        string(row["barcode"]) ? [[string(row["barcode"]), row] as const] : [],
      ),
    );
    const taxRows = taxesResult.results ?? [];
    const unitCodes = new Set((unitsResult.results ?? []).map((row) => row.code.toUpperCase()));
    const channelCodes = new Set(
      (channelsResult.results ?? []).map((row) => row.code.toUpperCase()),
    );
    const recipeIds = new Set((recipesResult.results ?? []).map((row) => row.id));
    const knownCurrencies = new Set(
      (currenciesResult.results ?? []).map((row) => row.code.toUpperCase()),
    );
    const acceptedCurrencies = new Set(
      (acceptedCurrenciesResult.results ?? []).map((row) => row.currency_code.toUpperCase()),
    );
    const stationAliases = new Map(
      (stationAliasesResult.results ?? []).map((row) => [
        `${row.branch_id ?? "TENANT"}:${row.source_value_normalized}`,
        row.target_id,
      ]),
    );
    const seenAssignments = new Set<string>();
    const stationMap = normalizeReferenceMap(options.referenceMap).stations ?? {};
    const defaultCurrency = tenant?.default_currency?.toUpperCase();
    if (defaultCurrency) acceptedCurrencies.add(defaultCurrency);
    const results: ImportPreviewRow[] = [];

    for (let index = 0; index < rawRows.length; index += 1) {
      const source = applyMenuColumnMap(rawRows[index]!, columnMap);
      const normalized = normalizeImportRow("MENU", source, undefined, defaultCurrency);
      normalized.templateVersion = options.templateVersion;
      const errors: ImportIssue[] = [];
      const warnings: ImportIssue[] = [];
      const code = string(normalized.code).trim().toUpperCase();
      normalized.code = code;
      const targetBranches = [...options.targetBranchIds];
      if (options.targetMode === "ROW_BRANCHES") {
        const branchReference = string(normalized.branchCode).trim().toUpperCase();
        const branch = branchByReference.get(branchReference);
        if (!branch) {
          errors.push(importIssue("branchCode", "UNKNOWN_BRANCH", "Branch code is not configured"));
        } else {
          try {
            await this.assertImportBranch(branch.id);
            targetBranches.push(branch.id);
          } catch {
            errors.push(
              importIssue(
                "branchCode",
                "UNAUTHORIZED_BRANCH",
                "Branch is outside your import authority",
              ),
            );
          }
        }
      }
      normalized.targetBranchIds = [...new Set(targetBranches)];
      const assignmentKey = `${code}:${
        options.targetMode === "TENANT_MASTER"
          ? "TENANT_MASTER"
          : [...new Set(targetBranches)].sort().join("|")
      }`;
      if (seenAssignments.has(assignmentKey)) {
        errors.push(
          importIssue(
            "itemCode",
            "DUPLICATE_BRANCH_ROW",
            "Duplicate item and branch assignment in file",
          ),
        );
      }
      seenAssignments.add(assignmentKey);
      if (!code) errors.push(importIssue("itemCode", "REQUIRED", "A stable item code is required"));
      if (!normalized.name) errors.push(importIssue("name", "REQUIRED", "Name is required"));
      if (!normalized.categoryCode)
        errors.push(importIssue("categoryCode", "REQUIRED", "Category code is required"));
      const currency = string(normalized.currency).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        errors.push(
          importIssue("currency", "INVALID_CURRENCY", "A valid ISO currency is required"),
        );
      } else if (!knownCurrencies.has(currency) || !acceptedCurrencies.has(currency)) {
        errors.push(
          importIssue("currency", "UNSUPPORTED_CURRENCY", "Currency is not active for this tenant"),
        );
      } else {
        normalized.sellingPriceMinor = parseMenuMoney(string(normalized.rawBasePrice), currency);
        normalized.costPriceMinor = string(normalized.rawCostPrice)
          ? parseMenuMoney(string(normalized.rawCostPrice), currency)
          : undefined;
        normalized.branchPriceMinor = string(normalized.rawBranchPrice)
          ? parseMenuMoney(string(normalized.rawBranchPrice), currency)
          : undefined;
        normalized.onlinePriceMinor = string(normalized.rawOnlinePrice)
          ? parseMenuMoney(string(normalized.rawOnlinePrice), currency)
          : undefined;
      }
      if (
        !Number.isSafeInteger(normalized.sellingPriceMinor) ||
        number(normalized.sellingPriceMinor) < 0
      ) {
        errors.push(importIssue("basePrice", "INVALID_MONEY", "Selling price is not valid money"));
      }
      if (
        normalized.costPriceMinor !== undefined &&
        (!Number.isSafeInteger(normalized.costPriceMinor) || number(normalized.costPriceMinor) < 0)
      ) {
        errors.push(importIssue("costPrice", "INVALID_MONEY", "Cost price is not valid money"));
      }
      if (
        normalized.branchPriceMinor !== undefined &&
        (!Number.isSafeInteger(normalized.branchPriceMinor) ||
          number(normalized.branchPriceMinor) < 0)
      ) {
        errors.push(importIssue("branchPrice", "INVALID_MONEY", "Branch price is not valid money"));
      }
      if (
        normalized.onlinePriceMinor !== undefined &&
        (!Number.isSafeInteger(normalized.onlinePriceMinor) ||
          number(normalized.onlinePriceMinor) < 0)
      ) {
        errors.push(importIssue("onlinePrice", "INVALID_MONEY", "Online price is not valid money"));
      }
      if (!Number.isSafeInteger(normalized.prepMinutes) || number(normalized.prepMinutes) < 0) {
        errors.push(
          importIssue("prepMinutes", "INVALID", "Preparation minutes must be zero or greater"),
        );
      }
      if (!Number.isSafeInteger(normalized.parLevel) || number(normalized.parLevel) < 0) {
        errors.push(importIssue("parLevel", "INVALID", "PAR level must be zero or greater"));
      }
      for (const unsupported of options.unsupportedColumns) {
        if (source[normalizeKey(unsupported)]?.trim()) {
          warnings.push(
            importIssue(
              unsupported,
              "UNSUPPORTED_COLUMN",
              `Populated column ${unsupported} is not part of menu template v${MENU_IMPORT_TEMPLATE_VERSION}`,
            ),
          );
        }
      }

      const sku = string(normalized.sku).trim().toUpperCase();
      const skuOwner = sku ? existingBySku.get(sku) : undefined;
      if (skuOwner && string(skuOwner["code"]).toUpperCase() !== code) {
        errors.push(importIssue("sku", "SKU_CONFLICT", "SKU belongs to another menu item"));
      }
      const barcode = string(normalized.barcode).trim();
      const barcodeOwner = barcode ? existingByBarcode.get(barcode) : undefined;
      if (barcodeOwner && string(barcodeOwner["code"]).toUpperCase() !== code) {
        errors.push(
          importIssue("barcode", "BARCODE_CONFLICT", "Barcode belongs to another menu item"),
        );
      }

      const stationSource = string(normalized.stationCode).trim();
      if (stationSource && options.targetMode === "TENANT_MASTER") {
        warnings.push(
          importIssue(
            "stationCode",
            "BRANCH_ACTIVATION_REQUIRED",
            "Station is branch-specific and will be applied when the item is activated for a branch",
          ),
        );
      } else if (targetBranches.length) {
        const stationIdsByBranch: Record<string, string> = {};
        for (const targetBranchId of targetBranches) {
          if (!stationSource) {
            warnings.push(
              importIssue(
                "stationCode",
                "UNASSIGNED_STATION",
                "No production station is assigned for this branch",
              ),
            );
            continue;
          }
          const normalizedSource = normalizeReferenceValue(stationSource);
          const mappedReference =
            stationMap[normalizedSource] ??
            stationAliases.get(`${targetBranchId}:${normalizedSource}`) ??
            stationAliases.get(`TENANT:${normalizedSource}`) ??
            stationSource;
          const station = stations.find(
            (candidate) =>
              candidate.branch_id === targetBranchId &&
              (candidate.id === mappedReference ||
                candidate.code.toUpperCase() === mappedReference.toUpperCase()),
          );
          if (!station) {
            errors.push(
              importIssue(
                "stationCode",
                "UNKNOWN_STATION",
                `Station ${stationSource} is not configured for the target branch`,
              ),
            );
          } else {
            stationIdsByBranch[targetBranchId] = station.id;
          }
        }
        normalized.stationIdsByBranch = stationIdsByBranch;
        normalized.stationId = Object.values(stationIdsByBranch)[0];
      }

      const taxCode = string(normalized.taxCode).trim();
      if (taxCode) {
        const applicable = taxRows.filter(
          (tax) =>
            (tax.id === taxCode || tax.code.toUpperCase() === taxCode.toUpperCase()) &&
            (!tax.branch_id || targetBranches.includes(tax.branch_id)),
        );
        if (!applicable.length) {
          errors.push(
            importIssue("taxCode", "UNKNOWN_TAX", "Tax code is not active for the target"),
          );
        } else {
          normalized.taxRuleId = applicable[0]!.id;
        }
      }
      const unit = string(normalized.unitOfMeasure).trim().toUpperCase();
      if (unit && !unitCodes.has(unit)) {
        errors.push(
          importIssue("unitOfMeasure", "UNKNOWN_UNIT", "Unit of measure is not configured"),
        );
      }
      if (string(normalized.kitchenPrinterGroup).trim()) {
        warnings.push(
          importIssue(
            "kitchenPrinterGroup",
            "ROUTING_REFERENCE_PENDING",
            "Printer group is retained for routing review because no printer-group master exists",
          ),
        );
      }
      const recipeReference = string(normalized.recipeReference).trim();
      if (recipeReference && !recipeIds.has(recipeReference)) {
        normalized.recipePending = true;
        warnings.push(
          importIssue(
            "recipeCode",
            "RECIPE_PENDING",
            "Recipe reference is not linked to an active recipe and remains pending",
          ),
        );
      }
      if (string(normalized.modifierGroupReference).trim()) {
        warnings.push(
          importIssue(
            "modifierGroupCode",
            "MODIFIER_REFERENCE_PENDING",
            "Modifier group is retained but cannot be verified because no modifier-group master exists",
          ),
        );
      }
      if (string(normalized.imageFilename).trim()) {
        warnings.push(
          importIssue(
            "imageFilename",
            "IMAGE_REFERENCE_PENDING",
            "Image filename is retained; upload and asset verification remain separate",
          ),
        );
      }
      if (string(normalized.branchCode).trim() && options.targetMode !== "ROW_BRANCHES") {
        warnings.push(
          importIssue(
            "branchCode",
            "BRANCH_COLUMN_NOT_TARGETING",
            `branchCode is not used because targeting is controlled by ${options.targetMode}`,
          ),
        );
      }
      const suppliedChannels = Array.isArray(normalized.channelCodes)
        ? (normalized.channelCodes as string[])
        : [];
      const suppliedOnlinePriceChannels = Array.isArray(normalized.onlinePriceChannelCodes)
        ? (normalized.onlinePriceChannelCodes as string[])
        : [];
      const unknownChannels = [
        ...new Set([...suppliedChannels, ...suppliedOnlinePriceChannels]),
      ].filter((channel) => !channelCodes.has(channel));
      if (unknownChannels.length) {
        errors.push(
          importIssue(
            "channels",
            "UNKNOWN_CHANNEL",
            `Ordering channel is not configured: ${unknownChannels.join(", ")}`,
          ),
        );
      }

      const existing = existingByCode.get(code);
      normalized.existingId = existing?.["id"];
      let action: NonNullable<ImportPreviewRow["action"]> = "CREATE";
      if (existing) {
        normalized.before = existing;
        if (options.duplicateStrategy === "ERROR" || options.duplicateStrategy === "CREATE") {
          errors.push(
            importIssue(
              "itemCode",
              "DUPLICATE_ITEM",
              `Menu item ${code} already exists; choose Update existing or Skip existing`,
            ),
          );
          action = "ERROR";
        } else if (options.duplicateStrategy === "SKIP") {
          action = "SKIP";
        } else {
          action =
            targetBranches.length || !menuRowMatchesExisting(normalized, existing)
              ? "UPDATE"
              : "NO_CHANGE";
        }
      } else if (options.duplicateStrategy === "UPDATE") {
        errors.push(
          importIssue(
            "itemCode",
            "MISSING_FOR_UPDATE",
            `Menu item ${code} does not exist for Update existing`,
          ),
        );
        action = "ERROR";
      }
      results.push({
        rowNumber: index + 1,
        rowKey: assignmentKey || `MENU-ROW-${index + 1}`,
        status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "VALID",
        action: errors.length ? "ERROR" : action,
        normalized,
        errors,
        warnings,
      });
    }
    return results;
  }

  private buildMenuStageStatements(
    importId: string,
    rowNumber: number,
    action: string,
    value: ImportValue,
    planDigest: string,
  ) {
    const itemId = stableId("menu", string(value.code).toUpperCase());
    const stamp = now();
    const menuPayload = {
      imported: true,
      importId,
      templateVersion: value.templateVersion,
      menuSection: value.menuSection,
      costPriceMinor: value.costPriceMinor,
      unitOfMeasure: value.unitOfMeasure,
      prepMinutes: value.prepMinutes,
      parLevel: value.parLevel,
      imageFilename: value.imageFilename,
      onlinePriceMinor: value.onlinePriceMinor,
      onlinePriceChannelCodes: Array.isArray(value.onlinePriceChannelCodes)
        ? value.onlinePriceChannelCodes
        : [],
      recipePending: Boolean(value.recipePending),
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO menu_import_staged_items
            (tenant_id,import_id,menu_item_id,source_row_number,action,before_json,after_json,
             plan_digest,code,sku,name,category_code,description,selling_price_minor,currency,
             tax_rule_id,service_charge_applicable,recipe_reference,modifier_group_reference,
             barcode,sellable,payload_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,import_id,menu_item_id) DO UPDATE SET
             after_json=excluded.after_json,plan_digest=excluded.plan_digest,
             code=excluded.code,sku=excluded.sku,name=excluded.name,
             category_code=excluded.category_code,description=excluded.description,
             selling_price_minor=excluded.selling_price_minor,currency=excluded.currency,
             tax_rule_id=excluded.tax_rule_id,
             service_charge_applicable=excluded.service_charge_applicable,
             recipe_reference=excluded.recipe_reference,
             modifier_group_reference=excluded.modifier_group_reference,
             barcode=excluded.barcode,sellable=excluded.sellable,payload_json=excluded.payload_json`,
        )
        .bind(
          this.actor.tenantId,
          importId,
          itemId,
          rowNumber,
          action,
          json(value.before ?? {}),
          json(value),
          planDigest,
          string(value.code).toUpperCase(),
          optionalString(value.sku),
          string(value.name),
          string(value.categoryCode),
          optionalString(value.description),
          number(value.sellingPriceMinor),
          string(value.currency),
          optionalString(value.taxRuleId),
          bool(Boolean(value.serviceChargeApplicable)),
          optionalString(value.recipeReference),
          optionalString(value.modifierGroupReference),
          optionalString(value.barcode),
          bool(value.sellable !== false),
          json(menuPayload),
          stamp,
        ),
    ];
    const branchSettingKeys: string[] = [];
    const targetBranchIds = Array.isArray(value.targetBranchIds)
      ? [...new Set(value.targetBranchIds.map(string).filter(Boolean))]
      : [];
    for (const branchId of targetBranchIds) {
      branchSettingKeys.push(`${branchId}:${itemId}`);
      const stationIdsByBranch =
        value.stationIdsByBranch && typeof value.stationIdsByBranch === "object"
          ? (value.stationIdsByBranch as Record<string, unknown>)
          : {};
      const stationId = optionalString(stationIdsByBranch[branchId]);
      const sourceStation = string(value.stationCode).trim();
      const normalizedSource = sourceStation ? normalizeReferenceValue(sourceStation) : null;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO menu_import_staged_branch_settings
              (tenant_id,import_id,branch_id,menu_item_id,source_row_number,after_json,
               plan_digest,selling_price_minor,available,channel_availability_json,station_id,
               kitchen_printer_group,payload_json,source_station_normalized,reference_alias_id,
               created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(tenant_id,import_id,branch_id,menu_item_id) DO UPDATE SET
               after_json=excluded.after_json,plan_digest=excluded.plan_digest,
               selling_price_minor=excluded.selling_price_minor,available=excluded.available,
               channel_availability_json=excluded.channel_availability_json,
               station_id=excluded.station_id,
               kitchen_printer_group=excluded.kitchen_printer_group,
               payload_json=excluded.payload_json,
               source_station_normalized=excluded.source_station_normalized,
               reference_alias_id=excluded.reference_alias_id`,
          )
          .bind(
            this.actor.tenantId,
            importId,
            branchId,
            itemId,
            rowNumber,
            json(value),
            planDigest,
            value.branchPriceMinor === undefined ? null : number(value.branchPriceMinor),
            bool(value.available !== false),
            json(value.channelAvailability ?? {}),
            stationId,
            optionalString(value.kitchenPrinterGroup),
            json({
              imported: true,
              importId,
              templateVersion: value.templateVersion,
              onlinePriceChannelCodes: Array.isArray(value.onlinePriceChannelCodes)
                ? value.onlinePriceChannelCodes
                : [],
            }),
            normalizedSource,
            normalizedSource ? stableId("station-alias", `${branchId}:${normalizedSource}`) : null,
            stamp,
          ),
      );
    }
    return {
      statements,
      entityType: "MENU",
      entityId: itemId,
      skipped: false,
      created: action === "CREATE",
      masterChanged: action === "UPDATE",
      branchSettingKeys,
    };
  }

  private async buildImportStatements(
    kind: string,
    strategy: string,
    branchId: string | null,
    value: ImportValue,
    options: { masterAlreadyPlanned?: boolean } = {},
  ) {
    const code = string(value.code || value.employeeCode).toUpperCase();
    const stamp = now();
    const table =
      kind === "MENU"
        ? "menu_catalog_items"
        : kind === "INVENTORY"
          ? "inventory_items"
          : kind === "SUPPLIER"
            ? "suppliers"
            : kind === "STAFF"
              ? "employees"
              : "";
    if (!table) throw validation(`Commit is not implemented for ${kind}`);
    const keyColumn =
      kind === "STAFF"
        ? "employee_number"
        : kind === "MENU" || kind === "SUPPLIER"
          ? "code"
          : "sku";
    const exists = await this.db
      .prepare(`SELECT id FROM ${table} WHERE tenant_id=? AND ${keyColumn}=?`)
      .bind(this.actor.tenantId, code)
      .first<{ id: string }>();
    if (exists && strategy === "ERROR") throw validation(`${kind} ${code} already exists`);
    if (exists && strategy === "CREATE" && !options.masterAlreadyPlanned)
      throw validation(`${kind} ${code} already exists and cannot be created twice`);
    if (exists && strategy === "SKIP")
      return {
        statements: [] as D1PreparedStatement[],
        entityType: kind,
        entityId: exists.id,
        skipped: true,
      };
    if (!exists && !options.masterAlreadyPlanned && strategy === "UPDATE")
      throw validation(`${kind} ${code} does not exist for UPDATE strategy`);
    const id = exists?.id ?? stableId(kind.toLowerCase(), code);
    const statements: D1PreparedStatement[] = [];
    const branchSettingKeys: string[] = [];
    if (kind === "MENU") {
      const menuPayload = {
        imported: true,
        templateVersion: value.templateVersion,
        menuSection: value.menuSection,
        costPriceMinor: value.costPriceMinor,
        unitOfMeasure: value.unitOfMeasure,
        prepMinutes: value.prepMinutes,
        parLevel: value.parLevel,
        imageFilename: value.imageFilename,
        onlinePriceMinor: value.onlinePriceMinor,
        onlinePriceChannelCodes: Array.isArray(value.onlinePriceChannelCodes)
          ? value.onlinePriceChannelCodes
          : [],
        recipePending: Boolean(value.recipePending),
      };
      const insertSql = `INSERT INTO menu_catalog_items
            (tenant_id,id,code,sku,name,category_code,description,selling_price_minor,currency,
             tax_rule_id,service_charge_applicable,station_id,recipe_reference,modifier_group_reference,
             barcode,sellable,active,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`;
      const updateSql = `UPDATE menu_catalog_items SET
             code=?,sku=?,name=?,category_code=?,description=?,selling_price_minor=?,currency=?,
             tax_rule_id=?,service_charge_applicable=?,station_id=NULL,recipe_reference=?,
             modifier_group_reference=?,barcode=?,sellable=?,payload_json=?,updated_at=?
           WHERE tenant_id=? AND id=?`;
      if (options.masterAlreadyPlanned) {
        // The same new tenant item may have multiple row-branch assignments in one atomic import.
      } else if (exists) {
        statements.push(
          this.db
            .prepare(updateSql)
            .bind(
              code,
              optionalString(value.sku),
              string(value.name),
              string(value.categoryCode),
              optionalString(value.description),
              number(value.sellingPriceMinor),
              string(value.currency),
              optionalString(value.taxRuleId),
              bool(Boolean(value.serviceChargeApplicable)),
              optionalString(value.recipeReference),
              optionalString(value.modifierGroupReference),
              optionalString(value.barcode),
              bool(value.sellable !== false),
              json(menuPayload),
              stamp,
              this.actor.tenantId,
              id,
            ),
        );
      } else {
        statements.push(
          this.db
            .prepare(insertSql)
            .bind(
              this.actor.tenantId,
              id,
              code,
              optionalString(value.sku),
              string(value.name),
              string(value.categoryCode),
              optionalString(value.description),
              number(value.sellingPriceMinor),
              string(value.currency),
              optionalString(value.taxRuleId),
              bool(Boolean(value.serviceChargeApplicable)),
              null,
              optionalString(value.recipeReference),
              optionalString(value.modifierGroupReference),
              optionalString(value.barcode),
              bool(value.sellable !== false),
              json(menuPayload),
              stamp,
              stamp,
            ),
        );
      }
      const targetBranchIds = Array.isArray(value.targetBranchIds)
        ? [...new Set(value.targetBranchIds.map(string).filter(Boolean))]
        : branchId
          ? [branchId]
          : [];
      const stationIdsByBranch =
        value.stationIdsByBranch && typeof value.stationIdsByBranch === "object"
          ? (value.stationIdsByBranch as Record<string, unknown>)
          : {};
      for (const targetBranchId of targetBranchIds) {
        branchSettingKeys.push(`${targetBranchId}:${id}`);
        const stationId = optionalString(stationIdsByBranch[targetBranchId]);
        statements.push(
          this.db
            .prepare(
              `INSERT INTO menu_item_branch_settings
                (tenant_id,branch_id,menu_item_id,selling_price_minor,available,
                 channel_availability_json,updated_at,station_id,kitchen_printer_group,payload_json)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id,branch_id,menu_item_id) DO UPDATE SET
                 selling_price_minor=excluded.selling_price_minor,available=excluded.available,
                 channel_availability_json=excluded.channel_availability_json,
                 station_id=excluded.station_id,kitchen_printer_group=excluded.kitchen_printer_group,
                 payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
            )
            .bind(
              this.actor.tenantId,
              targetBranchId,
              id,
              value.branchPriceMinor === undefined ? null : number(value.branchPriceMinor),
              bool(value.available !== false),
              json(value.channelAvailability ?? {}),
              stamp,
              stationId,
              optionalString(value.kitchenPrinterGroup),
              json({
                imported: true,
                templateVersion: value.templateVersion,
                onlinePriceChannelCodes: Array.isArray(value.onlinePriceChannelCodes)
                  ? value.onlinePriceChannelCodes
                  : [],
              }),
            ),
        );
        const stationSource = string(value.stationCode).trim();
        if (stationId && stationSource) {
          const normalizedSource = normalizeReferenceValue(stationSource);
          statements.push(
            this.db
              .prepare(
                `INSERT INTO setup_import_reference_aliases
                  (tenant_id,id,reference_type,source_value_normalized,branch_id,target_id,active,
                   created_by,created_at,updated_at)
                 VALUES (?,?,'STATION',?,?,?,1,?,?,?)
                 ON CONFLICT(tenant_id,reference_type,source_value_normalized,branch_id)
                 DO UPDATE SET target_id=excluded.target_id,active=1,updated_at=excluded.updated_at`,
              )
              .bind(
                this.actor.tenantId,
                stableId("station-alias", `${targetBranchId}:${normalizedSource}`),
                normalizedSource,
                targetBranchId,
                stationId,
                this.actor.id,
                stamp,
                stamp,
              ),
          );
        }
      }
    } else if (kind === "INVENTORY") {
      const baseUnitId = stableId("unit", string(value.baseUnitCode).toUpperCase());
      const purchaseUnitId = value.purchaseUnitCode
        ? stableId("unit", string(value.purchaseUnitCode).toUpperCase())
        : baseUnitId;
      statements.push(
        this.unitStatement(
          baseUnitId,
          string(value.baseUnitCode),
          string(value.baseUnitCode),
          string(value.dimension),
          stamp,
        ),
      );
      if (purchaseUnitId !== baseUnitId)
        statements.push(
          this.unitStatement(
            purchaseUnitId,
            string(value.purchaseUnitCode),
            string(value.purchaseUnitCode),
            string(value.dimension),
            stamp,
          ),
        );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json,code,description,base_unit_id,purchase_unit_id,storage_unit_id,issue_unit_id,track_inventory,track_expiry,default_warehouse_id,barcode,updated_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET sku=excluded.sku,name=excluded.name,unit=excluded.unit,code=excluded.code,description=excluded.description,base_unit_id=excluded.base_unit_id,purchase_unit_id=excluded.purchase_unit_id,track_expiry=excluded.track_expiry,default_warehouse_id=excluded.default_warehouse_id,barcode=excluded.barcode,updated_at=excluded.updated_at`,
          )
          .bind(
            this.actor.tenantId,
            id,
            code,
            string(value.name),
            string(value.baseUnitCode),
            json({ imported: true }),
            code,
            optionalString(value.description),
            baseUnitId,
            purchaseUnitId,
            baseUnitId,
            baseUnitId,
            1,
            bool(Boolean(value.trackExpiry)),
            optionalString(value.warehouseId),
            optionalString(value.barcode),
            stamp,
          ),
      );
      if (purchaseUnitId !== baseUnitId)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO item_unit_conversions (tenant_id,id,inventory_item_id,from_unit_id,to_unit_id,factor_numerator,factor_denominator,effective_from,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,inventory_item_id,from_unit_id,effective_from) DO NOTHING`,
            )
            .bind(
              this.actor.tenantId,
              stableId("conversion", `${id}:${purchaseUnitId}`),
              id,
              purchaseUnitId,
              baseUnitId,
              number(value.factorNumerator ?? 1),
              number(value.factorDenominator ?? 1),
              "1970-01-01",
              stamp,
            ),
        );
    } else if (kind === "SUPPLIER") {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO suppliers (tenant_id,id,code,name,legal_name,phone,email,tax_number,address,payment_terms_days,currency,lead_time_days,minimum_order_minor,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET code=excluded.code,name=excluded.name,legal_name=excluded.legal_name,phone=excluded.phone,email=excluded.email,tax_number=excluded.tax_number,address=excluded.address,payment_terms_days=excluded.payment_terms_days,currency=excluded.currency,lead_time_days=excluded.lead_time_days,minimum_order_minor=excluded.minimum_order_minor,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
          )
          .bind(
            this.actor.tenantId,
            id,
            code,
            string(value.name),
            optionalString(value.legalName),
            optionalString(value.phone),
            optionalString(value.email),
            optionalString(value.taxNumber),
            optionalString(value.address),
            number(value.paymentTermsDays ?? 0),
            optionalString(value.currency),
            number(value.leadTimeDays ?? 0),
            number(value.minimumOrderMinor ?? 0),
            json({ imported: true, preferred: Boolean(value.preferred) }),
            stamp,
            stamp,
          ),
      );
    } else if (kind === "STAFF") {
      const targetBranchId = string(value.branchId);
      const userId = stableId("user", code);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO employees (tenant_id,id,branch_id,employee_number,status,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET branch_id=excluded.branch_id,status=excluded.status,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
          )
          .bind(
            this.actor.tenantId,
            id,
            targetBranchId,
            code,
            string(value.employmentStatus || "ACTIVE"),
            json({
              name: value.name,
              email: value.email,
              phone: value.phone,
              department: value.department,
              jobTitle: value.jobTitle,
              shiftGroup: value.shiftGroup,
            }),
            stamp,
            stamp,
          ),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,1,1,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET email=excluded.email,name=excluded.name,active=excluded.active,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
          )
          .bind(
            this.actor.tenantId,
            userId,
            optionalString(value.email),
            string(value.name),
            json({ invitationRequired: true, employeeId: id }),
            stamp,
            stamp,
          ),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?) ON CONFLICT DO NOTHING`,
          )
          .bind(this.actor.tenantId, userId, string(value.roleId)),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?) ON CONFLICT DO NOTHING`,
          )
          .bind(this.actor.tenantId, userId, targetBranchId),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO user_primary_branches
              (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason)
             VALUES (?,?,?,?,?,'Staff import branch assignment')
             ON CONFLICT(tenant_id,user_id) DO UPDATE SET
               branch_id=excluded.branch_id,
               assigned_by=excluded.assigned_by,
               assigned_at=excluded.assigned_at,
               reason=excluded.reason`,
          )
          .bind(this.actor.tenantId, userId, targetBranchId, this.actor.id, stamp),
      );
    }
    return {
      statements,
      entityType: kind,
      entityId: id,
      skipped: false,
      created: !exists && !options.masterAlreadyPlanned,
      masterChanged: !options.masterAlreadyPlanned,
      branchSettingKeys,
    };
  }

  private publishMenuPlanStatements(importId: string, stamp: string) {
    return [
      this.db
        .prepare(
          `INSERT INTO menu_catalog_items
            (tenant_id,id,code,sku,name,category_code,description,selling_price_minor,currency,
             tax_rule_id,service_charge_applicable,station_id,recipe_reference,
             modifier_group_reference,barcode,sellable,active,payload_json,created_at,updated_at)
           SELECT tenant_id,menu_item_id,code,sku,name,category_code,description,
                  selling_price_minor,currency,tax_rule_id,service_charge_applicable,NULL,
                  recipe_reference,modifier_group_reference,barcode,sellable,1,payload_json,?,?
           FROM menu_import_staged_items
           WHERE tenant_id=? AND import_id=?
           ON CONFLICT(tenant_id,id) DO UPDATE SET
             code=excluded.code,sku=excluded.sku,name=excluded.name,
             category_code=excluded.category_code,description=excluded.description,
             selling_price_minor=excluded.selling_price_minor,currency=excluded.currency,
             tax_rule_id=excluded.tax_rule_id,
             service_charge_applicable=excluded.service_charge_applicable,
             recipe_reference=excluded.recipe_reference,
             modifier_group_reference=excluded.modifier_group_reference,
             barcode=excluded.barcode,sellable=excluded.sellable,active=1,
             payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
        )
        .bind(stamp, stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `INSERT INTO menu_item_branch_settings
            (tenant_id,branch_id,menu_item_id,selling_price_minor,available,
             channel_availability_json,updated_at,station_id,kitchen_printer_group,payload_json)
           SELECT tenant_id,branch_id,menu_item_id,selling_price_minor,available,
                  channel_availability_json,?,station_id,kitchen_printer_group,payload_json
           FROM menu_import_staged_branch_settings
           WHERE tenant_id=? AND import_id=?
           ON CONFLICT(tenant_id,branch_id,menu_item_id) DO UPDATE SET
             selling_price_minor=excluded.selling_price_minor,available=excluded.available,
             channel_availability_json=excluded.channel_availability_json,
             station_id=excluded.station_id,
             kitchen_printer_group=excluded.kitchen_printer_group,
             payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
        )
        .bind(stamp, this.actor.tenantId, importId),
      this.db
        .prepare(
          `INSERT INTO setup_import_reference_aliases
            (tenant_id,id,reference_type,source_value_normalized,branch_id,target_id,active,
             created_by,created_at,updated_at)
           SELECT DISTINCT tenant_id,reference_alias_id,'STATION',source_station_normalized,branch_id,
                  station_id,1,?,?,?
           FROM menu_import_staged_branch_settings
           WHERE tenant_id=? AND import_id=? AND station_id IS NOT NULL
             AND source_station_normalized IS NOT NULL AND reference_alias_id IS NOT NULL
           ON CONFLICT(tenant_id,reference_type,source_value_normalized,branch_id)
           DO UPDATE SET target_id=excluded.target_id,active=1,updated_at=excluded.updated_at`,
        )
        .bind(this.actor.id, stamp, stamp, this.actor.tenantId, importId),
    ];
  }

  private async importPlanDigest(importId: string, fileChecksum: string) {
    const plan = await this.db
      .prepare(
        `SELECT row_number,row_key,action,after_json,errors_json,warnings_json
         FROM setup_import_rows WHERE tenant_id=? AND import_id=? ORDER BY row_number`,
      )
      .bind(this.actor.tenantId, importId)
      .all<Record<string, unknown>>();
    return sha256Text(
      stableJson({
        tenantId: this.actor.tenantId,
        importId,
        fileChecksum,
        rows: (plan.results ?? []).map((row) => ({
          rowNumber: number(row["row_number"]),
          rowKey: string(row["row_key"]),
          action: string(row["action"]),
          after: parseJson(string(row["after_json"]), {}),
          errors: parseJson(string(row["errors_json"]), []),
          warnings: parseJson(string(row["warnings_json"]), []),
        })),
      }),
    );
  }

  private async menuImportCompletionContext(importId: string) {
    const rows = await this.db
      .prepare(
        `SELECT status,action,normalized_json FROM setup_import_rows
         WHERE tenant_id=? AND import_id=? ORDER BY row_number`,
      )
      .bind(this.actor.tenantId, importId)
      .all<{ status: string; action: string; normalized_json: string }>();
    const expectedEntityIds = new Set<string>();
    const expectedBranchSettings = new Set<string>();
    const createdEntityIds = new Set<string>();
    const updatedEntityIds = new Set<string>();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of rows.results ?? []) {
      const value = parseJson<ImportValue>(row.normalized_json, {});
      const itemId = stableId("menu", string(value.code).toUpperCase());
      if (row.status === "SKIPPED") {
        skipped += 1;
        continue;
      }
      if (row.status !== "COMMITTED") continue;
      expectedEntityIds.add(itemId);
      for (const branchId of Array.isArray(value.targetBranchIds)
        ? value.targetBranchIds.map(string).filter(Boolean)
        : []) {
        expectedBranchSettings.add(`${branchId}:${itemId}`);
      }
      if (row.action === "UPDATE") updatedEntityIds.add(itemId);
      else createdEntityIds.add(itemId);
    }
    created = createdEntityIds.size;
    updated = updatedEntityIds.size;
    return { expectedEntityIds, expectedBranchSettings, created, updated, skipped };
  }

  private async verifyStagedMenuImport(
    importId: string,
    entityIds: Set<string>,
    branchSettingKeys: Set<string>,
    counts: { created: number; updated: number; skipped: number },
  ): Promise<NonNullable<ImportPreview["verification"]>> {
    const stagedItems = await count(
      this.db,
      `SELECT COUNT(*) count FROM menu_import_staged_items
       WHERE tenant_id=? AND import_id=?`,
      this.actor.tenantId,
      importId,
    );
    const stagedBranches = await count(
      this.db,
      `SELECT COUNT(*) count FROM menu_import_staged_branch_settings
       WHERE tenant_id=? AND import_id=?`,
      this.actor.tenantId,
      importId,
    );
    const catalogueVerified = stagedItems === entityIds.size;
    const branchesVerified = stagedBranches === branchSettingKeys.size;
    const warnings = [
      ...(catalogueVerified ? [] : ["The immutable item plan could not be verified"]),
      ...(branchesVerified ? [] : ["The immutable branch activation plan could not be verified"]),
    ];
    return {
      status: warnings.length ? "FAILED" : "VERIFIED",
      ...counts,
      failed: warnings.length ? 1 : 0,
      branchSettings: stagedBranches,
      catalogueVerified: catalogueVerified && branchesVerified,
      warnings,
    };
  }

  private async verifyMenuImport(
    entityIds: Set<string>,
    branchSettingKeys: Set<string>,
    counts: { created: number; updated: number; skipped: number },
  ): Promise<NonNullable<ImportPreview["verification"]>> {
    let catalogueRows = 0;
    const ids = [...entityIds];
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      const result = await this.db
        .prepare(
          `SELECT COUNT(*) count FROM menu_catalog_items
           WHERE tenant_id=? AND active=1 AND id IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(this.actor.tenantId, ...chunk)
        .first<{ count: number }>();
      catalogueRows += number(result?.count);
    }
    let branchSettings = 0;
    const pairs = [...branchSettingKeys].map((key) => {
      const split = key.indexOf(":");
      return { branchId: key.slice(0, split), itemId: key.slice(split + 1) };
    });
    for (let offset = 0; offset < pairs.length; offset += 40) {
      const chunk = pairs.slice(offset, offset + 40);
      const predicates = chunk.map(() => "(branch_id=? AND menu_item_id=?)").join(" OR ");
      const bindings = chunk.flatMap((pair) => [pair.branchId, pair.itemId]);
      const result = await this.db
        .prepare(
          `SELECT COUNT(*) count FROM menu_item_branch_settings
           WHERE tenant_id=? AND (${predicates})`,
        )
        .bind(this.actor.tenantId, ...bindings)
        .first<{ count: number }>();
      branchSettings += number(result?.count);
    }
    const catalogueVerified = catalogueRows === ids.length;
    const branchSettingsVerified = branchSettings === pairs.length;
    const warnings = [
      ...(catalogueVerified ? [] : ["Not every committed item was found in the catalogue"]),
      ...(branchSettingsVerified
        ? []
        : ["Not every selected branch received an explicit menu activation"]),
    ];
    return {
      status: warnings.length ? "FAILED" : "VERIFIED",
      ...counts,
      failed: warnings.length ? Math.max(1, ids.length - catalogueRows) : 0,
      branchSettings,
      catalogueVerified: catalogueVerified && branchSettingsVerified,
      warnings,
    };
  }

  private async getImport(id: string): Promise<ImportPreview> {
    const record = await this.db
      .prepare(
        `SELECT i.id,i.import_kind,i.status,i.original_name,i.duplicate_strategy,i.row_count,i.valid_count,
                i.warning_count,i.error_count,i.idempotency_key,i.created_at,i.template_version,
                i.preview_fingerprint,i.importer_version,i.target_mode,i.target_branch_ids_json,
                i.expires_at,i.verification_status,i.verification_json,i.file_checksum,i.scan_status,
                i.scan_evidence_json,i.approved_plan_digest,i.approved_at,i.publish_status,
                i.published_at,i.source_object_id,
                o.object_key,o.object_version,o.scan_evidence_id,o.status object_status
         FROM setup_imports i
         LEFT JOIN stored_objects o ON o.tenant_id=i.tenant_id AND o.id=i.source_object_id
         WHERE i.tenant_id=? AND i.id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<Record<string, unknown>>();
    if (!record) throw notFound("Import not found");
    const cleanEvidence = hasValidCleanEvidence(
      string(record["file_checksum"]),
      string(record["scan_status"]),
      string(record["scan_evidence_json"]),
      optionalString(record["source_object_id"])
        ? {
            objectKey: optionalString(record["object_key"]),
            objectVersion: optionalString(record["object_version"]),
            evidenceId: optionalString(record["scan_evidence_id"]),
            objectStatus: optionalString(record["object_status"]),
          }
        : {},
    );
    const rows = cleanEvidence
      ? await this.db
          .prepare(
            `SELECT row_number,row_key,status,normalized_json,errors_json,warnings_json,action
         FROM setup_import_rows WHERE tenant_id=? AND import_id=? ORDER BY row_number LIMIT ${record["import_kind"] === "INVENTORY" ? 5000 : 1000}`,
          )
          .bind(this.actor.tenantId, id)
          .all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const parsedVerification = parseJson<ImportPreview["verification"]>(
      string(record["verification_json"]),
      undefined,
    );
    const verification = parsedVerification?.status ? parsedVerification : undefined;
    return {
      id: string(record["id"]),
      commitKey: `commit:${string(record["idempotency_key"])}`,
      kind: string(record["import_kind"]) as ImportPreview["kind"],
      status: string(record["status"]) as ImportPreview["status"],
      templateVersion: number(record["template_version"]),
      importerVersion: string(record["importer_version"]),
      fingerprint: string(record["preview_fingerprint"]),
      targetMode: string(record["target_mode"]) as ImportTargetMode,
      targetBranchIds: parseJson<string[]>(string(record["target_branch_ids_json"]), []),
      expiresAt: string(record["expires_at"]),
      scanStatus: string(record["scan_status"]) as ImportPreview["scanStatus"],
      approved: Boolean(record["approved_plan_digest"]),
      approvedAt: optionalString(record["approved_at"]) ?? undefined,
      publishStatus: string(record["publish_status"]) as ImportPreview["publishStatus"],
      ...(record["approved_plan_digest"]
        ? { publishKey: `publish:${string(record["approved_plan_digest"])}` }
        : {}),
      publishedAt: optionalString(record["published_at"]) ?? undefined,
      ...(verification ? { verification } : {}),
      originalName: string(record["original_name"]),
      duplicateStrategy: string(record["duplicate_strategy"]) as ImportPreview["duplicateStrategy"],
      rowCount: number(record["row_count"]),
      validCount: number(record["valid_count"]),
      warningCount: number(record["warning_count"]),
      errorCount: number(record["error_count"]),
      canCommit: cleanEvidence && string(record["status"]) === "VALIDATED",
      rows: (rows.results ?? []).map((row) => ({
        rowNumber: number(row["row_number"]),
        rowKey: string(row["row_key"]),
        status: string(row["status"]) as ImportPreviewRow["status"],
        action: string(row["action"]) as NonNullable<ImportPreviewRow["action"]>,
        normalized: parseJson(string(row["normalized_json"]), {}),
        errors: parseJson(string(row["errors_json"]), []),
        warnings: parseJson(string(row["warnings_json"]), []),
      })),
      createdAt: string(record["created_at"]),
    };
  }

  private async normalizeOpeningStockLine(line: OpeningStockInput["lines"][number]) {
    const item = await this.db
      .prepare("SELECT base_unit_id FROM inventory_items WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, line.inventoryItemId)
      .first<{ base_unit_id: string }>();
    if (!item?.base_unit_id) throw validation("Inventory item has no base unit");
    if (line.unitId === item.base_unit_id) return { baseQuantityMicro: line.quantityMicro };
    const conversion = await this.db
      .prepare(
        `SELECT factor_numerator,factor_denominator FROM item_unit_conversions WHERE tenant_id=? AND inventory_item_id=? AND from_unit_id=? AND to_unit_id=? AND effective_from<=date('now') AND (effective_to IS NULL OR effective_to>=date('now')) ORDER BY effective_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, line.inventoryItemId, line.unitId, item.base_unit_id)
      .first<{ factor_numerator: number; factor_denominator: number }>();
    if (!conversion) throw validation("No valid item-specific conversion exists for opening stock");
    const value =
      (BigInt(line.quantityMicro) * BigInt(conversion.factor_numerator)) /
      BigInt(conversion.factor_denominator);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw validation("Opening stock quantity exceeds safe range");
    return { baseQuantityMicro: Number(value) };
  }

  private async detectRecipeCycles() {
    const rows = await this.db
      .prepare(
        `SELECT rv.recipe_id parent_recipe,rc.sub_recipe_id child_recipe FROM recipe_version_components rc JOIN recipe_versions rv ON rv.tenant_id=rc.tenant_id AND rv.id=rc.recipe_version_id WHERE rc.tenant_id=? AND rc.sub_recipe_id IS NOT NULL`,
      )
      .bind(this.actor.tenantId)
      .all<{ parent_recipe: string; child_recipe: string }>();
    const graph = new Map<string, string[]>();
    for (const row of rows.results ?? [])
      graph.set(row.parent_recipe, [...(graph.get(row.parent_recipe) ?? []), row.child_recipe]);
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const visit = (node: string, path: string[]) => {
      if (stack.has(node)) {
        cycles.push([...path, node]);
        return;
      }
      if (visited.has(node)) return;
      stack.add(node);
      for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
      stack.delete(node);
      visited.add(node);
    };
    for (const node of graph.keys()) visit(node, []);
    return cycles;
  }

  private readinessStatement(row: ReadinessResult, scopeKey: string, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO setup_readiness_results (tenant_id,id,branch_id,scope_key,section_key,code,status,severity,message,evidence_json,recommended_action,source_entity_type,source_entity_id,override_allowed,calculated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        row.id,
        row.branchId ?? null,
        scopeKey,
        row.section,
        row.code,
        row.status,
        row.severity,
        row.message,
        json(row.evidence),
        row.recommendedAction,
        row.sourceEntityType ?? null,
        row.sourceEntityId ?? null,
        bool(row.overrideAllowed),
        stamp,
      );
  }
  private unitStatement(id: string, code: string, name: string, dimension: string, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,1,?,?) ON CONFLICT(tenant_id,id) DO NOTHING`,
      )
      .bind(this.actor.tenantId, id, code.toUpperCase(), name, code, dimension, stamp, stamp);
  }
  private enqueueJobStatement(
    jobType: string,
    id: string,
    idempotencyKey: string,
    correlationId: string,
    payload: Record<string, unknown>,
    scheduledAt = now(),
  ) {
    const stamp = now();
    return this.db
      .prepare(
        `INSERT INTO worker_jobs (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,max_attempts,scheduled_at,created_at,updated_at) VALUES (?,?,?, ?,?,?,'PENDING',0,8,?,?,?) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        this.actor.tenantId,
        stableId("worker", idempotencyKey),
        jobType,
        json(payload),
        idempotencyKey,
        correlationId,
        scheduledAt,
        stamp,
        stamp,
      );
  }
  private async dispatchScanJob(jobId: string, correlationId: string) {
    if (!this.env.SERAMET_SCAN_QUEUE) {
      throw new ServerOperationError(
        "EXTERNAL_SERVICE_UNAVAILABLE",
        503,
        "File imports are unavailable until security scanning is configured",
      );
    }
    try {
      await this.env.SERAMET_SCAN_QUEUE.send(
        {
          kind: "file-scan",
          tenantId: this.actor.tenantId,
          jobId,
          correlationId,
        },
        { contentType: "json" },
      );
    } catch {
      throw new ServerOperationError(
        "EXTERNAL_SERVICE_UNAVAILABLE",
        503,
        "File security scan could not be queued; retry the upload",
      );
    }
  }
  private async dispatchWorkerJob(jobId: string, correlationId: string) {
    if (!this.env.SERAMET_WORK_QUEUE) return;
    await this.env.SERAMET_WORK_QUEUE.send(
      {
        kind: "worker-job",
        tenantId: this.actor.tenantId,
        jobId,
        correlationId,
      },
      { contentType: "json" },
    ).catch(() => undefined);
  }
  private importStateEvent(
    state:
      | "QUARANTINED"
      | "SCAN_PENDING"
      | "SCANNED_CLEAN"
      | "PARSING"
      | "STAGED"
      | "APPROVED"
      | "COMMITTING"
      | "VERIFYING"
      | "READY_TO_PUBLISH"
      | "PUBLISHING"
      | "PUBLISHED"
      | "REJECTED_INFECTED"
      | "SCAN_FAILED"
      | "VALIDATION_FAILED"
      | "COMMIT_FAILED"
      | "VERIFICATION_FAILED"
      | "CANCELLED",
    input: {
      jobId?: string;
      importId?: string;
      objectId?: string;
      attempt?: number;
      evidence: Record<string, unknown>;
    },
  ) {
    return this.db
      .prepare(
        `INSERT INTO file_import_state_events
          (tenant_id,id,job_id,import_id,object_id,state,attempt,evidence_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        input.jobId ?? null,
        input.importId ?? null,
        input.objectId ?? null,
        state,
        input.attempt ?? 1,
        json(input.evidence),
        now(),
      );
  }
  private audit(
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,correlation_id,session_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        "Authenticated setup command",
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        json(metadata),
        now(),
      );
  }
  private auditForTenant(
    tenantId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,correlation_id,session_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        tenantId,
        crypto.randomUUID(),
        null,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        entityType,
        entityId,
        "Authenticated platform provisioning command",
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        json(metadata),
        now(),
      );
  }
  /** Tenant-wide view: a requirement applies when any active branch requires it. */
  private async combinedBranchPolicy() {
    return this.db
      .prepare(
        `SELECT MAX(p.inventory_enabled) inventory_enabled,MAX(p.recipes_required) recipes_required,
                MAX(p.payments_required) payments_required,MAX(p.printing_required) printing_required,
                MAX(p.kds_required) kds_required
         FROM branch_operating_profiles p
         JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id AND b.active=1
         WHERE p.tenant_id=?`,
      )
      .bind(this.actor.tenantId)
      .first<{
        inventory_enabled: number | null;
        recipes_required: number | null;
        payments_required: number | null;
        printing_required: number | null;
        kds_required: number | null;
      }>();
  }
  /** The guided onboarding tax step records an explicit "no tax charged" answer. */
  private async ownerSignedOffNoTax() {
    const progress = await this.db
      .prepare("SELECT responses_json FROM onboarding_wizard_progress WHERE tenant_id=?")
      .bind(this.actor.tenantId)
      .first<{ responses_json: string }>();
    try {
      const responses = JSON.parse(progress?.responses_json ?? "{}") as Record<string, unknown>;
      const tax = responses[String(onboardingStepNumber("tax"))] as
        Record<string, unknown> | undefined;
      return isCurrentFlow(responses) && tax?.["noTax"] === true;
    } catch {
      return false;
    }
  }
  private async branchPolicy(branchId: string) {
    return this.db
      .prepare("SELECT * FROM branch_operating_profiles WHERE tenant_id=? AND branch_id=?")
      .bind(this.actor.tenantId, branchId)
      .first<{
        inventory_enabled: number;
        recipes_required: number;
        payments_required: number;
        printing_required: number;
        kds_required: number;
      }>();
  }
  private async assertEntitledWhenManaged(featureKey: string) {
    const subscriptions = await count(
      this.db,
      "SELECT COUNT(*) count FROM tenant_subscriptions WHERE tenant_id=?",
      this.actor.tenantId,
    );
    if (subscriptions > 0) await this.assertEntitlement(featureKey);
  }
  private require(permission: string) {
    if (!this.actor.permissions.includes(permission))
      throw denied(`Permission ${permission} is required`);
  }
  private canReadBranch(branchId: string) {
    return this.actor.branchScope.type === "ALL" || this.actor.assignedBranchIds.includes(branchId);
  }

  private async resolveMenuImportTarget(input: ImportPreviewInput): Promise<{
    mode: MenuImportTargetMode;
    branchIds: string[];
  }> {
    const mode = input.targetMode ?? (input.branchId ? "SELECTED_BRANCHES" : "TENANT_MASTER");
    const branchIds = [
      ...new Set(input.targetBranchIds ?? (input.branchId ? [input.branchId] : [])),
    ];
    if (mode === "TENANT_MASTER") return { mode, branchIds: [] };
    if (mode === "ROW_BRANCHES") {
      if (branchIds.length) throw validation("ROW_BRANCHES uses branchCode from each row");
      return { mode, branchIds: [] };
    }
    if (!branchIds.length) throw validation("Select at least one branch for the menu import");
    for (const branchId of branchIds) await this.assertImportBranch(branchId);
    return { mode, branchIds };
  }

  private async assertImportBranch(branchId: string) {
    const isActiveBranch = branchId === this.actor.branchId;
    const canSwitch = this.actor.permissions.includes(permissions.branchSwitch);
    const trustedSetupWorker = this.actor.id === "system:setup-worker";
    if (
      !trustedSetupWorker &&
      (!this.actor.assignedBranchIds.includes(branchId) || (!isActiveBranch && !canSwitch))
    ) {
      throw denied("Branch is outside the authenticated import assignment");
    }
    const branch = await this.db
      .prepare("SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, branchId)
      .first();
    if (!branch) throw notFound("Branch not found");
  }

  private async assertQueuedImportAuthority(userId: string, targetBranchIds: string[]) {
    const authorized = await this.db
      .prepare(
        `SELECT u.id FROM users u
         WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
           WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND rp.permission_code=?
         )`,
      )
      .bind(this.actor.tenantId, userId, permissions.setupImport)
      .first<{ id: string }>();
    if (!authorized) throw denied("Import creator no longer has setup import permission");
    for (const branchId of targetBranchIds) {
      const assignment = await this.db
        .prepare(
          "SELECT 1 allowed FROM user_branches WHERE tenant_id=? AND user_id=? AND branch_id=?",
        )
        .bind(this.actor.tenantId, userId, branchId)
        .first<{ allowed: number }>();
      if (!assignment) throw denied("Import creator is no longer assigned to a target branch");
    }
  }

  private async menuCatalogueRevision() {
    const [items, settings] = await Promise.all([
      this.db
        .prepare(
          "SELECT COUNT(*) count,COALESCE(MAX(updated_at),'') latest FROM menu_catalog_items WHERE tenant_id=?",
        )
        .bind(this.actor.tenantId)
        .first<{ count: number; latest: string }>(),
      this.db
        .prepare(
          "SELECT COUNT(*) count,COALESCE(MAX(updated_at),'') latest FROM menu_item_branch_settings WHERE tenant_id=?",
        )
        .bind(this.actor.tenantId)
        .first<{ count: number; latest: string }>(),
    ]);
    return sha256Text(
      `${number(items?.count)}:${string(items?.latest)}:${number(settings?.count)}:${string(settings?.latest)}`,
    );
  }

  private async assertBranch(branchId: string) {
    if (!this.canReadBranch(branchId))
      throw denied("Branch is outside the authenticated assignment");
    const branch = await this.db
      .prepare("SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, branchId)
      .first();
    if (!branch) throw notFound("Branch not found");
  }
}

async function parseRows(bytes: Uint8Array, extension: string) {
  if (extension === "xlsx") {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return parseXlsxRows(copy);
  }
  return parseCsvRows(new TextDecoder().decode(bytes));
}

function assertSafeParsedRows(rows: Array<Record<string, string>>) {
  for (const row of rows) {
    if (Object.keys(row).length > 100) throw validation("Import column limit exceeded");
    if (Object.values(row).some((value) => value.length > 10_000)) {
      throw validation("Import cell length limit exceeded");
    }
  }
}

function normalizeImportRow(
  kind: string,
  row: Record<string, string>,
  branchId?: string,
  defaultCurrency?: string,
): ImportValue {
  const value = (...keys: string[]) => {
    for (const key of keys) {
      const found = row[normalizeKey(key)];
      if (found !== undefined && found.trim() !== "") return found.trim();
    }
    return "";
  };
  if (kind === "MENU")
    return {
      code: value("itemCode", "code", "sku"),
      sku: value("sku") || undefined,
      name: value("name", "itemName"),
      categoryCode: value("categoryCode", "category"),
      menuSection: value("menuSection") || undefined,
      description: value("description") || undefined,
      rawBasePrice: value("basePrice", "price", "sellingPrice"),
      sellingPriceMinor: parseMoneyMinor(value("basePrice", "price", "sellingPrice")),
      rawOnlinePrice: value("onlinePrice", "digitalPrice") || undefined,
      onlinePriceMinor: value("onlinePrice", "digitalPrice")
        ? parseMoneyMinor(value("onlinePrice", "digitalPrice"))
        : undefined,
      rawCostPrice: value("costPrice") || undefined,
      costPriceMinor: value("costPrice") ? parseMoneyMinor(value("costPrice")) : undefined,
      currency: (value("currency") || defaultCurrency || "").toUpperCase(),
      taxCode: value("taxCode", "taxCategory", "tax", "taxRule") || undefined,
      serviceChargeApplicable: parseBoolean(value("serviceCharge", "serviceChargeApplicable")),
      unitOfMeasure: value("unitOfMeasure", "unit") || undefined,
      stationCode: value("stationCode", "station", "productionStation") || undefined,
      kitchenPrinterGroup: value("kitchenPrinterGroup") || undefined,
      recipeReference: value("recipeCode", "recipe", "recipeReference") || undefined,
      modifierGroupReference:
        value("modifierGroupCode", "modifierGroup", "modifierGroupReference") || undefined,
      barcode: value("barcode") || undefined,
      sellable: !isFalse(value("sellable", "active")),
      available: !isFalse(value("available")),
      branchCode: value("branchCode") || undefined,
      rawBranchPrice: value("branchPrice") || undefined,
      branchPriceMinor: value("branchPrice") ? parseMoneyMinor(value("branchPrice")) : undefined,
      channelCodes: parseList(value("channels", "channelAvailability")).map((item) =>
        item.toUpperCase(),
      ),
      onlinePriceChannelCodes: parseList(value("onlinePriceChannels", "digitalPriceChannels")).map(
        (item) => item.toUpperCase(),
      ),
      channelAvailability: Object.fromEntries(
        parseList(value("channels", "channelAvailability")).map((item) => [
          item.toUpperCase(),
          true,
        ]),
      ),
      prepMinutes: parseInteger(value("prepMinutes", "prep") || "0"),
      parLevel: parseInteger(value("parLevel", "par") || "0"),
      imageFilename: value("imageFilename") || undefined,
      branchId,
    };
  if (kind === "INVENTORY")
    return {
      code: value("code", "sku"),
      name: value("name", "itemName"),
      description: value("description") || undefined,
      baseUnitCode: value("baseUnit", "baseUnitCode", "unit").toUpperCase(),
      purchaseUnitCode: (
        value("purchaseUnit", "purchaseUnitCode") || value("baseUnit", "baseUnitCode", "unit")
      ).toUpperCase(),
      dimension: value("dimension").toUpperCase(),
      factorNumerator: parseInteger(value("factorNumerator", "conversionNumerator") || "1"),
      factorDenominator: parseInteger(value("factorDenominator", "conversionDenominator") || "1"),
      trackExpiry: parseBoolean(value("trackExpiry")),
      warehouseId: value("warehouseId") || undefined,
      categoryCode: value("categoryCode", "category") || undefined,
      barcode: value("barcode") || undefined,
      parMicro: parseInteger(value("parMicro", "par") || "0"),
      safetyStockMicro: parseInteger(value("safetyStockMicro", "safetyStock") || "0"),
    };
  if (kind === "SUPPLIER")
    return {
      code: value("code", "supplierCode"),
      name: value("name", "supplierName"),
      legalName: value("legalName") || undefined,
      phone: value("phone") || undefined,
      email: value("email") || undefined,
      taxNumber: value("taxNumber") || undefined,
      address: value("address") || undefined,
      paymentTermsDays: parseInteger(value("paymentTermsDays") || "0"),
      currency: (value("currency") || "").toUpperCase() || undefined,
      leadTimeDays: parseInteger(value("leadTimeDays") || "0"),
      minimumOrderMinor: parseMoneyMinor(value("minimumOrder") || "0"),
      preferred: parseBoolean(value("preferred")),
    };
  if (kind === "STAFF")
    return {
      employeeCode: value("employeeCode", "code"),
      code: value("employeeCode", "code"),
      name: value("name", "employeeName"),
      email: value("email") || undefined,
      phone: value("phone") || undefined,
      roleCode: value("role", "roleCode"),
      branchCode: value("branch", "branchCode") || branchId,
      department: value("department") || undefined,
      jobTitle: value("jobTitle") || undefined,
      shiftGroup: value("shiftGroup") || undefined,
      employmentStatus: (value("employmentStatus", "status") || "ACTIVE").toUpperCase(),
    };
  return { code: value("code"), name: value("name") };
}

function applyColumnMap(row: Record<string, string>, columnMap?: Record<string, string>) {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value]),
  );
  if (!columnMap) return normalized;
  for (const [target, source] of Object.entries(columnMap))
    normalized[normalizeKey(target)] = normalized[normalizeKey(source)] ?? "";
  return normalized;
}
function applyMenuColumnMap(row: Record<string, string>, columnMap?: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [source, value] of Object.entries(row)) {
    const canonical = resolveMenuImportHeader(source);
    normalized[canonical ? normalizeKey(canonical) : normalizeKey(source)] = value;
  }
  for (const [target, source] of Object.entries(columnMap ?? {})) {
    const canonicalTarget = resolveMenuImportHeader(target) ?? resolveMenuImportHeader(source);
    if (!canonicalTarget) continue;
    const sourceKey = normalizeMenuImportHeader(source);
    const sourceEntry = Object.entries(row).find(
      ([header]) => normalizeMenuImportHeader(header) === sourceKey,
    );
    normalized[normalizeKey(canonicalTarget)] = sourceEntry?.[1] ?? "";
  }
  return normalized;
}
function normalizeReferenceValue(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}
function normalizeReferenceMap(value?: { stations?: Record<string, string> }) {
  return {
    stations: Object.fromEntries(
      Object.entries(value?.stations ?? {})
        .map(([source, target]) => [normalizeReferenceValue(source), target.trim()] as const)
        .filter(([source, target]) => Boolean(source && target))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}
function normalizeStringRecord(value?: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([key, item]) => [normalizeKey(key), item.trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
function stableJson(value: unknown) {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}
async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function menuRowMatchesExisting(normalized: ImportValue, existing: Record<string, unknown>) {
  const payload = parseJson<Record<string, unknown>>(string(existing["payload_json"]), {});
  const existingOnlineChannels = Array.isArray(payload["onlinePriceChannelCodes"])
    ? payload["onlinePriceChannelCodes"]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toUpperCase())
        .sort()
    : [];
  const desiredOnlineChannels = Array.isArray(normalized.onlinePriceChannelCodes)
    ? (normalized.onlinePriceChannelCodes as string[]).map((value) => value.toUpperCase()).sort()
    : [];
  return (
    string(existing["code"]).toUpperCase() === string(normalized.code).toUpperCase() &&
    optionalString(existing["sku"]) === optionalString(normalized.sku) &&
    string(existing["name"]) === string(normalized.name) &&
    string(existing["category_code"]) === string(normalized.categoryCode) &&
    optionalString(existing["description"]) === optionalString(normalized.description) &&
    number(existing["selling_price_minor"]) === number(normalized.sellingPriceMinor) &&
    payload["onlinePriceMinor"] === normalized.onlinePriceMinor &&
    existingOnlineChannels.join("|") === desiredOnlineChannels.join("|") &&
    string(existing["currency"]).toUpperCase() === string(normalized.currency).toUpperCase() &&
    optionalString(existing["tax_rule_id"]) === optionalString(normalized.taxRuleId) &&
    number(existing["service_charge_applicable"]) ===
      bool(Boolean(normalized.serviceChargeApplicable)) &&
    optionalString(existing["recipe_reference"]) === optionalString(normalized.recipeReference) &&
    optionalString(existing["barcode"]) === optionalString(normalized.barcode) &&
    number(existing["sellable"]) === bool(normalized.sellable !== false)
  );
}
function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
function parseMoneyMinor(value: string) {
  const cleaned = value.replace(/[,\s]/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return Number.NaN;
  const cents = (match[3] ?? "").padEnd(2, "0");
  const amount = BigInt(match[2]!) * 100n + BigInt(cents || "0");
  const signed = match[1] ? -amount : amount;
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(signed)
    : Number.NaN;
}
function parseMenuMoney(value: string, currency: string) {
  try {
    return parseMajorAmount(value.replace(/[,\s]/g, ""), currency);
  } catch {
    return Number.NaN;
  }
}
function parseInteger(value: string) {
  return /^-?\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
}
function parseBoolean(value: string) {
  return ["1", "true", "yes", "y", "on", "active", "available"].includes(
    value.trim().toLowerCase(),
  );
}
function isFalse(value: string) {
  return ["0", "false", "no", "n", "off", "inactive", "unavailable"].includes(
    value.trim().toLowerCase(),
  );
}
function parseList(value: string) {
  return value
    ? value
        .split(/[|;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
function multiplyMicroCost(quantityMicro: number, unitCostMinor: number) {
  const value = (BigInt(quantityMicro) * BigInt(unitCostMinor) + 500000n) / 1000000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw validation("Opening stock value exceeds safe range");
  return Number(value);
}
function issue(
  code: string,
  severity: "WARNING" | "CRITICAL",
  message: string,
  evidence: Record<string, unknown>,
  menuItemId?: string,
  recipeId?: string,
): RecipeValidationIssue {
  return {
    code,
    severity,
    message,
    evidence,
    ...(menuItemId ? { menuItemId } : {}),
    ...(recipeId ? { recipeId } : {}),
  };
}
function notApplicable(section: SetupSection, code: string, branchId?: string): ReadinessResult {
  return {
    id: stableId("readiness", `${branchId ?? "tenant"}:${code}`),
    code,
    section,
    scope: branchId ? "BRANCH" : "TENANT",
    ...(branchId ? { branchId } : {}),
    status: "NOT_APPLICABLE",
    severity: "INFO",
    message: "This section is not required by current configuration",
    evidence: {},
    recommendedAction: "No action required",
    overrideAllowed: false,
  };
}
function importIssue(field: string, code: string, message: string): ImportIssue {
  return { field, code, message };
}
function providerHealth(status: string, deadLetters: number): IntegrationHealthRow["health"] {
  if (deadLetters > 0) return "DEGRADED";
  if (["CONNECTED", "HEALTHY", "CONFIGURED"].includes(status)) return "HEALTHY";
  if (["AUTH_ERROR"].includes(status)) return "AUTH_ERROR";
  if (["DISABLED", "OFFLINE"].includes(status)) return "OFFLINE";
  if (["UNCONFIGURED", "CREDENTIALS_REQUIRED"].includes(status)) return "CONFIG_REQUIRED";
  return "UNKNOWN";
}
function mapTestRun(row: Row): TestRun {
  return {
    id: string(row.id),
    testType: string(row.test_type) as TestRun["testType"],
    targetType: string(row.target_type),
    ...(row.target_id ? { targetId: string(row.target_id) } : {}),
    status: string(row.status) as TestRun["status"],
    marker: string(row.test_marker),
    result: parseJson(string(row.result_json), {}),
    createdAt: string(row.created_at),
  };
}
async function count(db: D1Database, query: string, ...values: unknown[]) {
  const row = await db
    .prepare(query)
    .bind(...values)
    .first<CountRow>();
  return number(row?.count);
}
export function stableId(prefix: string, value: string) {
  return `${prefix}-${value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)}`;
}
function clean(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
function normalizeComparable(value: unknown) {
  return string(value)
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function normalizedAddress(payload: unknown) {
  const parsed = parseJson<Record<string, unknown>>(string(payload), {});
  return normalizeComparable(parsed["address"]);
}
function branchSummary(row: Record<string, unknown>) {
  return {
    id: string(row["id"]),
    code: string(row["code"]),
    name: string(row["name"]),
    lifecycleState: string(row["lifecycle_state"]),
    isBootstrap: Boolean(row["is_bootstrap"]),
  };
}
function string(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
function optionalString(value: unknown) {
  const text = string(value).trim();
  return text || null;
}
function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function bool(value: boolean) {
  return value ? 1 : 0;
}
function json(value: unknown) {
  return JSON.stringify(value);
}
function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
function hasValidCleanEvidence(
  checksum: string,
  status: string,
  encoded: string,
  subject: {
    objectKey?: string | null;
    objectVersion?: string | null;
    evidenceId?: string | null;
    objectStatus?: string | null;
  } = {},
) {
  if (status !== "CLEAN") return false;
  const evidence = parseJson<Partial<CleanScanEvidence>>(encoded, {});
  return (
    evidence.verdict === "CLEAN" &&
    evidence.sha256 === checksum &&
    ["cloudflare-service-binding", "cloudflare-service-binding+hmac-v1"].includes(
      evidence.authenticatedOrigin ?? "",
    ) &&
    (!subject.objectKey || evidence.objectKey === subject.objectKey) &&
    (!subject.objectVersion || evidence.objectVersion === subject.objectVersion) &&
    (!subject.evidenceId || evidence.evidenceId === subject.evidenceId) &&
    (!subject.objectStatus || subject.objectStatus === "ACTIVE") &&
    Boolean(
      evidence.evidenceId &&
      evidence.scannerId &&
      evidence.engine &&
      evidence.signatureVersion &&
      evidence.scannedAt &&
      evidence.jobId &&
      evidence.objectKey &&
      evidence.objectVersion,
    )
  );
}
function now() {
  return new Date().toISOString();
}
function validation(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 400, message);
}
function invalidTransition(message: string) {
  return new ServerOperationError("INVALID_STATE_TRANSITION", 409, message);
}
function denied(message: string) {
  return new ServerOperationError("PERMISSION_DENIED", 403, message);
}
function notFound(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 404, message);
}

/** Validates the restaurant's M-Pesa account numbers; a till needs its store number too. */
function darajaSetupConfiguration(configuration: Record<string, unknown> | undefined) {
  const config = { ...(configuration ?? {}) };
  const type = String(config["accountType"] ?? "PAYBILL").toUpperCase();
  if (type !== "PAYBILL" && type !== "TILL") throw validation("Choose Till or Paybill");
  const shortcode = String(config["shortcode"] ?? "").trim();
  if (!/^\d{5,7}$/.test(shortcode))
    throw validation(
      type === "TILL"
        ? "Enter the store (head office) number for your till"
        : "Enter your Paybill number",
    );
  const tillNumber = String(config["tillNumber"] ?? "").trim();
  if (type === "TILL" && !/^\d{5,7}$/.test(tillNumber)) throw validation("Enter your till number");
  for (const key of ["callbackUrl", "transactionType", "allowUnsignedSandboxCallbacks"])
    delete config[key];
  return {
    ...config,
    accountType: type,
    shortcode,
    ...(type === "TILL" ? { tillNumber } : { tillNumber: undefined }),
  };
}

function darajaCredentialsComplete(credentials: Record<string, string> | undefined) {
  return Boolean(
    credentials?.["consumerKey"] && credentials["consumerSecret"] && credentials["passkey"],
  );
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
