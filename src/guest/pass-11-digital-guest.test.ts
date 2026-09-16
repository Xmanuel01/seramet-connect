import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import { GuestExperienceService } from "@/guest/guest-service";
import { hashCapabilityToken } from "@/guest/security";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import { PaymentOrchestrator } from "@/payments/payment-orchestrator";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
const restaurantSlug = "mona-swahili-demo";
const branchSlug = "westlands";
const secret = "pass-eleven-test-capability-secret-which-is-long";

describe("Pass 11 digital guest experience", () => {
  let db: SqliteD1TestDatabase;
  let repo: D1AuthoritativeTransactionRepository;
  let service: GuestExperienceService;
  let capturedEvents: number;

  beforeEach(async () => {
    db = createDemoFixtureDatabase();
    db.sqlite
      .prepare(
        `UPDATE public_branch_profiles SET operating_hours_json=?
         WHERE tenant_id=?`,
      )
      .run(
        JSON.stringify(
          Object.fromEntries(
            ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(
              (day) => [day, ["00:00", "23:59"]],
            ),
          ),
        ),
        tenantId,
      );
    await hydrateAuthoritativeConfiguration(db, {}, true);
    repo = new D1AuthoritativeTransactionRepository(db);
    capturedEvents = 0;
    service = new GuestExperienceService(db, repo, secret, async () => {
      capturedEvents += 1;
    });
  });

  afterEach(() => db.close());

  it("applies the current schema with tenant-scoped guest and reservation constraints", () => {
    expect(
      db.sqlite.prepare("SELECT MAX(version) version FROM schema_migrations").get(),
    ).toMatchObject({ version: 20 });
    const tables = db.sqlite
      .prepare(
        `SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN
       ('public_branch_profiles','guest_sessions','guest_checkout_quotes','table_qr_tokens',
        'reservations','reservation_capacity_locks','waitlist_entries','guest_funnel_events')`,
      )
      .get() as { count: number };
    expect(tables.count).toBe(8);
    expect(() =>
      db.sqlite
        .prepare(
          `INSERT INTO guest_sessions
          (tenant_id,id,branch_id,session_type,token_hash,status,channel_code,expires_at,last_seen_at,created_at)
         VALUES ('missing','cross-tenant','branch-demo-westlands','WEB','hash','ACTIVE','WEB-DIRECT',?,?,?)`,
        )
        .run(nowPlus(1), new Date().toISOString(), new Date().toISOString()),
    ).toThrow();
  });

  it("publishes only configured branch profile and authoritative menu fields", async () => {
    const restaurant = await service.publicRestaurant(restaurantSlug);
    expect(restaurant.branches).toHaveLength(2);
    expect(restaurant.branches[0]).not.toHaveProperty("tenantId");
    expect(restaurant.branches[0]).not.toHaveProperty("branchId");
    const menu = await service.publicMenu(restaurantSlug, branchSlug, "PICKUP");
    expect(menu.items).toHaveLength(4);
    expect(menu.items[0]).not.toHaveProperty("payload_json");
    expect(menu.items.every((item) => Number.isSafeInteger(item.priceMinor))).toBe(true);
  });

  it("creates server quotes from current prices and rejects client monetary fields", async () => {
    const session = await webSession();
    const quote = await service.createQuote(session.token, {
      serviceMode: "PICKUP",
      items: [{ itemId: "menu-demo-biryani", quantity: 2 }],
    });
    expect(quote.subtotalMinor).toBe(200_000);
    expect(quote.totalMinor).toBe(200_000);

    const response = await api(
      `/api/seramet/guest/restaurants/${restaurantSlug}/${branchSlug}/quotes`,
      {
        serviceMode: "PICKUP",
        items: [{ itemId: "menu-demo-biryani", quantity: 1, priceMinor: 1 }],
      },
      { "x-seramet-guest-token": session.token },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects forged tax/payment state and guest-to-staff privilege escalation", async () => {
    const session = await webSession();
    const forgedTax = await api(
      `/api/seramet/guest/restaurants/${restaurantSlug}/${branchSlug}/quotes`,
      {
        serviceMode: "PICKUP",
        items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
        taxMinor: 0,
      },
      { "x-seramet-guest-token": session.token },
    );
    expect(forgedTax.status).toBe(400);

    const quote = await service.createQuote(session.token, {
      serviceMode: "PICKUP",
      items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
    });
    const forgedPayment = await api(
      `/api/seramet/guest/restaurants/${restaurantSlug}/${branchSlug}/orders`,
      {
        quoteId: quote.id,
        idempotencyKey: "forged-payment-state-0001",
        paymentStatus: "PAID",
      },
      { "x-seramet-guest-token": session.token },
    );
    expect(forgedPayment.status).toBe(400);

    const staffEscalation = await handleSerametApiRequest(
      new Request(`http://localhost/api/seramet/guest-admin/host?branchId=${branchId}`, {
        headers: { "x-seramet-guest-token": session.token },
      }),
      {
        SERAMET_ENVIRONMENT: "development",
        SERAMET_DB: db,
        SERAMET_JWT_SECRET: secret,
      },
    );
    expect(staffEscalation.status).toBe(401);
  });

  it("creates one normal Seramet order, bill and kitchen dispatch on duplicate submit", async () => {
    const session = await webSession();
    const quote = await service.createQuote(session.token, {
      serviceMode: "PICKUP",
      items: [
        { itemId: "menu-demo-biryani", quantity: 1, specialRequest: "No chilli <script>" },
        { itemId: "menu-demo-juice", quantity: 1 },
      ],
    });
    const command = {
      quoteId: quote.id,
      idempotencyKey: "checkout-retry-0001",
      customerName: "Guest diner",
    };
    const first = await service.submitOrder(session.token, command);
    const replay = await service.submitOrder(session.token, command);
    expect(replay).toMatchObject({ orderReference: first.orderReference, duplicate: true });
    const state = await repo.loadState(tenantId);
    const orders = state.orders.filter((order) => order.guestContext?.submissionId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "SENT_TO_KITCHEN", channel: "WEB-DIRECT" });
    expect(orders[0]!.kitchenNote).not.toContain("<script>");
    expect(state.bills.some((bill) => bill.orderIds.includes(orders[0]!.id))).toBe(true);
    expect(capturedEvents).toBe(1);
  });

  it("redeems a capped voucher atomically with the guest order and rejects concurrent reuse", async () => {
    const value = new LoyaltyValueService(db, manager());
    await value.createVoucherDefinition({
      code: "GUEST10",
      name: "Guest checkout voucher",
      validFrom: "2026-01-01T00:00:00.000Z",
      branchIds: [branchId],
      channels: ["WEB-DIRECT"],
      itemIds: [],
      categoryCodes: [],
      minimumSpendMinor: 0,
      currency: "KES",
      discountType: "FIXED_MINOR",
      discountValue: 1_000,
      usageCap: 1,
      customerSpecific: false,
      singleUse: false,
      stackingPolicy: "BLOCK",
      stackingPriority: 10,
    });
    const sessions = await Promise.all([webSession(), webSession()]);
    const quotes = await Promise.all(
      sessions.map((session) =>
        service.createQuote(session.token, {
          serviceMode: "PICKUP",
          items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
          voucherCode: "GUEST10",
        }),
      ),
    );
    expect(quotes[0]).toMatchObject({
      subtotalMinor: 100_000,
      discountMinor: 1_000,
      totalMinor: 99_000,
    });
    const attempts = await Promise.allSettled(
      sessions.map((session, index) =>
        service.submitOrder(session.token, {
          quoteId: quotes[index]!.id,
          idempotencyKey: `voucher-concurrent-${index + 1}`,
        }),
      ),
    );
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM voucher_redemptions WHERE status='CONFIRMED'")
        .get(),
    ).toMatchObject({ count: 1 });
    const state = await repo.loadState(tenantId);
    const guestOrders = state.orders.filter((order) => order.guestContext?.submissionId);
    expect(guestOrders).toHaveLength(1);
    const bill = state.bills.find((candidate) => candidate.orderIds.includes(guestOrders[0]!.id));
    expect(bill).toMatchObject({ total: 1_000, paid: 10, paymentStatus: "PARTIAL" });
    expect(bill!.total - bill!.paid).toBe(990);
    expect(
      state.paymentOperations?.transactions.filter(
        (transaction) => transaction.metadata["customerValueType"] === "VOUCHER",
      ),
    ).toHaveLength(1);
  });

  it("keeps tracking non-enumerable, scoped and free of guest PII", async () => {
    const session = await webSession();
    const quote = await service.createQuote(session.token, {
      serviceMode: "PICKUP",
      items: [{ itemId: "menu-demo-stew", quantity: 1 }],
    });
    const order = await service.submitOrder(session.token, {
      quoteId: quote.id,
      idempotencyKey: "tracking-order-0001",
      customerName: "Private name",
      contactPhone: "+254700000000",
    });
    const tracking = await service.trackOrder(order.trackingToken);
    expect(tracking.reference).toBe(order.orderReference);
    expect(tracking).not.toHaveProperty("customerName");
    expect(JSON.stringify(tracking)).not.toContain("+254700000000");
    await expect(service.trackOrder(`${order.trackingToken}x`)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rotates and revokes non-guessable table QR capability tokens", async () => {
    const first = await service.rotateQrToken(manager(), {
      branchId,
      tableId: "table-demo-w-01",
      mode: "ORDERING_ENABLED",
    });
    const second = await service.rotateQrToken(manager(), {
      branchId,
      tableId: "table-demo-w-01",
      mode: "ORDER_AND_PAY",
    });
    expect(first.token).not.toBe(second.token);
    expect(second.token.length).toBeGreaterThan(40);
    await expect(
      service.createSession({
        restaurantSlug,
        branchSlug,
        sessionType: "QR",
        qrToken: first.token,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const session = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "QR",
      qrToken: second.token,
    });
    expect(session.tableSessionId).toBeTruthy();
    await service.disableQrToken(manager(), branchId, second.id);
    await expect(
      service.createSession({
        restaurantSlug,
        branchSlug,
        sessionType: "QR",
        qrToken: second.token,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("supports multiple guest sessions at one table without granting staff access", async () => {
    const qr = await service.rotateQrToken(manager(), {
      branchId,
      tableId: "table-demo-w-02",
      mode: "ORDERING_ENABLED",
    });
    const first = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "QR",
      qrToken: qr.token,
    });
    const second = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "QR",
      qrToken: qr.token,
    });
    expect(first.tableSessionId).toBe(second.tableSessionId);
    const request = await service.createServiceRequest(first.token, {
      requestType: "REQUEST_BILL",
      note: "Please bring the bill",
    });
    expect(request.status).toBe("OPEN");
    const stored = db.sqlite
      .prepare("SELECT request_type,status FROM guest_service_requests WHERE id=?")
      .get(request.id);
    expect(stored).toMatchObject({ request_type: "REQUEST_BILL", status: "OPEN" });
  });

  it("resets kiosk identity server-side without affecting authoritative orders", async () => {
    const session = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "KIOSK",
    });
    const quote = await service.createQuote(session.token, {
      serviceMode: "KIOSK",
      items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
    });
    const order = await service.submitOrder(session.token, {
      quoteId: quote.id,
      idempotencyKey: "kiosk-order-reset-0001",
      customerName: "Temporary kiosk guest",
    });
    await expect(service.resetKioskSession(session.token)).resolves.toMatchObject({
      status: "COMPLETED",
      duplicate: false,
    });
    await expect(service.resetKioskSession(session.token)).resolves.toMatchObject({
      status: "COMPLETED",
      duplicate: true,
    });
    const kioskTokenHash = await hashCapabilityToken(session.token);
    expect(
      db.sqlite
        .prepare("SELECT status,customer_id FROM guest_sessions WHERE tenant_id=? AND token_hash=?")
        .get(tenantId, kioskTokenHash),
    ).toMatchObject({ status: "COMPLETED", customer_id: null });
    expect((await service.trackOrder(order.trackingToken)).reference).toBe(order.orderReference);
  });

  it("prevents simultaneous reservation double-booking with database slot locks", async () => {
    const startsAt = futureLocalIso(1, 19);
    const attempts = await Promise.allSettled([
      service.createReservation(restaurantSlug, branchSlug, {
        startsAt,
        partySize: 8,
        guestName: "First party",
        idempotencyKey: "reservation-concurrent-first",
      }),
      service.createReservation(restaurantSlug, branchSlug, {
        startsAt,
        partySize: 8,
        guestName: "Second party",
        idempotencyKey: "reservation-concurrent-second",
      }),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const locks = db.sqlite
      .prepare(
        "SELECT COUNT(DISTINCT owner_id) owners FROM reservation_capacity_locks WHERE table_id='table-demo-w-06'",
      )
      .get() as { owners: number };
    expect(locks.owners).toBe(1);
  });

  it("securely reads, modifies, and cancels a reservation while preserving event history", async () => {
    const reservation = await service.createReservation(restaurantSlug, branchSlug, {
      startsAt: futureLocalIso(2, 18),
      partySize: 4,
      guestName: "Reservation guest",
      notes: "Window seat <b>",
      idempotencyKey: "reservation-manage-0001",
    });
    await expect(
      service.getReservation("rsv_invalid-token-value-that-cannot-match"),
    ).rejects.toMatchObject({ status: 404 });
    const changed = await service.modifyReservation(reservation.manageToken, {
      startsAt: futureLocalIso(3, 19),
      partySize: 6,
    });
    expect(changed).toMatchObject({ partySize: 6 });
    await service.cancelReservation(reservation.manageToken, "Plans changed");
    const after = await service.getReservation(reservation.manageToken);
    expect(after.status).toBe("CANCELLED");
    const events = db.sqlite
      .prepare("SELECT COUNT(*) count FROM reservation_events WHERE reservation_id=?")
      .get(reservation.id) as { count: number };
    expect(events.count).toBe(3);
  });

  it("provides deterministic wait estimates and an authorized host dashboard", async () => {
    const first = await service.joinWaitlist(restaurantSlug, branchSlug, {
      guestName: "Walk in one",
      partySize: 2,
    });
    const second = await service.joinWaitlist(restaurantSlug, branchSlug, {
      guestName: "Walk in two",
      partySize: 3,
    });
    expect(second.estimatedWaitMinutes).toBeGreaterThanOrEqual(first.estimatedWaitMinutes);
    const host = await service.hostDashboard(manager(), branchId);
    expect(host.waitlist).toHaveLength(2);
    expect(host.tables.length).toBeGreaterThan(0);
    await expect(
      service.hostDashboard({ ...manager(), permissions: [] }, branchId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("blocks cross-session payment access and never trusts a browser payment state", async () => {
    const owner = await webSession();
    const other = await webSession();
    const quote = await service.createQuote(owner.token, {
      serviceMode: "PICKUP",
      items: [{ itemId: "menu-demo-juice", quantity: 2 }],
    });
    const order = await service.submitOrder(owner.token, {
      quoteId: quote.id,
      idempotencyKey: "payment-scope-order",
    });
    await expect(
      service.guestPaymentContext(other.token, order.trackingToken, "payment-demo-cash"),
    ).rejects.toMatchObject({ status: 403 });
    expect((await service.trackOrder(order.trackingToken)).paymentStatus).toBe("AWAITING_PAYMENT");
  });

  it("redeems a gift card through the existing payment ledger without double-spend", async () => {
    const value = new LoyaltyValueService(db, manager());
    const card = await value.issueGiftCard({
      amountMinor: 100_000,
      currency: "KES",
      liabilityAccountId: "account-demo-gift-card-liability",
      collectionAccountId: "account-demo-gift-card-collection",
      redemptionAccountId: "account-demo-gift-card-redemption",
      businessDate: "2026-09-08",
      idempotencyKey: "guest-gift-card-issue",
    });
    const sessions = await Promise.all([webSession(), webSession()]);
    const orders: Array<Awaited<ReturnType<GuestExperienceService["submitOrder"]>>> = [];
    for (const [index, session] of sessions.entries()) {
      const quote = await service.createQuote(session.token, {
        serviceMode: "PICKUP",
        items: [{ itemId: "menu-demo-juice", quantity: 2 }],
      });
      orders.push(
        await service.submitOrder(session.token, {
          quoteId: quote.id,
          idempotencyKey: `gift-card-order-${index + 1}`,
        }),
      );
    }
    const attempts = await Promise.allSettled(
      sessions.map((session, index) =>
        service.redeemGuestGiftCard(session.token, {
          trackingToken: orders[index]!.trackingToken,
          paymentMethodId: "payment-demo-gift-card",
          instrumentToken: card.token!,
          amountMinor: 80_000,
          idempotencyKey: `gift-card-pay-${index + 1}`,
        }),
      ),
    );
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await value.giftCardBalance(card.token!)).balance_minor).toBe(20_000);
    const state = await repo.loadState(tenantId);
    expect(
      state.paymentOperations?.transactions.filter(
        (transaction) => transaction.metadata["customerValueType"] === "GIFT_CARD",
      ),
    ).toHaveLength(1);
  });

  it("links a hashed member credential and redeems loyalty through the payment ledger", async () => {
    const memberToken = "MEM_secure-pass-eleven-member-token-0001";
    db.sqlite
      .prepare(
        `UPDATE customer_loyalty_memberships
         SET member_number_hash=?,member_number_last_four='0001'
         WHERE tenant_id=? AND id='membership-demo-001'`,
      )
      .run(await hashCapabilityToken(memberToken), tenantId);
    const value = new LoyaltyValueService(db, manager());
    const reward = await value.createReward({
      programId: "loyalty-demo-program",
      code: "GUEST-LOYALTY-10",
      name: "Guest loyalty discount",
      rewardType: "FIXED_DISCOUNT",
      pointsCost: 100,
      valueMinor: 1_000,
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    const session = await webSession();
    await expect(
      service.linkLoyaltyMembership(session.token, "MEM_invalid-member-token-000000000"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.linkLoyaltyMembership(session.token, memberToken)).resolves.toMatchObject({
      memberLastFour: "0001",
    });
    const portal = await service.guestPortalSummary(session.token);
    expect(portal).toMatchObject({ displayName: "Kelvin Otieno", quality: "HIGH" });
    expect(portal.rewards).toContainEqual(
      expect.objectContaining({ id: reward.id, pointsCost: 100 }),
    );

    const quote = await service.createQuote(session.token, {
      serviceMode: "PICKUP",
      items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
    });
    const order = await service.submitOrder(session.token, {
      quoteId: quote.id,
      idempotencyKey: "loyalty-member-order-0001",
    });
    const redemption = await service.redeemGuestLoyalty(session.token, {
      trackingToken: order.trackingToken,
      paymentMethodId: "payment-demo-loyalty",
      rewardId: reward.id,
      idempotencyKey: "loyalty-member-redeem-0001",
    });
    expect(redemption).toMatchObject({ outstandingMinor: 99_000, duplicate: false });
    expect(
      db.sqlite
        .prepare(
          `SELECT points FROM loyalty_ledger
           WHERE tenant_id=? AND source_type='PAYMENT_TRANSACTION'`,
        )
        .get(tenantId),
    ).toMatchObject({ points: -100 });
    const state = await repo.loadState(tenantId);
    expect(
      state.paymentOperations?.transactions.filter(
        (transaction) => transaction.metadata["customerValueType"] === "LOYALTY",
      ),
    ).toHaveLength(1);
  });

  it("collects a reservation deposit as liability and applies it once to the seated bill", async () => {
    db.sqlite
      .prepare(
        `INSERT INTO accounts
          (tenant_id,id,code,name,account_type,currency,active,payload_json)
         VALUES (?,?,?,'Configured mobile clearing','ASSET','KES',1,'{}')
         ON CONFLICT(tenant_id,id) DO NOTHING`,
      )
      .run(tenantId, "account-demo-mpesa-clearing", "DEMO-MOBILE-CLEARING");
    db.sqlite
      .prepare(
        `INSERT INTO payment_methods
          (tenant_id,id,code,category,settlement_account_id,clearing_account_id,
           receivable_account_id,active,payload_json)
         VALUES (?,?,?,'DIGITAL_WALLET',?,?,?,1,?)
         ON CONFLICT(tenant_id,id) DO NOTHING`,
      )
      .run(
        tenantId,
        "payment-demo-mpesa-till",
        "MOBILE_COLLECTION",
        "account-demo-mpesa-clearing",
        "account-demo-mpesa-clearing",
        "account-demo-customer-receivable",
        JSON.stringify({
          displayName: "Configured mobile collection",
          supportsSplit: true,
          metadata: { guestEnabled: true },
        }),
      );
    await hydrateAuthoritativeConfiguration(db, {}, true);
    expect(
      getConfigurationRepository()
        .listPaymentMethods(tenantId, false)
        .find((method) => method.id === "payment-demo-mpesa-till"),
    ).toMatchObject({
      settlementAccountId: "account-demo-mpesa-clearing",
      receivableAccountId: "account-demo-customer-receivable",
    });
    db.sqlite
      .prepare(
        `UPDATE reservation_policies
         SET verification_policy='DEPOSIT',deposit_type='FIXED',deposit_value=50000,
             deposit_liability_account_id='account-demo-gift-card-liability',
             deposit_payment_method_id='payment-demo-mpesa-till'
         WHERE tenant_id=? AND branch_id=?`,
      )
      .run(tenantId, branchId);
    const reservation = await service.createReservation(restaurantSlug, branchSlug, {
      startsAt: futureLocalIso(4, 18),
      partySize: 2,
      guestName: "Deposit guest",
      idempotencyKey: "reservation-deposit-order-0001",
    });
    const deposit = db.sqlite
      .prepare(
        `SELECT id,payment_method_id,liability_account_id,amount_minor,currency
         FROM reservation_deposits WHERE tenant_id=? AND reservation_id=?`,
      )
      .get(tenantId, reservation.id) as {
      id: string;
      payment_method_id: string;
      liability_account_id: string;
      amount_minor: number;
      currency: string;
    };
    const orchestrator = new PaymentOrchestrator();
    let state = await repo.loadState(tenantId);
    const intent = orchestrator.createIntent(state, {
      tenantId,
      branchId,
      invoiceIds: [],
      paymentMethodId: deposit.payment_method_id,
      amountRequestedMinor: deposit.amount_minor,
      currency: deposit.currency,
      createdBy: "Guest deposit",
      idempotencyKey: "reservation-deposit-intent-0001",
      metadata: {
        collectionPurpose: "RESERVATION_DEPOSIT",
        collectionCreditAccountId: deposit.liability_account_id,
      },
    });
    state = intent.state;
    state = orchestrator.confirmProviderCollection(state, {
      tenantId,
      branchId,
      intentId: intent.intent.id,
      paymentMethodId: deposit.payment_method_id,
      providerConnectionId: "connection-demo-daraja-wst",
      providerTransactionId: "PASS11-DEPOSIT-0001",
      merchantReference: `reservation:${reservation.id}`,
      amountMinor: deposit.amount_minor,
      currency: deposit.currency,
      allocations: [],
      actor: "Provider callback",
      metadata: {
        collectionPurpose: "RESERVATION_DEPOSIT",
        collectionCreditAccountId: deposit.liability_account_id,
      },
    });
    await repo.saveState(state, manager(), "Persist confirmed reservation deposit fixture");
    db.sqlite
      .prepare(
        `UPDATE reservation_deposits SET payment_intent_id=?,status='PENDING'
         WHERE tenant_id=? AND id=?`,
      )
      .run(intent.intent.id, tenantId, deposit.id);
    expect((await service.getReservation(reservation.manageToken)).deposit?.status).toBe(
      "CONFIRMED",
    );
    await service.staffReservationTransition(manager(), {
      branchId,
      reservationId: reservation.id,
      status: "SEATED",
    });
    const table = db.sqlite
      .prepare(
        `SELECT table_id FROM reservation_table_assignments
         WHERE tenant_id=? AND reservation_id=? AND released_at IS NULL LIMIT 1`,
      )
      .get(tenantId, reservation.id) as { table_id: string };
    const qr = await service.rotateQrToken(manager(), {
      branchId,
      tableId: table.table_id,
      mode: "ORDERING_ENABLED",
    });
    const session = await service.createSession({
      restaurantSlug,
      branchSlug,
      sessionType: "QR",
      qrToken: qr.token,
    });
    const quote = await service.createQuote(session.token, {
      serviceMode: "QR_TABLE",
      items: [{ itemId: "menu-demo-biryani", quantity: 1 }],
    });
    const order = await service.submitOrder(session.token, {
      quoteId: quote.id,
      idempotencyKey: "reservation-table-order-0001",
    });
    const reservationOrder = (await repo.loadState(tenantId)).orders.find(
      (candidate) => candidate.guestContext?.trackingReference === order.orderReference,
    );
    expect(reservationOrder).toBeTruthy();
    await hydrateAuthoritativeConfiguration(db, {}, true);
    const applied = await service.applyReservationDeposit(manager(), {
      branchId,
      reservationId: reservation.id,
      depositId: deposit.id,
      orderId: reservationOrder!.id,
      idempotencyKey: "deposit-application-0001",
    });
    expect(applied).toMatchObject({ status: "APPLIED", duplicate: false });
    await expect(
      service.applyReservationDeposit(manager(), {
        branchId,
        reservationId: reservation.id,
        depositId: deposit.id,
        orderId: reservationOrder!.id,
        idempotencyKey: "deposit-application-0002",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      db.sqlite
        .prepare("SELECT status FROM reservation_deposits WHERE tenant_id=? AND id=?")
        .get(tenantId, deposit.id),
    ).toMatchObject({ status: "APPLIED" });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM reservation_deposit_applications WHERE tenant_id=?")
        .get(tenantId),
    ).toMatchObject({ count: 1 });
    const appliedState = await repo.loadState(tenantId);
    expect(
      appliedState.paymentOperations?.journals.find(
        (journal) => journal.sourceType === "RESERVATION_DEPOSIT_APPLICATION",
      ),
    ).toMatchObject({ status: "POSTED" });
  });

  async function webSession() {
    return service.createSession({ restaurantSlug, branchSlug, sessionType: "WEB" });
  }

  function api(path: string, body: unknown, headers: Record<string, string> = {}) {
    const request = new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const env: SerametEnv = {
      SERAMET_ENVIRONMENT: "development",
      SERAMET_DB: db,
      SERAMET_JWT_SECRET: secret,
    };
    return handleSerametApiRequest(request, env);
  }
});

function manager(): ServerActor {
  return {
    id: "manager-pass11",
    name: "Configured Manager",
    tenantId,
    roleIds: ["role-demo-branch-manager"],
    permissions: [...allPermissionCodes, permissions.tenantScopeAllBranches],
    assignedBranchIds: [branchId, "branch-demo-ngong-road"],
    assignedBranches: [
      { id: branchId, name: "Westlands" },
      { id: "branch-demo-ngong-road", name: "Ngong Road" },
    ],
    branchScope: { type: "ALL" },
    branchId,
    role: "General Manager",
    branch: "Westlands",
  };
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

function nowPlus(hours: number) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}
