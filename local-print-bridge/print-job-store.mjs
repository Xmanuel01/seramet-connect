import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export class PrintJobStore {
  constructor(path, { maxPending = 100, maxJobs = 10000 } = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, printer TEXT NOT NULL,
      stage TEXT NOT NULL, payload TEXT NOT NULL, outcome TEXT, recovery_id TEXT,
      updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, stage TEXT NOT NULL,
      code TEXT NOT NULL, at TEXT NOT NULL);`);
    this.maxPending = maxPending;
    this.maxJobs = maxJobs;
    // A process exit during transmission cannot establish non-delivery.
    this.db.exec(
      "UPDATE jobs SET stage='UNCERTAIN', outcome='CRASH_DURING_SEND' WHERE stage='TRANSMITTING'",
    );
  }
  enqueue(job) {
    const id = job.id;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          tenantId: job.tenantId,
          branchId: job.branchId,
          printer: job.target,
          documentType: job.documentType,
          content: job.content,
          profile: job.profile,
        }),
      )
      .digest("hex");
    const existing = this.get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("ALTERED_JOB_IDENTITY");
      return existing;
    }
    if (
      this.db.prepare("SELECT COUNT(*) n FROM jobs WHERE stage IN ('QUEUED','TRANSMITTING')").get()
        .n >= this.maxPending ||
      this.db.prepare("SELECT COUNT(*) n FROM jobs").get().n >= this.maxJobs
    ) {
      throw new Error("QUEUE_CAPACITY_REACHED");
    }
    this.db
      .prepare("INSERT INTO jobs VALUES (?,?,?,'QUEUED',?,NULL,NULL,?)")
      .run(
        id,
        fingerprint,
        `${job.tenantId}:${job.branchId}:${job.target.id}`,
        JSON.stringify(job),
        new Date().toISOString(),
      );
    this.record(id, "QUEUED", "ACCEPTED");
    return this.get(id);
  }
  get(id) {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  }
  pending() {
    return this.db.prepare("SELECT * FROM jobs WHERE stage='QUEUED' ORDER BY rowid").all();
  }
  history(id) {
    return this.db.prepare("SELECT stage,code,at FROM attempts WHERE job_id=? ORDER BY id").all(id);
  }
  claim(id) {
    return (
      this.db
        .prepare("UPDATE jobs SET stage='TRANSMITTING',updated_at=? WHERE id=? AND stage='QUEUED'")
        .run(new Date().toISOString(), id).changes === 1
    );
  }
  record(id, stage, code) {
    this.db
      .prepare("INSERT INTO attempts(job_id,stage,code,at) VALUES (?,?,?,?)")
      .run(id, stage, code, new Date().toISOString());
    this.db
      .prepare("UPDATE jobs SET stage=?,outcome=?,updated_at=? WHERE id=?")
      .run(stage, code, new Date().toISOString(), id);
  }
  retry(id, recoveryId) {
    const row = this.get(id);
    if (
      !row ||
      !["NOT_SENT", "UNCERTAIN"].includes(row.stage) ||
      !recoveryId ||
      row.recovery_id === recoveryId
    ) {
      throw new Error("RETRY_REQUIRES_NEW_AUTHORIZATION");
    }
    if (this.history(id).filter((a) => a.stage === "QUEUED").length >= 3)
      throw new Error("RETRY_LIMIT_REACHED");
    this.db.prepare("UPDATE jobs SET recovery_id=? WHERE id=?").run(recoveryId, id);
    this.record(id, "QUEUED", "AUTHORIZED_RETRY");
  }
  close() {
    this.db.close();
  }
}
