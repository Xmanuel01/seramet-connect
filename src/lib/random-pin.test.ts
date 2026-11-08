import { describe, expect, it } from "vitest";
import { randomPin } from "@/lib/random-pin";

describe("randomPin", () => {
  it("gives six digits the server accepts", () => {
    for (let i = 0; i < 2_000; i += 1) {
      const pin = randomPin();
      expect(pin).toMatch(/^\d{6}$/);
      expect("01234567890123456789".includes(pin)).toBe(false);
      expect("98765432109876543210".includes(pin)).toBe(false);
      expect(new Set(pin).size).toBeGreaterThan(1);
    }
  });
});
