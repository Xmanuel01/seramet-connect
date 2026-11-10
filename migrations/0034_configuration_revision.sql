-- Each server caches restaurant configuration (branches, payment methods, roles, devices...).
-- Any configuration change bumps this shared revision, so servers reload only when something
-- actually changed instead of every few seconds and on every sale.
CREATE TABLE configuration_revisions (
  scope TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

INSERT INTO configuration_revisions (scope,revision,updated_at)
VALUES ('platform',1,CURRENT_TIMESTAMP);

-- Indexes for the history cleanup (succeeded jobs by age, events by expiry) and for lookups of
-- one restaurant's jobs by type: the daily-summary check and the close-readiness check.
CREATE INDEX IF NOT EXISTS worker_jobs_status_created_idx ON worker_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS worker_jobs_tenant_type_idx
  ON worker_jobs (tenant_id, job_type, status, created_at);
CREATE INDEX IF NOT EXISTS realtime_events_expiry_idx ON realtime_events (expires_at);

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(34,'configuration_revision','configuration-revision-0034-v1',CURRENT_TIMESTAMP);
