import { afterEach, describe, expect, it } from "vitest";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { createMigratedTestDatabase, type SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { RestaurantRegistrationService } from "@/server/registration-service";
import type { VerifiedExternalIdentity } from "@/server/identity/supabase-identity";

let db: SqliteD1TestDatabase;
const identity: VerifiedExternalIdentity = {
  provider: "supabase",
  subject: "isolated-e2e-owner",
  sessionId: "isolated-e2e-owner-session",
  email: "owner@disposable.example",
  emailVerified: true,
  issuedAt: 1,
  expiresAt: 4102444800,
};
const details = {
  idempotencyKey: "isolated-account-to-close-registration-001",
  administratorName: " Pilot Owner ",
  legalName: "Disposable Restaurant Limited",
  tradingName: "Disposable Restaurant",
  slug: "disposable-restaurant-ci",
  countryCode: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
  locale: "en-KE",
  branchCode: "PILOT_BRANCH_1",
  branchName: "Pilot Branch",
};
function count(query: string, ...values: Array<string | number>) {
  return Number((db.sqlite.prepare(query).get(...values) as { count: number }).count);
}
describe.sequential("fresh owner account to restaurant setup contract", () => {
  afterEach(() => db?.close());
  it("creates one correctly scoped tenant, owner, draft branch and onboarding state", async () => {
    db = createMigratedTestDatabase();
    for (const code of allPermissionCodes) {
      db.sqlite.prepare("INSERT INTO permissions(code,description) VALUES(?,?) ON CONFLICT DO NOTHING").run(code, code);
    }
    const service = new RestaurantRegistrationService(db);
    const result = await service.register(identity, details);
    expect(result.goLiveState).toBe("SETUP");
    expect(result.nextPath).toBe("/seramet-setup");
    expect(count("SELECT COUNT(*) count FROM tenants WHERE id=?", result.tenantId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM branches WHERE tenant_id=? AND id=? AND lifecycle_state='DRAFT' AND is_bootstrap=1", result.tenantId, result.branchId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM user_branches WHERE tenant_id=? AND user_id=? AND branch_id=?", result.tenantId, result.userId, result.branchId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM account_owners WHERE tenant_id=? AND user_id=? AND status='ACTIVE'", result.tenantId, result.userId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM identity_accounts WHERE tenant_id=? AND user_id=? AND provider='supabase' AND email_verified=1", result.tenantId, result.userId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM tenant_onboarding_profiles WHERE tenant_id=? AND go_live_state='SETUP' AND demo_mode=0", result.tenantId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM onboarding_wizard_progress WHERE tenant_id=? AND current_step=5 AND status='IN_PROGRESS'", result.tenantId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM branch_operating_profiles WHERE tenant_id=? AND branch_id=?", result.tenantId, result.branchId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM roles WHERE tenant_id=? AND code='ACCOUNT_OWNER'", result.tenantId)).toBe(1);
    for (const permission of [permissions.usersManage, permissions.employeeCredentialsManage, permissions.staffManage, permissions.settingsBranchManage]) {
      expect(count("SELECT COUNT(*) count FROM user_roles ur JOIN role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id WHERE ur.tenant_id=? AND ur.user_id=? AND rp.permission_code=?", result.tenantId, result.userId, permission)).toBe(1);
    }
    expect(count("SELECT COUNT(*) count FROM audit_events WHERE tenant_id=? AND action='RESTAURANT_REGISTERED'", result.tenantId)).toBe(1);
    const repeated = await service.register(identity, details);
    expect(repeated).toEqual(result);
    expect(count("SELECT COUNT(*) count FROM tenants WHERE id=?", result.tenantId)).toBe(1);
    expect(count("SELECT COUNT(*) count FROM restaurant_registration_attempts WHERE tenant_id=?", result.tenantId)).toBe(1);
    await expect(service.register(identity, { ...details, legalName: "Altered legal name" })).rejects.toThrow(/idempotency key was reused/i);
    expect(count("SELECT COUNT(*) count FROM tenants")).toBe(1);
  });

  it("rejects unverified account creation without a trusted phone and leaves no partial tenant", async () => {
    db = createMigratedTestDatabase();
    const service = new RestaurantRegistrationService(db);
    await expect(service.register({ ...identity, emailVerified: false, phone: undefined }, details)).rejects.toThrow(/verified email address or phone/i);
    expect(count("SELECT COUNT(*) count FROM tenants")).toBe(0);
    expect(count("SELECT COUNT(*) count FROM restaurant_registration_attempts")).toBe(0);
  });
});
