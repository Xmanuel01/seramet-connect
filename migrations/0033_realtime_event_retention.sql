-- Real-time events are short-lived notices (each carries a 24-hour expiry), but the
-- append-only guard blocked every delete, so they were never cleaned up and filled the
-- database. Events that expire may now be deleted; an event without an expiry stays
-- permanent. The application only deletes events whose expiry has passed.
DROP TRIGGER IF EXISTS realtime_event_no_delete;

CREATE TRIGGER realtime_event_no_delete
BEFORE DELETE ON realtime_events
WHEN OLD.expires_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'real-time event history is append-only');
END;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(33,'realtime_event_retention','realtime-event-retention-0033-v1',CURRENT_TIMESTAMP);
