-- Dedicated authenticated employee attendance. Never interpret legacy employee
-- snapshots as verified geofenced punches.
CREATE TABLE attendance_geofences (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  latitude REAL,
  longitude REAL,
  radius_m REAL NOT NULL DEFAULT 10 CHECK(radius_m BETWEEN 10 AND 500),
  max_accuracy_m REAL NOT NULL DEFAULT 8 CHECK(max_accuracy_m BETWEEN 1 AND 100),
  max_fix_age_seconds INTEGER NOT NULL DEFAULT 30 CHECK(max_fix_age_seconds BETWEEN 5 AND 120),
  grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK(grace_minutes BETWEEN 0 AND 120),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,branch_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK ((latitude IS NULL AND longitude IS NULL) OR
    (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE TABLE attendance_shift_assignments (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scheduled_start TEXT CHECK(scheduled_start IS NULL OR
    (LENGTH(scheduled_start)=5 AND scheduled_start GLOB '[0-2][0-9]:[0-5][0-9]')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(tenant_id,branch_id,user_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE employee_attendance_sessions (
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
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,user_id,business_date),
  UNIQUE(tenant_id,user_id,clock_in_key),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK(clock_out_at IS NULL OR clock_out_at>=clock_in_at)
);
CREATE UNIQUE INDEX uq_attendance_clock_out_key
  ON employee_attendance_sessions(tenant_id,user_id,clock_out_key)
  WHERE clock_out_key IS NOT NULL;
CREATE INDEX idx_attendance_branch_date
  ON employee_attendance_sessions(tenant_id,branch_id,business_date,user_id);
CREATE TABLE employee_attendance_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('CLOCK_IN','CLOCK_OUT','SUPERVISOR_CLOCK_IN','SUPERVISOR_CLOCK_OUT','CORRECT_IN','CORRECT_OUT')),
  request_key TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL,
  accuracy_m REAL,
  distance_m REAL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,actor_id,request_key),
  FOREIGN KEY(tenant_id,session_id) REFERENCES employee_attendance_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX idx_attendance_events_session ON employee_attendance_events(tenant_id,session_id,at);
CREATE TRIGGER attendance_events_no_update BEFORE UPDATE ON employee_attendance_events
BEGIN SELECT RAISE(ABORT,'attendance event history is append-only'); END;
CREATE TRIGGER attendance_events_no_delete BEFORE DELETE ON employee_attendance_events
BEGIN SELECT RAISE(ABORT,'attendance event history is append-only'); END;
-- POSTGRES_ONLY: ALTER TABLE attendance_geofences ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE attendance_shift_assignments ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE employee_attendance_sessions ENABLE ROW LEVEL SECURITY;
-- POSTGRES_ONLY: ALTER TABLE employee_attendance_events ENABLE ROW LEVEL SECURITY;
-- All writes go through server-authenticated, tenant-scoped APIs; no direct user Data API policies.
INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(28,'geofenced_employee_attendance','geofenced-attendance-0028-v1',CURRENT_TIMESTAMP);
