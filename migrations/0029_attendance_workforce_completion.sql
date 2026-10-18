-- Preserve migration 28 and all existing punch/event identities. Rebuild only
-- these two attendance tables transactionally to permit genuine split shifts.
CREATE TABLE employee_attendance_sessions_v2 (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  clock_in_key TEXT NOT NULL,
  clock_out_key TEXT,
  minutes_late INTEGER,
  clock_in_source TEXT NOT NULL CHECK(clock_in_source IN ('GEOFENCE','SUPERVISOR')),
  clock_out_source TEXT CHECK(clock_out_source IN ('GEOFENCE','SUPERVISOR')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opened_revision INTEGER NOT NULL DEFAULT 0,
  scheduled_start TEXT,
  scheduled_end TEXT,
  rest_day INTEGER,
  grace_minutes INTEGER,
  schedule_timezone TEXT,
  schedule_cutoff_minutes INTEGER,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,user_id,clock_in_key),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK(clock_out_at IS NULL OR clock_out_at>=clock_in_at)
);
-- POSTGRES_ONLY: ALTER TABLE employee_attendance_sessions_v2 ENABLE ROW LEVEL SECURITY;
INSERT INTO employee_attendance_sessions_v2 SELECT employee_attendance_sessions.*,0,NULL,NULL,NULL,NULL,NULL,NULL FROM employee_attendance_sessions;
CREATE TABLE employee_attendance_events_v2 (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('CLOCK_IN','CLOCK_OUT','SUPERVISOR_CLOCK_IN','SUPERVISOR_CLOCK_OUT','CORRECT_IN','CORRECT_OUT','EXPLAIN')),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL CHECK(session_version>0),
  reason TEXT,
  at TEXT NOT NULL,
  accuracy_m REAL,
  distance_m REAL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,actor_id,request_key),
  UNIQUE(tenant_id,session_id,session_version),
  FOREIGN KEY(tenant_id,session_id) REFERENCES employee_attendance_sessions_v2(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
-- POSTGRES_ONLY: ALTER TABLE employee_attendance_events_v2 ENABLE ROW LEVEL SECURITY;
INSERT INTO employee_attendance_events_v2 SELECT * FROM employee_attendance_events;
DROP TABLE employee_attendance_events;
DROP TABLE employee_attendance_sessions;
ALTER TABLE employee_attendance_sessions_v2 RENAME TO employee_attendance_sessions;
ALTER TABLE employee_attendance_events_v2 RENAME TO employee_attendance_events;
CREATE UNIQUE INDEX uq_attendance_clock_out_key ON employee_attendance_sessions(tenant_id,user_id,clock_out_key) WHERE clock_out_key IS NOT NULL;
CREATE UNIQUE INDEX uq_attendance_open_session ON employee_attendance_sessions(tenant_id,user_id) WHERE clock_out_at IS NULL;
CREATE INDEX idx_attendance_branch_date ON employee_attendance_sessions(tenant_id,branch_id,business_date,user_id);
CREATE INDEX idx_attendance_events_session ON employee_attendance_events(tenant_id,session_id,at);
CREATE TRIGGER attendance_events_no_update BEFORE UPDATE ON employee_attendance_events
BEGIN SELECT RAISE(ABORT,'attendance event history is append-only'); END;
CREATE TRIGGER attendance_events_no_delete BEFORE DELETE ON employee_attendance_events
BEGIN SELECT RAISE(ABORT,'attendance event history is append-only'); END;

ALTER TABLE attendance_shift_assignments ADD COLUMN scheduled_end TEXT;
ALTER TABLE attendance_shift_assignments ADD COLUMN rest_day INTEGER NOT NULL DEFAULT 0 CHECK(rest_day IN (0,1));

CREATE TABLE attendance_employee_versions (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,user_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE attendance_mutation_claims (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY(tenant_id,user_id,version),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,event_id) REFERENCES employee_attendance_events(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER attendance_claims_no_update BEFORE UPDATE ON attendance_mutation_claims
BEGIN SELECT RAISE(ABORT,'attendance mutation claims are append-only'); END;
CREATE TRIGGER attendance_claims_no_delete BEFORE DELETE ON attendance_mutation_claims
BEGIN SELECT RAISE(ABORT,'attendance mutation claims are append-only'); END;
CREATE TABLE attendance_access_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type='TIMESHEET_EXPORT'),
  at TEXT NOT NULL,
  details_json TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER attendance_access_no_update BEFORE UPDATE ON attendance_access_events
BEGIN SELECT RAISE(ABORT,'attendance access history is append-only'); END;
CREATE TRIGGER attendance_access_no_delete BEFORE DELETE ON attendance_access_events
BEGIN SELECT RAISE(ABORT,'attendance access history is append-only'); END;
-- POSTGRES_ONLY: ALTER TABLE attendance_employee_versions ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE attendance_mutation_claims ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE attendance_access_events ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(29,'attendance_workforce_completion','attendance-workforce-0029-v1',CURRENT_TIMESTAMP);
