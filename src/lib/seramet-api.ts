import {
  DarajaMpesaProvider,
  TendePayProvider,
  createPaymentIntentForProvider,
} from "@/lib/payment-providers";
import {
  SerametHttpError,
  authenticateSerametRequest,
  authorizeBranchRead,
  authorizeSerametMutation,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import {
  applyServerMutation,
  createTransactionRepository,
  type TransactionRepository,
} from "@/lib/seramet-repository";
import { TransactionEngine, type TransactionState } from "@/lib/transaction-engine";

type MutationRequest = {
  action?: string;
  payload?: unknown;
  idempotencyKey?: string;
};

type SnapshotReplaceRequest = {
  state?: TransactionState;
  idempotencyKey?: string;
};

const systemActor: ServerActor = {
  id: "provider-webhook",
  name: "Provider Webhook",
  role: "General Manager",
  branch: "All Branches",
};

export async function handleSerametApiRequest(request: Request, env: SerametEnv) {
  env = env ?? {};
  const repo = createTransactionRepository(env.SERAMET_DB);
  await repo.migrate();
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/seramet/health" && request.method === "GET") {
      return json({
        ok: true,
        database: env.SERAMET_DB ? "d1" : "memory",
        providerMode: providerMode(env),
      });
    }

    if (url.pathname === "/api/seramet/transactions" && request.method === "GET") {
      return await getTransactions(request, env, repo);
    }

    if (url.pathname === "/api/seramet/transactions" && request.method === "PUT") {
      return await replaceTransactions(request, env, repo);
    }

    if (url.pathname === "/api/seramet/transactions/mutate" && request.method === "POST") {
      return await mutateTransactions(request, env, repo);
    }

    if (url.pathname === "/api/seramet/payments/mpesa/stk" && request.method === "POST") {
      return await createMpesaStk(request, env, repo);
    }

    if (url.pathname === "/api/seramet/payments/mpesa/qr" && request.method === "POST") {
      return await createMpesaQr(request, env, repo);
    }

    if (url.pathname === "/api/seramet/webhooks/mpesa/stk" && request.method === "POST") {
      return await receiveMpesaWebhook(request, env, repo);
    }

    if (url.pathname === "/api/seramet/webhooks/tendepay" && request.method === "POST") {
      return await receiveTendePayWebhook(request, env, repo);
    }

    if (url.pathname === "/api/seramet/webhooks/card" && request.method === "POST") {
      return await receiveExternalPaymentWebhook(
        request,
        env.SERAMET_CARD_WEBHOOK_SECRET,
        "Card Acquirer",
        repo,
      );
    }

    if (url.pathname === "/api/seramet/webhooks/bank" && request.method === "POST") {
      return await receiveExternalPaymentWebhook(
        request,
        env.SERAMET_BANK_WEBHOOK_SECRET,
        "Bank Feed",
        repo,
      );
    }

    return json({ ok: false, message: "Seramet API route not found" }, 404);
  } catch (error) {
    if (error instanceof SerametHttpError)
      return json({ ok: false, message: error.message }, error.status);
    console.error(error);
    return json({ ok: false, message: "Seramet API failure" }, 500);
  }
}

async function getTransactions(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = authenticateSerametRequest(request, env);
  const state = await repo.loadState();
  const branch = new URL(request.url).searchParams.get("branch") ?? actor.branch;
  authorizeBranchRead(actor, branch);
  return json({ ok: true, state: filterStateForActor(state, actor) });
}

async function replaceTransactions(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = authenticateSerametRequest(request, env);
  const body = await readJson<SnapshotReplaceRequest>(request);
  if (!body.state) throw new SerametHttpError(400, "Missing transaction state");
  authorizeSerametMutation(actor, "replaceState");
  const current = await repo.loadState();
  assertBranchSafeSnapshotReplace(current, body.state, actor);
  const stateToSave = mergeSnapshotForActor(current, body.state, actor);

  const requestHash = await hashJson(body.state);
  const idempotencyKey = body.idempotencyKey ?? request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const cached = await loadCachedIdempotency(repo, idempotencyKey, requestHash);
    if (cached) return cached;
  }

  await repo.saveState(stateToSave, actor, "Snapshot replace through Seramet API");
  const response = { ok: true, state: filterStateForActor(stateToSave, actor) };
  if (idempotencyKey)
    await saveIdempotency(repo, idempotencyKey, actor, "replaceState", requestHash, response);
  return json(response);
}

async function mutateTransactions(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = authenticateSerametRequest(request, env);
  const body = await readJson<MutationRequest>(request);
  if (!body.action) throw new SerametHttpError(400, "Missing transaction action");
  if (!body.idempotencyKey)
    throw new SerametHttpError(400, "Production mutations require an idempotencyKey");
  const current = await repo.loadState();
  const branches = branchesForAction(current, body.action, body.payload);
  branches.forEach((branch) => authorizeSerametMutation(actor, body.action!, branch));
  if (branches.length === 0) authorizeSerametMutation(actor, body.action);

  const requestHash = await hashJson({ action: body.action, payload: body.payload });
  const cached = await loadCachedIdempotency(repo, body.idempotencyKey, requestHash);
  if (cached) return cached;

  const next = applyServerMutation(current, body.action, body.payload, actor);
  assertBranchSafeSnapshotReplace(current, next, actor);
  await repo.saveState(next, actor, `Mutation ${body.action}`);
  const response = { ok: true, state: filterStateForActor(next, actor) };
  await saveIdempotency(repo, body.idempotencyKey, actor, body.action, requestHash, response);
  return json(response);
}

async function createMpesaStk(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = authenticateSerametRequest(request, env);
  const body = await readJson<{
    invoiceId?: string;
    amount?: number;
    customerPhone?: string;
    idempotencyKey?: string;
  }>(request);
  if (!body.invoiceId || !body.amount || !body.customerPhone || !body.idempotencyKey) {
    throw new SerametHttpError(
      400,
      "invoiceId, amount, customerPhone and idempotencyKey are required",
    );
  }
  const current = await repo.loadState();
  const bill = current.bills.find((item) => item.id === body.invoiceId);
  if (!bill) throw new SerametHttpError(404, "Invoice not found");
  authorizeSerametMutation(actor, "createPaymentIntent", bill.branch);
  const requestHash = await hashJson(body);
  const cached = await loadCachedIdempotency(repo, body.idempotencyKey, requestHash);
  if (cached) return cached;

  const created = createPaymentIntentForProvider(
    current,
    bill.id,
    "MPESA_PROMPT",
    body.amount,
    actor.name,
    body.customerPhone,
  );
  const intent = created.intent;
  if (!intent) throw new SerametHttpError(400, "Could not create payment intent");
  const provider = new DarajaMpesaProvider(env);
  const result = await provider.createPrompt(intent, body.customerPhone);
  let next = created.state;
  if (result.ok) {
    next = {
      ...next,
      paymentIntents: next.paymentIntents.map((item) =>
        item.id === intent.id
          ? { ...item, externalReference: result.providerReference, status: "AWAITING_CUSTOMER" }
          : item,
      ),
    };
    await repo.saveState(next, actor, "Created M-Pesa STK payment intent");
  }
  const response = {
    ok: result.ok,
    provider: result,
    intent: next.paymentIntents.find((item) => item.id === intent.id),
    state: filterStateForActor(next, actor),
  };
  await saveIdempotency(repo, body.idempotencyKey, actor, "mpesaStk", requestHash, response);
  return json(response, result.ok ? 200 : 424);
}

async function createMpesaQr(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = authenticateSerametRequest(request, env);
  const body = await readJson<{ invoiceId?: string; amount?: number; idempotencyKey?: string }>(
    request,
  );
  if (!body.invoiceId || !body.amount || !body.idempotencyKey) {
    throw new SerametHttpError(400, "invoiceId, amount and idempotencyKey are required");
  }
  const current = await repo.loadState();
  const bill = current.bills.find((item) => item.id === body.invoiceId);
  if (!bill) throw new SerametHttpError(404, "Invoice not found");
  authorizeSerametMutation(actor, "createPaymentIntent", bill.branch);
  const requestHash = await hashJson(body);
  const cached = await loadCachedIdempotency(repo, body.idempotencyKey, requestHash);
  if (cached) return cached;

  const created = createPaymentIntentForProvider(
    current,
    bill.id,
    "MPESA_QR",
    body.amount,
    actor.name,
  );
  const intent = created.intent;
  if (!intent) throw new SerametHttpError(400, "Could not create payment intent");
  const provider = new DarajaMpesaProvider(env);
  const result = await provider.createQr(intent);
  let next = created.state;
  if (result.ok) {
    next = {
      ...next,
      paymentIntents: next.paymentIntents.map((item) =>
        item.id === intent.id
          ? { ...item, externalReference: result.providerReference, status: "PENDING" }
          : item,
      ),
    };
    await repo.saveState(next, actor, "Created M-Pesa QR payment intent");
  }
  const response = {
    ok: result.ok,
    provider: result,
    intent: next.paymentIntents.find((item) => item.id === intent.id),
    state: filterStateForActor(next, actor),
  };
  await saveIdempotency(repo, body.idempotencyKey, actor, "mpesaQr", requestHash, response);
  return json(response, result.ok ? 200 : 424);
}

async function receiveMpesaWebhook(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const secret = env.SERAMET_MPESA_WEBHOOK_SECRET;
  const urlSecret = new URL(request.url).searchParams.get("secret");
  if (
    secret &&
    request.headers.get("x-seramet-webhook-secret") !== secret &&
    urlSecret !== secret
  ) {
    throw new SerametHttpError(401, "Invalid M-Pesa webhook secret");
  }
  const payload = await readJson<unknown>(request);
  const parsed = new DarajaMpesaProvider(env).parseWebhook(payload);
  if (!parsed.ok) throw new SerametHttpError(400, parsed.message);
  await repo.appendProviderEvent({
    id: `mpesa-${parsed.intentReference ?? parsed.reference}`,
    provider: parsed.provider,
    eventType: parsed.eventType,
    externalReference: parsed.reference,
    payloadJson: JSON.stringify(payload),
    receivedAt: new Date().toISOString(),
    processed: parsed.status === "SUCCEEDED",
  });
  const current = await repo.loadState();
  const intent = current.paymentIntents.find(
    (item) =>
      item.externalReference === parsed.intentReference ||
      item.externalReference === parsed.reference,
  );
  if (parsed.status === "SUCCEEDED" && intent) {
    const next = TransactionEngine.confirmPaymentIntent(
      current,
      intent.id,
      parsed.reference,
      "M-Pesa Callback",
    );
    await repo.saveState(next, systemActor, "Processed M-Pesa STK callback");
    return json({ ok: true, matchedIntentId: intent.id, state: next });
  }
  return json({ ok: true, matchedIntentId: intent?.id, status: parsed.status });
}

async function receiveTendePayWebhook(
  request: Request,
  env: SerametEnv,
  repo: TransactionRepository,
) {
  assertSharedSecret(request, env.SERAMET_TENDEPAY_WEBHOOK_SECRET, "TendePay");
  const payload = await readJson<unknown>(request);
  const parsed = new TendePayProvider(env).parseWebhook(payload);
  if (!parsed.ok) throw new SerametHttpError(400, parsed.message);
  await repo.appendProviderEvent({
    id: `tendepay-${parsed.reference}`,
    provider: parsed.provider,
    eventType: parsed.eventType,
    externalReference: parsed.reference,
    payloadJson: JSON.stringify(payload),
    receivedAt: new Date().toISOString(),
    processed: parsed.status === "SUCCEEDED",
  });
  return json({ ok: true, event: parsed });
}

async function receiveExternalPaymentWebhook(
  request: Request,
  secret: string | undefined,
  provider: string,
  repo: TransactionRepository,
) {
  assertSharedSecret(request, secret, provider);
  const payload = await readJson<{
    reference?: string;
    amount?: number;
    branch?: string;
    account?: string;
    status?: string;
    description?: string;
    metadata?: Record<string, string>;
  }>(request);
  if (!payload.reference || !payload.amount)
    throw new SerametHttpError(400, "reference and amount are required");
  await repo.appendProviderEvent({
    id: `${provider.toLowerCase().replace(/\W+/g, "-")}-${payload.reference}`,
    provider,
    eventType: "TRANSACTION",
    externalReference: payload.reference,
    payloadJson: JSON.stringify(payload),
    receivedAt: new Date().toISOString(),
    processed: payload.status === "success" || payload.status === "settled",
  });
  const current = await repo.loadState();
  const next = TransactionEngine.importExternalTransaction(current, {
    provider,
    sourceAccount: payload.account ?? provider,
    destination: "Seramet Operating Account",
    branch: payload.branch,
    amount: payload.amount,
    direction: "INBOUND",
    currency: "KES",
    reference: payload.reference,
    timestamp: new Date().toISOString(),
    description: payload.description ?? `${provider} transaction`,
    providerMetadata: payload.metadata ?? {},
  });
  await repo.saveState(next, systemActor, `Imported ${provider} webhook transaction`);
  return json({ ok: true, state: next });
}

function branchesForAction(state: TransactionState, action: string, payload: unknown) {
  const input = payload as Record<string, unknown> | undefined;
  const branches = new Set<string>();
  if (!input) return [];
  const draft = input.draft as { branch?: string } | undefined;
  const nestedInput = input.input as
    { branch?: string; invoiceId?: string; orderId?: string } | undefined;
  if (draft?.branch) branches.add(draft.branch);
  if (nestedInput?.branch) branches.add(nestedInput.branch);
  const invoiceId = String(input.invoiceId ?? "");
  const orderId = String(input.orderId ?? "");
  const billId = String(input.billId ?? "");
  const refundId = String(input.refundId ?? "");
  const drawerId = String(input.drawerId ?? "");
  const externalTransactionId = String(input.externalTransactionId ?? "");
  const paymentId = String(input.paymentId ?? "");
  if (invoiceId) addBranch(branches, state.bills.find((item) => item.id === invoiceId)?.branch);
  if (billId) addBranch(branches, state.bills.find((item) => item.id === billId)?.branch);
  if (orderId) addBranch(branches, state.orders.find((item) => item.id === orderId)?.branch);
  if (refundId) addBranch(branches, state.refunds.find((item) => item.id === refundId)?.branch);
  if (drawerId) addBranch(branches, state.cashDrawers.find((item) => item.id === drawerId)?.branch);
  if (externalTransactionId)
    addBranch(
      branches,
      state.externalTransactions.find((item) => item.id === externalTransactionId)?.branch,
    );
  if (paymentId) addBranch(branches, state.payments.find((item) => item.id === paymentId)?.branch);
  if (nestedInput?.invoiceId)
    addBranch(branches, state.bills.find((item) => item.id === nestedInput.invoiceId)?.branch);
  if (nestedInput?.orderId)
    addBranch(branches, state.orders.find((item) => item.id === nestedInput.orderId)?.branch);
  (input.billIds as string[] | undefined)?.forEach((id) =>
    addBranch(branches, state.bills.find((item) => item.id === id)?.branch),
  );
  if (action === "replaceState") return [];
  return [...branches];
}

function addBranch(branches: Set<string>, branch?: string) {
  if (branch) branches.add(branch);
}

function assertBranchSafeSnapshotReplace(
  current: TransactionState,
  next: TransactionState,
  actor: ServerActor,
) {
  if (actor.role === "General Manager" || actor.branch === "All Branches") return;
  const touchedOutsideBranch = (rows: { branch?: string }[]) =>
    rows.some((row) => row.branch !== undefined && row.branch !== actor.branch);
  const directRows = [
    ...next.orders,
    ...next.bills,
    ...next.paymentIntents,
    ...next.payments,
    ...next.receipts,
    ...next.externalTransactions,
    ...next.journalEntries,
    ...next.cashDrawers,
    ...next.refunds,
    ...next.auditEvents,
  ];
  if (directRows.length > 0 && touchedOutsideBranch(directRows)) {
    const before = JSON.stringify(branchRestrictedSnapshot(current, actor.branch, false));
    const after = JSON.stringify(branchRestrictedSnapshot(next, actor.branch, false));
    if (before !== after)
      throw new SerametHttpError(403, `Actor cannot change records outside ${actor.branch}`);
  }
}

function mergeSnapshotForActor(
  current: TransactionState,
  next: TransactionState,
  actor: ServerActor,
): TransactionState {
  if (actor.role === "General Manager" || actor.branch === "All Branches") return next;
  const merge = <T extends { branch?: string }>(currentRows: T[], nextRows: T[]) => [
    ...nextRows.filter((row) => row.branch === actor.branch || row.branch === undefined),
    ...currentRows.filter((row) => row.branch !== actor.branch && row.branch !== undefined),
  ];
  return {
    orders: merge(current.orders, next.orders),
    bills: merge(current.bills, next.bills),
    paymentIntents: merge(current.paymentIntents, next.paymentIntents),
    payments: merge(current.payments, next.payments),
    receipts: merge(current.receipts, next.receipts),
    externalTransactions: merge(current.externalTransactions, next.externalTransactions),
    reconciliationMatches: current.reconciliationMatches,
    journalEntries: merge(current.journalEntries, next.journalEntries),
    cashDrawers: merge(current.cashDrawers, next.cashDrawers),
    refunds: merge(current.refunds, next.refunds),
    auditEvents: merge(current.auditEvents, next.auditEvents),
  };
}

function branchRestrictedSnapshot(
  state: TransactionState,
  branch: string,
  includeBranch: boolean,
): TransactionState {
  const keep = <T extends { branch?: string }>(rows: T[]) =>
    rows.filter((row) =>
      includeBranch
        ? row.branch === branch || row.branch === undefined
        : row.branch !== branch && row.branch !== undefined,
    );
  return {
    orders: keep(state.orders),
    bills: keep(state.bills),
    paymentIntents: keep(state.paymentIntents),
    payments: keep(state.payments),
    receipts: keep(state.receipts),
    externalTransactions: keep(state.externalTransactions),
    reconciliationMatches: state.reconciliationMatches,
    journalEntries: keep(state.journalEntries),
    cashDrawers: keep(state.cashDrawers),
    refunds: keep(state.refunds),
    auditEvents: keep(state.auditEvents),
  };
}

function filterStateForActor(state: TransactionState, actor: ServerActor): TransactionState {
  if (actor.role === "General Manager" || actor.branch === "All Branches") return state;
  return branchRestrictedSnapshot(state, actor.branch, true);
}

async function loadCachedIdempotency(
  repo: TransactionRepository,
  key: string,
  requestHash: string,
) {
  const cached = await repo.getIdempotency(key);
  if (!cached) return null;
  if (cached.requestHash !== requestHash)
    throw new SerametHttpError(409, "Idempotency key reused with a different request");
  return json(JSON.parse(cached.responseJson), 200, { "x-seramet-idempotent-replay": "true" });
}

async function saveIdempotency(
  repo: TransactionRepository,
  key: string,
  actor: ServerActor,
  action: string,
  requestHash: string,
  response: unknown,
) {
  await repo.saveIdempotency({
    key,
    actorId: actor.id,
    action,
    requestHash,
    responseJson: JSON.stringify(response),
    createdAt: new Date().toISOString(),
  });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
}

async function hashJson(value: unknown) {
  const text = JSON.stringify(value);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSharedSecret(request: Request, secret: string | undefined, provider: string) {
  if (!secret) return;
  if (request.headers.get("x-seramet-webhook-secret") !== secret) {
    throw new SerametHttpError(401, `Invalid ${provider} webhook secret`);
  }
}

function providerMode(env: SerametEnv) {
  return {
    mpesa: env.SERAMET_MPESA_CONSUMER_KEY ? (env.SERAMET_MPESA_ENV ?? "sandbox") : "missing-config",
    tendepay: env.SERAMET_TENDEPAY_API_KEY ? "configured" : "missing-config",
    card: env.SERAMET_CARD_WEBHOOK_SECRET ? "webhook-secret-configured" : "missing-config",
    bank: env.SERAMET_BANK_WEBHOOK_SECRET ? "webhook-secret-configured" : "missing-config",
  };
}

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
