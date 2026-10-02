import { describe, expect, it } from "vitest";
import { parseRealtimeCursor } from "./realtime-api";

describe("SSE reconnect resume cursor", () => {
  const cursor = "2026-09-29T12:00:00.000Z|123e4567-e89b-12d3-a456-426614174000";

  it("parses the exact last delivered event without widening the replay window", () => {
    expect(parseRealtimeCursor(cursor)).toEqual({
      after: "2026-09-29T12:00:00.000Z",
      afterId: "123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("rejects malformed timestamps, unknown IDs and oversized input", () => {
    expect(parseRealtimeCursor(null)).toBeNull();
    expect(parseRealtimeCursor("arbitrary")).toBeNull();
    expect(parseRealtimeCursor("invalid|123e4567-e89b-12d3-a456-426614174000")).toBeNull();
    expect(parseRealtimeCursor("2026-09-29T12:00:00.000Z|not-a-uuid")).toBeNull();
    expect(parseRealtimeCursor("x".repeat(200))).toBeNull();
  });
});
