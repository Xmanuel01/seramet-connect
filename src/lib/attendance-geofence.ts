/**
 * Privacy-preserving, fail-closed geofence policy for an employee's explicit
 * attendance punch. This module does not trust client-side checks as authorization.
 * The API must authenticate the employee and resolve branch coordinates from
 * server-controlled configuration before calling this validator.
 */
export type AttendanceFix = Readonly<{
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}>;
export type BranchGeofence = Readonly<{
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maximumAccuracyMeters: number;
  maximumFixAgeSeconds: number;
}>;
export type GeofenceDecision =
  | { allowed: true; distanceMeters: number; accuracyMeters: number }
  | {
      allowed: false;
      reason: "INVALID_FIX" | "STALE_FIX" | "LOW_ACCURACY" | "OUTSIDE_GEOFENCE";
      distanceMeters?: number;
    };

const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function distanceMeters(
  a: Pick<AttendanceFix, "latitude" | "longitude">,
  b: Pick<AttendanceFix, "latitude" | "longitude">,
): number {
  const deltaLatitude = radians(b.latitude - a.latitude);
  const deltaLongitude = radians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}
const coordinatesValid = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180;

export function evaluateAttendanceGeofence(
  fix: AttendanceFix,
  branch: BranchGeofence,
  nowMs: number = Date.now(),
): GeofenceDecision {
  if (
    !coordinatesValid(fix.latitude, fix.longitude) ||
    !coordinatesValid(branch.latitude, branch.longitude) ||
    !Number.isFinite(fix.accuracyMeters) ||
    fix.accuracyMeters < 0 ||
    !Number.isFinite(branch.radiusMeters) ||
    branch.radiusMeters < 1 ||
    !Number.isFinite(branch.maximumAccuracyMeters) ||
    branch.maximumAccuracyMeters <= 0 ||
    !Number.isFinite(branch.maximumFixAgeSeconds) ||
    branch.maximumFixAgeSeconds <= 0 ||
    !Number.isFinite(nowMs)
  ) {
    return { allowed: false, reason: "INVALID_FIX" };
  }
  const capturedMs = Date.parse(fix.capturedAt);
  if (
    !Number.isFinite(capturedMs) ||
    capturedMs > nowMs + 2000 ||
    nowMs - capturedMs > branch.maximumFixAgeSeconds * 1000
  ) {
    return { allowed: false, reason: "STALE_FIX" };
  }
  if (fix.accuracyMeters > branch.maximumAccuracyMeters) {
    return { allowed: false, reason: "LOW_ACCURACY" };
  }
  const distance = distanceMeters(fix, branch);
  // The reported position must fall inside the radius. Requiring the whole accuracy circle
  // to fit rejected almost every indoor phone (20-50 m accuracy); the maximum accuracy
  // setting is what bounds how vague a fix may be.
  if (distance > branch.radiusMeters) {
    return { allowed: false, reason: "OUTSIDE_GEOFENCE", distanceMeters: distance };
  }
  return { allowed: true, distanceMeters: distance, accuracyMeters: fix.accuracyMeters };
}
