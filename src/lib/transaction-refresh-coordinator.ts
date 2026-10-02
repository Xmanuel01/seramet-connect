/**
 * Bounds realtime/focus refreshes to one active request and one trailing request.
 * The injected clock and scheduler make event storms, slow servers and teardown
 * deterministically testable without network requests.
 */
export function createTransactionRefreshCoordinator<Timer>(options: {
  refresh: () => Promise<unknown>;
  now: () => number;
  schedule: (run: () => void, delay: number) => Timer;
  cancel: (timer: Timer) => void;
  minIntervalMs?: number;
}) {
  const minInterval = options.minIntervalMs ?? 2_000;
  let timer: Timer | undefined;
  let lastStarted = Number.NEGATIVE_INFINITY;
  let running = false;
  let queued = false;
  let stopped = false;

  const schedule = () => {
    if (stopped || running || !queued || timer !== undefined) return;
    const elapsed = options.now() - lastStarted;
    const delay = Math.max(300, minInterval - elapsed);
    timer = options.schedule(() => void run(), delay);
  };

  const run = async () => {
    timer = undefined;
    if (stopped || running || !queued) return;
    queued = false;
    running = true;
    lastStarted = options.now();
    try {
      await options.refresh();
    } finally {
      running = false;
      if (!stopped) schedule();
    }
  };

  return {
    request() {
      if (stopped) return;
      queued = true;
      schedule();
    },
    stop() {
      stopped = true;
      queued = false;
      if (timer !== undefined) options.cancel(timer);
      timer = undefined;
    },
  };
}

/** Unsynchronized local commands own their optimistic branch snapshot.
 * A background server read may update connectivity but must not replace it.
 */
export function mayApplyRemoteSnapshot(input: {
  sameScope: boolean;
  inFlightMutations: number;
  pendingLocalCommands: number;
  nextRevision: number;
  currentRevision: number;
}): boolean {
  return (
    input.sameScope &&
    input.inFlightMutations === 0 &&
    input.pendingLocalCommands === 0 &&
    input.nextRevision >= input.currentRevision
  );
}

/** Browser storage is optional for an online authoritative session. */
export async function readOptionalOfflineSnapshot<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** A brief disappearing server row must not reset draft hydration for the selected order. */
export function shouldHydratePosOrder(input: {
  selectedOrderId: string | null;
  availableOrderId: string | null;
  hydratedScopeOrderKey: string | null;
  currentScope: string;
}): boolean {
  return Boolean(
    input.selectedOrderId &&
    input.availableOrderId === input.selectedOrderId &&
    input.hydratedScopeOrderKey !== `${input.currentScope}:${input.selectedOrderId}`,
  );
}
