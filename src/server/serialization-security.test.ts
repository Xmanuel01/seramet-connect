import { atob } from "node:buffer";
import { runInNewContext } from "node:vm";
import { serialize } from "seroval";
import { describe, expect, it } from "vitest";

describe("server-rendered state serialization security", () => {
  it("does not execute a typed array's own constructor name", () => {
    const value = new Uint8Array([1, 2, 3]);
    Object.defineProperty(value, "constructor", {
      value: { name: "Uint8Array([7]);globalThis.serametInjected=true;//" },
      configurable: true,
    });
    const context: Record<string, unknown> = { atob };
    const restored: Uint8Array = runInNewContext(serialize(value), context);
    expect(context.serametInjected).toBeUndefined();
    expect(Array.from(restored)).toEqual([1, 2, 3]);
  });

  it("does not emit an HTML script terminator from a regular expression", () => {
    const value = new RegExp("[</script><script>]");
    const output = serialize(value);
    expect(output.toLowerCase()).not.toContain("</script");
    const restored: RegExp = runInNewContext(output);
    expect(restored.source).toBe(value.source);
    expect(restored.flags).toBe(value.flags);
  });

  it("preserves ordinary required values, leading zero PINs and financial values", () => {
    const value = {
      name: "QA Owner",
      pin: "012345",
      amount: 1250,
      zero: 0,
      enabled: false,
      empty: "",
      date: new Date("2026-10-29T00:00:00.000Z"),
    };
    const restored: typeof value = runInNewContext(serialize(value));
    expect({ ...restored, date: restored.date.toISOString() }).toEqual({
      ...value,
      date: value.date.toISOString(),
    });
  });
});
