-- One record per outbound email job, for diagnosing delivery: category, sender identity,
-- recipient, Brevo's message id, and what Brevo later reported (delivered, bounced, blocked).
-- The job and its retry state stay in worker_jobs. No message bodies, attachments, links,
-- passwords or one-time codes are stored here. Rows older than 400 days are pruned.
CREATE TABLE email_delivery_log (
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  category TEXT NOT NULL,
  sender_identity TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'BREVO',
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('SENDING','ACCEPTED','DELIVERED','DEFERRED','BOUNCED',
    'BLOCKED','COMPLAINED','RATE_LIMITED','REJECTED','UNKNOWN')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  accepted_at TEXT,
  delivered_at TEXT,
  last_event TEXT,
  last_event_at TEXT,
  failure_reason TEXT,
  PRIMARY KEY (tenant_id, job_id)
);

CREATE INDEX IF NOT EXISTS email_delivery_log_message_idx
  ON email_delivery_log (provider_message_id);
CREATE INDEX IF NOT EXISTS email_delivery_log_created_idx
  ON email_delivery_log (created_at);
CREATE INDEX IF NOT EXISTS email_delivery_log_tenant_idx
  ON email_delivery_log (tenant_id, status, created_at);

-- Only the server reads and writes this table, through platform-administrator APIs. With RLS on
-- and no policies, Supabase's Data API cannot read it as anon or authenticated.
-- POSTGRES_ONLY: ALTER TABLE email_delivery_log ENABLE ROW LEVEL SECURITY;

-- Platform-wide email records are for Seramet platform administrators only. Like
-- platform.tenants.provision, these are never part of a restaurant owner's permissions.
INSERT INTO permissions (code,description) VALUES
  ('platform.email.view','View platform-wide email delivery records')
ON CONFLICT(code) DO NOTHING;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(35,'email_delivery_log','email-delivery-log-0035-v1',CURRENT_TIMESTAMP);
