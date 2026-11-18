/** One Uber Eats connection per branch; its id is stable so saving again updates it. */
export const uberConnectionId = (branchId: string) => `uber-eats-${branchId}`;

/** Where Uber sends order events for a connection. */
export function uberWebhookUrl(connectionId: string, origin: string) {
  return `${origin}/api/seramet/integrations/webhooks/UBER_EATS/${encodeURIComponent(connectionId)}`;
}
