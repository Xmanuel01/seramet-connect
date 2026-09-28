import { describe, expect, it } from "vitest";
import {
  INITIAL_POS_MENU_ITEMS,
  shouldLoadNextPosMenuPage,
  visiblePosMenuItems,
} from "./pos-menu-view";

describe("POS compact progressive menu", () => {
  const items = Array.from({ length: 345 }, (_, i) => i + 1);
  it("mounts at most 20 menu cards before interaction while retaining the full searchable catalogue", () => {
    expect(visiblePosMenuItems(items, INITIAL_POS_MENU_ITEMS)).toEqual(items.slice(0, 20));
    expect(visiblePosMenuItems(items, 40).length).toBe(40);
    expect(items[300]).toBe(301);
  });
  it("only extends near the scroll end and never beyond the category's item count", () => {
    expect(
      shouldLoadNextPosMenuPage({
        scrollTop: 0,
        scrollHeight: 900,
        clientHeight: 400,
        displayed: 20,
        total: 345,
      }),
    ).toBe(false);
    expect(
      shouldLoadNextPosMenuPage({
        scrollTop: 365,
        scrollHeight: 900,
        clientHeight: 400,
        displayed: 20,
        total: 345,
      }),
    ).toBe(true);
    expect(
      shouldLoadNextPosMenuPage({
        scrollTop: 365,
        scrollHeight: 900,
        clientHeight: 400,
        displayed: 20,
        total: 20,
      }),
    ).toBe(false);
    expect(visiblePosMenuItems(items.slice(0, 7), 20)).toHaveLength(7);
  });
});
