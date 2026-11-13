import { describe, expect, it } from "vitest";
import { isStaleBuildError } from "@/lib/stale-build-recovery";

describe("stale build recovery", () => {
  it("recognises a page whose code was replaced by a deploy", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://pos.seramet.co.ke/assets/pos-abc123.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/index-1a2b.css",
      "Expected a JavaScript module script but the server responded with a MIME type of 'text/html'. 'text/html' is not a valid JavaScript MIME type.",
    ])
      expect(isStaleBuildError(new TypeError(message)), message).toBe(true);
    expect(isStaleBuildError(Object.assign(new Error("x"), { name: "ChunkLoadError" }))).toBe(true);
  });

  it("leaves ordinary failures to the error screen", () => {
    expect(isStaleBuildError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleBuildError(new Error("Failed to fetch"))).toBe(false);
    expect(isStaleBuildError(undefined)).toBe(false);
  });
});
