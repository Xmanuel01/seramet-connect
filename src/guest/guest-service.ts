import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import type { ServerActor } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import type { OrderDraft, TransactionState } from "@/lib/transaction-engine";
import { majorFromMinor, parseMajorAmount } from "@/payments/money";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { authoritativeBusinessDate } from "@/server/business-date";
import {
  createCapabilityToken,
  deriveCapabilityToken,
  hashCapabilityToken,
  hashGuestPayload,
  sanitizeGuestText,
} from "@/guest/security";
import type {
  GuestCartInput,
  GuestQuote,
  GuestQuoteLine,
  GuestServiceMode,
  GuestSessionType,
  PublicBranchProfile,
  PublicMenuItem,
  ReservationStatus,
} from "@/guest/types";
import { GuestDomainError } from "@/guest/types";

type Row = Record<string, unknown>;
type CaptureEvents = (previous: TransactionState, next: TransactionState) => Promise<unknown>;

type ProfileScope = PublicBranchProfile & {
  tenantId: string;
  branchId: string;
  branchName: string;
  timezone: string;
  cutoffMinutes: number;
  serviceConfiguration: Record<string, unknown>;
};

type GuestSessionRow = {
  tenant_id: string;
  id: string;
  branch_id: string;
  customer_id: string | null;
  table_session_id: string | null;
  session_type: GuestSessionType;
  channel_code: string;
  source_qr_token_id: string | null;
  expires_at: string;
  status: string;
};

type QuoteRow = {
  tenant_id: string;
  id: string;
  branch_id: string;
  guest_session_id: string;
  service_mode: GuestServiceMode;
  currency: string;
  lines_json: string;
  pricing_json: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  service_charge_minor: number;
  delivery_charge_minor: number;
  tip_minor: number;
  total_minor: number;
  amount_due_minor: number;
  status: string;
  expires_at: string;
  scheduled_for: string | null;
  delivery_zone_id: string | null;
};

type ReservationPolicy = {
  id: string;
  slot_interval_minutes: number;
  default_duration_minutes: number;
  buffer_minutes: number;
  minimum_party_size: number;
  maximum_party_size: number;
  advance_booking_days: number;
  verification_policy: "NONE" | "EMAIL" | "PHONE" | "DEPOSIT" | "STAFF_CONFIRMATION";
  anonymous_allowed: number;
  reservation_hours_json: string;
  deposit_type: "NONE" | "FIXED" | "PERCENTAGE" | "PER_GUEST";
  deposit_value: number;
  deposit_liability_account_id: string | null;
  deposit_payment_method_id: string | null;
  hold_minutes: number;
};

type ReservationResultView = {
  id: string;
  restaurant: string;
  branchSlug: string;
  restaurantSlug: string;
  guestName: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  confirmationState: string;
  table?: string;
  deposit?: { amountMinor: number; currency: string; status: string };
};

type TableCandidate = {
  key: string;
  tableIds: string[];
  codes: string[];
  capacity: number;
  combinationId?: string;
};

export class GuestExperienceService {
  constructor(
    private readonly db: D1Database,
    private readonly transactions: TransactionRepository,
    private readonly capabilitySecret: string,
    private readonly captureEvents?: CaptureEvents,
  ) {
    if (capabilitySecret.length < 24) {
      throw new GuestDomainError(
        "UNAVAILABLE",
        503,
        "Guest capability signing is not configured securely",
      );
    }
  }

  async publicRestaurant(restaurantSlug: string, branchSlug?: string) {
    const rows = await this.db
      .prepare(
        `SELECT p.*,b.name AS branch_name,b.timezone,b.business_day_cutoff_minutes
         FROM public_branch_profiles p
         JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id AND b.active=1
         WHERE p.restaurant_slug=? AND p.publicly_enabled=1
           AND (? IS NULL OR p.branch_slug=?)
         ORDER BY p.public_name,b.name LIMIT 100`,
      )
      .bind(
        normalizeSlug(restaurantSlug),
        branchSlug ? normalizeSlug(branchSlug) : null,
        branchSlug ? normalizeSlug(branchSlug) : null,
      )
      .all<Row>();
    const profiles = (rows.results ?? []).map(profileFromRow);
    if (!profiles.length) throw new GuestDomainError("NOT_FOUND", 404, "Restaurant was not found");
    return { restaurant: profiles[0]!.publicName, branches: profiles.map(publicProfile) };
  }

  async publicMenu(restaurantSlug: string, branchSlug: string, serviceMode?: GuestServiceMode) {
    const profile = await this.profile(restaurantSlug, branchSlug);
    if (profile.status === "COMING_SOON") {
      return {
        profile: publicProfile(profile),
        categories: [],
        items: [],
        menuWatermark: "unavailable",
      };
    }
    const rows = await this.db
      .prepare(
        `SELECT m.id,m.code,m.name,m.category_code,m.description,m.selling_price_minor,m.currency,
                m.station_id,s.code AS station_code,m.payload_json,m.updated_at,
                COALESCE(bs.selling_price_minor,m.selling_price_minor) AS effective_price_minor,
                COALESCE(bs.available,m.sellable) AS available,bs.channel_availability_json
         FROM menu_catalog_items m
         LEFT JOIN stations s ON s.tenant_id=m.tenant_id AND s.id=m.station_id
         LEFT JOIN menu_item_branch_settings bs ON bs.tenant_id=m.tenant_id
           AND bs.menu_item_id=m.id AND bs.branch_id=?
         WHERE m.tenant_id=? AND m.active=1 AND m.sellable=1
         ORDER BY m.category_code,m.name LIMIT 1000`,
      )
      .bind(profile.branchId, profile.tenantId)
      .all<Row>();
    const items = (rows.results ?? []).map((row) => menuItemFromRow(row, serviceMode));
    const categories = Array.from(new Set(items.map((item) => item.categoryCode)));
    const menuWatermark = await hashGuestPayload(
      items.map((item) => [item.id, item.priceMinor, item.available]),
    );
    const deliveryZones =
      serviceMode === "DIRECT_DELIVERY" ? await this.publicDeliveryZones(profile) : [];
    return { profile: publicProfile(profile), categories, items, menuWatermark, deliveryZones };
  }

  private async publicDeliveryZones(profile: ProfileScope) {
    const rows = await this.db
      .prepare(
        `SELECT id,name,minimum_order_minor,delivery_fee_minor,estimated_min_minutes,
              estimated_max_minutes,currency
       FROM delivery_zones
       WHERE tenant_id=? AND branch_id=? AND active=1
       ORDER BY name LIMIT 100`,
      )
      .bind(profile.tenantId, profile.branchId)
      .all<{
        id: string;
        name: string;
        minimum_order_minor: number;
        delivery_fee_minor: number;
        estimated_min_minutes: number | null;
        estimated_max_minutes: number | null;
        currency: string;
      }>();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      minimumOrderMinor: row.minimum_order_minor,
      deliveryFeeMinor: row.delivery_fee_minor,
      estimatedMinutes:
        row.estimated_min_minutes === null || row.estimated_max_minutes === null
          ? undefined
          : ([row.estimated_min_minutes, row.estimated_max_minutes] as [number, number]),
      currency: row.currency,
    }));
  }

  async createSession(input: {
    restaurantSlug: string;
    branchSlug: string;
    sessionType: GuestSessionType;
    qrToken?: string | undefined;
    customerId?: string | undefined;
    fingerprint?: string | undefined;
  }) {
    const profile = await this.profile(input.restaurantSlug, input.branchSlug);
    let tableSessionId: string | null = null;
    let sourceQrId: string | null = null;
    let qrMode: string | undefined;
    let tableCode: string | undefined;
    let sessionType = input.sessionType;
    if (input.qrToken) {
      sessionType = "QR";
      const qr = await this.resolveQr(input.qrToken, profile);
      sourceQrId = qr.id;
      qrMode = qr.mode;
      tableCode = await this.tableCodeById(profile.tenantId, qr.table_id);
      tableSessionId = await this.openOrFindTableSession(profile, qr.table_id, qr.mode);
      const stamp = new Date().toISOString();
      await this.db.batch([
        this.db
          .prepare("UPDATE table_qr_tokens SET last_used_at=? WHERE tenant_id=? AND id=?")
          .bind(stamp, profile.tenantId, qr.id),
        this.db
          .prepare(
            `INSERT INTO table_qr_token_events
              (tenant_id,id,branch_id,qr_token_id,event_type,actor_id,metadata_json,created_at)
             VALUES (?,?,?,?, 'USED','guest','{}',?)`,
          )
          .bind(profile.tenantId, crypto.randomUUID(), profile.branchId, qr.id, stamp),
      ]);
    }
    if (input.customerId) {
      const customer = await this.db
        .prepare("SELECT id FROM customers WHERE tenant_id=? AND id=? AND status='ACTIVE'")
        .bind(profile.tenantId, input.customerId)
        .first<{ id: string }>();
      if (!customer)
        throw new GuestDomainError("FORBIDDEN", 403, "Customer account is not available");
    }
    const id = crypto.randomUUID();
    const token = createCapabilityToken("gss");
    const tokenHash = await hashCapabilityToken(token);
    const stamp = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + (sessionType === "QR" ? 12 : 4) * 3_600_000,
    ).toISOString();
    const channelCode = this.channelCode(profile.tenantId, sessionType);
    await this.db
      .prepare(
        `INSERT INTO guest_sessions
          (tenant_id,id,branch_id,customer_id,table_session_id,session_type,token_hash,status,
           channel_code,source_qr_token_id,client_fingerprint_hash,expires_at,last_seen_at,created_at)
         VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?)`,
      )
      .bind(
        profile.tenantId,
        id,
        profile.branchId,
        input.customerId ?? null,
        tableSessionId,
        sessionType,
        tokenHash,
        channelCode,
        sourceQrId,
        input.fingerprint ? await hashCapabilityToken(input.fingerprint) : null,
        expiresAt,
        stamp,
        stamp,
      )
      .run();
    return {
      token,
      expiresAt,
      sessionType,
      ...(tableSessionId ? { tableSessionId } : {}),
      ...(qrMode ? { qrMode } : {}),
      ...(tableCode ? { tableCode } : {}),
      profile: publicProfile(profile),
    };
  }

  async createQuote(token: string, cart: GuestCartInput) {
    const session = await this.session(token);
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    const calculated = await this.priceCart(profile, session, cart);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const cartHash = await hashGuestPayload(cart);
    const menuWatermark = await hashGuestPayload(
      calculated.lines.map((line) => [line.itemId, line.unitPriceMinor, line.modifierTotalMinor]),
    );
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE guest_checkout_quotes SET status='REPLACED'
           WHERE tenant_id=? AND guest_session_id=? AND status='ACTIVE'`,
        )
        .bind(session.tenant_id, session.id),
      this.db
        .prepare(
          `INSERT INTO guest_checkout_quotes
            (tenant_id,id,branch_id,guest_session_id,service_mode,currency,menu_watermark,cart_hash,
             lines_json,pricing_json,subtotal_minor,discount_minor,tax_minor,service_charge_minor,
             delivery_charge_minor,tip_minor,total_minor,amount_due_minor,delivery_zone_id,
             scheduled_for,voucher_reference_hash,status,created_at,expires_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
        )
        .bind(
          session.tenant_id,
          id,
          session.branch_id,
          session.id,
          cart.serviceMode,
          calculated.currency,
          menuWatermark,
          cartHash,
          JSON.stringify(calculated.lines),
          JSON.stringify({ cart, warnings: calculated.warnings, taxRules: calculated.taxRules }),
          calculated.subtotalMinor,
          calculated.discountMinor,
          calculated.taxMinor,
          calculated.serviceChargeMinor,
          calculated.deliveryChargeMinor,
          calculated.tipMinor,
          calculated.totalMinor,
          calculated.totalMinor,
          cart.deliveryZoneId ?? null,
          cart.scheduledFor ?? null,
          cart.voucherCode
            ? await hashCapabilityToken(cart.voucherCode.trim().toUpperCase())
            : null,
          stamp,
          expiresAt,
        ),
      this.funnelStatement(session, "ORDERING", "QUOTE_CREATED", id, stamp),
    ]);
    return {
      id,
      branchId: session.branch_id,
      sessionId: session.id,
      serviceMode: cart.serviceMode,
      currency: calculated.currency,
      lines: calculated.lines,
      subtotalMinor: calculated.subtotalMinor,
      discountMinor: calculated.discountMinor,
      taxMinor: calculated.taxMinor,
      serviceChargeMinor: calculated.serviceChargeMinor,
      deliveryChargeMinor: calculated.deliveryChargeMinor,
      tipMinor: calculated.tipMinor,
      totalMinor: calculated.totalMinor,
      amountDueMinor: calculated.totalMinor,
      expiresAt,
      warnings: calculated.warnings,
    } satisfies GuestQuote;
  }

  async submitOrder(
    token: string,
    input: {
      quoteId: string;
      idempotencyKey: string;
      customerName?: string | undefined;
      contactPhone?: string | undefined;
      deliveryAddress?: string | undefined;
      deliveryInstructions?: string | undefined;
    },
  ) {
    const session = await this.session(token);
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    const existing = await this.db
      .prepare(
        `SELECT * FROM guest_order_submissions
         WHERE tenant_id=? AND guest_session_id=? AND idempotency_key=?`,
      )
      .bind(session.tenant_id, session.id, input.idempotencyKey)
      .first<Row>();
    if (existing) return this.resumeSubmission(session, existing);

    const quote = await this.quote(session, input.quoteId);
    const pricing = safeJson<{ cart: GuestCartInput; warnings: string[] }>(quote.pricing_json, {
      cart: { items: [], serviceMode: quote.service_mode },
      warnings: [],
    });
    const current = await this.priceCart(profile, session, pricing.cart);
    if (!sameQuote(quote, current)) {
      throw new GuestDomainError(
        "STALE_QUOTE",
        409,
        "Menu price or availability changed. Review a refreshed quote before ordering.",
      );
    }
    this.validateOrderMode(profile, quote.service_mode, input.deliveryAddress);
    const submissionId = crypto.randomUUID();
    const trackingReference = publicReferenceFromSubmission(submissionId);
    const trackingToken = await deriveCapabilityToken(
      "trk",
      this.capabilitySecret,
      `${session.tenant_id}:${submissionId}`,
    );
    const trackingHash = await hashCapabilityToken(trackingToken);
    const stamp = new Date().toISOString();
    try {
      const statements = [
        this.db
          .prepare(
            `INSERT INTO guest_order_submissions
            (tenant_id,id,branch_id,guest_session_id,table_session_id,quote_id,order_id,service_mode,
             tracking_token_hash,idempotency_key,customer_id,status,scheduled_for,created_at,updated_at)
           VALUES (?,?,?,?,?,?,NULL,?,?,?,?, 'COMMAND_PENDING',?,?,?)`,
          )
          .bind(
            session.tenant_id,
            submissionId,
            session.branch_id,
            session.id,
            session.table_session_id,
            quote.id,
            quote.service_mode,
            trackingHash,
            input.idempotencyKey,
            session.customer_id,
            quote.scheduled_for,
            stamp,
            stamp,
          ),
      ];
      if (
        quote.service_mode === "DIRECT_DELIVERY" &&
        quote.delivery_zone_id &&
        input.deliveryAddress
      ) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO guest_addresses
              (tenant_id,id,branch_id,guest_session_id,customer_id,delivery_zone_id,address_text,
               instructions,retention_expires_at,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              session.tenant_id,
              submissionId,
              session.branch_id,
              session.id,
              session.customer_id,
              quote.delivery_zone_id,
              sanitizeGuestText(input.deliveryAddress, 500),
              sanitizeGuestText(input.deliveryInstructions) ?? null,
              new Date(Date.now() + 30 * 86_400_000).toISOString(),
              stamp,
            ),
        );
      }
      await this.db.batch(statements);
    } catch (error) {
      if (!constraintError(error)) throw error;
      const concurrent = await this.db
        .prepare(
          `SELECT * FROM guest_order_submissions
           WHERE tenant_id=? AND guest_session_id=? AND idempotency_key=?`,
        )
        .bind(session.tenant_id, session.id, input.idempotencyKey)
        .first<Row>();
      if (!concurrent) throw error;
      return this.resumeSubmission(session, concurrent);
    }

    const result = await this.executeSubmission({
      session,
      profile,
      quote,
      submissionId,
      trackingReference,
      trackingToken,
      input,
    });
    return result;
  }

  async trackOrder(token: string) {
    const hash = await hashCapabilityToken(token);
    const submission = await this.db
      .prepare(
        `SELECT tenant_id,branch_id,order_id,status,service_mode,scheduled_for,created_at
         FROM guest_order_submissions WHERE tracking_token_hash=?`,
      )
      .bind(hash)
      .first<Row>();
    if (!submission) throw new GuestDomainError("NOT_FOUND", 404, "Order tracking link is invalid");
    const state = await this.transactions.loadState(String(submission["tenant_id"]));
    const order = state.orders.find(
      (candidate) =>
        candidate.id === submission["order_id"] &&
        candidate.branchId === submission["branch_id"] &&
        candidate.guestContext,
    );
    if (!order) throw new GuestDomainError("NOT_FOUND", 404, "Order is not available");
    const bill = state.bills.find((candidate) => candidate.orderIds.includes(order.id));
    const publicStatus = mapOrderStatus(order.status, order.delivery?.status);
    const profile = await this.profileByScope(
      String(submission["tenant_id"]),
      String(submission["branch_id"]),
    );
    const cancellationStatuses = stringArray(
      profile.serviceConfiguration["guestCancellationStatuses"],
    );
    const allowedCancellationStatuses = cancellationStatuses.length
      ? cancellationStatuses
      : ["HELD"];
    const cancellationMinutes = safeInteger(
      profile.serviceConfiguration["guestCancellationMinutes"] ?? 15,
    );
    return {
      reference: order.guestContext!.trackingReference,
      status: publicStatus,
      serviceMode: order.guestContext!.serviceMode,
      scheduledFor: order.guestContext!.scheduledFor,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      total: {
        amountMinor:
          order.guestContext?.amountDueMinor ??
          quoteMinor(order.total, bill?.total, this.currency(order.tenantId!)),
        currency: order.guestContext?.currency ?? this.currency(order.tenantId!),
      },
      outstanding: {
        amountMinor: parseMajorAmount(
          Math.max(0, (bill?.total ?? order.total) - (bill?.paid ?? 0)),
          order.guestContext?.currency ?? this.currency(order.tenantId!),
        ),
        currency: order.guestContext?.currency ?? this.currency(order.tenantId!),
      },
      paymentStatus:
        bill?.paymentStatus === "PAID"
          ? "PAID"
          : bill?.paymentStatus === "PARTIAL"
            ? "PROCESSING"
            : "AWAITING_PAYMENT",
      receiptAvailable: bill?.paymentStatus === "PAID",
      canCancel:
        bill?.paymentStatus === "UNPAID" &&
        allowedCancellationStatuses.includes(order.status) &&
        Date.now() - Date.parse(order.createdAt) <= cancellationMinutes * 60_000,
      lines: order.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
    };
  }

  async digitalReceipt(guestToken: string, trackingToken: string) {
    const session = await this.session(guestToken);
    const trackingHash = await hashCapabilityToken(trackingToken);
    const submission = await this.db
      .prepare(
        `SELECT order_id FROM guest_order_submissions
         WHERE tenant_id=? AND branch_id=? AND guest_session_id=? AND tracking_token_hash=?`,
      )
      .bind(session.tenant_id, session.branch_id, session.id, trackingHash)
      .first<{ order_id: string }>();
    if (!submission)
      throw new GuestDomainError("FORBIDDEN", 403, "Receipt does not belong to this guest session");
    const state = await this.transactions.loadState(session.tenant_id);
    const order = state.orders.find(
      (candidate) =>
        candidate.id === submission.order_id && candidate.branchId === session.branch_id,
    );
    const invoice = state.bills.find(
      (candidate) =>
        candidate.orderIds.includes(submission.order_id) &&
        candidate.branchId === session.branch_id,
    );
    if (!order || !invoice || invoice.paymentStatus !== "PAID") {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        "A receipt is available only after confirmed payment",
      );
    }
    const receipt = state.receipts.find((candidate) => candidate.invoiceId === invoice.id);
    if (!receipt)
      throw new GuestDomainError("UNAVAILABLE", 503, "Receipt generation is still processing");
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    return {
      id: receipt.id,
      restaurant: profile.publicName,
      branch: profile.branchName,
      issuedAt: receipt.issuedAt,
      orderReference: order.guestContext?.trackingReference,
      currency: profile.currency,
      totalMinor: parseMajorAmount(receipt.total, profile.currency),
      paidMinor: parseMajorAmount(receipt.paidAmount, profile.currency),
      changeMinor: parseMajorAmount(receipt.change, profile.currency),
      lines: order.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPriceMinor: parseMajorAmount(line.unitPrice, profile.currency),
      })),
      payments: receipt.paymentBreakdown.map((payment) => ({
        method: String(payment.method),
        amountMinor: parseMajorAmount(payment.amount, profile.currency),
        reference: payment.reference,
      })),
    };
  }

  async cancelGuestOrder(guestToken: string, trackingToken: string, reason?: string) {
    const session = await this.session(guestToken);
    const trackingHash = await hashCapabilityToken(trackingToken);
    const submission = await this.db
      .prepare(
        `SELECT id,order_id,status FROM guest_order_submissions
         WHERE tenant_id=? AND branch_id=? AND guest_session_id=? AND tracking_token_hash=?`,
      )
      .bind(session.tenant_id, session.branch_id, session.id, trackingHash)
      .first<{ id: string; order_id: string; status: string }>();
    if (!submission)
      throw new GuestDomainError("FORBIDDEN", 403, "Order does not belong to this guest session");
    const previous = await this.transactions.loadState(session.tenant_id);
    const order = previous.orders.find(
      (candidate) =>
        candidate.id === submission.order_id && candidate.branchId === session.branch_id,
    );
    const invoice = previous.bills.find((candidate) =>
      candidate.orderIds.includes(submission.order_id),
    );
    if (!order || !invoice) throw new GuestDomainError("NOT_FOUND", 404, "Order is not available");
    if (invoice.paymentStatus !== "UNPAID") {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        "Paid orders require the authorized refund workflow",
      );
    }
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    const configuredStatuses = stringArray(
      profile.serviceConfiguration["guestCancellationStatuses"],
    );
    const allowedStatuses = configuredStatuses.length ? configuredStatuses : ["HELD"];
    const windowMinutes = safeInteger(
      profile.serviceConfiguration["guestCancellationMinutes"] ?? 15,
    );
    const withinWindow = Date.now() - Date.parse(order.createdAt) <= windowMinutes * 60_000;
    if (!withinWindow || !allowedStatuses.includes(order.status)) {
      throw new GuestDomainError("CONFLICT", 409, "This order can no longer be cancelled online");
    }
    const actor: ServerActor = {
      ...guestCommandActor(profile, session),
      permissions: [permissions.ordersCancel],
    };
    const cancellationReason = sanitizeGuestText(reason, 280) ?? "Guest cancellation";
    const committed = await this.transactions.commitMutation({
      actor,
      action: "cancelOrder",
      payload: {
        orderId: order.id,
        input: {
          user: "Guest Gateway",
          reason: cancellationReason,
          affectedItems: order.lines.map((line) => line.id),
        },
      },
      idempotencyKey: `guest-cancel:${submission.id}`,
      requestHash: await hashGuestPayload({ orderId: order.id, reason: cancellationReason }),
      correlationId: crypto.randomUUID(),
    });
    const updated = committed.state.orders.find((candidate) => candidate.id === order.id);
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE guest_order_submissions SET status='CANCELLED',updated_at=?
           WHERE tenant_id=? AND id=? AND status!='CANCELLED'`,
        )
        .bind(stamp, session.tenant_id, submission.id),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO guest_order_tracking_events
            (tenant_id,id,branch_id,order_id,public_status,source_status,message,occurred_at,created_at)
           VALUES (?,?,?,?,'CANCELLED',?,'Order cancelled by guest',?,?)`,
        )
        .bind(
          session.tenant_id,
          `guest-order-cancelled:${order.id}`,
          session.branch_id,
          order.id,
          updated?.status ?? "CANCELLED",
          stamp,
          stamp,
        ),
    ]);
    if (this.captureEvents) await this.captureEvents(previous, committed.state);
    return { status: "CANCELLED" as const, duplicate: committed.duplicate };
  }

  async guestPaymentContext(
    guestToken: string,
    trackingToken: string,
    paymentMethodId: string,
    requestedAmountMinor?: number,
  ) {
    const session = await this.session(guestToken);
    const trackingHash = await hashCapabilityToken(trackingToken);
    const submission = await this.db
      .prepare(
        `SELECT order_id FROM guest_order_submissions
       WHERE tenant_id=? AND branch_id=? AND guest_session_id=? AND tracking_token_hash=?
         AND status!='CANCELLED'`,
      )
      .bind(session.tenant_id, session.branch_id, session.id, trackingHash)
      .first<{ order_id: string }>();
    if (!submission)
      throw new GuestDomainError("FORBIDDEN", 403, "Order does not belong to this guest session");
    const state = await this.transactions.loadState(session.tenant_id);
    const order = state.orders.find(
      (candidate) =>
        candidate.id === submission.order_id && candidate.branchId === session.branch_id,
    );
    const invoice = state.bills.find(
      (candidate) =>
        candidate.orderIds.includes(submission.order_id) &&
        candidate.branchId === session.branch_id,
    );
    if (!order || !invoice)
      throw new GuestDomainError("NOT_FOUND", 404, "Order bill is not available");
    if (invoice.paymentStatus === "PAID")
      throw new GuestDomainError("CONFLICT", 409, "Bill is already paid");
    const method = getConfigurationRepository()
      .listPaymentMethods(session.tenant_id, true)
      .find(
        (candidate) =>
          candidate.id === paymentMethodId &&
          candidate.providerConnectionId &&
          candidate.metadata["guestEnabled"] === true,
      );
    if (!method)
      throw new GuestDomainError(
        "FORBIDDEN",
        403,
        "Payment method is not available for guest checkout",
      );
    if (session.session_type === "QR") {
      const qr = await this.qrMode(session);
      if (qr !== "ORDER_AND_PAY") {
        throw new GuestDomainError("FORBIDDEN", 403, "Payment is not enabled for this table QR");
      }
    }
    const currency = this.currency(session.tenant_id);
    const outstandingMinor = parseMajorAmount(Math.max(0, invoice.total - invoice.paid), currency);
    const amountMinor = requestedAmountMinor ?? outstandingMinor;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > outstandingMinor) {
      throw new GuestDomainError(
        "VALIDATION_FAILED",
        400,
        "Payment amount exceeds the outstanding bill",
      );
    }
    if (amountMinor < outstandingMinor && !method.supportsSplit) {
      throw new GuestDomainError(
        "VALIDATION_FAILED",
        400,
        "Payment method does not support split payment",
      );
    }
    return {
      tenantId: session.tenant_id,
      branchId: session.branch_id,
      invoiceId: invoice.id,
      orderId: order.id,
      paymentMethodId: method.id,
      amountMinor,
      outstandingMinor,
      currency,
      guestSessionId: session.id,
    };
  }

  async publicPaymentMethods(restaurantSlug: string, branchSlug: string) {
    const profile = await this.profile(restaurantSlug, branchSlug);
    return getConfigurationRepository()
      .listPaymentMethods(profile.tenantId, true)
      .filter(
        (method) =>
          method.metadata["guestEnabled"] === true &&
          (Boolean(method.providerConnectionId) ||
            (method.category === "VOUCHER" && method.metadata["valueType"] === "GIFT_CARD") ||
            method.category === "LOYALTY"),
      )
      .map((method) => ({
        id: method.id,
        displayName: method.displayName,
        category: method.category,
        supportsSplit: method.supportsSplit,
        flow: method.providerConnectionId
          ? ("PROVIDER" as const)
          : method.category === "LOYALTY"
            ? ("LOYALTY" as const)
            : ("GIFT_CARD" as const),
      }));
  }

  async linkLoyaltyMembership(guestToken: string, memberToken: string) {
    const session = await this.session(guestToken);
    const memberHash = await hashCapabilityToken(memberToken.trim());
    const membership = await this.db
      .prepare(
        `SELECT m.customer_id,m.member_number_last_four,p.name AS program_name,c.display_name
         FROM customer_loyalty_memberships m
         JOIN loyalty_programs p ON p.tenant_id=m.tenant_id AND p.id=m.program_id
         JOIN customers c ON c.tenant_id=m.tenant_id AND c.id=m.customer_id
         WHERE m.tenant_id=? AND m.member_number_hash=? AND m.status='ACTIVE'
           AND p.status='ACTIVE' AND c.status='ACTIVE'`,
      )
      .bind(session.tenant_id, memberHash)
      .first<{
        customer_id: string;
        member_number_last_four: string;
        program_name: string;
        display_name: string;
      }>();
    if (!membership) {
      throw new GuestDomainError("FORBIDDEN", 403, "Membership code is invalid or inactive");
    }
    if (session.customer_id && session.customer_id !== membership.customer_id) {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        "This guest session is already linked to another verified account",
      );
    }
    const stamp = new Date().toISOString();
    const result = await this.db
      .prepare(
        `UPDATE guest_sessions SET customer_id=?,last_seen_at=?
         WHERE tenant_id=? AND id=? AND status='ACTIVE'
           AND (customer_id IS NULL OR customer_id=?)`,
      )
      .bind(membership.customer_id, stamp, session.tenant_id, session.id, membership.customer_id)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      throw new GuestDomainError("CONFLICT", 409, "Membership could not be linked safely");
    }
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    await auditStatement(
      this.db,
      guestCommandActor(profile, { ...session, customer_id: membership.customer_id }),
      "GUEST_MEMBERSHIP_LINKED",
      "GuestSession",
      session.id,
      undefined,
      stamp,
    ).run();
    return {
      displayName: membership.display_name,
      programName: membership.program_name,
      memberLastFour: membership.member_number_last_four,
    };
  }

  async guestPortalSummary(guestToken: string) {
    const session = await this.session(guestToken);
    if (!session.customer_id) {
      throw new GuestDomainError("FORBIDDEN", 403, "A verified membership is required");
    }
    const customer = await this.db
      .prepare("SELECT display_name FROM customers WHERE tenant_id=? AND id=? AND status='ACTIVE'")
      .bind(session.tenant_id, session.customer_id)
      .first<{ display_name: string }>();
    if (!customer) throw new GuestDomainError("FORBIDDEN", 403, "Customer account is unavailable");
    const memberships = await this.db
      .prepare(
        `SELECT m.id,m.program_id,m.member_number_last_four,p.name AS program_name,
                t.name AS tier_name,
                COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l
                  WHERE l.tenant_id=m.tenant_id AND l.customer_id=m.customer_id
                    AND l.program_id=m.program_id),0) AS points_balance
         FROM customer_loyalty_memberships m
         JOIN loyalty_programs p ON p.tenant_id=m.tenant_id AND p.id=m.program_id
         LEFT JOIN loyalty_tiers t ON t.tenant_id=m.tenant_id AND t.id=m.tier_id
         WHERE m.tenant_id=? AND m.customer_id=? AND m.status='ACTIVE' AND p.status='ACTIVE'
         ORDER BY p.name LIMIT 20`,
      )
      .bind(session.tenant_id, session.customer_id)
      .all<Row>();
    const stamp = new Date().toISOString();
    const rewards = await this.db
      .prepare(
        `SELECT r.id,r.program_id,r.name,r.reward_type,r.points_cost
         FROM loyalty_rewards r
         JOIN loyalty_programs p ON p.tenant_id=r.tenant_id AND p.id=r.program_id
         JOIN customer_loyalty_memberships m ON m.tenant_id=r.tenant_id
           AND m.program_id=r.program_id AND m.customer_id=? AND m.status='ACTIVE'
         WHERE r.tenant_id=? AND r.active=1 AND p.status='ACTIVE'
           AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?)
           AND r.points_cost<=COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l
             WHERE l.tenant_id=r.tenant_id AND l.customer_id=m.customer_id
               AND l.program_id=r.program_id),0)
         ORDER BY r.points_cost,r.name LIMIT 50`,
      )
      .bind(session.customer_id, session.tenant_id, stamp, stamp)
      .all<Row>();
    const state = await this.transactions.loadState(session.tenant_id);
    const orders = state.orders
      .filter((order) => order.customerId === session.customer_id && order.guestContext)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20)
      .map((order) => ({
        reference: order.guestContext!.trackingReference,
        status: mapOrderStatus(order.status, order.delivery?.status),
        amountMinor: order.guestContext!.amountDueMinor,
        currency: order.guestContext!.currency,
        createdAt: order.createdAt,
      }));
    const reservations = await this.db
      .prepare(
        `SELECT r.id,r.starts_at,r.party_size,r.status,p.public_name,b.name AS branch_name
         FROM reservations r JOIN public_branch_profiles p
            ON p.tenant_id=r.tenant_id AND p.branch_id=r.branch_id
         JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id
         WHERE r.tenant_id=? AND r.customer_id=?
         ORDER BY r.starts_at DESC LIMIT 20`,
      )
      .bind(session.tenant_id, session.customer_id)
      .all<Row>();
    return {
      displayName: customer.display_name,
      memberships: (memberships.results ?? []).map((row) => ({
        programId: String(row["program_id"]),
        programName: String(row["program_name"]),
        memberLastFour: String(row["member_number_last_four"]),
        tierName: row["tier_name"] ? String(row["tier_name"]) : undefined,
        pointsBalance: Number(row["points_balance"] ?? 0),
      })),
      rewards: (rewards.results ?? []).map((row) => ({
        id: String(row["id"]),
        programId: String(row["program_id"]),
        name: String(row["name"]),
        type: String(row["reward_type"]),
        pointsCost: Number(row["points_cost"]),
      })),
      orders,
      reservations: (reservations.results ?? []).map((row) => ({
        id: String(row["id"]),
        restaurant: String(row["public_name"]),
        branch: String(row["branch_name"]),
        startsAt: String(row["starts_at"]),
        partySize: Number(row["party_size"]),
        status: String(row["status"]),
      })),
      quality: "HIGH" as const,
    };
  }

  async redeemGuestLoyalty(
    guestToken: string,
    input: {
      trackingToken: string;
      paymentMethodId: string;
      rewardId: string;
      idempotencyKey: string;
    },
  ) {
    const session = await this.session(guestToken);
    if (!session.customer_id) {
      throw new GuestDomainError("FORBIDDEN", 403, "Link a verified membership before redeeming");
    }
    const trackingHash = await hashCapabilityToken(input.trackingToken);
    const submission = await this.db
      .prepare(
        `SELECT order_id FROM guest_order_submissions
         WHERE tenant_id=? AND branch_id=? AND guest_session_id=? AND tracking_token_hash=?
           AND customer_id=? AND status!='CANCELLED'`,
      )
      .bind(session.tenant_id, session.branch_id, session.id, trackingHash, session.customer_id)
      .first<{ order_id: string }>();
    if (!submission) {
      throw new GuestDomainError("FORBIDDEN", 403, "Order does not belong to this member session");
    }
    const previous = await this.transactions.loadState(session.tenant_id);
    const invoice = previous.bills.find(
      (candidate) =>
        candidate.orderIds.includes(submission.order_id) &&
        candidate.branchId === session.branch_id &&
        candidate.customerId === session.customer_id,
    );
    if (!invoice) throw new GuestDomainError("NOT_FOUND", 404, "Member bill is not available");
    const method = getConfigurationRepository()
      .listPaymentMethods(session.tenant_id, true)
      .find(
        (candidate) =>
          candidate.id === input.paymentMethodId &&
          candidate.category === "LOYALTY" &&
          candidate.metadata["guestEnabled"] === true,
      );
    if (!method) throw new GuestDomainError("FORBIDDEN", 403, "Loyalty payment is unavailable");
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    const actor: ServerActor = {
      ...guestCommandActor(profile, session),
      permissions: [
        permissions.paymentsCollect,
        permissions.loyaltyView,
        permissions.loyaltyRedeem,
      ],
    };
    const committed = await this.transactions.commitMutation({
      actor,
      action: "applyLoyaltyReward",
      payload: {
        input: {
          invoiceId: invoice.id,
          paymentMethodId: method.id,
          rewardId: input.rewardId,
        },
      },
      idempotencyKey: `guest-loyalty:${session.id}:${input.idempotencyKey}`,
      requestHash: await hashGuestPayload({
        orderId: submission.order_id,
        paymentMethodId: method.id,
        rewardId: input.rewardId,
      }),
      correlationId: crypto.randomUUID(),
    });
    if (this.captureEvents) await this.captureEvents(previous, committed.state);
    const updated = committed.state.bills.find((candidate) => candidate.id === invoice.id)!;
    const currency = this.currency(session.tenant_id);
    return {
      status: updated.paymentStatus === "PAID" ? "PAID" : "PROCESSING",
      outstandingMinor: parseMajorAmount(Math.max(0, updated.total - updated.paid), currency),
      currency,
      duplicate: committed.duplicate,
    };
  }

  async redeemGuestGiftCard(
    guestToken: string,
    input: {
      trackingToken: string;
      paymentMethodId: string;
      instrumentToken: string;
      amountMinor: number;
      idempotencyKey: string;
    },
  ) {
    const session = await this.session(guestToken);
    const trackingHash = await hashCapabilityToken(input.trackingToken);
    const submission = await this.db
      .prepare(
        `SELECT order_id FROM guest_order_submissions
       WHERE tenant_id=? AND branch_id=? AND guest_session_id=? AND tracking_token_hash=?
         AND status!='CANCELLED'`,
      )
      .bind(session.tenant_id, session.branch_id, session.id, trackingHash)
      .first<{ order_id: string }>();
    if (!submission) {
      throw new GuestDomainError("FORBIDDEN", 403, "Order does not belong to this guest session");
    }
    const previous = await this.transactions.loadState(session.tenant_id);
    const order = previous.orders.find(
      (candidate) =>
        candidate.id === submission.order_id && candidate.branchId === session.branch_id,
    );
    const invoice = previous.bills.find(
      (candidate) =>
        candidate.orderIds.includes(submission.order_id) &&
        candidate.branchId === session.branch_id,
    );
    if (!order || !invoice)
      throw new GuestDomainError("NOT_FOUND", 404, "Order bill is not available");
    const method = getConfigurationRepository()
      .listPaymentMethods(session.tenant_id, true)
      .find(
        (candidate) =>
          candidate.id === input.paymentMethodId &&
          candidate.category === "VOUCHER" &&
          candidate.metadata["valueType"] === "GIFT_CARD" &&
          candidate.metadata["guestEnabled"] === true,
      );
    if (!method) throw new GuestDomainError("FORBIDDEN", 403, "Gift-card payment is not available");
    const currency = this.currency(session.tenant_id);
    const outstandingMinor = parseMajorAmount(Math.max(0, invoice.total - invoice.paid), currency);
    if (input.amountMinor > outstandingMinor) {
      throw new GuestDomainError(
        "VALIDATION_FAILED",
        400,
        "Gift-card amount exceeds the outstanding bill",
      );
    }
    const profile = await this.profileByScope(session.tenant_id, session.branch_id);
    const actor: ServerActor = {
      ...guestCommandActor(profile, session),
      permissions: [permissions.giftCardView, permissions.giftCardManage],
    };
    const committed = await this.transactions.commitMutation({
      actor,
      action: "applyGiftCardRedemption",
      payload: {
        input: {
          invoiceId: invoice.id,
          paymentMethodId: method.id,
          token: input.instrumentToken,
          amountMinor: input.amountMinor,
        },
      },
      idempotencyKey: `guest-gift-card:${session.id}:${input.idempotencyKey}`,
      requestHash: await hashGuestPayload({
        orderId: order.id,
        paymentMethodId: method.id,
        instrumentTokenHash: await hashCapabilityToken(input.instrumentToken),
        amountMinor: input.amountMinor,
      }),
      correlationId: crypto.randomUUID(),
    });
    if (this.captureEvents) await this.captureEvents(previous, committed.state);
    const updated = committed.state.bills.find((candidate) => candidate.id === invoice.id)!;
    return {
      status: updated.paymentStatus === "PAID" ? "PAID" : "PROCESSING",
      amountMinor: input.amountMinor,
      outstandingMinor: parseMajorAmount(Math.max(0, updated.total - updated.paid), currency),
      currency,
      duplicate: committed.duplicate,
    };
  }

  async reservationAvailability(
    restaurantSlug: string,
    branchSlug: string,
    input: {
      startsAt: string;
      partySize: number;
      durationMinutes?: number | undefined;
      areaPreference?: string | undefined;
    },
  ) {
    const profile = await this.profile(restaurantSlug, branchSlug);
    const policy = await this.reservationPolicy(profile);
    const timing = this.validateReservationTiming(profile, policy, input);
    await this.expireCapacityLocks(profile.tenantId);
    const candidates = await this.tableCandidates(profile, input.partySize, input.areaPreference);
    const available: TableCandidate[] = [];
    for (const candidate of candidates) {
      if (await this.candidateAvailable(profile, candidate, timing.lockSlots))
        available.push(candidate);
    }
    return {
      available: available.length > 0,
      startsAt: timing.startsAt,
      endsAt: timing.endsAt,
      partySize: input.partySize,
      capacityOptions: available.slice(0, 12).map((candidate) => ({
        code: candidate.codes.join(" + "),
        capacity: candidate.capacity,
      })),
      quality: "HIGH" as const,
    };
  }

  async createReservation(
    restaurantSlug: string,
    branchSlug: string,
    input: {
      startsAt: string;
      partySize: number;
      durationMinutes?: number | undefined;
      areaPreference?: string | undefined;
      guestName: string;
      contactPhone?: string | undefined;
      contactEmail?: string | undefined;
      notes?: string | undefined;
      idempotencyKey: string;
      guestSessionToken?: string | undefined;
    },
  ) {
    const profile = await this.profile(restaurantSlug, branchSlug);
    const policy = await this.reservationPolicy(profile);
    const timing = this.validateReservationTiming(profile, policy, input);
    const replay = await this.db
      .prepare("SELECT id FROM reservations WHERE tenant_id=? AND idempotency_key=?")
      .bind(profile.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (replay) {
      const manageToken = await deriveCapabilityToken(
        "rsv",
        this.capabilitySecret,
        `${profile.tenantId}:${replay.id}`,
      );
      return { ...(await this.reservationResult(profile.tenantId, replay.id)), manageToken };
    }
    const guestSession = input.guestSessionToken
      ? await this.session(input.guestSessionToken)
      : null;
    if (guestSession && guestSession.branch_id !== profile.branchId) {
      throw new GuestDomainError("FORBIDDEN", 403, "Guest session belongs to another branch");
    }
    await this.expireCapacityLocks(profile.tenantId);
    const candidates = await this.tableCandidates(profile, input.partySize, input.areaPreference);
    const reservationId = crypto.randomUUID();
    const manageToken = await deriveCapabilityToken(
      "rsv",
      this.capabilitySecret,
      `${profile.tenantId}:${reservationId}`,
    );
    const manageHash = await hashCapabilityToken(manageToken);
    const stamp = new Date().toISOString();
    const status: ReservationStatus =
      policy.verification_policy === "NONE" ? "CONFIRMED" : "PENDING";
    const confirmationState = policy.verification_policy === "NONE" ? "NOT_REQUIRED" : "PENDING";

    for (const candidate of candidates) {
      if (!(await this.candidateAvailable(profile, candidate, timing.lockSlots))) continue;
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `INSERT INTO reservations
              (tenant_id,id,branch_id,customer_id,guest_session_id,guest_name,contact_phone,
               contact_email,party_size,starts_at,ends_at,business_date,area_preference,notes,status,
               source,confirmation_state,manage_token_hash,idempotency_key,created_by,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            profile.tenantId,
            reservationId,
            profile.branchId,
            guestSession?.customer_id ?? null,
            guestSession?.id ?? null,
            sanitizeGuestText(input.guestName, 120)!,
            sanitizeGuestText(input.contactPhone, 40) ?? null,
            sanitizeGuestText(input.contactEmail, 254)?.toLowerCase() ?? null,
            input.partySize,
            timing.startsAt,
            timing.endsAt,
            authoritativeBusinessDate({
              occurredAt: timing.startsAt,
              timezone: profile.timezone,
              cutoffMinutes: profile.cutoffMinutes,
            }),
            sanitizeGuestText(input.areaPreference, 120) ?? null,
            sanitizeGuestText(input.notes) ?? null,
            status,
            guestSession ? guestSession.channel_code : "PUBLIC_RESERVATION",
            confirmationState,
            manageHash,
            input.idempotencyKey,
            guestSession ? `guest:${guestSession.id}` : "guest:anonymous",
            stamp,
            stamp,
          ),
        this.db
          .prepare(
            `INSERT INTO reservation_events
              (tenant_id,id,branch_id,reservation_id,event_type,actor_id,metadata_json,created_at)
             VALUES (?,?,?,?, 'CREATED',?,?,?)`,
          )
          .bind(
            profile.tenantId,
            crypto.randomUUID(),
            profile.branchId,
            reservationId,
            guestSession ? `guest:${guestSession.id}` : "guest:anonymous",
            JSON.stringify({ status, partySize: input.partySize }),
            stamp,
          ),
      ];
      candidate.tableIds.forEach((tableId) => {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO reservation_table_assignments
                (tenant_id,id,branch_id,reservation_id,table_id,combination_id,assigned_by,assigned_at)
               VALUES (?,?,?,?,?,?,?,?)`,
            )
            .bind(
              profile.tenantId,
              crypto.randomUUID(),
              profile.branchId,
              reservationId,
              tableId,
              candidate.combinationId ?? null,
              "guest-allocation",
              stamp,
            ),
        );
        timing.lockSlots.forEach((slot) =>
          statements.push(
            this.db
              .prepare(
                `INSERT INTO reservation_capacity_locks
                  (tenant_id,branch_id,table_id,slot_start,owner_type,owner_id,created_at)
                 VALUES (?,?,?,?,'RESERVATION',?,?)`,
              )
              .bind(profile.tenantId, profile.branchId, tableId, slot, reservationId, stamp),
          ),
        );
      });
      if (policy.deposit_type !== "NONE") {
        const amountMinor = depositAmount(policy, input.partySize);
        if (!policy.deposit_liability_account_id || !policy.deposit_payment_method_id) {
          throw new GuestDomainError(
            "UNAVAILABLE",
            409,
            "Reservation deposit accounting is not fully configured",
          );
        }
        statements.push(
          this.db
            .prepare(
              `INSERT INTO reservation_deposits
                (tenant_id,id,branch_id,reservation_id,amount_minor,currency,liability_account_id,
                 payment_method_id,status,idempotency_key,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,'REQUIRED',?,?,?)`,
            )
            .bind(
              profile.tenantId,
              crypto.randomUUID(),
              profile.branchId,
              reservationId,
              amountMinor,
              profile.currency,
              policy.deposit_liability_account_id,
              policy.deposit_payment_method_id,
              `deposit:${input.idempotencyKey}`,
              stamp,
              stamp,
            ),
        );
      }
      try {
        await this.db.batch(statements);
        return { ...(await this.reservationResult(profile.tenantId, reservationId)), manageToken };
      } catch (error) {
        if (!constraintError(error)) throw error;
      }
    }
    throw new GuestDomainError(
      "CONFLICT",
      409,
      "That reservation capacity was just taken. Select another time.",
    );
  }

  async getReservation(manageToken: string) {
    const reservation = await this.reservationByToken(manageToken);
    return this.reservationResult(reservation.tenant_id, reservation.id);
  }

  async reservationDepositContext(manageToken: string) {
    const reservation = await this.reservationByToken(manageToken);
    await this.refreshReservationDeposit(reservation.tenant_id, reservation.id);
    const row = await this.db
      .prepare(
        `SELECT d.id,d.tenant_id,d.branch_id,d.amount_minor,d.currency,d.liability_account_id,
                d.payment_method_id,d.payment_intent_id,d.status
         FROM reservation_deposits d
         WHERE d.tenant_id=? AND d.reservation_id=?`,
      )
      .bind(reservation.tenant_id, reservation.id)
      .first<Row>();
    if (!row) throw new GuestDomainError("NOT_FOUND", 404, "Reservation has no configured deposit");
    const status = String(row["status"]);
    if (["CONFIRMED", "APPLIED"].includes(status)) {
      return {
        alreadyConfirmed: true as const,
        depositId: String(row["id"]),
        status,
        paymentIntentId: row["payment_intent_id"] ? String(row["payment_intent_id"]) : undefined,
      };
    }
    if (["REFUND_PENDING", "REFUNDED", "FORFEITED"].includes(status)) {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        "Reservation deposit cannot be initiated in its current state",
      );
    }
    const method = getConfigurationRepository()
      .listPaymentMethods(String(row["tenant_id"]), true)
      .find((candidate) => candidate.id === String(row["payment_method_id"]));
    if (!method?.providerConnectionId || method.metadata?.["guestEnabled"] !== true) {
      throw new GuestDomainError(
        "UNAVAILABLE",
        409,
        "Reservation deposit payment is not available online",
      );
    }
    return {
      alreadyConfirmed: false as const,
      tenantId: String(row["tenant_id"]),
      branchId: String(row["branch_id"]),
      reservationId: reservation.id,
      depositId: String(row["id"]),
      paymentMethodId: method.id,
      amountMinor: Number(row["amount_minor"]),
      currency: String(row["currency"]),
      liabilityAccountId: String(row["liability_account_id"]),
      paymentIntentId: row["payment_intent_id"] ? String(row["payment_intent_id"]) : undefined,
    };
  }

  async linkReservationDepositIntent(manageToken: string, intentId: string, initiated: boolean) {
    const reservation = await this.reservationByToken(manageToken);
    const stamp = new Date().toISOString();
    const result = await this.db
      .prepare(
        `UPDATE reservation_deposits SET payment_intent_id=COALESCE(payment_intent_id,?),
                status=?,updated_at=?
         WHERE tenant_id=? AND reservation_id=?
           AND (payment_intent_id IS NULL OR payment_intent_id=?)
           AND status IN ('REQUIRED','PENDING','FAILED')`,
      )
      .bind(
        intentId,
        initiated ? "PENDING" : "FAILED",
        stamp,
        reservation.tenant_id,
        reservation.id,
        intentId,
      )
      .run();
    if (!result.success)
      throw new GuestDomainError("CONFLICT", 409, "Reservation deposit changed concurrently");
    return this.getReservation(manageToken);
  }

  async modifyReservation(
    manageToken: string,
    input: {
      startsAt?: string | undefined;
      partySize?: number | undefined;
      durationMinutes?: number | undefined;
      notes?: string | undefined;
    },
  ) {
    const secured = await this.reservationByToken(manageToken);
    if (!["PENDING", "CONFIRMED", "WAITLISTED"].includes(secured.status)) {
      throw new GuestDomainError("CONFLICT", 409, "Reservation can no longer be modified");
    }
    const current = await this.db
      .prepare(
        `SELECT starts_at,ends_at,party_size,notes,area_preference,status,updated_at
       FROM reservations WHERE tenant_id=? AND id=?`,
      )
      .bind(secured.tenant_id, secured.id)
      .first<{
        starts_at: string;
        ends_at: string;
        party_size: number;
        notes: string | null;
        area_preference: string | null;
        status: ReservationStatus;
        updated_at: string;
      }>();
    if (!current) throw new GuestDomainError("NOT_FOUND", 404, "Reservation was not found");
    const profile = await this.profileByScope(secured.tenant_id, secured.branch_id);
    const policy = await this.reservationPolicy(profile);
    const currentDuration = Math.round(
      (Date.parse(current.ends_at) - Date.parse(current.starts_at)) / 60_000,
    );
    const timing = this.validateReservationTiming(profile, policy, {
      startsAt: input.startsAt ?? current.starts_at,
      partySize: input.partySize ?? current.party_size,
      durationMinutes: input.durationMinutes ?? currentDuration,
    });
    const candidates = await this.tableCandidates(
      profile,
      input.partySize ?? current.party_size,
      current.area_preference ?? undefined,
    );
    const stamp = new Date().toISOString();
    for (const candidate of candidates) {
      const conflicting = await this.candidateHasOtherLock(
        profile,
        candidate,
        timing.lockSlots,
        secured.id,
      );
      if (conflicting) continue;
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `DELETE FROM reservation_capacity_locks
           WHERE tenant_id=? AND owner_type='RESERVATION' AND owner_id=?`,
          )
          .bind(secured.tenant_id, secured.id),
        this.db
          .prepare(
            `UPDATE reservation_table_assignments SET released_at=?,release_reason='MODIFIED'
           WHERE tenant_id=? AND reservation_id=? AND released_at IS NULL`,
          )
          .bind(stamp, secured.tenant_id, secured.id),
        this.db
          .prepare(
            `UPDATE reservations SET starts_at=?,ends_at=?,party_size=?,notes=?,business_date=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status=? AND updated_at=?`,
          )
          .bind(
            timing.startsAt,
            timing.endsAt,
            input.partySize ?? current.party_size,
            input.notes === undefined ? current.notes : (sanitizeGuestText(input.notes) ?? null),
            authoritativeBusinessDate({
              occurredAt: timing.startsAt,
              timezone: profile.timezone,
              cutoffMinutes: profile.cutoffMinutes,
            }),
            stamp,
            secured.tenant_id,
            secured.id,
            current.status,
            current.updated_at,
          ),
        this.db
          .prepare(
            `INSERT INTO reservation_events
            (tenant_id,id,branch_id,reservation_id,event_type,actor_id,metadata_json,created_at)
           VALUES (?,?,?,?, 'MODIFIED','guest',?,?)`,
          )
          .bind(
            secured.tenant_id,
            crypto.randomUUID(),
            secured.branch_id,
            secured.id,
            JSON.stringify({
              startsAt: timing.startsAt,
              partySize: input.partySize ?? current.party_size,
            }),
            stamp,
          ),
      ];
      candidate.tableIds.forEach((tableId) => {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO reservation_table_assignments
              (tenant_id,id,branch_id,reservation_id,table_id,combination_id,assigned_by,assigned_at)
             VALUES (?,?,?,?,?,?, 'guest-reallocation',?)`,
            )
            .bind(
              secured.tenant_id,
              crypto.randomUUID(),
              secured.branch_id,
              secured.id,
              tableId,
              candidate.combinationId ?? null,
              stamp,
            ),
        );
        timing.lockSlots.forEach((slot) =>
          statements.push(
            this.db
              .prepare(
                `INSERT INTO reservation_capacity_locks
                (tenant_id,branch_id,table_id,slot_start,owner_type,owner_id,created_at)
               VALUES (?,?,?,?,'RESERVATION',?,?)`,
              )
              .bind(secured.tenant_id, secured.branch_id, tableId, slot, secured.id, stamp),
          ),
        );
      });
      try {
        const results = await this.db.batch(statements);
        if ((results[2]?.meta?.changes ?? 0) !== 1)
          throw new GuestDomainError("CONFLICT", 409, "Reservation changed concurrently");
        return this.reservationResult(secured.tenant_id, secured.id);
      } catch (error) {
        if (error instanceof GuestDomainError) throw error;
        if (!constraintError(error)) throw error;
      }
    }
    throw new GuestDomainError("CONFLICT", 409, "No capacity is available for that change");
  }

  async cancelReservation(manageToken: string, reason?: string) {
    const reservation = await this.reservationByToken(manageToken);
    if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(reservation.status)) {
      throw new GuestDomainError("CONFLICT", 409, "Reservation can no longer be cancelled");
    }
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE reservations SET status='CANCELLED',cancellation_reason=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status NOT IN ('CANCELLED','COMPLETED','NO_SHOW')`,
        )
        .bind(
          sanitizeGuestText(reason) ?? "Guest cancellation",
          stamp,
          reservation.tenant_id,
          reservation.id,
        ),
      this.db
        .prepare(
          "DELETE FROM reservation_capacity_locks WHERE tenant_id=? AND owner_type='RESERVATION' AND owner_id=?",
        )
        .bind(reservation.tenant_id, reservation.id),
      this.db
        .prepare(
          `UPDATE reservation_table_assignments SET released_at=?,release_reason='GUEST_CANCELLED'
           WHERE tenant_id=? AND reservation_id=? AND released_at IS NULL`,
        )
        .bind(stamp, reservation.tenant_id, reservation.id),
      this.db
        .prepare(
          `INSERT INTO reservation_events
            (tenant_id,id,branch_id,reservation_id,event_type,actor_id,reason,metadata_json,created_at)
           VALUES (?,?,?,?, 'CANCELLED','guest',?,'{}',?)`,
        )
        .bind(
          reservation.tenant_id,
          crypto.randomUUID(),
          reservation.branch_id,
          reservation.id,
          sanitizeGuestText(reason) ?? "Guest cancellation",
          stamp,
        ),
    ]);
    return { status: "CANCELLED" as const };
  }

  async joinWaitlist(
    restaurantSlug: string,
    branchSlug: string,
    input: {
      guestName: string;
      contactPhone?: string | undefined;
      partySize: number;
      areaPreference?: string | undefined;
      guestSessionToken?: string | undefined;
    },
  ) {
    const profile = await this.profile(restaurantSlug, branchSlug);
    const session = input.guestSessionToken ? await this.session(input.guestSessionToken) : null;
    if (session && session.branch_id !== profile.branchId) {
      throw new GuestDomainError("FORBIDDEN", 403, "Guest session belongs to another branch");
    }
    const waiting = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM waitlist_entries WHERE tenant_id=? AND branch_id=? AND status='WAITING'",
      )
      .bind(profile.tenantId, profile.branchId)
      .first<{ count: number }>();
    const tableCount = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND active=1",
      )
      .bind(profile.tenantId, profile.branchId)
      .first<{ count: number }>();
    const estimate = Math.min(
      180,
      Math.ceil(((waiting?.count ?? 0) + 1) / Math.max(1, tableCount?.count ?? 1)) * 20,
    );
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO waitlist_entries
            (tenant_id,id,branch_id,customer_id,guest_session_id,guest_name,contact_phone,party_size,
             area_preference,status,estimated_wait_minutes,joined_at,created_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'WAITING',?,?,?,?)`,
        )
        .bind(
          profile.tenantId,
          id,
          profile.branchId,
          session?.customer_id ?? null,
          session?.id ?? null,
          sanitizeGuestText(input.guestName, 120)!,
          sanitizeGuestText(input.contactPhone, 40) ?? null,
          input.partySize,
          sanitizeGuestText(input.areaPreference, 120) ?? null,
          estimate,
          stamp,
          session ? `guest:${session.id}` : "guest:anonymous",
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO waitlist_events
            (tenant_id,id,branch_id,waitlist_entry_id,event_type,actor_id,metadata_json,created_at)
           VALUES (?,?,?,?, 'JOINED',?,'{}',?)`,
        )
        .bind(
          profile.tenantId,
          crypto.randomUUID(),
          profile.branchId,
          id,
          session ? `guest:${session.id}` : "guest:anonymous",
          stamp,
        ),
    ]);
    return { id, status: "WAITING" as const, estimatedWaitMinutes: estimate };
  }

  async createServiceRequest(
    token: string,
    input: { requestType: string; note?: string | undefined },
  ) {
    const session = await this.session(token);
    if (!session.table_session_id) {
      throw new GuestDomainError("FORBIDDEN", 403, "A table QR session is required");
    }
    const open = await this.db
      .prepare(
        `SELECT id FROM guest_table_sessions
         WHERE tenant_id=? AND id=? AND branch_id=? AND status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')`,
      )
      .bind(session.tenant_id, session.table_session_id, session.branch_id)
      .first<{ id: string }>();
    if (!open) throw new GuestDomainError("EXPIRED", 410, "Table session is closed");
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO guest_service_requests
            (tenant_id,id,branch_id,table_session_id,guest_session_id,request_type,status,note,created_at)
           VALUES (?,?,?,?,?,?,'OPEN',?,?)`,
        )
        .bind(
          session.tenant_id,
          id,
          session.branch_id,
          session.table_session_id,
          session.id,
          input.requestType,
          sanitizeGuestText(input.note) ?? null,
          stamp,
        ),
      ...(input.requestType === "REQUEST_BILL"
        ? [
            this.db
              .prepare(
                `UPDATE guest_table_sessions SET status='CHECK_REQUESTED'
                 WHERE tenant_id=? AND id=? AND status IN ('OPEN','ORDERING')`,
              )
              .bind(session.tenant_id, session.table_session_id),
          ]
        : []),
    ]);
    return { id, status: "OPEN" as const };
  }

  async hostDashboard(actor: ServerActor, branchId: string, businessDate?: string) {
    assertStaffBranch(actor, branchId, permissions.reservationView);
    const branch = await this.db
      .prepare(
        "SELECT timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=? AND active=1",
      )
      .bind(actor.tenantId, branchId)
      .first<{ timezone: string; business_day_cutoff_minutes: number }>();
    if (!branch) throw new GuestDomainError("NOT_FOUND", 404, "Branch was not found");
    const date =
      businessDate ??
      authoritativeBusinessDate({
        timezone: branch.timezone,
        cutoffMinutes: branch.business_day_cutoff_minutes,
      });
    const [reservations, waitlist, tables, requests] = await Promise.all([
      this.db
        .prepare(
          `SELECT r.id,r.guest_name,r.party_size,r.starts_at,r.ends_at,r.status,r.confirmation_state,
                GROUP_CONCAT(t.code, ' + ') AS table_codes
         FROM reservations r
         LEFT JOIN reservation_table_assignments a ON a.tenant_id=r.tenant_id AND a.reservation_id=r.id AND a.released_at IS NULL
         LEFT JOIN restaurant_tables t ON t.tenant_id=a.tenant_id AND t.id=a.table_id
         WHERE r.tenant_id=? AND r.branch_id=? AND r.business_date=?
         GROUP BY r.id ORDER BY r.starts_at LIMIT 500`,
        )
        .bind(actor.tenantId, branchId, date)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT id,guest_name,party_size,status,estimated_wait_minutes,joined_at
         FROM waitlist_entries WHERE tenant_id=? AND branch_id=? AND status IN ('WAITING','NOTIFIED')
         ORDER BY joined_at LIMIT 200`,
        )
        .bind(actor.tenantId, branchId)
        .all<Row>(),
      this.tableStatus(actor.tenantId, branchId),
      this.db
        .prepare(
          `SELECT id,table_session_id,request_type,status,note,created_at
         FROM guest_service_requests WHERE tenant_id=? AND branch_id=? AND status IN ('OPEN','ACKNOWLEDGED')
         ORDER BY created_at LIMIT 200`,
        )
        .bind(actor.tenantId, branchId)
        .all<Row>(),
    ]);
    return {
      businessDate: date,
      reservations: reservations.results ?? [],
      waitlist: waitlist.results ?? [],
      tables,
      serviceRequests: requests.results ?? [],
    };
  }

  async staffReservationTransition(
    actor: ServerActor,
    input: {
      branchId: string;
      reservationId: string;
      status: ReservationStatus;
      reason?: string | undefined;
    },
  ) {
    const required =
      input.status === "SEATED"
        ? permissions.reservationSeat
        : input.status === "NO_SHOW"
          ? permissions.reservationNoShow
          : permissions.reservationModify;
    assertStaffBranch(actor, input.branchId, required);
    const current = await this.db
      .prepare("SELECT status FROM reservations WHERE tenant_id=? AND branch_id=? AND id=?")
      .bind(actor.tenantId, input.branchId, input.reservationId)
      .first<{ status: ReservationStatus }>();
    if (!current) throw new GuestDomainError("NOT_FOUND", 404, "Reservation was not found");
    if (!reservationTransitionAllowed(current.status, input.status)) {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        `Cannot move reservation from ${current.status} to ${input.status}`,
      );
    }
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "UPDATE reservations SET status=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status=?",
        )
        .bind(
          input.status,
          stamp,
          actor.tenantId,
          input.branchId,
          input.reservationId,
          current.status,
        ),
      this.db
        .prepare(
          `INSERT INTO reservation_events
          (tenant_id,id,branch_id,reservation_id,event_type,actor_id,reason,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,'{}',?)`,
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          input.branchId,
          input.reservationId,
          input.status,
          actor.id,
          sanitizeGuestText(input.reason) ?? null,
          stamp,
        ),
      auditStatement(
        this.db,
        actor,
        `RESERVATION_${input.status}`,
        "RESERVATION",
        input.reservationId,
        input.reason,
        stamp,
      ),
    ];
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(input.status)) {
      statements.push(
        this.db
          .prepare(
            "DELETE FROM reservation_capacity_locks WHERE tenant_id=? AND owner_type='RESERVATION' AND owner_id=?",
          )
          .bind(actor.tenantId, input.reservationId),
      );
    }
    if (input.status === "SEATED") {
      const assignment = await this.db
        .prepare(
          "SELECT table_id FROM reservation_table_assignments WHERE tenant_id=? AND reservation_id=? AND released_at IS NULL ORDER BY assigned_at LIMIT 1",
        )
        .bind(actor.tenantId, input.reservationId)
        .first<{ table_id: string }>();
      if (!assignment)
        throw new GuestDomainError("CONFLICT", 409, "Reservation has no active table allocation");
      const sessionId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO guest_table_sessions
            (tenant_id,id,branch_id,table_id,reservation_id,service_mode,status,basket_policy,
             payment_policy,opened_by,opened_at,expires_at)
           VALUES (?,?,?,?,?,'DINE_IN','OPEN','SEPARATE','SEPARATE',?,?,?)`,
          )
          .bind(
            actor.tenantId,
            sessionId,
            input.branchId,
            assignment.table_id,
            input.reservationId,
            actor.id,
            stamp,
            new Date(Date.now() + 8 * 3_600_000).toISOString(),
          ),
      );
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (constraintError(error))
        throw new GuestDomainError("CONFLICT", 409, "Table is already occupied");
      throw error;
    }
    return { status: input.status };
  }

  async seatWalkIn(
    actor: ServerActor,
    input: {
      branchId: string;
      tableId: string;
      guestName: string;
      partySize: number;
      idempotencyKey: string;
    },
  ) {
    assertStaffBranch(actor, input.branchId, permissions.reservationSeat);
    const replay = await this.db
      .prepare("SELECT id FROM reservations WHERE tenant_id=? AND idempotency_key=?")
      .bind(actor.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (replay) return { reservationId: replay.id, duplicate: true };
    const branch = await this.db
      .prepare(
        "SELECT timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=? AND active=1",
      )
      .bind(actor.tenantId, input.branchId)
      .first<{ timezone: string; business_day_cutoff_minutes: number }>();
    const table = await this.db
      .prepare(
        "SELECT id,seats FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND id=? AND active=1",
      )
      .bind(actor.tenantId, input.branchId, input.tableId)
      .first<{ id: string; seats: number }>();
    if (!branch || !table)
      throw new GuestDomainError("NOT_FOUND", 404, "Branch or table was not found");
    if (input.partySize > table.seats)
      throw new GuestDomainError("VALIDATION_FAILED", 400, "Party exceeds table capacity");
    const reservationId = crypto.randomUUID();
    const tableSessionId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const endsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const manageToken = await deriveCapabilityToken(
      "rsv",
      this.capabilitySecret,
      `${actor.tenantId}:${reservationId}`,
    );
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO reservations
            (tenant_id,id,branch_id,guest_name,party_size,starts_at,ends_at,business_date,status,
             source,confirmation_state,manage_token_hash,idempotency_key,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'SEATED','WALK_IN','NOT_REQUIRED',?,?,?,?,?)`,
          )
          .bind(
            actor.tenantId,
            reservationId,
            input.branchId,
            sanitizeGuestText(input.guestName, 120),
            input.partySize,
            stamp,
            endsAt,
            authoritativeBusinessDate({
              timezone: branch.timezone,
              cutoffMinutes: branch.business_day_cutoff_minutes,
            }),
            await hashCapabilityToken(manageToken),
            input.idempotencyKey,
            actor.id,
            stamp,
            stamp,
          ),
        this.db
          .prepare(
            `INSERT INTO reservation_table_assignments
            (tenant_id,id,branch_id,reservation_id,table_id,assigned_by,assigned_at)
           VALUES (?,?,?,?,?,?,?)`,
          )
          .bind(
            actor.tenantId,
            crypto.randomUUID(),
            input.branchId,
            reservationId,
            input.tableId,
            actor.id,
            stamp,
          ),
        this.db
          .prepare(
            `INSERT INTO guest_table_sessions
            (tenant_id,id,branch_id,table_id,reservation_id,service_mode,status,basket_policy,
             payment_policy,opened_by,opened_at,expires_at)
           VALUES (?,?,?,?,?,'DINE_IN','OPEN','SEPARATE','SEPARATE',?,?,?)`,
          )
          .bind(
            actor.tenantId,
            tableSessionId,
            input.branchId,
            input.tableId,
            reservationId,
            actor.id,
            stamp,
            endsAt,
          ),
        this.db
          .prepare(
            `INSERT INTO reservation_events
            (tenant_id,id,branch_id,reservation_id,event_type,actor_id,metadata_json,created_at)
           VALUES (?,?,?,?, 'WALK_IN_SEATED',?,'{}',?)`,
          )
          .bind(
            actor.tenantId,
            crypto.randomUUID(),
            input.branchId,
            reservationId,
            actor.id,
            stamp,
          ),
        auditStatement(
          this.db,
          actor,
          "WALK_IN_SEATED",
          "RESERVATION",
          reservationId,
          undefined,
          stamp,
        ),
      ]);
    } catch (error) {
      if (constraintError(error))
        throw new GuestDomainError("CONFLICT", 409, "Table is already occupied");
      throw error;
    }
    return { reservationId, tableSessionId, duplicate: false };
  }

  async staffWaitlistTransition(
    actor: ServerActor,
    input: {
      branchId: string;
      id: string;
      status: "NOTIFIED" | "SEATED" | "CANCELLED" | "EXPIRED";
      reason?: string | undefined;
    },
  ) {
    assertStaffBranch(actor, input.branchId, permissions.waitlistManage);
    const current = await this.db
      .prepare("SELECT status FROM waitlist_entries WHERE tenant_id=? AND branch_id=? AND id=?")
      .bind(actor.tenantId, input.branchId, input.id)
      .first<{ status: string }>();
    if (!current) throw new GuestDomainError("NOT_FOUND", 404, "Waitlist entry was not found");
    const allowed: Record<string, string[]> = {
      WAITING: ["NOTIFIED", "SEATED", "CANCELLED", "EXPIRED"],
      NOTIFIED: ["SEATED", "CANCELLED", "EXPIRED"],
    };
    if (!(allowed[current.status] ?? []).includes(input.status))
      throw new GuestDomainError("CONFLICT", 409, "Waitlist transition is invalid");
    const stamp = new Date().toISOString();
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE waitlist_entries SET status=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status=?",
        )
        .bind(input.status, stamp, actor.tenantId, input.branchId, input.id, current.status),
      this.db
        .prepare(
          `INSERT INTO waitlist_events
          (tenant_id,id,branch_id,waitlist_entry_id,event_type,actor_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          input.branchId,
          input.id,
          input.status,
          actor.id,
          JSON.stringify({ reason: sanitizeGuestText(input.reason) }),
          stamp,
        ),
      auditStatement(
        this.db,
        actor,
        `WAITLIST_${input.status}`,
        "WAITLIST_ENTRY",
        input.id,
        input.reason,
        stamp,
      ),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1)
      throw new GuestDomainError("CONFLICT", 409, "Waitlist entry changed concurrently");
    return { status: input.status };
  }

  async staffServiceRequestTransition(
    actor: ServerActor,
    input: {
      branchId: string;
      id: string;
      status: "ACKNOWLEDGED" | "COMPLETED" | "CANCELLED";
      reason?: string | undefined;
    },
  ) {
    assertStaffBranch(actor, input.branchId, permissions.guestServiceManage);
    const current = await this.db
      .prepare(
        "SELECT status FROM guest_service_requests WHERE tenant_id=? AND branch_id=? AND id=?",
      )
      .bind(actor.tenantId, input.branchId, input.id)
      .first<{ status: string }>();
    if (!current) throw new GuestDomainError("NOT_FOUND", 404, "Service request was not found");
    const valid =
      (current.status === "OPEN" &&
        ["ACKNOWLEDGED", "COMPLETED", "CANCELLED"].includes(input.status)) ||
      (current.status === "ACKNOWLEDGED" && ["COMPLETED", "CANCELLED"].includes(input.status));
    if (!valid)
      throw new GuestDomainError("CONFLICT", 409, "Service request transition is invalid");
    const stamp = new Date().toISOString();
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE guest_service_requests SET status=?,acknowledged_by=CASE WHEN ?='ACKNOWLEDGED' THEN ? ELSE acknowledged_by END,
          acknowledged_at=CASE WHEN ?='ACKNOWLEDGED' THEN ? ELSE acknowledged_at END,
          completed_by=CASE WHEN ?='COMPLETED' THEN ? ELSE completed_by END,
          completed_at=CASE WHEN ?='COMPLETED' THEN ? ELSE completed_at END
         WHERE tenant_id=? AND branch_id=? AND id=? AND status=?`,
        )
        .bind(
          input.status,
          input.status,
          actor.id,
          input.status,
          stamp,
          input.status,
          actor.id,
          input.status,
          stamp,
          actor.tenantId,
          input.branchId,
          input.id,
          current.status,
        ),
      auditStatement(
        this.db,
        actor,
        `GUEST_SERVICE_${input.status}`,
        "GUEST_SERVICE_REQUEST",
        input.id,
        input.reason,
        stamp,
      ),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1)
      throw new GuestDomainError("CONFLICT", 409, "Service request changed concurrently");
    return { status: input.status };
  }

  async closeTableSession(
    actor: ServerActor,
    input: { branchId: string; tableSessionId: string; reason: string },
  ) {
    assertStaffBranch(actor, input.branchId, permissions.tableManage);
    const session = await this.db
      .prepare(
        `SELECT id,status FROM guest_table_sessions
         WHERE tenant_id=? AND branch_id=? AND id=?`,
      )
      .bind(actor.tenantId, input.branchId, input.tableSessionId)
      .first<{ id: string; status: string }>();
    if (!session) throw new GuestDomainError("NOT_FOUND", 404, "Table session was not found");
    if (session.status === "CLOSED") return { status: "CLOSED" as const, duplicate: true };
    const pending = await this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM guest_order_submissions
         WHERE tenant_id=? AND branch_id=? AND table_session_id=? AND status='COMMAND_PENDING'`,
      )
      .bind(actor.tenantId, input.branchId, input.tableSessionId)
      .first<{ count: number }>();
    if ((pending?.count ?? 0) > 0) {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        "A guest order is still being submitted for this table",
      );
    }
    const state = await this.transactions.loadState(actor.tenantId);
    const tableOrders = state.orders.filter(
      (order) =>
        order.branchId === input.branchId &&
        order.guestContext?.tableSessionId === input.tableSessionId &&
        order.status !== "CANCELLED",
    );
    const unpaid = tableOrders.some((order) => {
      const invoice = state.bills.find((candidate) => candidate.orderIds.includes(order.id));
      return invoice?.paymentStatus !== "PAID";
    });
    if (unpaid) throw new GuestDomainError("CONFLICT", 409, "Table has an unpaid guest order");
    const stamp = new Date().toISOString();
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE guest_table_sessions SET status='CLOSED',closed_by=?,closed_at=?
           WHERE tenant_id=? AND branch_id=? AND id=?
             AND status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')`,
        )
        .bind(actor.id, stamp, actor.tenantId, input.branchId, input.tableSessionId),
      this.db
        .prepare(
          `INSERT INTO guest_table_session_events
            (tenant_id,id,branch_id,table_session_id,event_type,actor_id,metadata_json,created_at)
           VALUES (?,?,?,?, 'CLOSED',?,?,?)`,
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          input.branchId,
          input.tableSessionId,
          actor.id,
          JSON.stringify({ reason: sanitizeGuestText(input.reason, 280) }),
          stamp,
        ),
      auditStatement(
        this.db,
        actor,
        "TABLE_SESSION_CLOSED",
        "TABLE_SESSION",
        input.tableSessionId,
        input.reason,
        stamp,
      ),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1) {
      throw new GuestDomainError("CONFLICT", 409, "Table session changed concurrently");
    }
    return { status: "CLOSED" as const, duplicate: false };
  }

  async applyReservationDeposit(
    actor: ServerActor,
    input: {
      branchId: string;
      reservationId: string;
      depositId: string;
      orderId: string;
      idempotencyKey: string;
    },
  ) {
    assertStaffBranch(actor, input.branchId, permissions.paymentsCollect);
    await this.refreshReservationDeposit(actor.tenantId, input.reservationId);
    const deposit = await this.db
      .prepare(
        `SELECT id,reservation_id,status,amount_minor,currency,liability_account_id,
                payment_method_id,payment_transaction_id,confirmed_at
         FROM reservation_deposits
         WHERE tenant_id=? AND branch_id=? AND id=? AND reservation_id=?`,
      )
      .bind(actor.tenantId, input.branchId, input.depositId, input.reservationId)
      .first<Row>();
    if (!deposit) throw new GuestDomainError("NOT_FOUND", 404, "Reservation deposit was not found");
    if (String(deposit["status"]) === "APPLIED") {
      throw new GuestDomainError("CONFLICT", 409, "Reservation deposit has already been applied");
    }
    if (String(deposit["status"]) !== "CONFIRMED" || !deposit["payment_transaction_id"]) {
      throw new GuestDomainError("CONFLICT", 409, "Reservation deposit is not confirmed");
    }
    const previous = await this.transactions.loadState(actor.tenantId);
    const order = previous.orders.find(
      (candidate) =>
        candidate.id === input.orderId &&
        candidate.tenantId === actor.tenantId &&
        candidate.branchId === input.branchId,
    );
    const invoice = previous.bills.find(
      (candidate) =>
        candidate.tenantId === actor.tenantId &&
        candidate.branchId === input.branchId &&
        candidate.orderIds.includes(input.orderId),
    );
    if (!order || !invoice) {
      throw new GuestDomainError("NOT_FOUND", 404, "Reservation order invoice was not found");
    }
    const profile = await this.profileByScope(actor.tenantId, input.branchId);
    const amountMinor = Number(deposit["amount_minor"]);
    const currency = String(deposit["currency"]);
    const originalTransactionId = String(deposit["payment_transaction_id"]);
    const committed = await this.transactions.commitMutation({
      actor,
      action: "applyReservationDeposit",
      payload: {
        input: {
          tenantId: actor.tenantId,
          branchId: input.branchId,
          invoiceId: invoice.id,
          orderId: input.orderId,
          paymentMethodId: String(deposit["payment_method_id"]),
          originalTransactionId,
          depositId: String(deposit["id"]),
          amountMinor,
          currency,
          liabilityAccountId: String(deposit["liability_account_id"]),
          businessDate: authoritativeBusinessDate({
            ...(deposit["confirmed_at"] ? { occurredAt: String(deposit["confirmed_at"]) } : {}),
            timezone: profile.timezone,
            cutoffMinutes: profile.cutoffMinutes,
          }),
          actor: actor.name,
          authoritative: true,
        },
      },
      idempotencyKey: `reservation-deposit-application:${input.idempotencyKey}`,
      requestHash: await hashGuestPayload({
        reservationId: input.reservationId,
        depositId: String(deposit["id"]),
        orderId: input.orderId,
        branchId: input.branchId,
      }),
      correlationId: crypto.randomUUID(),
    });
    const appliedTransaction = committed.state.paymentOperations?.transactions.find(
      (transaction) =>
        transaction.direction === "ADJUSTMENT" &&
        transaction.originalTransactionId === originalTransactionId &&
        transaction.metadata["reservationDepositId"] === String(deposit["id"]),
    );
    if (!appliedTransaction) {
      throw new GuestDomainError(
        "CONFLICT",
        409,
        "Reservation deposit application was not recorded",
      );
    }
    if (this.captureEvents) await this.captureEvents(previous, committed.state);
    return {
      depositId: String(deposit["id"]),
      status: "APPLIED" as const,
      duplicate: committed.duplicate,
    };
  }

  async listQrTokens(actor: ServerActor, branchId: string) {
    assertStaffBranch(actor, branchId, permissions.qrManage);
    const rows = await this.db
      .prepare(
        `SELECT q.id,q.table_id,t.code AS table_code,q.token_last_four,q.version,q.mode,q.status,
              q.expires_at,q.last_used_at,q.created_at
       FROM table_qr_tokens q JOIN restaurant_tables t ON t.tenant_id=q.tenant_id AND t.id=q.table_id
       WHERE q.tenant_id=? AND q.branch_id=? ORDER BY t.code,q.version DESC LIMIT 500`,
      )
      .bind(actor.tenantId, branchId)
      .all<Row>();
    return rows.results ?? [];
  }

  async rotateQrToken(
    actor: ServerActor,
    input: {
      branchId: string;
      tableId: string;
      mode: "MENU_ONLY" | "ORDERING_ENABLED" | "ORDER_AND_PAY" | "CALL_WAITER_ONLY";
      expiresAt?: string | undefined;
    },
  ) {
    assertStaffBranch(actor, input.branchId, permissions.qrManage);
    const table = await this.db
      .prepare(
        "SELECT id FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND id=? AND active=1",
      )
      .bind(actor.tenantId, input.branchId, input.tableId)
      .first<{ id: string }>();
    if (!table) throw new GuestDomainError("NOT_FOUND", 404, "Table was not found");
    const active = await this.db
      .prepare(
        "SELECT id,version FROM table_qr_tokens WHERE tenant_id=? AND branch_id=? AND table_id=? AND status='ACTIVE'",
      )
      .bind(actor.tenantId, input.branchId, input.tableId)
      .first<{ id: string; version: number }>();
    const id = crypto.randomUUID();
    const token = createCapabilityToken("qrc");
    const hash = await hashCapabilityToken(token);
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    if (active) {
      statements.push(
        this.db
          .prepare(
            "UPDATE table_qr_tokens SET status='ROTATED',disabled_by=?,disabled_at=? WHERE tenant_id=? AND id=? AND status='ACTIVE'",
          )
          .bind(actor.id, stamp, actor.tenantId, active.id),
        this.db
          .prepare(
            `INSERT INTO table_qr_token_events
            (tenant_id,id,branch_id,qr_token_id,event_type,actor_id,metadata_json,created_at)
           VALUES (?,?,?,?, 'ROTATED',?,'{}',?)`,
          )
          .bind(actor.tenantId, crypto.randomUUID(), input.branchId, active.id, actor.id, stamp),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO table_qr_tokens
          (tenant_id,id,branch_id,table_id,token_hash,token_last_four,version,mode,status,expires_at,
           created_by,created_at,rotated_from_id)
         VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?)`,
        )
        .bind(
          actor.tenantId,
          id,
          input.branchId,
          input.tableId,
          hash,
          token.slice(-4),
          (active?.version ?? 0) + 1,
          input.mode,
          input.expiresAt ?? null,
          actor.id,
          stamp,
          active?.id ?? null,
        ),
      this.db
        .prepare(
          `INSERT INTO table_qr_token_events
          (tenant_id,id,branch_id,qr_token_id,event_type,actor_id,metadata_json,created_at)
         VALUES (?,?,?,?, 'CREATED',?,'{}',?)`,
        )
        .bind(actor.tenantId, crypto.randomUUID(), input.branchId, id, actor.id, stamp),
      auditStatement(
        this.db,
        actor,
        active ? "QR_TOKEN_ROTATED" : "QR_TOKEN_CREATED",
        "TABLE_QR_TOKEN",
        id,
        undefined,
        stamp,
      ),
    );
    await this.db.batch(statements);
    const profile = await this.profileByScope(actor.tenantId, input.branchId);
    return {
      id,
      token,
      mode: input.mode,
      version: (active?.version ?? 0) + 1,
      guestPath: `/guest/${encodeURIComponent(profile.restaurantSlug)}/menu?branch=${encodeURIComponent(profile.branchSlug)}&qr=${encodeURIComponent(token)}`,
    };
  }

  async disableQrToken(actor: ServerActor, branchId: string, id: string) {
    assertStaffBranch(actor, branchId, permissions.qrManage);
    const stamp = new Date().toISOString();
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE table_qr_tokens SET status='DISABLED',disabled_by=?,disabled_at=?
         WHERE tenant_id=? AND branch_id=? AND id=? AND status='ACTIVE'`,
        )
        .bind(actor.id, stamp, actor.tenantId, branchId, id),
      this.db
        .prepare(
          `INSERT INTO table_qr_token_events
          (tenant_id,id,branch_id,qr_token_id,event_type,actor_id,metadata_json,created_at)
         SELECT ?,?,?,?,'DISABLED',?,'{}',? WHERE EXISTS
           (SELECT 1 FROM table_qr_tokens WHERE tenant_id=? AND id=? AND status='DISABLED')`,
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          branchId,
          id,
          actor.id,
          stamp,
          actor.tenantId,
          id,
        ),
      auditStatement(this.db, actor, "QR_TOKEN_DISABLED", "TABLE_QR_TOKEN", id, undefined, stamp),
    ]);
    if ((result[0]?.meta?.changes ?? 0) === 0)
      throw new GuestDomainError("NOT_FOUND", 404, "Active QR token was not found");
    return { status: "DISABLED" as const };
  }

  async cleanupExpired(now = new Date().toISOString()) {
    const [holds, sessions, waitlist] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE reservation_holds SET status='EXPIRED',updated_at=?
         WHERE status='ACTIVE' AND expires_at<=?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `UPDATE guest_sessions SET status='EXPIRED'
         WHERE status='ACTIVE' AND expires_at<=?`,
        )
        .bind(now),
      this.db
        .prepare(
          `UPDATE waitlist_entries SET status='EXPIRED',updated_at=?
         WHERE status IN ('WAITING','NOTIFIED') AND expires_at IS NOT NULL AND expires_at<=?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `DELETE FROM reservation_capacity_locks
         WHERE owner_type='HOLD' AND expires_at IS NOT NULL AND expires_at<=?`,
        )
        .bind(now),
    ]);
    return {
      expiredHolds: holds?.meta?.changes ?? 0,
      expiredSessions: sessions?.meta?.changes ?? 0,
      expiredWaitlist: waitlist?.meta?.changes ?? 0,
    };
  }

  async resetKioskSession(token: string) {
    const hash = await hashCapabilityToken(token);
    const session = await this.db
      .prepare(
        `SELECT tenant_id,id,branch_id,session_type,status
         FROM guest_sessions WHERE token_hash=?`,
      )
      .bind(hash)
      .first<Pick<GuestSessionRow, "tenant_id" | "id" | "branch_id" | "session_type" | "status">>();
    if (!session) throw new GuestDomainError("FORBIDDEN", 403, "Kiosk session is invalid");
    if (session.session_type !== "KIOSK") {
      throw new GuestDomainError("FORBIDDEN", 403, "Only kiosk sessions can use kiosk reset");
    }
    if (session.status === "COMPLETED") return { status: "COMPLETED" as const, duplicate: true };
    if (session.status !== "ACTIVE") {
      throw new GuestDomainError("EXPIRED", 410, "Kiosk session is no longer active");
    }
    const stamp = new Date().toISOString();
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE guest_sessions
           SET status='COMPLETED',customer_id=NULL,last_seen_at=?,completed_at=?
           WHERE tenant_id=? AND id=? AND session_type='KIOSK' AND status='ACTIVE'`,
        )
        .bind(stamp, stamp, session.tenant_id, session.id),
      this.db
        .prepare(
          `INSERT INTO guest_funnel_events
            (tenant_id,id,branch_id,guest_session_id,funnel_type,stage,source_channel,source_id,
             occurred_at,created_at)
           VALUES (?,?,?,?, 'ORDERING','KIOSK_RESET','KIOSK',NULL,?,?)`,
        )
        .bind(session.tenant_id, crypto.randomUUID(), session.branch_id, session.id, stamp, stamp),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1) {
      throw new GuestDomainError("CONFLICT", 409, "Kiosk session changed concurrently");
    }
    return { status: "COMPLETED" as const, duplicate: false };
  }

  private async executeSubmission(input: {
    session: GuestSessionRow;
    profile: ProfileScope;
    quote: QuoteRow;
    submissionId: string;
    trackingReference: string;
    trackingToken: string;
    input: {
      customerName?: string | undefined;
      contactPhone?: string | undefined;
      deliveryAddress?: string | undefined;
      deliveryInstructions?: string | undefined;
      idempotencyKey: string;
    };
  }) {
    const lines = safeJson<GuestQuoteLine[]>(input.quote.lines_json, []);
    const quotePricing = safeJson<{ cart: GuestCartInput }>(input.quote.pricing_json, {
      cart: { items: [], serviceMode: input.quote.service_mode },
    });
    const tableCode = input.session.table_session_id
      ? await this.tableCode(input.session.tenant_id, input.session.table_session_id)
      : undefined;
    const draft: OrderDraft = {
      tenantId: input.session.tenant_id,
      branchId: input.session.branch_id,
      branch: input.profile.branchName,
      ...(tableCode ? { table: tableCode } : {}),
      customer: sanitizeGuestText(input.input.customerName, 120) ?? "Guest",
      ...(input.session.customer_id ? { customerId: input.session.customer_id } : {}),
      channel: input.session.channel_code,
      cashier: "Guest Gateway",
      kitchenNote: lines
        .filter((line) => line.specialRequest)
        .map((line) => `${line.name}: ${line.specialRequest}`)
        .join(" | ")
        .slice(0, 500),
      lines: lines.map((line, index) => ({
        id: `${input.submissionId}:line:${index + 1}`,
        productId: line.itemId,
        name: line.modifiers.length
          ? `${line.name} (${line.modifiers.map((modifier) => modifier.name).join(", ")})`
          : line.name,
        category: line.categoryCode,
        quantity: line.quantity,
        unitPrice: majorFromMinor(
          line.unitPriceMinor + line.modifierTotalMinor,
          input.quote.currency,
        ),
        ...(line.stationCode ? { productionStation: line.stationCode } : {}),
        ...(line.specialRequest ? { itemNote: line.specialRequest } : {}),
      })),
      financialOverride: {
        subtotal: majorFromMinor(input.quote.subtotal_minor, input.quote.currency),
        tax: majorFromMinor(
          input.quote.tax_minor + input.quote.service_charge_minor,
          input.quote.currency,
        ),
        total: majorFromMinor(
          input.quote.total_minor + input.quote.discount_minor,
          input.quote.currency,
        ),
      },
      guestContext: {
        guestSessionId: input.session.id,
        ...(input.session.table_session_id
          ? { tableSessionId: input.session.table_session_id }
          : {}),
        quoteId: input.quote.id,
        submissionId: input.submissionId,
        serviceMode: input.quote.service_mode,
        trackingReference: input.trackingReference,
        ...(input.quote.scheduled_for ? { scheduledFor: input.quote.scheduled_for } : {}),
        quotedSubtotalMinor: input.quote.subtotal_minor,
        discountMinor: input.quote.discount_minor,
        amountDueMinor: input.quote.total_minor,
        currency: input.quote.currency,
        acceptancePolicy: guestOrderAcceptancePolicy(input.profile),
      },
      ...(input.quote.service_mode === "DIRECT_DELIVERY"
        ? { delivery: { status: "UNASSIGNED" as const } }
        : {}),
    };
    const actor = guestCommandActor(input.profile, input.session);
    const previous = await this.transactions.loadState(input.session.tenant_id);
    const committed = await this.transactions.commitMutation({
      actor,
      action: "createGuestOrder",
      payload: {
        draft,
        ...(quotePricing.cart.voucherCode
          ? { voucher: { code: quotePricing.cart.voucherCode } }
          : {}),
      },
      idempotencyKey: `guest-order:${input.session.id}:${input.input.idempotencyKey}`,
      requestHash: await hashGuestPayload({
        quoteId: input.quote.id,
        submissionId: input.submissionId,
        draft,
        voucherCode: quotePricing.cart.voucherCode ?? null,
      }),
      correlationId: input.submissionId,
    });
    const order = committed.state.orders.find(
      (candidate) => candidate.guestContext?.submissionId === input.submissionId,
    );
    if (!order)
      throw new GuestDomainError("UNAVAILABLE", 503, "Order command is awaiting recovery");
    const bill = committed.state.bills.find((candidate) => candidate.orderIds.includes(order.id));
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE guest_order_submissions SET order_id=?,status='ORDER_RECEIVED',updated_at=?
         WHERE tenant_id=? AND id=? AND status='COMMAND_PENDING'`,
        )
        .bind(order.id, stamp, input.session.tenant_id, input.submissionId),
      this.db
        .prepare(
          `UPDATE guest_checkout_quotes SET status='CONSUMED',consumed_at=?
         WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
        )
        .bind(stamp, input.session.tenant_id, input.quote.id),
      this.db
        .prepare(
          `INSERT INTO guest_order_tracking_events
          (tenant_id,id,branch_id,order_id,public_status,source_status,message,occurred_at,created_at)
         VALUES (?,?,?,?, 'ORDER_RECEIVED',?,'Order accepted',?,?)`,
        )
        .bind(
          input.session.tenant_id,
          crypto.randomUUID(),
          input.session.branch_id,
          order.id,
          order.status,
          stamp,
          stamp,
        ),
      this.funnelStatement(input.session, "ORDERING", "ORDER_CONFIRMED", order.id, stamp),
    ]);
    if (this.captureEvents) await this.captureEvents(previous, committed.state);
    return {
      orderReference: input.trackingReference,
      trackingToken: input.trackingToken,
      status: "ORDER_RECEIVED" as const,
      duplicate: committed.duplicate,
      totalMinor: input.quote.total_minor,
      currency: input.quote.currency,
      ...(bill ? { billId: bill.id, paymentStatus: bill.paymentStatus } : {}),
    };
  }

  private async resumeSubmission(session: GuestSessionRow, row: Row) {
    const submissionId = String(row["id"]);
    const token = await deriveCapabilityToken(
      "trk",
      this.capabilitySecret,
      `${session.tenant_id}:${submissionId}`,
    );
    if (row["status"] === "COMMAND_PENDING") {
      const quote = await this.quote(session, String(row["quote_id"]), true);
      const profile = await this.profileByScope(session.tenant_id, session.branch_id);
      return this.executeSubmission({
        session,
        profile,
        quote,
        submissionId,
        trackingReference: publicReferenceFromSubmission(submissionId),
        trackingToken: token,
        input: { idempotencyKey: String(row["idempotency_key"]) },
      });
    }
    const state = await this.transactions.loadState(session.tenant_id);
    const order = state.orders.find((candidate) => candidate.id === row["order_id"]);
    return {
      orderReference:
        order?.guestContext?.trackingReference ?? publicReferenceFromSubmission(submissionId),
      trackingToken: token,
      status: mapOrderStatus(order?.status ?? "OPEN", order?.delivery?.status),
      duplicate: true,
    };
  }

  private async priceCart(profile: ProfileScope, session: GuestSessionRow, cart: GuestCartInput) {
    if (
      !profile.orderingEnabled ||
      ["CLOSED", "RESERVATIONS_ONLY", "COMING_SOON"].includes(profile.status)
    ) {
      throw new GuestDomainError("UNAVAILABLE", 409, "Ordering is not currently available");
    }
    if (!profile.serviceModes.includes(cart.serviceMode)) {
      throw new GuestDomainError("FORBIDDEN", 403, "Service mode is not enabled for this branch");
    }
    if (cart.serviceMode === "QR_TABLE" && !session.table_session_id) {
      throw new GuestDomainError("FORBIDDEN", 403, "QR table ordering requires a table session");
    }
    if (cart.serviceMode === "QR_TABLE") {
      const qrMode = await this.qrMode(session);
      if (!["ORDERING_ENABLED", "ORDER_AND_PAY"].includes(qrMode)) {
        throw new GuestDomainError("FORBIDDEN", 403, "Ordering is not enabled for this table QR");
      }
      const tableSession = await this.db
        .prepare(
          `SELECT status FROM guest_table_sessions
         WHERE tenant_id=? AND branch_id=? AND id=?`,
        )
        .bind(session.tenant_id, session.branch_id, session.table_session_id)
        .first<{ status: string }>();
      if (
        !tableSession ||
        !["OPEN", "ORDERING", "CHECK_REQUESTED", "PAYMENT_PENDING"].includes(tableSession.status)
      ) {
        throw new GuestDomainError("EXPIRED", 410, "Table session is closed");
      }
    }
    if (cart.scheduledFor && Date.parse(cart.scheduledFor) <= Date.now() + 10 * 60_000) {
      throw new GuestDomainError(
        "VALIDATION_FAILED",
        400,
        "Scheduled time must be at least 10 minutes ahead",
      );
    }
    if (cart.serviceMode !== "QR_TABLE") {
      const fulfillmentAt = new Date(cart.scheduledFor ?? Date.now());
      const fulfillmentEnd = new Date(fulfillmentAt.getTime() + 60_000);
      if (!withinHours(fulfillmentAt, fulfillmentEnd, profile.timezone, profile.operatingHours)) {
        throw new GuestDomainError(
          "UNAVAILABLE",
          409,
          "The branch is closed at the selected order time",
        );
      }
    }
    const menu = await this.publicMenu(
      profile.restaurantSlug,
      profile.branchSlug,
      cart.serviceMode,
    );
    const byId = new Map(menu.items.map((item) => [item.id, item]));
    const requestedIds = new Set<string>();
    const lines: GuestQuoteLine[] = cart.items.map((requested) => {
      if (requestedIds.has(requested.itemId)) {
        throw new GuestDomainError(
          "VALIDATION_FAILED",
          400,
          "Combine duplicate cart items before checkout",
        );
      }
      requestedIds.add(requested.itemId);
      const item = byId.get(requested.itemId);
      if (!item || !item.available) {
        throw new GuestDomainError(
          "UNAVAILABLE",
          409,
          "One or more menu items are no longer available",
        );
      }
      const modifierIds = new Set(requested.modifierIds ?? []);
      const modifiers: Array<{ id: string; name: string; priceMinor: number }> = [];
      item.modifierGroups.forEach((group) => {
        const selected = group.options.filter((option) => modifierIds.has(option.id));
        if (selected.length < group.minimum || selected.length > group.maximum) {
          throw new GuestDomainError(
            "VALIDATION_FAILED",
            400,
            `Modifier selection for ${group.name} is invalid`,
          );
        }
        selected.forEach((option) => {
          if (!option.available)
            throw new GuestDomainError("UNAVAILABLE", 409, "A modifier is no longer available");
          modifiers.push({ id: option.id, name: option.name, priceMinor: option.priceMinor });
          modifierIds.delete(option.id);
        });
      });
      if (modifierIds.size)
        throw new GuestDomainError("VALIDATION_FAILED", 400, "Unknown modifier selected");
      const modifierTotalMinor = modifiers.reduce((sum, modifier) => sum + modifier.priceMinor, 0);
      const lineTotalMinor = safeMultiply(item.priceMinor + modifierTotalMinor, requested.quantity);
      return {
        itemId: item.id,
        name: item.name,
        categoryCode: item.categoryCode,
        quantity: requested.quantity,
        unitPriceMinor: item.priceMinor,
        modifierTotalMinor,
        lineTotalMinor,
        ...(item.stationCode ? { stationCode: item.stationCode } : {}),
        modifiers,
        ...(requested.specialRequest
          ? { specialRequest: sanitizeGuestText(requested.specialRequest)! }
          : {}),
      };
    });
    const subtotalMinor = lines.reduce((sum, line) => safeAdd(sum, line.lineTotalMinor), 0);
    let discountMinor = 0;
    if (cart.voucherCode) {
      const voucherActor = guestValueActor(profile, session);
      const validation = await new LoyaltyValueService(this.db, voucherActor).validateVoucher({
        code: cart.voucherCode,
        ...(session.customer_id ? { customerId: session.customer_id } : {}),
        branchId: profile.branchId,
        channel: session.channel_code,
        subtotalMinor,
        lineItems: lines.map((line) => ({
          itemId: line.itemId,
          categoryCode: line.categoryCode,
          subtotalMinor: line.lineTotalMinor,
        })),
        currency: profile.currency,
      });
      discountMinor = validation.discountMinor;
    }
    const taxRules = await this.activePricingRules(
      profile,
      lines.map((line) => line.itemId),
    );
    const discountedSubtotal = Math.max(0, subtotalMinor - discountMinor);
    const tax = calculateRules(
      discountedSubtotal,
      taxRules.filter((rule) => rule.rule_type === "TAX"),
    );
    const serviceBasis = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    const service = calculateRules(
      serviceBasis,
      taxRules.filter((rule) => rule.rule_type === "SERVICE_CHARGE"),
    );
    let deliveryChargeMinor = 0;
    if (cart.serviceMode === "DIRECT_DELIVERY") {
      if (!cart.deliveryZoneId)
        throw new GuestDomainError("VALIDATION_FAILED", 400, "Delivery zone is required");
      const zone = await this.db
        .prepare(
          `SELECT delivery_fee_minor,minimum_order_minor,currency FROM delivery_zones
         WHERE tenant_id=? AND branch_id=? AND id=? AND active=1`,
        )
        .bind(profile.tenantId, profile.branchId, cart.deliveryZoneId)
        .first<{ delivery_fee_minor: number; minimum_order_minor: number; currency: string }>();
      if (!zone || zone.currency !== profile.currency)
        throw new GuestDomainError("VALIDATION_FAILED", 400, "Delivery zone is invalid");
      if (discountedSubtotal < zone.minimum_order_minor)
        throw new GuestDomainError(
          "VALIDATION_FAILED",
          400,
          "Order is below the delivery-zone minimum",
        );
      deliveryChargeMinor = zone.delivery_fee_minor;
    } else if (discountedSubtotal < profile.minimumOrderMinor && cart.serviceMode !== "QR_TABLE") {
      throw new GuestDomainError("VALIDATION_FAILED", 400, "Order is below the configured minimum");
    }
    const tipMinor = cart.tipMinor ?? 0;
    const totalMinor = safeAdd(
      discountedSubtotal,
      tax.addedMinor,
      service.addedMinor,
      deliveryChargeMinor,
      tipMinor,
    );
    return {
      currency: profile.currency,
      lines,
      subtotalMinor,
      discountMinor,
      taxMinor: tax.reportedMinor,
      serviceChargeMinor: service.reportedMinor,
      deliveryChargeMinor,
      tipMinor,
      totalMinor,
      warnings: [] as string[],
      taxRules: taxRules.map((rule) => ({
        code: rule.code,
        type: rule.rule_type,
        rateBps: rule.rate_bps,
        mode: rule.calculation_mode,
      })),
    };
  }

  private async activePricingRules(profile: ProfileScope, itemIds: string[]) {
    if (!itemIds.length) return [];
    const rows = await this.db
      .prepare(
        `SELECT id,code,rule_type,rate_bps,calculation_mode
       FROM tax_service_rules
       WHERE tenant_id=? AND active=1 AND (branch_id=? OR branch_id IS NULL)
         AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
       ORDER BY CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END,id`,
      )
      .bind(profile.tenantId, profile.branchId, new Date().toISOString(), new Date().toISOString())
      .all<{
        id: string;
        code: string;
        rule_type: "TAX" | "SERVICE_CHARGE";
        rate_bps: number;
        calculation_mode: "INCLUSIVE" | "EXCLUSIVE";
      }>();
    const configuredItemRules = await this.db
      .prepare(
        `SELECT DISTINCT tax_rule_id FROM menu_catalog_items
       WHERE tenant_id=? AND tax_rule_id IS NOT NULL AND id IN (${itemIds.map(() => "?").join(",")})`,
      )
      .bind(profile.tenantId, ...itemIds)
      .all<{ tax_rule_id: string }>();
    const itemRuleIds = new Set((configuredItemRules.results ?? []).map((row) => row.tax_rule_id));
    return (rows.results ?? []).filter(
      (rule) => rule.rule_type === "SERVICE_CHARGE" || itemRuleIds.has(rule.id),
    );
  }

  private async profile(restaurantSlug: string, branchSlug: string) {
    const row = await this.db
      .prepare(
        `SELECT p.*,b.name AS branch_name,b.timezone,b.business_day_cutoff_minutes
       FROM public_branch_profiles p
       JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id AND b.active=1
       WHERE p.restaurant_slug=? AND p.branch_slug=? AND p.publicly_enabled=1`,
      )
      .bind(normalizeSlug(restaurantSlug), normalizeSlug(branchSlug))
      .first<Row>();
    if (!row) throw new GuestDomainError("NOT_FOUND", 404, "Public branch was not found");
    return profileFromRow(row);
  }

  private async profileByScope(tenantId: string, branchId: string) {
    const row = await this.db
      .prepare(
        `SELECT p.*,b.name AS branch_name,b.timezone,b.business_day_cutoff_minutes
       FROM public_branch_profiles p JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id
       WHERE p.tenant_id=? AND p.branch_id=? AND p.publicly_enabled=1`,
      )
      .bind(tenantId, branchId)
      .first<Row>();
    if (!row) throw new GuestDomainError("NOT_FOUND", 404, "Public branch was not found");
    return profileFromRow(row);
  }

  private async session(token: string) {
    const hash = await hashCapabilityToken(token);
    const session = await this.db
      .prepare(
        `SELECT tenant_id,id,branch_id,customer_id,table_session_id,session_type,channel_code,
              source_qr_token_id,expires_at,status
       FROM guest_sessions WHERE token_hash=?`,
      )
      .bind(hash)
      .first<GuestSessionRow>();
    if (!session) throw new GuestDomainError("FORBIDDEN", 403, "Guest session is invalid");
    if (session.status !== "ACTIVE" || Date.parse(session.expires_at) <= Date.now()) {
      throw new GuestDomainError("EXPIRED", 410, "Guest session expired");
    }
    if (session.table_session_id) {
      const tableSession = await this.db
        .prepare(
          `SELECT id FROM guest_table_sessions
           WHERE tenant_id=? AND branch_id=? AND id=?
             AND status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')`,
        )
        .bind(session.tenant_id, session.branch_id, session.table_session_id)
        .first<{ id: string }>();
      if (!tableSession) throw new GuestDomainError("EXPIRED", 410, "Table session is closed");
    }
    await this.db
      .prepare("UPDATE guest_sessions SET last_seen_at=? WHERE tenant_id=? AND id=?")
      .bind(new Date().toISOString(), session.tenant_id, session.id)
      .run();
    return session;
  }

  private async resolveQr(token: string, profile: ProfileScope) {
    const hash = await hashCapabilityToken(token);
    const qr = await this.db
      .prepare(
        `SELECT id,table_id,mode,status,expires_at FROM table_qr_tokens
       WHERE tenant_id=? AND branch_id=? AND token_hash=?`,
      )
      .bind(profile.tenantId, profile.branchId, hash)
      .first<{
        id: string;
        table_id: string;
        mode: string;
        status: string;
        expires_at: string | null;
      }>();
    if (!qr || qr.status !== "ACTIVE")
      throw new GuestDomainError("FORBIDDEN", 403, "Table QR is invalid or revoked");
    if (qr.expires_at && Date.parse(qr.expires_at) <= Date.now())
      throw new GuestDomainError("EXPIRED", 410, "Table QR expired");
    return qr;
  }

  private async qrMode(session: GuestSessionRow) {
    if (!session.source_qr_token_id) {
      throw new GuestDomainError("FORBIDDEN", 403, "A table QR capability is required");
    }
    const qr = await this.db
      .prepare(
        `SELECT mode,status,expires_at FROM table_qr_tokens
       WHERE tenant_id=? AND branch_id=? AND id=?`,
      )
      .bind(session.tenant_id, session.branch_id, session.source_qr_token_id)
      .first<{
        mode: string;
        status: string;
        expires_at: string | null;
      }>();
    if (!qr || qr.status !== "ACTIVE")
      throw new GuestDomainError("FORBIDDEN", 403, "Table QR is no longer active");
    if (qr.expires_at && Date.parse(qr.expires_at) <= Date.now())
      throw new GuestDomainError("EXPIRED", 410, "Table QR expired");
    return qr.mode;
  }

  private async openOrFindTableSession(profile: ProfileScope, tableId: string, qrMode: string) {
    const active = await this.db
      .prepare(
        `SELECT id FROM guest_table_sessions WHERE tenant_id=? AND branch_id=? AND table_id=?
       AND status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')`,
      )
      .bind(profile.tenantId, profile.branchId, tableId)
      .first<{ id: string }>();
    if (active) return active.id;
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    try {
      await this.db
        .prepare(
          `INSERT INTO guest_table_sessions
          (tenant_id,id,branch_id,table_id,service_mode,status,basket_policy,payment_policy,
           opened_by,opened_at,expires_at)
         VALUES (?,?,?,?,'QR_TABLE',?,'SEPARATE','SEPARATE','guest-qr',?,?)`,
        )
        .bind(
          profile.tenantId,
          id,
          profile.branchId,
          tableId,
          qrMode === "MENU_ONLY" ? "OPEN" : "ORDERING",
          stamp,
          new Date(Date.now() + 12 * 3_600_000).toISOString(),
        )
        .run();
      return id;
    } catch (error) {
      if (!constraintError(error)) throw error;
      const concurrent = await this.db
        .prepare(
          `SELECT id FROM guest_table_sessions WHERE tenant_id=? AND branch_id=? AND table_id=?
         AND status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')`,
        )
        .bind(profile.tenantId, profile.branchId, tableId)
        .first<{ id: string }>();
      if (!concurrent) throw error;
      return concurrent.id;
    }
  }

  private async quote(session: GuestSessionRow, quoteId: string, allowConsumed = false) {
    const quote = await this.db
      .prepare(
        `SELECT * FROM guest_checkout_quotes WHERE tenant_id=? AND branch_id=? AND guest_session_id=? AND id=?`,
      )
      .bind(session.tenant_id, session.branch_id, session.id, quoteId)
      .first<QuoteRow>();
    if (!quote)
      throw new GuestDomainError("FORBIDDEN", 403, "Quote does not belong to this guest session");
    if (!allowConsumed && quote.status !== "ACTIVE")
      throw new GuestDomainError("CONFLICT", 409, "Quote is no longer active");
    if (Date.parse(quote.expires_at) <= Date.now())
      throw new GuestDomainError("EXPIRED", 410, "Quote expired");
    return quote;
  }

  private async reservationPolicy(profile: ProfileScope) {
    const policy = await this.db
      .prepare(`SELECT * FROM reservation_policies WHERE tenant_id=? AND branch_id=? AND active=1`)
      .bind(profile.tenantId, profile.branchId)
      .first<ReservationPolicy>();
    if (!profile.reservationsEnabled || !policy)
      throw new GuestDomainError("UNAVAILABLE", 409, "Reservations are not available");
    return policy;
  }

  private validateReservationTiming(
    profile: ProfileScope,
    policy: ReservationPolicy,
    input: { startsAt: string; partySize: number; durationMinutes?: number | undefined },
  ) {
    if (
      input.partySize < policy.minimum_party_size ||
      input.partySize > policy.maximum_party_size
    ) {
      throw new GuestDomainError(
        "VALIDATION_FAILED",
        400,
        "Party size is outside reservation policy",
      );
    }
    const starts = new Date(input.startsAt);
    const duration = input.durationMinutes ?? policy.default_duration_minutes;
    const ends = new Date(starts.getTime() + duration * 60_000);
    if (starts.getTime() <= Date.now())
      throw new GuestDomainError("VALIDATION_FAILED", 400, "Reservation must be in the future");
    if (starts.getTime() > Date.now() + policy.advance_booking_days * 86_400_000)
      throw new GuestDomainError(
        "VALIDATION_FAILED",
        400,
        "Reservation is beyond the advance-booking window",
      );
    if (!withinHours(starts, ends, profile.timezone, profile.operatingHours))
      throw new GuestDomainError(
        "UNAVAILABLE",
        409,
        "Reservation is outside branch operating hours",
      );
    return {
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      lockSlots: capacitySlots(
        starts,
        duration + policy.buffer_minutes,
        policy.slot_interval_minutes,
      ),
    };
  }

  private async tableCandidates(profile: ProfileScope, partySize: number, areaPreference?: string) {
    const tables = await this.db
      .prepare(
        `SELECT t.id,t.code,t.seats,a.name AS area_name FROM restaurant_tables t
       LEFT JOIN service_areas a ON a.tenant_id=t.tenant_id AND a.id=t.service_area_id
       WHERE t.tenant_id=? AND t.branch_id=? AND t.active=1
         AND (? IS NULL OR LOWER(a.name)=LOWER(?)) ORDER BY t.seats,t.code`,
      )
      .bind(profile.tenantId, profile.branchId, areaPreference ?? null, areaPreference ?? null)
      .all<{ id: string; code: string; seats: number; area_name: string | null }>();
    const rows = tables.results ?? [];
    const candidates: TableCandidate[] = rows
      .filter((table) => table.seats >= partySize)
      .map((table) => ({
        key: table.id,
        tableIds: [table.id],
        codes: [table.code],
        capacity: table.seats,
      }));
    const combinations = await this.db
      .prepare(
        `SELECT c.id,c.maximum_capacity,m.table_id,t.code,t.seats
       FROM table_combinations c
       JOIN table_combination_members m ON m.tenant_id=c.tenant_id AND m.combination_id=c.id
       JOIN restaurant_tables t ON t.tenant_id=m.tenant_id AND t.id=m.table_id AND t.active=1
       WHERE c.tenant_id=? AND c.branch_id=? AND c.active=1 AND c.maximum_capacity>=?
       ORDER BY c.maximum_capacity,c.name,t.code`,
      )
      .bind(profile.tenantId, profile.branchId, partySize)
      .all<{
        id: string;
        maximum_capacity: number;
        table_id: string;
        code: string;
        seats: number;
      }>();
    const grouped = new Map<string, TableCandidate>();
    (combinations.results ?? []).forEach((row) => {
      const candidate = grouped.get(row.id) ?? {
        key: row.id,
        tableIds: [],
        codes: [],
        capacity: row.maximum_capacity,
        combinationId: row.id,
      };
      candidate.tableIds.push(row.table_id);
      candidate.codes.push(row.code);
      grouped.set(row.id, candidate);
    });
    return [...candidates, ...grouped.values()].sort(
      (a, b) => a.capacity - b.capacity || a.key.localeCompare(b.key),
    );
  }

  private async candidateAvailable(
    profile: ProfileScope,
    candidate: TableCandidate,
    slots: string[],
  ) {
    for (const tableId of candidate.tableIds) {
      for (const slot of slots) {
        const lock = await this.db
          .prepare(
            `SELECT owner_id FROM reservation_capacity_locks
           WHERE tenant_id=? AND branch_id=? AND table_id=? AND slot_start=?`,
          )
          .bind(profile.tenantId, profile.branchId, tableId, slot)
          .first<{ owner_id: string }>();
        if (lock) return false;
      }
      const occupied = await this.db
        .prepare(
          `SELECT id FROM guest_table_sessions WHERE tenant_id=? AND branch_id=? AND table_id=?
         AND status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')`,
        )
        .bind(profile.tenantId, profile.branchId, tableId)
        .first<{ id: string }>();
      if (occupied) return false;
    }
    return true;
  }

  private async candidateHasOtherLock(
    profile: ProfileScope,
    candidate: TableCandidate,
    slots: string[],
    ownerId: string,
  ) {
    for (const tableId of candidate.tableIds) {
      for (const slot of slots) {
        const lock = await this.db
          .prepare(
            `SELECT owner_id FROM reservation_capacity_locks
           WHERE tenant_id=? AND branch_id=? AND table_id=? AND slot_start=? AND owner_id!=?`,
          )
          .bind(profile.tenantId, profile.branchId, tableId, slot, ownerId)
          .first<{ owner_id: string }>();
        if (lock) return true;
      }
    }
    return false;
  }

  private async reservationByToken(token: string) {
    const hash = await hashCapabilityToken(token);
    const reservation = await this.db
      .prepare(`SELECT tenant_id,id,branch_id,status FROM reservations WHERE manage_token_hash=?`)
      .bind(hash)
      .first<{ tenant_id: string; id: string; branch_id: string; status: ReservationStatus }>();
    if (!reservation) throw new GuestDomainError("NOT_FOUND", 404, "Reservation link is invalid");
    return reservation;
  }

  private async reservationResult(
    tenantId: string,
    reservationId: string,
  ): Promise<ReservationResultView> {
    await this.refreshReservationDeposit(tenantId, reservationId);
    const row = await this.db
      .prepare(
        `SELECT r.id,r.branch_id,r.guest_name,r.party_size,r.starts_at,r.ends_at,r.status,
              r.confirmation_state,r.notes,p.public_name,p.branch_slug,p.restaurant_slug,
              GROUP_CONCAT(t.code, ' + ') AS table_codes,
              d.amount_minor AS deposit_amount_minor,d.currency AS deposit_currency,d.status AS deposit_status
       FROM reservations r
       JOIN public_branch_profiles p ON p.tenant_id=r.tenant_id AND p.branch_id=r.branch_id
       LEFT JOIN reservation_table_assignments a ON a.tenant_id=r.tenant_id AND a.reservation_id=r.id AND a.released_at IS NULL
       LEFT JOIN restaurant_tables t ON t.tenant_id=a.tenant_id AND t.id=a.table_id
       LEFT JOIN reservation_deposits d ON d.tenant_id=r.tenant_id AND d.reservation_id=r.id
       WHERE r.tenant_id=? AND r.id=? GROUP BY r.id`,
      )
      .bind(tenantId, reservationId)
      .first<Row>();
    if (!row) throw new GuestDomainError("NOT_FOUND", 404, "Reservation was not found");
    return {
      id: String(row["id"]),
      restaurant: String(row["public_name"]),
      branchSlug: String(row["branch_slug"]),
      restaurantSlug: String(row["restaurant_slug"]),
      guestName: String(row["guest_name"]),
      partySize: Number(row["party_size"]),
      startsAt: String(row["starts_at"]),
      endsAt: String(row["ends_at"]),
      status: String(row["status"]) as ReservationStatus,
      confirmationState: String(row["confirmation_state"]),
      ...(row["table_codes"] ? { table: String(row["table_codes"]) } : {}),
      ...(row["deposit_amount_minor"]
        ? {
            deposit: {
              amountMinor: Number(row["deposit_amount_minor"]),
              currency: String(row["deposit_currency"]),
              status: String(row["deposit_status"]),
            },
          }
        : {}),
    };
  }

  private async refreshReservationDeposit(tenantId: string, reservationId: string) {
    const row = await this.db
      .prepare(
        `SELECT d.id,d.branch_id,d.status,d.payment_intent_id
         FROM reservation_deposits d
         WHERE d.tenant_id=? AND d.reservation_id=?`,
      )
      .bind(tenantId, reservationId)
      .first<Row>();
    if (!row || !row["payment_intent_id"]) return;
    const state = await this.transactions.loadState(tenantId);
    const intentId = String(row["payment_intent_id"]);
    const intent = state.paymentOperations?.intents.find(
      (candidate) => candidate.id === intentId && candidate.tenantId === tenantId,
    );
    const transaction = state.paymentOperations?.transactions.find(
      (candidate) =>
        candidate.intentId === intentId &&
        candidate.tenantId === tenantId &&
        candidate.direction === "COLLECTION" &&
        candidate.status === "CONFIRMED",
    );
    const current = String(row["status"]);
    const intentStatus = intent?.status ?? "";
    const transactionId = transaction?.id ?? null;
    const next = transactionId
      ? "CONFIRMED"
      : ["FAILED", "CANCELLED", "EXPIRED"].includes(intentStatus)
        ? "FAILED"
        : "PENDING";
    if (
      current === next ||
      ["APPLIED", "REFUND_PENDING", "REFUNDED", "FORFEITED"].includes(current)
    )
      return;
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE reservation_deposits SET status=?,payment_transaction_id=COALESCE(?,payment_transaction_id),
                  confirmed_at=CASE WHEN ?='CONFIRMED' THEN COALESCE(confirmed_at,?) ELSE confirmed_at END,
                  updated_at=?
           WHERE tenant_id=? AND id=? AND status=?`,
        )
        .bind(next, transactionId, next, stamp, stamp, tenantId, String(row["id"]), current),
    ];
    if (next === "CONFIRMED") {
      statements.push(
        this.db
          .prepare(
            `UPDATE reservations SET status=CASE WHEN status='PENDING' THEN 'CONFIRMED' ELSE status END,
                    confirmation_state='VERIFIED',updated_at=?
             WHERE tenant_id=? AND id=? AND status IN ('PENDING','CONFIRMED')`,
          )
          .bind(stamp, tenantId, reservationId),
        this.db
          .prepare(
            `INSERT OR IGNORE INTO reservation_events
              (tenant_id,id,branch_id,reservation_id,event_type,actor_id,metadata_json,created_at)
             VALUES (?,?,?,?,'DEPOSIT_CONFIRMED','system:payment-callback',?,?)`,
          )
          .bind(
            tenantId,
            `reservation-deposit-confirmed:${String(row["id"])}`,
            String(row["branch_id"]),
            reservationId,
            JSON.stringify({ paymentTransactionId: transactionId }),
            stamp,
          ),
      );
    }
    await this.db.batch(statements);
  }

  private async expireCapacityLocks(tenantId: string) {
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE reservation_holds SET status='EXPIRED',updated_at=? WHERE tenant_id=? AND status='ACTIVE' AND expires_at<=?",
        )
        .bind(stamp, tenantId, stamp),
      this.db
        .prepare(
          "DELETE FROM reservation_capacity_locks WHERE tenant_id=? AND owner_type='HOLD' AND expires_at IS NOT NULL AND expires_at<=?",
        )
        .bind(tenantId, stamp),
    ]);
  }

  private async tableStatus(tenantId: string, branchId: string) {
    const rows = await this.db
      .prepare(
        `SELECT t.id,t.code,t.seats,a.name AS area,
              CASE WHEN s.id IS NOT NULL THEN
                CASE s.status WHEN 'PAYMENT_PENDING' THEN 'PAYMENT_PENDING' ELSE 'OCCUPIED' END
                WHEN EXISTS (SELECT 1 FROM reservation_capacity_locks l
                  WHERE l.tenant_id=t.tenant_id AND l.branch_id=t.branch_id AND l.table_id=t.id
                    AND l.slot_start BETWEEN datetime('now','-30 minutes') AND datetime('now','+30 minutes'))
                THEN 'RESERVED' ELSE 'AVAILABLE' END AS status,
              s.id AS table_session_id
       FROM restaurant_tables t
       LEFT JOIN service_areas a ON a.tenant_id=t.tenant_id AND a.id=t.service_area_id
       LEFT JOIN guest_table_sessions s ON s.tenant_id=t.tenant_id AND s.table_id=t.id
         AND s.status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')
       WHERE t.tenant_id=? AND t.branch_id=? AND t.active=1 ORDER BY a.name,t.code`,
      )
      .bind(tenantId, branchId)
      .all<Row>();
    return rows.results ?? [];
  }

  private async tableCode(tenantId: string, tableSessionId: string) {
    const row = await this.db
      .prepare(
        `SELECT t.code FROM guest_table_sessions s JOIN restaurant_tables t
        ON t.tenant_id=s.tenant_id AND t.id=s.table_id
       WHERE s.tenant_id=? AND s.id=?`,
      )
      .bind(tenantId, tableSessionId)
      .first<{ code: string }>();
    return row?.code;
  }

  private async tableCodeById(tenantId: string, tableId: string) {
    const row = await this.db
      .prepare("SELECT code FROM restaurant_tables WHERE tenant_id=? AND id=?")
      .bind(tenantId, tableId)
      .first<{ code: string }>();
    return row?.code;
  }

  private channelCode(tenantId: string, type: GuestSessionType) {
    const channelType = type === "QR" ? "QR" : type === "KIOSK" ? "KIOSK" : "WEB";
    const channel = getConfigurationRepository()
      .listOrderChannels(tenantId)
      .find((candidate) => candidate.channelType === channelType);
    if (!channel)
      throw new GuestDomainError(
        "UNAVAILABLE",
        409,
        `No ${channelType} order channel is configured`,
      );
    return channel.code;
  }

  private currency(tenantId: string) {
    return getConfigurationRepository().getTenant(tenantId).defaultCurrency;
  }

  private validateOrderMode(
    profile: ProfileScope,
    mode: GuestServiceMode,
    deliveryAddress?: string,
  ) {
    if (!profile.serviceModes.includes(mode))
      throw new GuestDomainError("FORBIDDEN", 403, "Service mode is disabled");
    if (mode === "DIRECT_DELIVERY" && !sanitizeGuestText(deliveryAddress, 500)) {
      throw new GuestDomainError("VALIDATION_FAILED", 400, "Delivery address is required");
    }
  }

  private funnelStatement(
    session: GuestSessionRow,
    funnel: "ORDERING" | "RESERVATION",
    stage: string,
    sourceId: string,
    stamp: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO guest_funnel_events
        (tenant_id,id,branch_id,guest_session_id,funnel_type,stage,source_channel,source_id,occurred_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        session.tenant_id,
        crypto.randomUUID(),
        session.branch_id,
        session.id,
        funnel,
        stage,
        session.channel_code,
        sourceId,
        stamp,
        stamp,
      );
  }
}

function profileFromRow(row: Row): ProfileScope {
  return {
    tenantId: String(row["tenant_id"]),
    branchId: String(row["branch_id"]),
    branchName: String(row["branch_name"]),
    restaurantSlug: String(row["restaurant_slug"]),
    branchSlug: String(row["branch_slug"]),
    publicName: String(row["public_name"]),
    ...(row["description"] ? { description: String(row["description"]) } : {}),
    ...(row["logo_url"] ? { logoUrl: String(row["logo_url"]) } : {}),
    ...(row["cover_url"] ? { coverUrl: String(row["cover_url"]) } : {}),
    address: String(row["address"]),
    ...(row["public_phone"] ? { phone: String(row["public_phone"]) } : {}),
    ...(row["public_email"] ? { email: String(row["public_email"]) } : {}),
    currency: String(row["currency"]),
    status: String(row["public_status"]) as ProfileScope["status"],
    serviceModes: safeJson<GuestServiceMode[]>(String(row["service_modes_json"]), []),
    operatingHours: safeJson<Record<string, [string, string]>>(
      String(row["operating_hours_json"]),
      {},
    ),
    branding: safeJson<Record<string, string>>(String(row["branding_json"]), {}),
    orderingEnabled: Number(row["ordering_enabled"]) === 1,
    reservationsEnabled: Number(row["reservations_enabled"]) === 1,
    minimumOrderMinor: Number(row["minimum_order_minor"]),
    timezone: String(row["timezone"]),
    cutoffMinutes: Number(row["business_day_cutoff_minutes"]),
    serviceConfiguration: safeJson<Record<string, unknown>>(
      String(row["service_configuration_json"] ?? "{}"),
      {},
    ),
  };
}

function publicProfile(profile: ProfileScope): PublicBranchProfile {
  const {
    tenantId: _tenantId,
    branchId: _branchId,
    timezone: _timezone,
    cutoffMinutes: _cutoff,
    serviceConfiguration: _serviceConfiguration,
    ...safe
  } = profile;
  return safe;
}

function guestOrderAcceptancePolicy(profile: ProfileScope) {
  const configured = profile.serviceConfiguration["guestOrderAcceptancePolicy"];
  return configured === "WAITER_REVIEW" || configured === "CASHIER_REVIEW"
    ? configured
    : "AUTO_ACCEPT";
}

function menuItemFromRow(row: Row, serviceMode?: GuestServiceMode): PublicMenuItem {
  const payload = safeJson<Record<string, unknown>>(String(row["payload_json"] ?? "{}"), {});
  const channel = safeJson<Record<string, boolean>>(
    String(row["channel_availability_json"] ?? "{}"),
    {},
  );
  const configuredAvailable = Number(row["available"]) === 1;
  const channelAvailable = !serviceMode || channel[serviceMode] !== false;
  const rawGroups = Array.isArray(payload["modifierGroups"]) ? payload["modifierGroups"] : [];
  const modifierGroups = rawGroups
    .filter((group): group is Row =>
      Boolean(group && typeof group === "object" && !Array.isArray(group)),
    )
    .map((group) => {
      const options = Array.isArray(group["options"]) ? group["options"] : [];
      const normalizedOptions = options
        .filter((option): option is Row =>
          Boolean(option && typeof option === "object" && !Array.isArray(option)),
        )
        .map((option) => ({
          id: String(option["id"] ?? ""),
          name: String(option["name"] ?? "Option"),
          priceMinor: safeInteger(option["priceMinor"]),
          available: option["available"] !== false,
        }))
        .filter((option) => option.id);
      const minimum = safeInteger(group["minimum"]);
      const maximum = Math.max(minimum, safeInteger(group["maximum"] ?? normalizedOptions.length));
      return {
        id: String(group["id"] ?? ""),
        name: String(group["name"] ?? "Options"),
        required: minimum > 0,
        minimum,
        maximum,
        options: normalizedOptions,
      };
    })
    .filter((group) => group.id);
  return {
    id: String(row["id"]),
    code: String(row["code"]),
    name: String(row["name"]),
    categoryCode: String(row["category_code"]),
    ...(row["description"] ? { description: String(row["description"]) } : {}),
    ...(typeof payload["imageUrl"] === "string" ? { imageUrl: payload["imageUrl"] } : {}),
    priceMinor: Number(row["effective_price_minor"]),
    currency: String(row["currency"]),
    available: configuredAvailable && channelAvailable,
    ...(!configuredAvailable ? { soldOutReason: "SOLD_OUT" } : {}),
    ...(row["station_code"] ? { stationCode: String(row["station_code"]) } : {}),
    modifierGroups,
    dietaryTags: stringArray(payload["dietaryTags"]),
    allergenInformation: stringArray(payload["allergenInformation"]),
  };
}

function calculateRules(
  basisMinor: number,
  rules: Array<{ rate_bps: number; calculation_mode: "INCLUSIVE" | "EXCLUSIVE" }>,
) {
  return rules.reduce(
    (total, rule) => {
      const amount =
        rule.calculation_mode === "INCLUSIVE"
          ? divideRound(BigInt(basisMinor) * BigInt(rule.rate_bps), BigInt(10_000 + rule.rate_bps))
          : divideRound(BigInt(basisMinor) * BigInt(rule.rate_bps), 10_000n);
      return {
        reportedMinor: safeAdd(total.reportedMinor, amount),
        addedMinor: safeAdd(total.addedMinor, rule.calculation_mode === "EXCLUSIVE" ? amount : 0),
      };
    },
    { reportedMinor: 0, addedMinor: 0 },
  );
}

function divideRound(numerator: bigint, denominator: bigint) {
  const value = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(value))
    throw new GuestDomainError("VALIDATION_FAILED", 400, "Amount exceeds supported range");
  return value;
}

function safeMultiply(value: number, quantity: number) {
  const result = value * quantity;
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(quantity) ||
    !Number.isSafeInteger(result)
  ) {
    throw new GuestDomainError("VALIDATION_FAILED", 400, "Invalid monetary quantity");
  }
  return result;
}

function safeAdd(...values: number[]) {
  const result = values.reduce((sum, value) => sum + value, 0);
  if (!values.every(Number.isSafeInteger) || !Number.isSafeInteger(result)) {
    throw new GuestDomainError("VALIDATION_FAILED", 400, "Invalid monetary total");
  }
  return result;
}

function safeInteger(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 30)
    : [];
}

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new GuestDomainError("NOT_FOUND", 404, "Public route was not found");
  return slug;
}

function sameQuote(
  quote: QuoteRow,
  current: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    serviceChargeMinor: number;
    deliveryChargeMinor: number;
    tipMinor: number;
    totalMinor: number;
  },
) {
  return (
    quote.subtotal_minor === current.subtotalMinor &&
    quote.discount_minor === current.discountMinor &&
    quote.tax_minor === current.taxMinor &&
    quote.service_charge_minor === current.serviceChargeMinor &&
    quote.delivery_charge_minor === current.deliveryChargeMinor &&
    quote.tip_minor === current.tipMinor &&
    quote.total_minor === current.totalMinor
  );
}

function capacitySlots(starts: Date, durationMinutes: number, intervalMinutes: number) {
  const slots: string[] = [];
  const intervalMs = intervalMinutes * 60_000;
  const first = Math.floor(starts.getTime() / intervalMs) * intervalMs;
  const end = starts.getTime() + durationMinutes * 60_000;
  for (let cursor = first; cursor < end; cursor += intervalMs)
    slots.push(new Date(cursor).toISOString());
  return slots;
}

function withinHours(
  starts: Date,
  ends: Date,
  timezone: string,
  hours: Record<string, [string, string]>,
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (date: Date) => {
    const values = formatter.formatToParts(date);
    const read = (type: string) => values.find((part) => part.type === type)?.value ?? "";
    return { day: read("weekday").toLowerCase(), time: `${read("hour")}:${read("minute")}` };
  };
  const start = parts(starts);
  const end = parts(ends);
  const window = hours[start.day];
  return Boolean(
    window && start.day === end.day && start.time >= window[0] && end.time <= window[1],
  );
}

function depositAmount(policy: ReservationPolicy, partySize: number) {
  if (policy.deposit_type === "PER_GUEST") return safeMultiply(policy.deposit_value, partySize);
  if (policy.deposit_type === "PERCENTAGE") {
    throw new GuestDomainError(
      "UNAVAILABLE",
      409,
      "Percentage deposit needs a configured reservation value basis",
    );
  }
  return policy.deposit_value;
}

function guestCommandActor(profile: ProfileScope, session: GuestSessionRow): ServerActor {
  return {
    id: `guest:${session.id}`,
    name: "Guest Gateway",
    tenantId: profile.tenantId,
    roleIds: ["guest-gateway"],
    permissions: [
      permissions.guestOrderAccept,
      permissions.ordersCreate,
      permissions.ordersUpdate,
      permissions.invoicesManage,
      permissions.voucherView,
    ],
    assignedBranchIds: [profile.branchId],
    assignedBranches: [{ id: profile.branchId, name: profile.branchName }],
    branchScope: { type: "BRANCH", branchId: profile.branchId },
    branchId: profile.branchId,
    role: "Guest",
    branch: profile.branchName,
  };
}

function guestValueActor(profile: ProfileScope, session: GuestSessionRow): ServerActor {
  return {
    ...guestCommandActor(profile, session),
    permissions: [permissions.voucherView, permissions.loyaltyView, permissions.giftCardView],
  };
}

function assertStaffBranch(actor: ServerActor, branchId: string, permission: string) {
  if (!actor.permissions.includes(permission))
    throw new GuestDomainError("FORBIDDEN", 403, `${permission} permission is required`);
  if (
    !actor.assignedBranchIds.includes(branchId) &&
    !actor.permissions.includes(permissions.tenantScopeAllBranches)
  ) {
    throw new GuestDomainError("FORBIDDEN", 403, "Branch access is not assigned");
  }
}

function auditStatement(
  db: D1Database,
  actor: ServerActor,
  action: string,
  entityType: string,
  entityId: string,
  reason: string | undefined,
  stamp: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_events
      (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,correlation_id,
       session_id,metadata_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'{}',?)`,
    )
    .bind(
      actor.tenantId,
      crypto.randomUUID(),
      actor.branchId,
      actor.id,
      actor.deviceId ?? null,
      action,
      entityType,
      entityId,
      sanitizeGuestText(reason) ?? null,
      crypto.randomUUID(),
      actor.sessionId ?? null,
      stamp,
    );
}

function reservationTransitionAllowed(from: ReservationStatus, to: ReservationStatus) {
  const allowed: Record<ReservationStatus, ReservationStatus[]> = {
    PENDING: ["CONFIRMED", "CANCELLED", "WAITLISTED"],
    CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
    SEATED: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
    WAITLISTED: ["CONFIRMED", "CANCELLED"],
  };
  return allowed[from].includes(to);
}

function mapOrderStatus(status: string, deliveryStatus?: string) {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "PAID" || deliveryStatus === "DELIVERED") return "COMPLETED";
  if (deliveryStatus === "OUT_FOR_DELIVERY" || deliveryStatus === "PICKED_UP")
    return "OUT_FOR_DELIVERY";
  if (status === "READY" || status === "SERVED") return "READY";
  if (status === "IN_PROGRESS" || status === "SENT_TO_KITCHEN") return "PREPARING";
  if (status === "OPEN" || status === "HELD") return "CONFIRMED";
  return "ORDER_RECEIVED";
}

function quoteMinor(orderTotal: number, billTotal: number | undefined, currency: string) {
  const value = billTotal ?? orderTotal;
  return parseMajorAmount(value, currency);
}

function publicReferenceFromSubmission(submissionId: string) {
  return `ORD-${submissionId.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function constraintError(error: unknown) {
  return /constraint|unique/i.test(error instanceof Error ? error.message : String(error));
}
