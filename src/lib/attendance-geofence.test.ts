import { describe, expect, it } from "vitest";
import { distanceMeters, evaluateAttendanceGeofence } from "./attendance-geofence";
const now = Date.parse("2026-10-16T12:00:00.000Z");
const branch = { latitude: -1.264, longitude: 36.806, radiusMeters: 10, maximumAccuracyMeters: 8, maximumFixAgeSeconds: 30 };
const fix = { latitude: branch.latitude, longitude: branch.longitude, accuracyMeters: 3, capturedAt: new Date(now).toISOString() };
describe("attendance geofence", () => {
  it("accepts a fresh accurate fix inside the radius", () => expect(evaluateAttendanceGeofence(fix, branch, now).allowed).toBe(true));
  it("rejects a location beyond the radius", () => expect(evaluateAttendanceGeofence({ ...fix, latitude: fix.latitude + 0.001 }, branch, now).allowed).toBe(false));
  it("rejects stale fixes", () => expect(evaluateAttendanceGeofence({ ...fix, capturedAt: new Date(now - 31000).toISOString() }, branch, now)).toMatchObject({ reason: "STALE_FIX" }));
  it("rejects future timestamps", () => expect(evaluateAttendanceGeofence({ ...fix, capturedAt: new Date(now + 5000).toISOString() }, branch, now)).toMatchObject({ reason: "STALE_FIX" }));
  it("rejects inaccurate fixes", () => expect(evaluateAttendanceGeofence({ ...fix, accuracyMeters: 15 }, branch, now)).toMatchObject({ reason: "LOW_ACCURACY" }));
  it("rejects uncertainty that extends outside the radius", () => expect(evaluateAttendanceGeofence({ ...fix, accuracyMeters: 8, latitude: fix.latitude + 0.00005 }, branch, now)).toMatchObject({ reason: "OUTSIDE_GEOFENCE" }));
  it("rejects invalid coordinates", () => expect(evaluateAttendanceGeofence({ ...fix, latitude: 100 }, branch, now)).toMatchObject({ reason: "INVALID_FIX" }));
  it("rejects malformed policy", () => expect(evaluateAttendanceGeofence(fix, { ...branch, radiusMeters: 0 }, now)).toMatchObject({ reason: "INVALID_FIX" }));
  it("computes zero distance for identical coordinates", () => expect(distanceMeters(fix, branch)).toBe(0));
});
