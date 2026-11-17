import { describe, expect, it } from "vitest";
import { posMenuPrice } from "./pos-menu-pricing";
import type { Product } from "./menu-product";

const item: Product = {
  id: "pilau",
  name: "Beef Pilau",
  category: "PILAU",
  prep: 0,
  price: 900,
  priceMinor: 90_000,
  onlinePriceMinor: 109_000,
  currency: "KES",
};
const channel = (enabled: boolean) => ({
  metadata: { useOnlinePrice: enabled, priceMultiplier: 1.08 },
});

describe("POS configured channel prices", () => {
  it("uses the exact saved online price for any opted-in channel, without a multiplier", () => {
    expect(posMenuPrice(item, channel(true), "Rooftop", "KES")).toEqual({
      price: 1090,
      priceMinor: 109_000,
      currency: "KES",
    });
  });
  it("switches back to normal pricing when the channel setting is off or absent", () => {
    for (const selected of [channel(false), { metadata: {} }, undefined])
      expect(posMenuPrice(item, selected, "Rooftop", "KES").price).toBe(900);
  });
  it("uses the normal branch override only when online pricing is off or missing", () => {
    const branchItem = { ...item, branchPrices: { Rooftop: 950 } };
    expect(posMenuPrice(branchItem, channel(true), "Rooftop", "KES").price).toBe(1090);
    expect(posMenuPrice(branchItem, channel(false), "Rooftop", "KES").price).toBe(950);
    expect(
      posMenuPrice({ ...branchItem, onlinePriceMinor: undefined }, channel(true), "Rooftop", "KES")
        .price,
    ).toBe(950);
  });
  it("preserves explicit zero online prices and minor-unit precision", () => {
    expect(
      posMenuPrice({ ...item, onlinePriceMinor: 0 }, channel(true), "Rooftop", "KES").price,
    ).toBe(0);
    expect(
      posMenuPrice({ ...item, onlinePriceMinor: 109_025 }, channel(true), "Rooftop", "KES").price,
    ).toBe(1090.25);
    expect(
      posMenuPrice(
        { ...item, currency: "KWD", onlinePriceMinor: 1234 },
        channel(true),
        "Rooftop",
        "KES",
      ).price,
    ).toBe(1.234);
  });
  it("does not accept malformed online prices", () => {
    for (const onlinePriceMinor of [-1, NaN, Infinity, 100.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        posMenuPrice({ ...item, onlinePriceMinor }, channel(true), "Rooftop", "KES").price,
      ).toBe(900);
  });
});
