import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { SerametHttpError } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { PermissionCode } from "@/platform/types";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import {
  createOrderChannel,
  createPaymentMethod,
  createRole,
  deactivateRole,
  updateOrderChannel,
  updatePaymentMethod,
} from "@/server/settings-configuration-service";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";

describe.sequential("server-authoritative settings configuration", () => {
  let db: SqliteD1TestDatabase;

  beforeEach(() => {
    db = createDemoFixtureDatabase();
  });

  afterEach(() => db.close());

  it("persists an exact payment method once and audits only the authoritative mutation", async () => {
    const input = {
      code: "STAFF_MEAL",
      displayName: "Staff meal",
      category: "CUSTOM" as const,
      reason: "Enable the approved staff meal tender",
    };
    const first = await createPaymentMethod(db, actor([permissions.settingsPaymentManage]), input);
    const replay = await createPaymentMethod(db, actor([permissions.settingsPaymentManage]), input);

    expect(first.duplicate).toBe(false);
    expect(replay).toMatchObject({
      duplicate: true,
      paymentMethod: { id: first.paymentMethod.id },
    });
    expect(tableCount("payment_methods", "code", "STAFF_MEAL")).toBe(1);
    expect(auditCount("PAYMENT_METHOD_CREATED", first.paymentMethod.id)).toBe(1);

    await expect(
      createPaymentMethod(db, actor([permissions.settingsPaymentManage]), {
        ...input,
        displayName: "Different tender",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects unauthorized settings writes without records or audit effects", async () => {
    const beforeMethods = tableCount("payment_methods");
    const beforeAudits = auditCount("PAYMENT_METHOD_CREATED");

    await expect(
      createPaymentMethod(db, actor([]), {
        code: "UNAUTHORIZED",
        displayName: "Unauthorized tender",
        category: "CUSTOM",
        reason: "Attempt a settings write without permission",
      }),
    ).rejects.toBeInstanceOf(SerametHttpError);

    expect(tableCount("payment_methods")).toBe(beforeMethods);
    expect(auditCount("PAYMENT_METHOD_CREATED")).toBe(beforeAudits);
  });

  it("collapses simultaneous identical creation attempts into one record and one audit", async () => {
    const input = {
      code: "RACE_SAFE",
      displayName: "Race safe tender",
      category: "CUSTOM" as const,
      reason: "Verify repeated settings submissions remain idempotent",
    };
    const results = await Promise.all([
      createPaymentMethod(db, actor([permissions.settingsPaymentManage]), input),
      createPaymentMethod(db, actor([permissions.settingsPaymentManage]), input),
    ]);

    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(tableCount("payment_methods", "code", "RACE_SAFE")).toBe(1);
    const created = results.find((result) => !result.duplicate)!;
    expect(auditCount("PAYMENT_METHOD_CREATED", created.paymentMethod.id)).toBe(1);
  });

  it("persists payment and channel toggles with their exact server state", async () => {
    const payment = await createPaymentMethod(db, actor([permissions.settingsPaymentManage]), {
      code: "MANUAL_CARD",
      displayName: "Manual card",
      category: "CARD",
      reason: "Add the authorized manual card tender",
    });
    const disabledPayment = await updatePaymentMethod(
      db,
      actor([permissions.settingsPaymentManage]),
      payment.paymentMethod.id,
      { enabled: false, reason: "Disable tender pending terminal certification" },
    );
    expect(disabledPayment.paymentMethod.enabled).toBe(false);
    expect(storedPayload("payment_methods", payment.paymentMethod.id)).toMatchObject({
      enabled: false,
    });
    const enabledPayment = await updatePaymentMethod(
      db,
      actor([permissions.settingsPaymentManage]),
      payment.paymentMethod.id,
      { enabled: true, reason: "Re-enable tender after terminal certification" },
    );
    expect(enabledPayment.paymentMethod.enabled).toBe(true);

    const channel = await createOrderChannel(db, actor([permissions.settingsChannelManage]), {
      code: "PICKUP_TEST",
      displayName: "Pickup test",
      channelType: "TAKEAWAY",
      useOnlinePrice: false,
      reason: "Add the approved pickup order channel",
    });
    const updatedChannel = await updateOrderChannel(
      db,
      actor([permissions.settingsChannelManage]),
      channel.orderChannel.id,
      {
        enabled: false,
        useOnlinePrice: true,
        reason: "Suspend pickup while retaining configured online pricing",
      },
    );
    expect(updatedChannel.orderChannel).toMatchObject({
      enabled: false,
      metadata: { useOnlinePrice: true },
    });
    expect(storedPayload("order_channels", channel.orderChannel.id)).toMatchObject({
      enabled: false,
      metadata: { useOnlinePrice: true },
    });
    expect(auditCount("ORDER_CHANNEL_DISABLED", channel.orderChannel.id)).toBe(1);
  });

  it("creates a role idempotently but refuses to disable a role assigned to active staff", async () => {
    const input = {
      name: "Stock Counter",
      reason: "Create the branch stock counting role",
    };
    const created = await createRole(db, actor([permissions.settingsRoleManage]), input);
    if (!created.role) throw new Error("Created role was not returned");
    const replay = await createRole(db, actor([permissions.settingsRoleManage]), input);
    expect(replay).toMatchObject({ duplicate: true, role: { id: created.role.id } });
    expect(auditCount("ROLE_CREATED", created.role.id)).toBe(1);

    await expect(
      deactivateRole(db, actor([permissions.settingsRoleManage]), "role-demo-branch-manager", {
        reason: "Attempt to disable an assigned operational role",
      }),
    ).rejects.toMatchObject({ status: 409 });

    const disabled = await deactivateRole(
      db,
      actor([permissions.settingsRoleManage]),
      created.role.id,
      { reason: "Remove the unused stock counting role" },
    );
    expect(disabled.role.active).toBe(false);
    expect(auditCount("ROLE_DISABLED", created.role.id)).toBe(1);
  });

  function tableCount(
    table: "payment_methods" | "order_channels",
    column?: string,
    value?: string,
  ) {
    const statement = column
      ? db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=? AND ${column}=?`)
      : db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?`);
    const row = (column ? statement.get(tenantId, value!) : statement.get(tenantId)) as {
      count: number;
    };
    return Number(row.count);
  }

  function auditCount(action: string, entityId?: string) {
    const statement = entityId
      ? db.sqlite.prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE tenant_id=? AND action=? AND entity_id=?",
        )
      : db.sqlite.prepare("SELECT COUNT(*) count FROM audit_events WHERE tenant_id=? AND action=?");
    const row = (
      entityId ? statement.get(tenantId, action, entityId) : statement.get(tenantId, action)
    ) as { count: number };
    return Number(row.count);
  }

  function storedPayload(table: "payment_methods" | "order_channels", id: string) {
    const row = db.sqlite
      .prepare(`SELECT payload_json FROM ${table} WHERE tenant_id=? AND id=?`)
      .get(tenantId, id) as { payload_json: string };
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  }
});

function actor(permissionCodes: PermissionCode[]): ServerActor {
  return {
    id: "settings-test-actor",
    name: "Settings test actor",
    tenantId,
    roleIds: [],
    permissions: permissionCodes,
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Westlands" }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    role: "Configured settings administrator",
    branch: "Westlands",
  };
}
