import { describe, expect, it } from "vitest";
import {
  MENU_IMPORT_TEMPLATE_VERSION,
  createCanonicalMenuTemplate,
  resolveMenuImportHeader,
} from "@/onboarding/menu-import-schema";

describe("menu import online pricing contract", () => {
  it("includes explicit online pricing fields without treating marketplace as a price rule", () => {
    expect(MENU_IMPORT_TEMPLATE_VERSION).toBe(3);
    const template = createCanonicalMenuTemplate();
    expect(template).toContain("basePrice,onlinePrice,currency");
    expect(template).toContain("channels,onlinePriceChannels,prepMinutes");
  });

  it("accepts friendly aliases for online price imports", () => {
    expect(resolveMenuImportHeader("online price")).toBe("onlinePrice");
    expect(resolveMenuImportHeader("digital price")).toBe("onlinePrice");
    expect(resolveMenuImportHeader("online price channels")).toBe("onlinePriceChannels");
  });
});
