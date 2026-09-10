export const offlineAllowedCommands = new Set([
  "holdOrder",
  "createOrder",
  "sendToKitchen",
  "recordCashPayment",
  "updateOrderDraft",
  "upsertOrderDraft",
  "upsertAndSendKitchen",
  "requestBillWithDraft",
  "prepareInvoiceForPayment",
  "applyConfiguredPayment",
] as const);

export type OfflineAllowedCommand =
  | "holdOrder"
  | "createOrder"
  | "sendToKitchen"
  | "recordCashPayment"
  | "updateOrderDraft"
  | "upsertOrderDraft"
  | "upsertAndSendKitchen"
  | "requestBillWithDraft"
  | "prepareInvoiceForPayment"
  | "applyConfiguredPayment";

export type OfflineCommandStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";

export type OfflineCommand = {
  id: string;
  tenantId: string;
  branchId: string;
  deviceId: string;
  actorId: string;
  commandType: OfflineAllowedCommand;
  payload: unknown;
  createdAt: string;
  clientSequence: number;
  idempotencyKey: string;
  syncStatus: OfflineCommandStatus;
  correlationId: string;
  localEffects?: {
    kotPrinted?: boolean;
    receiptPrinted?: boolean;
  };
  error?: string;
};

export type OfflineConflict = {
  commandId: string;
  code: string;
  resolution: "SERVER_WINS" | "CLIENT_RETRY" | "MANAGER_REVIEW" | "MERGE";
  message: string;
};
