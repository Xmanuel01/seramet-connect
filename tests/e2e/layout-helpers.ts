import { expect, type Page } from "@playwright/test";

export async function expectFitsViewport(page: Page) {
  const layout = await page.evaluate(() => ({
    // Compare integer DOM dimensions; WebKit truncates innerWidth under Windows scaling.
    viewport: document.documentElement.clientWidth,
    windowInnerWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.getAttribute("class"),
          left: rect.left,
          right: rect.right,
        };
      })
      .filter((rect) => rect.left < 0 || rect.right > document.documentElement.clientWidth)
      .slice(0, 12),
  }));
  expect(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
}
