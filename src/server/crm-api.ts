import { z, type ZodTypeAny } from "zod";
import { CampaignService } from "@/crm/campaign-service";
import { CrmAnalyticsService } from "@/crm/crm-analytics";
import { CrmService } from "@/crm/crm-service";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import {
  anonymizeSchema,
  campaignApprovalSchema,
  campaignSchema,
  consentSchema,
  customerCreateSchema,
  customerImportPreviewSchema,
  feedbackResolveSchema,
  feedbackSchema,
  giftCardIssueSchema,
  identityResolveSchema,
  loyaltyAdjustmentSchema,
  loyaltyProgramSchema,
  mergeCustomersSchema,
  privacyRequestSchema,
  segmentSchema,
  voucherDefinitionSchema,
  voucherIssueSchema,
  voucherRedemptionSchema,
} from "@/crm/schemas";
import { CrmDomainError, safeJson } from "@/crm/service-base";
import { SerametHttpError, authenticateSerametRequest, type SerametEnv } from "@/lib/seramet-auth";
import { authoritativeBusinessDate } from "@/server/business-date";
import { ServerOperationError } from "@/server/errors";
import { enqueueCrmWork } from "@/server/workers";

const id = z.string().trim().min(1).max(128);
const tierSchema = z
  .object({
    programId: id,
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120),
    rank: z.number().int().min(0),
    qualificationType: z.enum(["ROLLING_SPEND", "LIFETIME_SPEND", "VISIT_COUNT", "POINTS_EARNED"]),
    thresholdMinorOrPoints: z.number().int().min(0),
    qualificationWindowDays: z.number().int().positive().optional(),
    multiplierNumerator: z.number().int().positive().optional(),
    multiplierDenominator: z.number().int().positive().optional(),
    downgradePolicy: z.enum(["RECALCULATE", "GRACE_PERIOD", "NO_DOWNGRADE"]).optional(),
    gracePeriodDays: z.number().int().positive().optional(),
    benefits: z.record(z.unknown()).optional(),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime().optional(),
  })
  .strict();
const rewardSchema = z
  .object({
    programId: id,
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120),
    rewardType: z.enum([
      "FIXED_DISCOUNT",
      "PERCENTAGE_DISCOUNT",
      "FREE_ITEM",
      "FREE_CATEGORY_ITEM",
      "POINTS_BONUS",
      "FREE_DELIVERY",
      "NON_FINANCIAL",
    ]),
    pointsCost: z.number().int().min(0),
    valueMinor: z.number().int().min(0).optional(),
    percentageBasisPoints: z.number().int().min(0).max(10_000).optional(),
    itemId: id.optional(),
    categoryCode: z.string().trim().max(80).optional(),
    minimumTierId: id.optional(),
    eligibility: z.record(z.unknown()).optional(),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().optional(),
  })
  .strict();
const membershipSchema = z.object({ customerId: id, programId: id }).strict();
const providerConfigSchema = z
  .object({
    id: id.optional(),
    providerKey: z.string().trim().min(1).max(100),
    displayName: z.string().trim().min(1).max(160),
    capabilities: z.array(z.enum(["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP", "SEND_PUSH"])),
    secretReference: z.string().trim().max(500).optional(),
    perMinuteLimit: z.number().int().positive().max(100_000).optional(),
    batchSize: z.number().int().positive().max(1000).optional(),
    maxAttempts: z.number().int().positive().max(20).optional(),
    configuration: z.record(z.unknown()).optional(),
  })
  .strict();
const loyaltyAdjustmentRequestSchema = loyaltyAdjustmentSchema.omit({ businessDate: true });
const giftCardIssueRequestSchema = giftCardIssueSchema.omit({ businessDate: true });
const customerNoteSchema = z
  .object({
    note: z.string().trim().min(1).max(2000),
    visibility: z.enum(["CRM", "SERVICE", "FINANCE"]).default("CRM"),
  })
  .strict();
const customerTagSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
  })
  .strict();
const customerTagAssignmentSchema = z.object({ tagId: id }).strict();

export async function handleCrmApi(request: Request, env: SerametEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/crm")) return null;
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative CRM database unavailable",
    );
  }
  const actor = await authenticateSerametRequest(request, env);
  const phonePolicy = await tenantPhonePolicy(env, actor.tenantId);
  const crm = new CrmService(env.SERAMET_DB, actor, phonePolicy);
  const loyalty = new LoyaltyValueService(env.SERAMET_DB, actor);
  const analytics = new CrmAnalyticsService(env.SERAMET_DB, actor);
  const campaigns = new CampaignService(env.SERAMET_DB, actor);

  try {
    if (url.pathname === "/api/seramet/crm/dashboard" && request.method === "GET") {
      return json({ ok: true, dashboard: await crm.dashboard(optionalQuery(url, "branchId")) });
    }
    if (url.pathname === "/api/seramet/crm/customers" && request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "30");
      if (!Number.isInteger(limit)) throw new SerametHttpError(400, "limit is invalid");
      return json({
        ok: true,
        ...(await crm.searchCustomers(
          omitUndefined({
            query: optionalQuery(url, "query"),
            branchId: optionalQuery(url, "branchId"),
            cursor: optionalQuery(url, "cursor"),
            limit,
          }),
        )),
      });
    }
    if (url.pathname === "/api/seramet/crm/customers" && request.method === "POST") {
      return json(
        {
          ok: true,
          customer: await crm.createCustomer(await parse(request, customerCreateSchema)),
        },
        201,
      );
    }
    const customerRoute = /^\/api\/seramet\/crm\/customers\/([^/]+)$/.exec(url.pathname);
    if (customerRoute && request.method === "GET") {
      return json({
        ok: true,
        customer: await crm.customerProfile(decodeURIComponent(customerRoute[1]!)),
      });
    }
    const customerNotesRoute = /^\/api\/seramet\/crm\/customers\/([^/]+)\/notes$/.exec(
      url.pathname,
    );
    if (customerNotesRoute && request.method === "POST") {
      const body = await parse(request, customerNoteSchema);
      return json(
        {
          ok: true,
          note: await crm.addCustomerNote({
            customerId: decodeURIComponent(customerNotesRoute[1]!),
            note: body.note,
            visibility: body.visibility,
          }),
        },
        201,
      );
    }
    const customerTagsRoute = /^\/api\/seramet\/crm\/customers\/([^/]+)\/tags$/.exec(url.pathname);
    if (customerTagsRoute && request.method === "POST") {
      const body = await parse(request, customerTagAssignmentSchema);
      return json(
        {
          ok: true,
          assignment: await crm.assignTag({
            customerId: decodeURIComponent(customerTagsRoute[1]!),
            tagId: body.tagId,
          }),
        },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/tags" && request.method === "GET") {
      return json({ ok: true, tags: await crm.listTags() });
    }
    if (url.pathname === "/api/seramet/crm/tags" && request.method === "POST") {
      return json(
        { ok: true, tag: await crm.createTag(await parse(request, customerTagSchema)) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/identity/resolve" && request.method === "POST") {
      return json({
        ok: true,
        match: await crm.resolveIdentity(await parse(request, identityResolveSchema)),
      });
    }
    if (url.pathname === "/api/seramet/crm/customers/merge" && request.method === "POST") {
      const body = await parse(request, mergeCustomersSchema);
      return json({
        ok: true,
        merge: await crm.mergeCustomers({
          canonicalCustomerId: body.canonicalCustomerId,
          duplicateCustomerId: body.duplicateCustomerId,
          reason: body.reason,
          idempotencyKey: body.idempotencyKey,
        }),
      });
    }
    if (url.pathname === "/api/seramet/crm/consents" && request.method === "POST") {
      return json(
        { ok: true, consent: await crm.appendConsent(await parse(request, consentSchema)) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/privacy" && request.method === "GET") {
      return json({
        ok: true,
        requests: await crm.listPrivacyRequests(
          integerQuery(url, "limit", 200, 1, 500),
          optionalQuery(url, "branchId"),
        ),
      });
    }
    if (url.pathname === "/api/seramet/crm/privacy" && request.method === "POST") {
      const body = await parse(request, privacyRequestSchema);
      const privacyRequest = await crm.createPrivacyRequest(body);
      if (["ACCESS", "EXPORT"].includes(body.requestType)) {
        await requireDurableCrmWork(env, {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          jobType: "CRM_PRIVACY_EXPORT",
          payload: { requestId: privacyRequest.id },
          idempotencyKey: `crm-privacy-export:${privacyRequest.id}`,
        });
      }
      return json({ ok: true, request: privacyRequest }, 201);
    }
    if (url.pathname === "/api/seramet/crm/privacy/anonymize" && request.method === "POST") {
      const body = await parse(request, anonymizeSchema);
      return json({ ok: true, result: await crm.anonymizeCustomer(body.requestId, body.reason) });
    }
    if (url.pathname === "/api/seramet/crm/customers/export" && request.method === "POST") {
      return json({ ok: true, customers: await crm.exportCustomers() });
    }
    if (url.pathname === "/api/seramet/crm/customers/import/preview" && request.method === "POST") {
      return json({
        ok: true,
        preview: await crm.previewCustomerImport(await parse(request, customerImportPreviewSchema)),
      });
    }
    const importCommitRoute = /^\/api\/seramet\/crm\/customers\/import\/([^/]+)\/commit$/.exec(
      url.pathname,
    );
    if (importCommitRoute && request.method === "POST") {
      const importId = decodeURIComponent(importCommitRoute[1]!);
      const queued = await requireDurableCrmWork(env, {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        jobType: "CRM_CUSTOMER_IMPORT_COMMIT",
        payload: { importId },
        idempotencyKey: `crm-import-commit:${importId}`,
      });
      return json({ ok: true, result: queued }, 202);
    }

    if (url.pathname === "/api/seramet/crm/loyalty/programs" && request.method === "GET") {
      return json({ ok: true, programs: await loyalty.listPrograms() });
    }
    if (url.pathname === "/api/seramet/crm/loyalty/programs" && request.method === "POST") {
      return json(
        {
          ok: true,
          program: await loyalty.createProgram(await parse(request, loyaltyProgramSchema)),
        },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/loyalty/tiers" && request.method === "GET") {
      return json({ ok: true, tiers: await loyalty.listTiers(optionalQuery(url, "programId")) });
    }
    if (url.pathname === "/api/seramet/crm/loyalty/tiers" && request.method === "POST") {
      return json(
        { ok: true, tier: await loyalty.createTier(await parse(request, tierSchema)) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/loyalty/rewards" && request.method === "GET") {
      return json({
        ok: true,
        rewards: await loyalty.listRewards(optionalQuery(url, "programId")),
      });
    }
    if (url.pathname === "/api/seramet/crm/loyalty/rewards" && request.method === "POST") {
      return json(
        { ok: true, reward: await loyalty.createReward(await parse(request, rewardSchema)) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/loyalty/memberships" && request.method === "POST") {
      const body = await parse(request, membershipSchema);
      return json(
        { ok: true, membership: await loyalty.joinProgram(body.customerId, body.programId) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/loyalty/redeem" && request.method === "POST") {
      throw new SerametHttpError(
        409,
        "Loyalty redemption must use the authoritative checkout transaction workflow",
      );
    }
    if (url.pathname === "/api/seramet/crm/loyalty/adjust" && request.method === "POST") {
      const body = await parse(request, loyaltyAdjustmentRequestSchema);
      const businessDate = await serverBusinessDate(
        env,
        actor.tenantId,
        body.branchId ?? actor.branchId,
      );
      return json({ ok: true, adjustment: await loyalty.adjustPoints({ ...body, businessDate }) });
    }

    if (url.pathname === "/api/seramet/crm/vouchers" && request.method === "GET") {
      return json({ ok: true, vouchers: await loyalty.listVouchers() });
    }
    if (url.pathname === "/api/seramet/crm/vouchers" && request.method === "POST") {
      return json(
        {
          ok: true,
          voucher: await loyalty.createVoucherDefinition(
            await parse(request, voucherDefinitionSchema),
          ),
        },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/vouchers/issue" && request.method === "POST") {
      return json(
        { ok: true, issue: await loyalty.issueVoucher(await parse(request, voucherIssueSchema)) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/vouchers/validate" && request.method === "POST") {
      const body = await parse(request, voucherRedemptionSchema);
      return json({ ok: true, validation: await loyalty.validateVoucher(body) });
    }
    if (url.pathname === "/api/seramet/crm/vouchers/redeem" && request.method === "POST") {
      throw new SerametHttpError(
        409,
        "Voucher redemption must use the authoritative checkout transaction workflow",
      );
    }

    if (url.pathname === "/api/seramet/crm/gift-cards" && request.method === "GET") {
      return json({ ok: true, giftCards: await loyalty.listGiftCards() });
    }
    if (url.pathname === "/api/seramet/crm/gift-cards/issue" && request.method === "POST") {
      const body = await parse(request, giftCardIssueRequestSchema);
      const businessDate = await serverBusinessDate(env, actor.tenantId, actor.branchId);
      return json(
        { ok: true, giftCard: await loyalty.issueGiftCard({ ...body, businessDate }) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/gift-cards/balance" && request.method === "POST") {
      const body = await parse(
        request,
        z.object({ token: z.string().trim().min(20).max(200) }).strict(),
      );
      return json({ ok: true, balance: await loyalty.giftCardBalance(body.token) });
    }
    if (url.pathname === "/api/seramet/crm/gift-cards/redeem" && request.method === "POST") {
      throw new SerametHttpError(
        409,
        "Gift-card redemption must use the authoritative checkout transaction workflow",
      );
    }

    if (url.pathname === "/api/seramet/crm/segments" && request.method === "GET") {
      return json({ ok: true, segments: await campaigns.listSegments() });
    }
    if (url.pathname === "/api/seramet/crm/segments" && request.method === "POST") {
      return json(
        { ok: true, segment: await campaigns.createSegment(await parse(request, segmentSchema)) },
        201,
      );
    }
    const segmentSnapshotRoute = /^\/api\/seramet\/crm\/segments\/([^/]+)\/snapshot$/.exec(
      url.pathname,
    );
    if (segmentSnapshotRoute && request.method === "POST") {
      return json({
        ok: true,
        snapshot: await campaigns.buildSegmentSnapshot(
          decodeURIComponent(segmentSnapshotRoute[1]!),
          optionalQuery(url, "branchId"),
        ),
      });
    }
    if (url.pathname === "/api/seramet/crm/retention" && request.method === "GET") {
      return json({
        ok: true,
        retention: await analytics.retentionSummary(
          omitUndefined({
            branchId: optionalQuery(url, "branchId"),
            lapsedDays: Number(url.searchParams.get("lapsedDays") ?? "60"),
          }),
        ),
      });
    }
    if (url.pathname === "/api/seramet/crm/cohorts" && request.method === "GET") {
      return json({
        ok: true,
        cohorts: await analytics.cohortRetention(optionalQuery(url, "branchId")),
      });
    }

    if (url.pathname === "/api/seramet/crm/campaigns" && request.method === "GET") {
      return json({ ok: true, campaigns: await campaigns.listCampaigns() });
    }
    if (url.pathname === "/api/seramet/crm/campaigns" && request.method === "POST") {
      return json(
        {
          ok: true,
          campaign: await campaigns.createCampaign(await parse(request, campaignSchema)),
        },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/campaigns/providers" && request.method === "GET") {
      return json({ ok: true, providers: await campaigns.providerHealth() });
    }
    if (url.pathname === "/api/seramet/crm/campaigns/providers" && request.method === "POST") {
      return json({
        ok: true,
        provider: await campaigns.upsertProviderConfig(await parse(request, providerConfigSchema)),
      });
    }
    const campaignAction =
      /^\/api\/seramet\/crm\/campaigns\/([^/]+)\/(preview|approve|queue)$/.exec(url.pathname);
    if (campaignAction && request.method === "POST") {
      const campaignId = decodeURIComponent(campaignAction[1]!);
      if (campaignAction[2] === "preview")
        return json({ ok: true, preview: await campaigns.previewCampaign(campaignId) });
      if (campaignAction[2] === "approve") {
        const body = await parse(request, campaignApprovalSchema);
        if (body.campaignId !== campaignId) throw new SerametHttpError(400, "Campaign ID mismatch");
        return json({
          ok: true,
          campaign: await campaigns.approveCampaign(campaignId, body.reason),
        });
      }
      const campaign = await campaigns.queueCampaign(campaignId);
      const worker = await requireDurableCrmWork(env, {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        jobType: "CRM_CAMPAIGN_DISPATCH",
        payload: { campaignId },
        idempotencyKey: `crm-campaign-dispatch:${campaignId}:${new Date().toISOString().slice(0, 16)}`,
      });
      return json({ ok: true, campaign, worker }, 202);
    }

    if (url.pathname === "/api/seramet/crm/feedback" && request.method === "GET") {
      return json({
        ok: true,
        feedback: await crm.listFeedback(
          optionalQuery(url, "branchId"),
          integerQuery(url, "limit", 200, 1, 500),
        ),
      });
    }
    if (url.pathname === "/api/seramet/crm/feedback/categories" && request.method === "GET") {
      return json({ ok: true, categories: await crm.listFeedbackCategories() });
    }
    if (url.pathname === "/api/seramet/crm/feedback" && request.method === "POST") {
      return json(
        { ok: true, feedback: await crm.createFeedback(await parse(request, feedbackSchema)) },
        201,
      );
    }
    if (url.pathname === "/api/seramet/crm/feedback/resolve" && request.method === "POST") {
      return json({
        ok: true,
        feedback: await crm.resolveFeedback(await parse(request, feedbackResolveSchema)),
      });
    }

    return null;
  } catch (error) {
    if (error instanceof CrmDomainError) throw mapDomainError(error);
    throw error;
  }
}

type ExactOptionals<T> = T extends readonly (infer TItem)[]
  ? ExactOptionals<TItem>[]
  : T extends Record<string, unknown>
    ? {
        [TKey in keyof T as undefined extends T[TKey] ? never : TKey]: ExactOptionals<T[TKey]>;
      } & {
        [TKey in keyof T as undefined extends T[TKey] ? TKey : never]?: ExactOptionals<
          Exclude<T[TKey], undefined>
        >;
      }
    : T;

function omitUndefined<T>(value: T): ExactOptionals<T> {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefined(item)) as ExactOptionals<T>;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, omitUndefined(item)]],
      ),
    ) as ExactOptionals<T>;
  }
  return value as ExactOptionals<T>;
}

async function parse<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<ExactOptionals<z.infer<TSchema>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SerametHttpError(
      400,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
        .join("; "),
    );
  }
  return omitUndefined(parsed.data);
}

async function tenantPhonePolicy(env: SerametEnv, tenantId: string) {
  const row = await env
    .SERAMET_DB!.prepare(
      "SELECT configuration_json FROM feature_flags WHERE tenant_id=? AND key='crm.enabled'",
    )
    .bind(tenantId)
    .first<{ configuration_json: string }>();
  const config = safeJson<Record<string, unknown>>(row?.configuration_json, {});
  return {
    defaultCallingCode:
      typeof config["phoneDefaultCallingCode"] === "string"
        ? String(config["phoneDefaultCallingCode"])
        : "",
    nationalPrefix:
      typeof config["phoneNationalPrefix"] === "string"
        ? String(config["phoneNationalPrefix"])
        : "0",
    minNationalDigits: 8,
    maxNationalDigits: 15,
  };
}

async function serverBusinessDate(env: SerametEnv, tenantId: string, branchId: string) {
  const branch = await env
    .SERAMET_DB!.prepare(
      "SELECT timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=? AND active=1",
    )
    .bind(tenantId, branchId)
    .first<{ timezone: string; business_day_cutoff_minutes: number }>();
  if (!branch) throw new SerametHttpError(404, "Branch was not found");
  return authoritativeBusinessDate({
    timezone: branch.timezone,
    cutoffMinutes: branch.business_day_cutoff_minutes,
  });
}

function mapDomainError(error: CrmDomainError) {
  const status =
    error.code === "PERMISSION_DENIED"
      ? 403
      : error.code === "NOT_FOUND"
        ? 404
        : error.code === "DUPLICATE" || error.code === "CONFLICT" || error.code === "INVALID_STATE"
          ? 409
          : 400;
  return new SerametHttpError(status, error.message);
}

function optionalQuery(url: URL, key: string) {
  return url.searchParams.get(key)?.trim() || undefined;
}

function integerQuery(url: URL, key: string, fallback: number, minimum: number, maximum: number) {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SerametHttpError(400, `${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

async function requireDurableCrmWork(env: SerametEnv, input: Parameters<typeof enqueueCrmWork>[1]) {
  if (!env.SERAMET_WORK_QUEUE) {
    throw new ServerOperationError(
      "QUEUE_UNAVAILABLE",
      503,
      "Durable CRM worker queue unavailable",
    );
  }
  return enqueueCrmWork(env, input);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
