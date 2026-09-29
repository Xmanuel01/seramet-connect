export type LegacyWebhookAlias = {
  providerCode: string;
  mode: "ADAPTER" | "EXTERNAL_TRANSACTION";
};

export type LegacyWebhookEnvironment = {
  SERAMET_CARD_WEBHOOK_SECRET?: string;
  SERAMET_BANK_WEBHOOK_SECRET?: string;
};

const aliases = new Map<string, LegacyWebhookAlias>([
  ["/api/seramet/webhooks/mpesa/stk", { providerCode: "DARAJA", mode: "ADAPTER" }],
  ["/api/seramet/webhooks/tendepay", { providerCode: "TENDEPAY", mode: "ADAPTER" }],
  ["/api/seramet/webhooks/card", { providerCode: "CARD_ACQUIRER", mode: "EXTERNAL_TRANSACTION" }],
  ["/api/seramet/webhooks/bank", { providerCode: "BANK_FEED", mode: "EXTERNAL_TRANSACTION" }],
]);

export function resolveLegacyWebhookAlias(pathname: string) {
  return aliases.get(pathname);
}

export function resolveLegacyWebhookSecret(
  alias: LegacyWebhookAlias,
  env: LegacyWebhookEnvironment,
) {
  if (alias.providerCode === "CARD_ACQUIRER") return env.SERAMET_CARD_WEBHOOK_SECRET;
  if (alias.providerCode === "BANK_FEED") return env.SERAMET_BANK_WEBHOOK_SECRET;
  return undefined;
}
