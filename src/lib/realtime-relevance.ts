/**
 * Which live events are worth a refetch. The server announces every finished background
 * job; reacting to all of them made each open device reload its transactions every couple
 * of seconds while nothing had changed.
 */
type LiveEvent = { topic?: unknown; eventType?: unknown; payload?: unknown };

const MONEY_JOBS = /CLOSING|LEDGER|JOURNAL|POST|SETTLE|PAYMENT|BANK|RECONCIL|INVOICE|RECEIPT/;

function fields(detail: unknown) {
  if (!detail || typeof detail !== "object") return null;
  const { topic, eventType, payload } = detail as LiveEvent;
  return {
    topic: typeof topic === "string" ? topic : "",
    eventType: typeof eventType === "string" ? eventType : "",
    payload: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
  };
}

/**
 * The transaction snapshot only changes through transaction commands, which announce the
 * new revision. Background jobs never move it, and a revision we already hold needs nothing.
 */
export function changesTransactions(detail: unknown, knownRevision: number) {
  const event = fields(detail);
  if (!event) return true;
  if (event.topic === "workers") return false;
  if (event.topic === "transactions") {
    const revision = event.payload["revision"];
    return !(typeof revision === "number" && revision <= knownRevision);
  }
  return true;
}

/** Documents and figures can follow money jobs (payments, posting), but not other jobs. */
export function changesRecords(detail: unknown) {
  const event = fields(detail);
  if (!event) return true;
  if (event.topic === "workers") return MONEY_JOBS.test(event.eventType);
  return true;
}
