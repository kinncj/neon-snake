import { test, expect } from "@playwright/test";

test("a black full-viewport canvas that resizes with the window", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  const box = await page.locator("#display").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBe(800);
  expect(box!.height).toBe(600);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(0, 0, 0)");

  await page.setViewportSize({ width: 1200, height: 700 });
  await page.waitForTimeout(50);
  const box2 = await page.locator("#display").boundingBox();
  expect(box2!.width).toBe(1200);
  expect(box2!.height).toBe(700);
  const backing = await page.evaluate(() => {
    const c = document.getElementById("display") as HTMLCanvasElement;
    return [c.width, c.height, window.devicePixelRatio];
  });
  expect(backing[0]).toBe(Math.round(1200 * backing[2]!));
  expect(backing[1]).toBe(Math.round(700 * backing[2]!));
});
