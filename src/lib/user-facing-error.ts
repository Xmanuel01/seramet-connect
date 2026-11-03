// Turns anything thrown while loading or saving into a sentence a restaurant
// operator can act on. Technical detail (status codes, stack traces, internal
// names) stays in the console; the screen only ever shows plain language.

/** A message written for the person using the app, safe to show as is. */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

/** A failed HTTP request. `message` is the server's own `message`, if any. */
export class RequestError extends Error {
  override name = "RequestError";
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

// Words and shapes that mark a message as written for developers, not operators.
const TECHNICAL =
  /\b(error|exception|undefined|null|nan|sql|sqlite|postgres|schema|stack|fetch|json|payload|idempoten\w*|authoritative|backend|endpoint|api|adapter|status \d+|typeerror|referenceerror)\b|[{}<>`=]|\w+\(\)|[A-Z]{2,}_[A-Z0-9_]{2,}/i;

function plain(message: string) {
  const text = message.trim();
  return text.length >= 3 && text.length <= 200 && !/\n/.test(text) && !TECHNICAL.test(text);
}

function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof RequestError) return error.httpStatus;
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
  return typeof status === "number" ? status : undefined;
}

function offline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** True for a request cancelled because the page moved on; never shown or logged. */
export function isAbort(error: unknown) {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}

/**
 * The sentence to show for `error`. `fallback` says what failed in the page's
 * own words, e.g. "Couldn't record the payment. Try again."
 */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) return error.message;
  const status = httpStatusOf(error);
  if (status === 401) return "Your session ended. Sign in again.";
  if (status === 403) return "You don't have access to this. Ask an owner or manager.";
  if (status === 429) return "Too many requests at once. Wait a moment, then try again.";
  // The fetch helper tags some network failures with a status (503), so check
  // the connection before trusting any other status.
  if (offline()) return "You're offline. Reconnect, then try again.";
  // Business rules (already paid, amount too high, period closed) come back as
  // 400/409/422 with a message meant for the operator.
  const serverMessage = (error as { serverMessage?: unknown } | null)?.serverMessage;
  const detail =
    typeof serverMessage === "string" ? serverMessage : error instanceof Error ? error.message : "";
  if ((status === 400 || status === 409 || status === 422) && plain(detail)) return detail.trim();
  if ((error as { name?: unknown } | null)?.name === "TimeoutError")
    return "This is taking longer than usual. Try again.";
  return fallback;
}

/** Logs the technical detail for support and returns the sentence to show. */
export function reportError(error: unknown, fallback: string): string {
  if (!(error instanceof UserFacingError) && !isAbort(error)) console.error(error);
  return userMessage(error, fallback);
}
