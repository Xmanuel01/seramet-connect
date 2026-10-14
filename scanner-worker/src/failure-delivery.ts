export async function persistScannerFailure(
  message: { ack(): void; retry(options: { delaySeconds: number }): void },
  report: () => Promise<void>,
) {
  try {
    await report();
  } catch {
    // Queue retry limits route an unreported failure to the DLQ for recovery.
    message.retry({ delaySeconds: 300 });
    return;
  }
  message.ack();
}
