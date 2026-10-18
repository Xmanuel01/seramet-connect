CREATE TABLE attendance_delay_requests (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, branch_id TEXT NOT NULL, user_id TEXT NOT NULL,
  business_date TEXT NOT NULL, expected_arrival_at TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  version INTEGER NOT NULL DEFAULT 1, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_note TEXT,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,user_id,request_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,decided_by) REFERENCES users(tenant_id,id)
);
CREATE UNIQUE INDEX uq_delay_pending ON attendance_delay_requests(tenant_id,user_id,branch_id,business_date) WHERE status='PENDING';
CREATE INDEX idx_delay_inbox ON attendance_delay_requests(tenant_id,branch_id,created_at);
CREATE TABLE attendance_delay_events (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('SUBMITTED','APPROVED','REJECTED')),
  version INTEGER NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  note TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_id,version), UNIQUE(tenant_id,actor_id,request_key),
  FOREIGN KEY(tenant_id,request_id) REFERENCES attendance_delay_requests(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER delay_events_no_update BEFORE UPDATE ON attendance_delay_events
BEGIN SELECT RAISE(ABORT,'delay history is append-only'); END;
CREATE TRIGGER delay_events_no_delete BEFORE DELETE ON attendance_delay_events
BEGIN SELECT RAISE(ABORT,'delay history is append-only'); END;
CREATE TABLE attendance_delay_reads (
  tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,request_id,user_id),
  FOREIGN KEY(tenant_id,request_id) REFERENCES attendance_delay_requests(tenant_id,id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE employee_account_invitations (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  email TEXT NOT NULL, request_key TEXT NOT NULL, branches_json TEXT NOT NULL,
  provider_subject TEXT, status TEXT NOT NULL CHECK(status IN ('PREPARING','PENDING','ACCEPTING','ACCEPTED','REVOKED','FAILED')),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,actor_id,request_key),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE UNIQUE INDEX uq_employee_account_pending ON employee_account_invitations(tenant_id,user_id) WHERE status IN ('PREPARING','PENDING','ACCEPTING');
CREATE TABLE employee_station_access (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  station_ids_json TEXT NOT NULL, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,user_id,branch_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,updated_by) REFERENCES users(tenant_id,id)
);
-- POSTGRES_ONLY: ALTER TABLE attendance_delay_requests ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE attendance_delay_events ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE attendance_delay_reads ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE employee_account_invitations ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE employee_station_access ENABLE ROW LEVEL SECURITY;
CREATE TABLE staff_access_events (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  version INTEGER NOT NULL, actor_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  event_type TEXT NOT NULL, at TEXT NOT NULL, details_json TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,entity_type,entity_id,version),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TRIGGER staff_access_events_no_update BEFORE UPDATE ON staff_access_events
BEGIN SELECT RAISE(ABORT,'staff access history is append-only'); END;
CREATE TRIGGER staff_access_events_no_delete BEFORE DELETE ON staff_access_events
BEGIN SELECT RAISE(ABORT,'staff access history is append-only'); END;
-- POSTGRES_ONLY: ALTER TABLE staff_access_events ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(30,'staff_pilot_workflows','staff-pilot-0030-v1',CURRENT_TIMESTAMP);
