import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SqliteD1TestDatabase,
  migrationFiles,
  applyPendingMigrations,
} from "./database/sqlite-test-adapter";

describe("attendance 28 to 29 compatibility", () => {
  it("retains existing identities, events and unknown historical schedules", () => {
    const db = new SqliteD1TestDatabase();
    try {
      for (const file of migrationFiles.filter((file) => Number(file.slice(0, 4)) <= 28))
        db.sqlite.exec(readFileSync(resolve("migrations", file), "utf8"));
      db.sqlite
        .exec(`INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,created_at,updated_at) VALUES('t','t','T','T','KES','Africa/Nairobi','en-KE','2026-10-18','2026-10-18');
        INSERT INTO branches(tenant_id,id,code,name,timezone) VALUES('t','b','B','Branch','Africa/Nairobi');
        INSERT INTO users(tenant_id,id,name,created_at,updated_at) VALUES('t','u','Employee','2026-10-18','2026-10-18');
        INSERT INTO employee_attendance_sessions(tenant_id,id,user_id,branch_id,business_date,clock_in_at,clock_in_key,clock_in_source,created_at,updated_at) VALUES('t','s','u','b','2026-10-18','2026-10-18T05:00:00Z','key','SUPERVISOR','2026-10-18','2026-10-18');
        INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,at) VALUES('t','e','s','u','SUPERVISOR_CLOCK_IN','key','original-hash',1,'2026-10-18');`);
      const before = db.sqlite.prepare("SELECT * FROM employee_attendance_events").get();
      applyPendingMigrations(db);
      expect(db.sqlite.prepare("SELECT * FROM employee_attendance_events").get()).toEqual(before);
      expect(
        db.sqlite
          .prepare(
            "SELECT id,clock_in_key,scheduled_end,schedule_timezone FROM employee_attendance_sessions",
          )
          .get(),
      ).toMatchObject({
        id: "s",
        clock_in_key: "key",
        scheduled_end: null,
        schedule_timezone: null,
      });
      expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() =>
        db.sqlite.exec("UPDATE employee_attendance_events SET request_hash='tampered'"),
      ).toThrow(/append-only/);
      applyPendingMigrations(db);
      expect(
        db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_sessions").get()?.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
