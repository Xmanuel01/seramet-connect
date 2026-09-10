import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import type { VerifiedExternalIdentity } from "@/server/identity/supabase-identity";

export type RestaurantRegistrationInput = {
  idempotencyKey: string;
  administratorName: string;
  slug?: string;
  legalName: string;
  tradingName: string;
  countryCode?: string;
  currency?: string;
  timezone?: string;
  locale?: string;
  brandCode?: string;
  brandName?: string;
  branchCode?: string;
  branchName?: string;
  businessDayCutoffMinutes?: number;
  negativeStockPolicy?: "ALLOW_WITH_ALERT" | "BLOCK" | "MANAGER_OVERRIDE";
  serviceModes?: string[];
};

export type RestaurantRegistrationResult = {
  tenantId: string;
  userId: string;
  legalEntityId: string;
  brandId: string;
  branchId: string;
  goLiveState: "SETUP";
  nextPath: "/seramet-setup";
};

const tenantAdministratorPermissions = allPermissionCodes.filter(
  (code) => code !== permissions.platformTenantsProvision && code !== permissions.setupDemoReset,
);

export class RestaurantRegistrationService {
  constructor(private readonly db: D1Database) {}

  async register(
    identity: VerifiedExternalIdentity,
    input: RestaurantRegistrationInput,
  ): Promise<RestaurantRegistrationResult> {
    if (!identity.emailVerified && !identity.phone) {
      throw new ServerOperationError(
        "AUTHENTICATION_REQUIRED",
        403,
        "A verified email address or phone number is required",
      );
    }
    const requestHash = await sha256(stableJson(input));
    const existing = await this.findAttempt(identity, input.idempotencyKey);
    if (existing) return replay(existing, requestHash);

    const requestedSlug = restaurantSlug(input.slug, input.tradingName);
    const slug = input.slug?.trim()
      ? requestedSlug
      : await this.nextAvailableGeneratedSlug(requestedSlug);
    const stamp = new Date().toISOString();
    const countryCode = input.countryCode ?? "ZZ";
    const currency = input.currency ?? "XXX";
    const timezone = input.timezone ?? "UTC";
    const locale = input.locale ?? "en";
    const brandCode = input.brandCode ?? codeFrom(slug);
    const brandName = input.brandName ?? input.tradingName;
    const branchCode = input.branchCode ?? `${brandCode.slice(0, 16)}_01`;
    const branchName = input.branchName ?? input.tradingName;
    const businessDayCutoffMinutes = input.businessDayCutoffMinutes ?? 0;
    const negativeStockPolicy = input.negativeStockPolicy ?? "BLOCK";
    const serviceModes = input.serviceModes ?? [];
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const legalEntityId = crypto.randomUUID();
    const brandId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const roleId = crypto.randomUUID();
    const groupNodeId = crypto.randomUUID();
    const legalNodeId = crypto.randomUUID();
    const brandNodeId = crypto.randomUUID();
    const branchNodeId = crypto.randomUUID();
    const result: RestaurantRegistrationResult = {
      tenantId,
      userId,
      legalEntityId,
      brandId,
      branchId,
      goLiveState: "SETUP",
      nextPath: "/seramet-setup",
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO tenants
            (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
        )
        .bind(
          tenantId,
          slug,
          clean(input.legalName),
          clean(input.tradingName),
          currency,
          timezone,
          locale,
          json({ countryCode }),
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          "INSERT INTO brands (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
        )
        .bind(tenantId, brandId, brandCode, clean(brandName)),
      this.db
        .prepare(
          `INSERT INTO branches
            (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
           VALUES (?,?,?,?,?,?,?,1,?)`,
        )
        .bind(
          tenantId,
          branchId,
          brandId,
          branchCode,
          clean(branchName),
          timezone,
          businessDayCutoffMinutes,
          json({ currency, metadata: {}, onboardingProvisional: true }),
        ),
      this.db
        .prepare(
          `INSERT INTO tenant_onboarding_profiles
            (tenant_id,country_code,accounting_mode,tax_configuration_reference,logo_asset_reference,
             default_document_footer,fiscal_settings_json,contact_json,legal_identifiers_json,
             document_branding_json,go_live_state,demo_mode,demo_reset_allowed,created_by,created_at,
             updated_by,updated_at)
           VALUES (?,?,NULL,NULL,NULL,NULL,'{}','{}','{}','{}','SETUP',0,0,?,?,?,?)`,
        )
        .bind(tenantId, countryCode === "ZZ" ? null : countryCode, userId, stamp, userId, stamp),
      this.db
        .prepare(
          `INSERT INTO onboarding_wizard_progress
            (tenant_id,current_step,status,completed_steps_json,responses_json,version,created_by,
             created_at,updated_by,updated_at,completed_at)
           VALUES (?,5,'IN_PROGRESS','[1,2,3,4]','{}',1,?,?,?,?,NULL)`,
        )
        .bind(tenantId, userId, stamp, userId, stamp),
      this.db
        .prepare(
          `INSERT INTO branch_operating_profiles
            (tenant_id,branch_id,accounting_mode_override,negative_stock_policy,operating_hours_json,
             service_modes_json,required_device_roles_json,payments_required,inventory_enabled,
             recipes_required,printing_required,kds_required,created_by,created_at,updated_by,updated_at)
           VALUES (?,?,NULL,?,'{}',?,'[]',1,1,1,1,1,?,?,?,?)`,
        )
        .bind(
          tenantId,
          branchId,
          negativeStockPolicy,
          json(serviceModes),
          userId,
          stamp,
          userId,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO legal_entities
            (tenant_id,id,code,legal_name,trading_name,registration_reference,tax_identifiers_json,
             country_code,base_currency,fiscal_configuration_json,accounting_configuration_json,
             status,created_by,created_at,updated_by,updated_at)
           VALUES (?,?,?,?,?,NULL,'{}',?,?,'{}','{}','ACTIVE',?,?,?,?)`,
        )
        .bind(
          tenantId,
          legalEntityId,
          brandCode,
          clean(input.legalName),
          clean(input.tradingName),
          countryCode,
          currency,
          userId,
          stamp,
          userId,
          stamp,
        ),
      nodeStatement(this.db, {
        tenantId,
        id: groupNodeId,
        type: "GROUP",
        code: "GROUP",
        name: clean(input.tradingName),
        parentId: null,
        legalEntityId: null,
        brandId: null,
        branchId: null,
        timezone,
        currency,
        userId,
        stamp,
      }),
      nodeStatement(this.db, {
        tenantId,
        id: legalNodeId,
        type: "LEGAL_ENTITY",
        code: `LEGAL-${brandCode}`,
        name: clean(input.legalName),
        parentId: groupNodeId,
        legalEntityId,
        brandId: null,
        branchId: null,
        timezone,
        currency,
        userId,
        stamp,
      }),
      nodeStatement(this.db, {
        tenantId,
        id: brandNodeId,
        type: "BRAND",
        code: `BRAND-${brandCode}`,
        name: clean(brandName),
        parentId: legalNodeId,
        legalEntityId,
        brandId,
        branchId: null,
        timezone,
        currency,
        userId,
        stamp,
      }),
      nodeStatement(this.db, {
        tenantId,
        id: branchNodeId,
        type: "BRANCH",
        code: `BRANCH-${branchCode}`,
        name: clean(branchName),
        parentId: brandNodeId,
        legalEntityId,
        brandId,
        branchId,
        timezone,
        currency,
        userId,
        stamp,
      }),
      this.db
        .prepare(
          `INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth)
           VALUES
             (?,?,?,0),(?,?,?,0),(?,?,?,0),(?,?,?,0),
             (?,?,?,1),(?,?,?,1),(?,?,?,1),(?,?,?,2),(?,?,?,2),(?,?,?,3)`,
        )
        .bind(
          tenantId,
          groupNodeId,
          groupNodeId,
          tenantId,
          legalNodeId,
          legalNodeId,
          tenantId,
          brandNodeId,
          brandNodeId,
          tenantId,
          branchNodeId,
          branchNodeId,
          tenantId,
          groupNodeId,
          legalNodeId,
          tenantId,
          legalNodeId,
          brandNodeId,
          tenantId,
          brandNodeId,
          branchNodeId,
          tenantId,
          groupNodeId,
          brandNodeId,
          tenantId,
          legalNodeId,
          branchNodeId,
          tenantId,
          groupNodeId,
          branchNodeId,
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
          userId,
          identity.email ?? null,
          clean(input.administratorName),
          json({ externalIdentityProvider: identity.provider }),
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO identity_accounts
            (tenant_id,user_id,provider,subject,email,email_verified,linked_at,last_authenticated_at,metadata_json)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          tenantId,
          userId,
          identity.provider,
          identity.subject,
          identity.email ?? null,
          identity.emailVerified ? 1 : 0,
          stamp,
          stamp,
          json({}),
        ),
      this.db
        .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
        .bind(tenantId, userId, roleId),
      this.db
        .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
        .bind(tenantId, userId, branchId),
      this.db
        .prepare(
          `INSERT INTO user_primary_branches
            (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason)
           VALUES (?,?,?,?,?,?)`,
        )
        .bind(tenantId, userId, branchId, userId, stamp, "Initial restaurant registration"),
      this.db
        .prepare(
          `INSERT INTO role_permissions (tenant_id,role_id,permission_code)
           SELECT ?,?,code FROM permissions WHERE code NOT IN (?,?)`,
        )
        .bind(tenantId, roleId, permissions.platformTenantsProvision, permissions.setupDemoReset),
      this.db
        .prepare(
          `INSERT INTO audit_events
            (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,
             correlation_id,session_id,metadata_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          tenantId,
          crypto.randomUUID(),
          branchId,
          userId,
          "RESTAURANT_REGISTERED",
          "TENANT",
          tenantId,
          "Verified self-service registration",
          crypto.randomUUID(),
          identity.sessionId,
          json({ provider: identity.provider, branchId, brandId, legalEntityId }),
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO restaurant_registration_attempts
            (provider,subject,idempotency_key,request_hash,status,tenant_id,response_json,created_at,updated_at)
           VALUES (?,?,?,?,'COMPLETED',?,?,?,?)`,
        )
        .bind(
          identity.provider,
          identity.subject,
          input.idempotencyKey,
          requestHash,
          tenantId,
          json(result),
          stamp,
          stamp,
        ),
    ];

    try {
      await this.db.batch(statements);
      return result;
    } catch (error) {
      const raced = await this.findAttempt(identity, input.idempotencyKey);
      if (raced) return replay(raced, requestHash);
      if (String(error).toLowerCase().includes("slug")) {
        throw new ServerOperationError("DUPLICATE", 409, "Restaurant URL is already in use");
      }
      throw error;
    }
  }

  private findAttempt(identity: VerifiedExternalIdentity, idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT request_hash,response_json FROM restaurant_registration_attempts
         WHERE provider=? AND subject=? AND idempotency_key=?`,
      )
      .bind(identity.provider, identity.subject, idempotencyKey)
      .first<{ request_hash: string; response_json: string }>();
  }

  private async nextAvailableGeneratedSlug(base: string) {
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      const suffix = sequence === 1 ? "" : `-${sequence}`;
      const root = base.slice(0, 63 - suffix.length).replace(/-+$/g, "");
      const candidate = `${root}${suffix}`;
      const existing = await this.db
        .prepare("SELECT 1 AS present FROM tenants WHERE slug=? LIMIT 1")
        .bind(candidate)
        .first<{ present: number }>();
      if (!existing) return candidate;
    }
    return `${base.slice(0, 54).replace(/-+$/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  }
}

function nodeStatement(
  db: D1Database,
  input: {
    tenantId: string;
    id: string;
    type: string;
    code: string;
    name: string;
    parentId: string | null;
    legalEntityId: string | null;
    brandId: string | null;
    branchId: string | null;
    timezone: string;
    currency: string;
    userId: string;
    stamp: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO enterprise_nodes
        (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,warehouse_id,
         status,effective_from,effective_to,timezone,currency,metadata_json,created_by,created_at,
         updated_by,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,'ACTIVE',?,NULL,?,?,'{}',?,?,?,?,1)`,
    )
    .bind(
      input.tenantId,
      input.id,
      input.type,
      input.code,
      input.name,
      input.parentId,
      input.legalEntityId,
      input.brandId,
      input.branchId,
      input.stamp,
      input.timezone,
      input.currency,
      input.userId,
      input.stamp,
      input.userId,
      input.stamp,
    );
}

function replay(
  existing: { request_hash: string; response_json: string },
  requestHash: string,
): RestaurantRegistrationResult {
  if (existing.request_hash !== requestHash) {
    throw new ServerOperationError(
      "CONFLICT",
      409,
      "Registration idempotency key was reused with different details",
    );
  }
  return JSON.parse(existing.response_json) as RestaurantRegistrationResult;
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function codeFrom(value: string) {
  const code = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return code.length >= 2 ? code : `ORG_${code || "NEW"}`;
}

function restaurantSlug(value: string | undefined, tradingName: string) {
  let source = value?.trim() || tradingName.trim();
  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      const pathSegment = url.pathname.split("/").filter(Boolean).at(-1);
      source = pathSegment || url.hostname.split(".")[0] || tradingName;
    } catch {
      source = tradingName;
    }
  }
  let slug = source
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (slug.length < 3) slug = `${slug || "restaurant"}-restaurant`.slice(0, 63);
  return slug;
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { tenantAdministratorPermissions };
