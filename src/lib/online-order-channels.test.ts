import { describe, expect, it } from "vitest";
import type { OrderChannelDefinition } from "@/platform/types";
import { resolveOnlineOrderChannel, usesOnlinePrice } from "./online-order-channels";

const channel: OrderChannelDefinition = {
  id: "custom-channel",
  tenantId: "restaurant",
  code: "CUSTOM",
  displayName: "My custom channel",
  channelType: "OTHER",
  enabled: true,
  requiresCustomer: false,
  requiresTable: false,
  requiresAddress: false,
  isExternallyPaid: false,
  sortOrder: 1,
  metadata: { useOnlinePrice: true },
};

describe("Online Orders channel eligibility", () => {
  it.each([
    "DINE_IN",
    "TAKEAWAY",
    "KIOSK",
    "MARKETPLACE",
    "OWN_DELIVERY",
    "WEB",
    "QR",
    "PHONE",
    "WHATSAPP",
    "OTHER",
  ] as const)("uses the saved flag, not the %s channel type", (channelType) => {
    const configured = { ...channel, channelType };
    expect(resolveOnlineOrderChannel([configured], channel.code)).toEqual(configured);
    expect(
      resolveOnlineOrderChannel(
        [{ ...configured, metadata: { useOnlinePrice: false } }],
        channel.code,
      ),
    ).toBeUndefined();
  });

  it("accepts stored IDs, codes and legacy display names without provider name lists", () => {
    for (const value of [channel.id, channel.code, channel.displayName])
      expect(resolveOnlineOrderChannel([channel], value)).toEqual(channel);
    expect(resolveOnlineOrderChannel([channel], "Unknown")).toBeUndefined();
  });

  it("excludes disabled, missing and malformed settings", () => {
    expect(resolveOnlineOrderChannel([{ ...channel, enabled: false }], channel.id)).toBeUndefined();
    expect(usesOnlinePrice(undefined)).toBe(false);
    for (const useOnlinePrice of [undefined, false, "true", "false", 1, null]) {
      const configured = { ...channel, metadata: { useOnlinePrice } };
      expect(resolveOnlineOrderChannel([configured], channel.id)).toBeUndefined();
    }
  });

  it("does not misclassify an off channel whose code matches another channel's name", () => {
    const off = { ...channel, metadata: { useOnlinePrice: false } };
    const on = { ...channel, id: "other-id", code: "OTHER", displayName: channel.code };
    expect(resolveOnlineOrderChannel([on, off], channel.code)).toBeUndefined();
  });

  it("reflects setting changes without modifying historical orders", () => {
    const orders = [{ id: "existing-order", channel: channel.code, total: 900 }];
    const select = (configured: OrderChannelDefinition) =>
      orders.filter((order) => resolveOnlineOrderChannel([configured], order.channel));
    expect(select(channel)).toHaveLength(1);
    expect(select({ ...channel, metadata: { useOnlinePrice: false } })).toHaveLength(0);
    expect(select(channel)).toHaveLength(1);
    expect(orders).toEqual([{ id: "existing-order", channel: channel.code, total: 900 }]);
  });
});
