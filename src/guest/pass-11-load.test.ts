import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GuestExperienceService } from "@/guest/guest-service";
import { hashCapabilityToken } from "@/guest/security";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
const restaurantSlug = "mona-swahili-demo";
const branchSlug = "westlands";
const representedRows = 2_000;

describe("Pass 11 scaled guest workload", () => {
  let db: SqliteD1TestDatabase;
  let service: GuestExperienceService;

  beforeAll(async () => {
    db = createDemoFixtureDatabase();
    db.sqlite
      .prepare("UPDATE public_branch_profiles SET operating_hours_json=? WHERE tenant_id=?")
      .run(alwaysOpenHours(), tenantId);
    seedRepresentedWorkload(db);
    await hydrateAuthoritativeConfiguration(db, {}, true);
    service = new GuestExperienceService(
      db,
      new D1AuthoritativeTransactionRepository(db),
      "pass-eleven-load-capability-secret-which-is-long",
    );
  });

  afterAll(() => db.close());

  it("keeps bounded public and staff operations responsive over a 14,000-row fixture", async () => {
    const timings: Record<string, number> = {};
    await timed(timings, "publicRestaurant", () => service.publicRestaurant(restaurantSlug));
    const menu = await timed(timings, "publicMenu", () =>
      service.publicMenu(restaurantSlug, branchSlug, "PICKUP"),
    );
    expect(menu.items.length).toBeGreaterThan(0);

    await timed(timings, "reservationAvailability", () =>
      service.reservationAvailability(restaurantSlug, branchSlug, {
        startsAt: futureLocalIso(5, 19),
        partySize: 2,
      }),
    );
    await timed(timings, "reservationCreate", () =>
      service.createReservation(restaurantSlug, branchSlug, {
        startsAt: futureLocalIso(6, 19),
        partySize: 2,
        guestName: "Load fixture guest",
        idempotencyKey: "pass11-load-reservation-create",
      }),
    );

    const qr = await service.rotateQrToken(actor(), {
      branchId,
      tableId: "table-demo-w-01",
      mode: "ORDERING_ENABLED",
    });
    const session = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "QR",
      qrToken: qr.token,
    });
    const quote = await timed(timings, "qrQuote", () =>
      service.createQuote(session.token, {
        serviceMode: "QR_TABLE",
        items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
      }),
    );
    const order = await timed(timings, "qrOrderSubmit", () =>
      service.submitOrder(session.token, {
        quoteId: quote.id,
        idempotencyKey: "pass11-load-qr-submit",
      }),
    );
    await timed(timings, "tracking", () => service.trackOrder(order.trackingToken));
    await timed(timings, "hostDashboard", () =>
      service.hostDashboard(actor(), branchId, fixtureBusinessDate()),
    );

    const memberToken = "MEM_pass-eleven-load-member-token-000001";
    db.sqlite
      .prepare(
        "UPDATE customer_loyalty_memberships SET member_number_hash=? WHERE tenant_id=? AND id='membership-demo-001'",
      )
      .run(await hashCapabilityToken(memberToken), tenantId);
    const portal = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "PORTAL",
    });
    await service.linkLoyaltyMembership(portal.token, memberToken);
    await timed(timings, "guestPortal", () => service.guestPortalSummary(portal.token));

    console.info(
      `PASS11_LOAD_METRICS ${JSON.stringify({ representedRows: representedRows * 7, timings })}`,
    );
    for (const duration of Object.values(timings)) expect(duration).toBeLessThan(5_000);
  });
});

function seedRepresentedWorkload(db: SqliteD1TestDatabase) {
  const stamp = new Date().toISOString();
  const businessDate = fixtureBusinessDate();
  const session = db.sqlite.prepare(
    `INSERT INTO guest_sessions
      (tenant_id,id,branch_id,session_type,token_hash,status,channel_code,expires_at,last_seen_at,created_at)
     VALUES (?,?,?,'WEB',?,'EXPIRED','WEB-DIRECT',?,?,?)`,
  );
  const reservation = db.sqlite.prepare(
    `INSERT INTO reservations
      (tenant_id,id,branch_id,guest_name,party_size,starts_at,ends_at,business_date,status,source,
       confirmation_state,manage_token_hash,idempotency_key,created_by,created_at,updated_at)
     VALUES (?,?,?,?,2,?,?,?,'COMPLETED','WEB-DIRECT','NOT_REQUIRED',?,?,'load-fixture',?,?)`,
  );
  const waitlist = db.sqlite.prepare(
    `INSERT INTO waitlist_entries
      (tenant_id,id,branch_id,guest_name,party_size,status,estimated_wait_minutes,joined_at,created_by,updated_at)
     VALUES (?,?,?,?,2,'EXPIRED',20,?,'load-fixture',?)`,
  );
  const funnel = db.sqlite.prepare(
    `INSERT INTO guest_funnel_events
      (tenant_id,id,branch_id,guest_session_id,funnel_type,stage,source_channel,source_id,occurred_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  db.sqlite.exec("BEGIN");
  for (let index = 0; index < representedRows; index += 1) {
    const sessionId = `pass11-load-session-${index}`;
    session.run(tenantId, sessionId, branchId, `pass11-load-token-${index}`, stamp, stamp, stamp);
    reservation.run(
      tenantId,
      `pass11-load-reservation-${index}`,
      branchId,
      `Represented guest ${index}`,
      `${businessDate}T12:00:00.000Z`,
      `${businessDate}T13:30:00.000Z`,
      businessDate,
      `pass11-load-reservation-hash-${index}`,
      `pass11-load-reservation-key-${index}`,
      stamp,
      stamp,
    );
    waitlist.run(
      tenantId,
      `pass11-load-waitlist-${index}`,
      branchId,
      `Represented waitlist ${index}`,
      stamp,
      stamp,
    );
    for (const [offset, stage] of [
      "CART_STARTED",
      "QUOTE_CREATED",
      "ORDER_CONFIRMED",
      "PAYMENT_INITIATED",
    ].entries()) {
      funnel.run(
        tenantId,
        `pass11-load-funnel-${index}-${offset}`,
        branchId,
        sessionId,
        "ORDERING",
        stage,
        "WEB-DIRECT",
        `pass11-load-source-${index}`,
        stamp,
        stamp,
      );
    }
  }
  db.sqlite.exec("COMMIT");
}

async function timed<T>(metrics: Record<string, number>, key: string, task: () => Promise<T>) {
  const started = performance.now();
  const result = await task();
  metrics[key] = Math.round((performance.now() - started) * 100) / 100;
  return result;
}

function fixtureBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function futureLocalIso(days: number, hour: number) {
  const future = new Date(Date.now() + days * 86_400_000);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(future);
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+03:00`).toISOString();
}

function alwaysOpenHours() {
  return JSON.stringify(
    Object.fromEntries(
      ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => [
        day,
        ["00:00", "23:59"],
      ]),
    ),
  );
}

function actor(): ServerActor {
  return {
    id: "pass11-load-manager",
    name: "Load Manager",
    tenantId,
    roleIds: ["role-demo-branch-manager"],
    permissions: [...allPermissionCodes, permissions.tenantScopeAllBranches],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Fixture branch" }],
    branchScope: { type: "ALL" },
    branchId,
    role: "Manager",
    branch: "Fixture branch",
  };
}
