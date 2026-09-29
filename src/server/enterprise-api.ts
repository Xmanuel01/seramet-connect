import { z, type ZodTypeAny } from "zod";
import { EnterpriseService } from "@/enterprise/enterprise-service";
import {
  legalEntitySchema,
  nodeInputSchema,
  policyAssignmentSchema,
  policyDefinitionSchema,
} from "@/enterprise/schemas";
import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { ServerOperationError } from "@/server/errors";
import { enqueueEnterpriseWork } from "@/server/workers";
import { moduleDecision } from "@/platform/module-access-registry";
import { resolveServerModuleAccess } from "@/server/module-access-service";

const roleAssignmentSchema = z
  .object({
    id: z.string().min(1).optional(),
    userId: z.string().min(1),
    roleId: z.string().min(1),
    scopeNodeId: z.string().min(1),
    descendToChildren: z.boolean().default(true),
    effect: z.enum(["ALLOW", "DENY"]).default("ALLOW"),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validUntil: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const exceptionSchema = z
  .object({
    policyCode: z.string().min(1),
    scopeNodeId: z.string().min(1),
    requestType: z.string().min(1).max(80),
    requestedValue: z.unknown().optional(),
    reason: z.string().trim().min(3).max(1000),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validUntil: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const exceptionTransitionSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "REVOKED"]),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

const priceRolloutSchema = z
  .object({
    id: z.string().min(1).optional(),
    scopeNodeId: z.string().min(1),
    menuItemId: z.string().min(1),
    priceMinor: z.number().int().safe().nonnegative(),
    currency: z.string().length(3),
    idempotencyKey: z.string().min(8).max(160),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    requiresApproval: z.boolean().default(false),
  })
  .strict();

const rolloutConfirmationSchema = z
  .object({
    confirmationHash: z.string().length(64),
  })
  .strict();

const templateSchema = z
  .object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    brandId: z.string().min(1).optional(),
  })
  .strict();

const templateVersionSchema = z
  .object({
    configuration: z.record(z.unknown()),
    publish: z.boolean().default(false),
  })
  .strict();

const templateApplicationSchema = z
  .object({
    branchId: z.string().min(1),
    previewHash: z.string().length(64),
    idempotencyKey: z.string().min(8).max(160),
  })
  .strict();

const templateProvisionSchema = z
  .object({
    id: z.string().min(1).max(120).optional(),
    nodeId: z.string().min(1).max(120).optional(),
    parentNodeId: z.string().min(1).max(120),
    legalEntityId: z.string().min(1).max(120),
    brandId: z.string().min(1).max(120),
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    timezone: z.string().trim().min(1).max(80),
    businessDayCutoffMinutes: z.number().int().min(0).max(1439),
    currency: z.string().trim().length(3),
    address: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(80).optional(),
    email: z.string().trim().email().max(254).optional(),
    idempotencyKey: z.string().trim().min(8).max(160),
  })
  .strict();

const requisitionAggregateSchema = z
  .object({
    scopeNodeId: z.string().min(1),
    currency: z.string().length(3),
    idempotencyKey: z.string().min(8).max(160),
    requiredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const franchiseFeeSchema = z
  .object({
    feeDefinitionId: z.string().min(1),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
  })
  .strict()
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "periodEnd must not precede periodStart",
  });

const enterpriseExportSchema = z
  .object({
    scopeNodeId: z.string().min(1),
    exportType: z.enum([
      "HIERARCHY",
      "MANAGEMENT_METRICS",
      "FRANCHISE_COMPLIANCE",
      "ENTERPRISE_AUDIT",
    ]),
    fields: z.array(z.string().min(1).max(80)).max(30).optional(),
    filters: z
      .object({
        periodStart: z.string().date().optional(),
        periodEnd: z.string().date().optional(),
      })
      .strict()
      .optional(),
    rowLimit: z.number().int().min(1).max(10_000).default(1000),
    idempotencyKey: z.string().min(8).max(160),
  })
  .strict()
  .refine(
    (value) =>
      !value.filters?.periodStart ||
      !value.filters?.periodEnd ||
      value.filters.periodEnd >= value.filters.periodStart,
    { message: "periodEnd must not precede periodStart" },
  );

const metricTargetSchema = z
  .object({
    scopeNodeId: z.string().min(1),
    metricCode: z.string().trim().min(1).max(120),
    targetValue: z.number().int().safe(),
    valueUnit: z.string().trim().min(1).max(40),
    overrideState: z.enum([
      "LOCKED",
      "ALLOWED_OVERRIDE",
      "ALLOWED_WITHIN_RANGE",
      "APPROVAL_REQUIRED",
    ]),
    minimumValue: z.number().int().safe().optional(),
    maximumValue: z.number().int().safe().optional(),
    approvalReference: z.string().trim().min(3).max(160).optional(),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.minimumValue === undefined ||
      value.maximumValue === undefined ||
      value.minimumValue <= value.maximumValue,
    { message: "minimumValue must not exceed maximumValue" },
  );

const nodeLifecycleSchema = z
  .object({
    status: z.enum(["ACTIVE", "TEMPORARILY_CLOSED", "SUSPENDED", "CLOSED"]),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

const franchiseLifecycleSchema = z
  .object({
    status: z.enum(["PROSPECT", "ONBOARDING", "ACTIVE", "SUSPENDED", "TERMINATED", "EXPIRED"]),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

const supplierContractSchema = z
  .object({
    id: z.string().min(1).optional(),
    supplierId: z.string().min(1),
    scopeNodeId: z.string().min(1),
    contractReference: z.string().trim().min(1).max(160),
    inventoryItemId: z.string().min(1).optional(),
    categoryReference: z.string().trim().min(1).max(120).optional(),
    purchaseUnitId: z.string().min(1).optional(),
    negotiatedPriceMinor: z.number().int().safe().nonnegative().optional(),
    currency: z.string().trim().length(3).optional(),
    minimumQuantityMicro: z.number().int().safe().nonnegative().optional(),
    leadTimeDays: z.number().int().safe().nonnegative().optional(),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "SUSPENDED"]),
  })
  .strict()
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not precede effectiveFrom",
  });

const intercompanyConfigurationSchema = z
  .object({
    id: z.string().min(1).optional(),
    sourceLegalEntityId: z.string().min(1),
    destinationLegalEntityId: z.string().min(1),
    currency: z.string().trim().length(3),
    dueFromAccountId: z.string().min(1),
    dueToAccountId: z.string().min(1),
    inventoryAccountId: z.string().min(1).optional(),
    revenueAccountId: z.string().min(1).optional(),
    cogsAccountId: z.string().min(1).optional(),
    transferPricePolicyReference: z.string().trim().min(3).max(160),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.effectiveFrom || !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      message: "effectiveTo must not precede effectiveFrom",
    },
  );

const franchiseRelationshipSchema = z
  .object({
    id: z.string().min(1).optional(),
    franchiseeLegalEntityId: z.string().min(1),
    franchisorLegalEntityId: z.string().min(1),
    brandId: z.string().min(1),
    branchIds: z.array(z.string().min(1)).max(500),
    agreementReference: z.string().trim().min(3).max(160),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
    status: z.enum(["PROSPECT", "ONBOARDING", "ACTIVE", "SUSPENDED", "TERMINATED", "EXPIRED"]),
    reportingScope: z.record(z.unknown()).default({}),
  })
  .strict()
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not precede effectiveFrom",
  });

const franchiseFeeDefinitionSchema = z
  .object({
    id: z.string().min(1).optional(),
    franchiseRelationshipId: z.string().min(1),
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(160),
    feeType: z.enum(["ROYALTY", "MARKETING_LEVY", "FIXED", "OTHER"]),
    basisType: z.enum(["GROSS_SALES", "NET_SALES", "CONFIGURED_REVENUE", "FIXED_PERIODIC"]),
    rateBps: z.number().int().min(0).max(10_000).optional(),
    fixedAmountMinor: z.number().int().safe().nonnegative().optional(),
    currency: z.string().trim().length(3).optional(),
    exclusions: z.array(z.unknown()).max(100).default([]),
    accountMapping: z.record(z.unknown()).default({}),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo must not precede effectiveFrom",
  });

export async function handleEnterpriseApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/enterprise")) return null;
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB)
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative enterprise database unavailable",
    );
  const service = new EnterpriseService(env.SERAMET_DB, actor);

  if (url.pathname === "/api/seramet/enterprise/overview" && request.method === "GET") {
    const access = await resolveServerModuleAccess(env.SERAMET_DB, actor);
    if (!moduleDecision(access, "hq-command")?.route) {
      throw new SerametHttpError(403, "Enterprise module permission or scope denied");
    }
    return json({ ok: true, overview: await service.overview() });
  }
  if (url.pathname === "/api/seramet/enterprise/hierarchy" && request.method === "GET") {
    return json({
      ok: true,
      nodes: await service.listHierarchy(optional(url, "rootNodeId"), boundedLimit(url, 1000)),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/dashboard" && request.method === "GET") {
    const periodStart = dateQuery(url, "periodStart");
    const periodEnd = dateQuery(url, "periodEnd");
    if (periodEnd < periodStart)
      throw new SerametHttpError(400, "periodEnd must not precede periodStart");
    return json({
      ok: true,
      dashboard: await service.dashboard(required(url, "scopeNodeId"), periodStart, periodEnd),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/policy/resolve" && request.method === "GET") {
    return json({
      ok: true,
      policy: await service.resolvePolicy(
        required(url, "code"),
        required(url, "nodeId"),
        optional(url, "effectiveAt"),
      ),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/targets/resolve" && request.method === "GET") {
    return json({
      ok: true,
      target: await service.resolveMetricTarget(
        required(url, "code"),
        required(url, "nodeId"),
        optional(url, "effectiveAt"),
      ),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/targets" && request.method === "POST") {
    return json(
      {
        ok: true,
        target: await service.createMetricTarget(await parse(request, metricTargetSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/enterprise/audit" && request.method === "GET") {
    const actorId = optional(url, "actorId");
    const branchId = optional(url, "branchId");
    const domain = optional(url, "domain");
    const action = optional(url, "action");
    const from = optionalDateTime(url, "from");
    const to = optionalDateTime(url, "to");
    const correlationId = optional(url, "correlationId");
    return json({
      ok: true,
      events: await service.enterpriseAudit(required(url, "scopeNodeId"), {
        limit: boundedLimit(url, 1000),
        ...(actorId ? { actorId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(domain ? { domain } : {}),
        ...(action ? { action } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(correlationId ? { correlationId } : {}),
      }),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/exports" && request.method === "POST") {
    const exportJob = await service.requestEnterpriseExport(
      await parse(request, enterpriseExportSchema),
    );
    if (!env.SERAMET_WORK_QUEUE) {
      return json({ ok: true, export: await service.runEnterpriseExport(exportJob.id) }, 201);
    }
    const queued = await enqueueEnterpriseWork(env, {
      tenantId: actor.tenantId,
      jobType: "ENTERPRISE_EXPORT_GENERATION",
      payload: { exportId: exportJob.id },
      idempotencyKey: `enterprise-export:${actor.tenantId}:${exportJob.id}`,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return json({ ok: true, export: exportJob, queued }, 202);
  }
  const exportRoute = /^\/api\/seramet\/enterprise\/exports\/([^/]+)$/.exec(url.pathname);
  if (exportRoute && request.method === "GET") {
    return json({
      ok: true,
      export: await service.getEnterpriseExport(decodeURIComponent(exportRoute[1]!)),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/legal-entities" && request.method === "POST") {
    return json(
      {
        ok: true,
        legalEntity: await service.createLegalEntity(await parse(request, legalEntitySchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/enterprise/nodes" && request.method === "POST") {
    return json(
      { ok: true, node: await service.createNode(await parse(request, nodeInputSchema)) },
      201,
    );
  }
  const nodeStatusRoute = /^\/api\/seramet\/enterprise\/nodes\/([^/]+)\/status$/.exec(url.pathname);
  if (nodeStatusRoute && request.method === "POST") {
    const body = await parse<{
      status: "ACTIVE" | "TEMPORARILY_CLOSED" | "SUSPENDED" | "CLOSED";
      reason: string;
    }>(request, nodeLifecycleSchema);
    return json({
      ok: true,
      node: await service.transitionNodeStatus(
        decodeURIComponent(nodeStatusRoute[1]!),
        body.status,
        body.reason,
      ),
    });
  }
  if (
    url.pathname === "/api/seramet/enterprise/policies/definitions" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true,
        policy: await service.createPolicyDefinition(await parse(request, policyDefinitionSchema)),
      },
      201,
    );
  }
  if (
    url.pathname === "/api/seramet/enterprise/policies/assignments" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true,
        policy: await service.assignPolicy(await parse(request, policyAssignmentSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/enterprise/policies/exceptions" && request.method === "POST") {
    return json(
      {
        ok: true,
        exception: await service.requestPolicyException(await parse(request, exceptionSchema)),
      },
      201,
    );
  }
  const exceptionRoute =
    /^\/api\/seramet\/enterprise\/policies\/exceptions\/([^/]+)\/transition$/.exec(url.pathname);
  if (exceptionRoute && request.method === "POST") {
    const body = await parse<{
      status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "REVOKED";
      note: string;
    }>(request, exceptionTransitionSchema);
    return json({
      ok: true,
      exception: await service.transitionPolicyException(
        decodeURIComponent(exceptionRoute[1]!),
        body.status,
        body.note,
      ),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/access/assignments" && request.method === "POST") {
    return json(
      {
        ok: true,
        assignment: await service.grantScopedRole(await parse(request, roleAssignmentSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/enterprise/rollouts/prices" && request.method === "POST") {
    return json(
      {
        ok: true,
        rollout: await service.createPriceRollout(await parse(request, priceRolloutSchema)),
      },
      201,
    );
  }
  const approveRollout = /^\/api\/seramet\/enterprise\/rollouts\/([^/]+)\/approve$/.exec(
    url.pathname,
  );
  if (approveRollout && request.method === "POST") {
    return json({
      ok: true,
      rollout: await service.approveRollout(decodeURIComponent(approveRollout[1]!)),
    });
  }
  const confirmRollout = /^\/api\/seramet\/enterprise\/rollouts\/([^/]+)\/confirm$/.exec(
    url.pathname,
  );
  if (confirmRollout && request.method === "POST") {
    const body = await parse<{ confirmationHash: string }>(request, rolloutConfirmationSchema);
    return json({
      ok: true,
      rollout: await service.confirmRollout(
        decodeURIComponent(confirmRollout[1]!),
        body.confirmationHash,
      ),
    });
  }
  const executeRollout = /^\/api\/seramet\/enterprise\/rollouts\/([^/]+)\/execute$/.exec(
    url.pathname,
  );
  if (executeRollout && request.method === "POST") {
    const rolloutId = decodeURIComponent(executeRollout[1]!);
    if (!env.SERAMET_WORK_QUEUE)
      return json({ ok: true, rollout: await service.executeRollout(rolloutId) });
    return json(
      {
        ok: true,
        queued: await enqueueEnterpriseWork(env, {
          tenantId: actor.tenantId,
          jobType: "ENTERPRISE_ROLLOUT_EXECUTION",
          payload: { rolloutId },
          idempotencyKey: `enterprise-rollout:${actor.tenantId}:${rolloutId}`,
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
        }),
      },
      202,
    );
  }
  if (url.pathname === "/api/seramet/enterprise/templates" && request.method === "POST") {
    return json(
      {
        ok: true,
        template: await service.createBranchTemplate(await parse(request, templateSchema)),
      },
      201,
    );
  }
  const templateVersionRoute = /^\/api\/seramet\/enterprise\/templates\/([^/]+)\/versions$/.exec(
    url.pathname,
  );
  if (templateVersionRoute && request.method === "POST") {
    const body = await parse<{ configuration: Record<string, unknown>; publish: boolean }>(
      request,
      templateVersionSchema,
    );
    return json(
      {
        ok: true,
        version: await service.createTemplateVersion(
          decodeURIComponent(templateVersionRoute[1]!),
          body.configuration,
          body.publish,
        ),
      },
      201,
    );
  }
  const templatePreviewRoute =
    /^\/api\/seramet\/enterprise\/template-versions\/([^/]+)\/preview$/.exec(url.pathname);
  if (templatePreviewRoute && request.method === "GET") {
    return json({
      ok: true,
      preview: await service.previewBranchTemplate(
        decodeURIComponent(templatePreviewRoute[1]!),
        required(url, "branchId"),
      ),
    });
  }
  const templateApplyRoute = /^\/api\/seramet\/enterprise\/template-versions\/([^/]+)\/apply$/.exec(
    url.pathname,
  );
  if (templateApplyRoute && request.method === "POST") {
    const body = await parse<{ branchId: string; previewHash: string; idempotencyKey: string }>(
      request,
      templateApplicationSchema,
    );
    return json(
      {
        ok: true,
        assignment: await service.applyBranchTemplate({
          templateVersionId: decodeURIComponent(templateApplyRoute[1]!),
          ...body,
        }),
      },
      201,
    );
  }
  const templateProvisionRoute =
    /^\/api\/seramet\/enterprise\/template-versions\/([^/]+)\/provision-branch$/.exec(url.pathname);
  if (templateProvisionRoute && request.method === "POST") {
    const body = await parse<
      Omit<Parameters<EnterpriseService["provisionBranchFromTemplate"]>[0], "templateVersionId">
    >(request, templateProvisionSchema);
    return json(
      {
        ok: true,
        provisioned: await service.provisionBranchFromTemplate({
          templateVersionId: decodeURIComponent(templateProvisionRoute[1]!),
          ...body,
        }),
      },
      201,
    );
  }
  const effectiveTemplateRoute = /^\/api\/seramet\/enterprise\/branches\/([^/]+)\/template$/.exec(
    url.pathname,
  );
  if (effectiveTemplateRoute && request.method === "GET") {
    return json({
      ok: true,
      template: await service.effectiveBranchTemplate(
        decodeURIComponent(effectiveTemplateRoute[1]!),
      ),
    });
  }
  if (
    url.pathname === "/api/seramet/enterprise/procurement/aggregate" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true,
        batch: await service.aggregateRequisitions(
          await parse(request, requisitionAggregateSchema),
        ),
      },
      201,
    );
  }
  if (
    url.pathname === "/api/seramet/enterprise/procurement/contracts" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true,
        contract: await service.createSupplierContract(
          await parse(request, supplierContractSchema),
        ),
      },
      201,
    );
  }
  if (
    url.pathname === "/api/seramet/enterprise/intercompany/configurations" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true,
        configuration: await service.createIntercompanyConfiguration(
          await parse(request, intercompanyConfigurationSchema),
        ),
      },
      201,
    );
  }
  const transferRoute = /^\/api\/seramet\/enterprise\/transfers\/([^/]+)\/validate$/.exec(
    url.pathname,
  );
  if (transferRoute && request.method === "POST") {
    return json({
      ok: true,
      accounting: await service.validateTransferAccounting(decodeURIComponent(transferRoute[1]!)),
    });
  }
  if (
    url.pathname === "/api/seramet/enterprise/franchise/fees/calculate" &&
    request.method === "POST"
  ) {
    return json({
      ok: true,
      fee: await service.calculateFranchiseFee(await parse(request, franchiseFeeSchema)),
    });
  }
  if (url.pathname === "/api/seramet/enterprise/franchises" && request.method === "POST") {
    return json(
      {
        ok: true,
        franchise: await service.createFranchiseRelationship(
          await parse(request, franchiseRelationshipSchema),
        ),
      },
      201,
    );
  }
  if (
    url.pathname === "/api/seramet/enterprise/franchise/fee-definitions" &&
    request.method === "POST"
  ) {
    return json(
      {
        ok: true,
        fee: await service.createFranchiseFeeDefinition(
          await parse(request, franchiseFeeDefinitionSchema),
        ),
      },
      201,
    );
  }
  const franchiseStatementRoute =
    /^\/api\/seramet\/enterprise\/franchises\/([^/]+)\/statement$/.exec(url.pathname);
  if (franchiseStatementRoute && request.method === "GET") {
    return json({
      ok: true,
      statement: await service.franchiseStatement(
        decodeURIComponent(franchiseStatementRoute[1]!),
        dateQuery(url, "periodStart"),
        dateQuery(url, "periodEnd"),
      ),
    });
  }
  const franchiseStatusRoute = /^\/api\/seramet\/enterprise\/franchises\/([^/]+)\/status$/.exec(
    url.pathname,
  );
  if (franchiseStatusRoute && request.method === "POST") {
    const body = await parse<{
      status: "PROSPECT" | "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "TERMINATED" | "EXPIRED";
      reason: string;
    }>(request, franchiseLifecycleSchema);
    return json({
      ok: true,
      franchise: await service.transitionFranchiseStatus(
        decodeURIComponent(franchiseStatusRoute[1]!),
        body.status,
        body.reason,
      ),
    });
  }
  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new SerametHttpError(
      400,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
        .join("; "),
    );
  return parsed.data as T;
}

function optional(url: URL, key: string) {
  return url.searchParams.get(key)?.trim() || undefined;
}
function required(url: URL, key: string) {
  const value = optional(url, key);
  if (!value) throw new SerametHttpError(400, `${key} is required`);
  return value;
}
function dateQuery(url: URL, key: string) {
  const value = required(url, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new SerametHttpError(400, `${key} must be YYYY-MM-DD`);
  return value;
}
function optionalDateTime(url: URL, key: string) {
  const value = optional(url, key);
  if (value && Number.isNaN(Date.parse(value)))
    throw new SerametHttpError(400, `${key} must be an ISO date-time`);
  return value;
}
function boundedLimit(url: URL, max: number) {
  const value = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new SerametHttpError(400, `limit must be between 1 and ${max}`);
  return value;
}
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
