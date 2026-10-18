const active = new Map<string, Promise<void>>();

/** All mounted readers share a replay lock; Web Locks also serialize browser tabs. */
export function serializeOfflineReplay(scope: string, run: () => Promise<void>): Promise<void> {
  const existing = active.get(scope);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(async () => {
      if (typeof navigator !== "undefined" && navigator.locks)
        await navigator.locks.request(`seramet-replay:${scope}`, async () => {
          await run();
        });
      else await run();
    })
    .finally(() => {
      if (active.get(scope) === promise) active.delete(scope);
    });
  active.set(scope, promise);
  return promise;
}
