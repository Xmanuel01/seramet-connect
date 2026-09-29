import type { AppRole } from "@/lib/app-context";

export type ServerActor = {
  id: string;
  name: string;
  role: AppRole;
  branch: string;
  tokenId?: string;
};

export type SerametEnv = {
  SERAMET_DB?: D1Database;
  SERAMET_API_TOKENS?: string;
  SERAMET_REQUIRE_BEARER?: string;
  SERAMET_MPESA_ENV?: "sandbox" | "production";
  SERAMET_MPESA_CONSUMER_KEY?: string;
  SERAMET_MPESA_CONSUMER_SECRET?: string;
  SERAMET_MPESA_SHORTCODE?: string;
  SERAMET_MPESA_PASSKEY?: string;
  SERAMET_MPESA_CALLBACK_URL?: string;
  SERAMET_MPESA_WEBHOOK_SECRET?: string;
  SERAMET_MPESA_QR_CPI?: string;
  SERAMET_MPESA_QR_MERCHANT_NAME?: string;
  SERAMET_TENDEPAY_BASE_URL?: string;
  SERAMET_TENDEPAY_API_KEY?: string;
  SERAMET_TENDEPAY_WEBHOOK_SECRET?: string;
  SERAMET_CARD_WEBHOOK_SECRET?: string;
  SERAMET_BANK_WEBHOOK_SECRET?: string;
};

export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch?: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

const mutationPolicies: Record<string, AppRole[]> = {
  holdOrder: ["General Manager", "Branch Manager", "Cashier"],
  createOrder: ["General Manager", "Branch Manager", "Cashier"],
  sendToKitchen: ["General Manager", "Branch Manager", "Cashier"],
  releaseHeldOrder: ["General Manager", "Branch Manager", "Cashier"],
  createOpenBill: ["General Manager", "Branch Manager", "Cashier"],
  createPaymentIntent: ["General Manager", "Branch Manager", "Cashier"],
  confirmPaymentIntent: ["General Manager", "Branch Manager", "Accountant"],
  recordManualTillPayment: ["General Manager", "Branch Manager", "Cashier", "Accountant"],
  recordCashPayment: ["General Manager", "Branch Manager", "Cashier"],
  recordCardPayment: ["General Manager", "Branch Manager", "Cashier", "Accountant"],
  recordBankPayment: ["General Manager", "Branch Manager", "Accountant"],
  applyPayment: ["General Manager", "Branch Manager", "Accountant"],
  mergeBills: ["General Manager", "Branch Manager"],
  splitBill: ["General Manager", "Branch Manager", "Cashier"],
  cancelOrder: ["General Manager", "Branch Manager"],
  requestRefund: ["General Manager", "Branch Manager", "Cashier"],
  approveRefund: ["General Manager", "Branch Manager"],
  importExternalTransaction: ["General Manager", "Accountant"],
  suggestReconciliation: ["General Manager", "Accountant"],
  manuallyReconcile: ["General Manager", "Accountant"],
  closeCashDrawer: ["General Manager", "Branch Manager", "Accountant"],
  replaceState: ["General Manager", "Branch Manager", "Accountant", "Cashier"],
};

export class SerametHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function authenticateSerametRequest(request: Request, env: SerametEnv): ServerActor {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token) {
    const configured = parseTokenConfig(env.SERAMET_API_TOKENS);
    const actor = configured[token];
    if (!actor) throw new SerametHttpError(401, "Invalid Seramet API token");
    return actor;
  }

  if (env.SERAMET_REQUIRE_BEARER === "true") {
    throw new SerametHttpError(401, "Bearer token required");
  }

  const devAuth = request.headers.get("x-seramet-dev-auth");
  if (devAuth !== "enabled") throw new SerametHttpError(401, "Missing Seramet authorization");
  return {
    id: request.headers.get("x-seramet-user-id") ?? "dev-user",
    name: request.headers.get("x-seramet-user") ?? "Amina W.",
    role: normalizeRole(request.headers.get("x-seramet-role")),
    branch: request.headers.get("x-seramet-branch") ?? "Westlands",
  };
}

export function authorizeSerametMutation(actor: ServerActor, action: string, branch?: string) {
  const allowed = mutationPolicies[action];
  if (!allowed) throw new SerametHttpError(400, `Unknown transaction action: ${action}`);
  if (!allowed.includes(actor.role)) {
    throw new SerametHttpError(403, `${actor.role} cannot perform ${action}`);
  }
  if (
    branch &&
    actor.branch !== "All Branches" &&
    branch !== actor.branch &&
    actor.role !== "General Manager"
  ) {
    throw new SerametHttpError(403, `Actor cannot mutate ${branch} records from ${actor.branch}`);
  }
}

export function authorizeBranchRead(actor: ServerActor, branch?: string) {
  if (!branch || branch === "All Branches") return;
  if (actor.branch === "All Branches" || actor.branch === branch) return;
  if (actor.role === "General Manager") return;
  throw new SerametHttpError(403, `Actor cannot read ${branch} records from ${actor.branch}`);
}

function parseTokenConfig(raw?: string) {
  if (!raw) return {} as Record<string, ServerActor>;
  try {
    return JSON.parse(raw) as Record<string, ServerActor>;
  } catch {
    throw new SerametHttpError(500, "SERAMET_API_TOKENS must be valid JSON");
  }
}

function normalizeRole(value: string | null): AppRole {
  const roles: AppRole[] = [
    "General Manager",
    "Branch Manager",
    "Accountant",
    "Storekeeper",
    "Chef",
    "Cashier",
  ];
  return roles.find((role) => role === value) ?? "Cashier";
}
