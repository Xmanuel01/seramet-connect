export class PrintJobRunner {
  constructor(store, deliver, concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
      throw new Error("INVALID_CONCURRENCY");
    this.store = store;
    this.deliver = deliver;
    this.concurrency = concurrency;
    this.active = new Set();
    this.tasks = new Set();
    this.stopped = false;
  }
  pump() {
    if (this.stopped) return;
    for (const row of this.store.pending()) {
      if (this.tasks.size >= this.concurrency) break;
      const job = JSON.parse(row.payload);
      // All TCP aliases share one lane. DNS aliases and address changes cannot
      // evade serialization; Windows queues retain their own independent lanes.
      const keys = [job.target, job.fallbackTarget]
        .filter(Boolean)
        .map((target) =>
          target.transport === "TCP"
            ? "TCP:SERIAL"
            : JSON.stringify([
                target.transport,
                target.host,
                target.port ?? 9100,
                target.osPrinterName,
              ]),
        );
      if (keys.some((key) => this.active.has(key)) || !this.store.claim(row.id)) continue;
      keys.forEach((key) => this.active.add(key));
      const task = Promise.resolve()
        .then(() => this.deliver(job))
        .then((outcome) => this.store.record(row.id, outcome.stage, outcome.code))
        .catch(() => this.store.record(row.id, "UNCERTAIN", "TRANSPORT_UNCONFIRMED"))
        .finally(() => {
          this.tasks.delete(task);
          keys.forEach((key) => this.active.delete(key));
          this.pump();
        });
      this.tasks.add(task);
    }
  }
  async stop() {
    this.stopped = true;
    await Promise.all([...this.tasks]);
  }
}
