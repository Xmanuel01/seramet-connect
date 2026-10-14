/** Cancellation saves work; the scope/generation check also rejects late responses
 * from transports that complete despite cancellation. */
export function createScopedReadGuard(currentScope: () => string) {
  let active: AbortController | undefined;
  return {
    begin(scope: string) {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      return {
        signal: controller.signal,
        isCurrent: () =>
          active === controller && !controller.signal.aborted && currentScope() === scope,
      };
    },
    cancel() {
      active?.abort();
      active = undefined;
    },
  };
}
