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
      const key = JSON.stringify([
        job.target.transport,
        job.target.host,
        job.target.port ?? 9100,
        job.target.osPrinterName,
      ]);
      if (this.active.has(key) || !this.store.claim(row.id)) continue;
      this.store.record(row.id, "TRANSMITTING", "ATTEMPT_STARTED");
      this.active.add(key);
      const task = Promise.resolve()
        .then(() => this.deliver(job))
        .then((outcome) => this.store.record(row.id, outcome.stage, outcome.code))
        .catch(() => this.store.record(row.id, "UNCERTAIN", "TRANSPORT_UNCONFIRMED"))
        .finally(() => {
          this.tasks.delete(task);
          this.active.delete(key);
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
