import { test, expect } from "@playwright/test";
import { ready, snakeState } from "./snake-debug";

test.use({ hasTouch: true, viewport: { width: 420, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

/** Dispatches a synthetic swipe as touchstart/touchmove/touchend on the display canvas. */
async function swipe(page: import("@playwright/test").Page, dx: number, dy: number): Promise<boolean> {
  return page.evaluate(([mx, my]) => {
    const el = document.getElementById("display")!;
    if (typeof TouchEvent === "undefined" || typeof Touch === "undefined") return false;
    const mk = (type: string, x: number, y: number) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      return new TouchEvent(type, { touches: type === "touchend" ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true });
    };
    el.dispatchEvent(mk("touchstart", 200, 400));
    el.dispatchEvent(mk("touchmove", 200 + mx! / 2, 400 + my! / 2));
    el.dispatchEvent(mk("touchmove", 200 + mx!, 400 + my!));
    el.dispatchEvent(mk("touchend", 200 + mx!, 400 + my!));
    return true;
  }, [dx, dy]);
}

test("a swipe steers: dominant axis, one intent per gesture", async ({ page }) => {
  const ok = await swipe(page, 5, -60);
  test.skip(!ok, "synthetic TouchEvent unsupported in this engine");
  await page.waitForFunction(() => window.__snake.state().dir === 3, null, { timeout: 2000 });
  await swipe(page, -70, 8);
  await page.waitForFunction(() => window.__snake.state().dir === 2, null, { timeout: 2000 });
});

test("a short drag below the threshold does nothing", async ({ page }) => {
  const ok = await swipe(page, 0, -12);
  test.skip(!ok, "synthetic TouchEvent unsupported in this engine");
  await page.waitForTimeout(300);
  expect((await snakeState(page)).dir).toBe(0);
});

test("touchstart on the field is prevented (no scroll, no zoom)", async ({ page }) => {
  const prevented = await page.evaluate(() => {
    if (typeof TouchEvent === "undefined" || typeof Touch === "undefined") return null;
    const el = document.getElementById("display")!;
    const t = new Touch({ identifier: 2, target: el, clientX: 10, clientY: 10 });
    const e = new TouchEvent("touchstart", { touches: [t], changedTouches: [t], bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  test.skip(prevented === null, "synthetic TouchEvent unsupported in this engine");
  expect(prevented).toBe(true);
  const ta = await page.evaluate(() => getComputedStyle(document.getElementById("display")!).touchAction);
  expect(ta).toBe("none");
});

test("the d-pad is hidden by default and steers when shown", async ({ page }) => {
  expect(await page.evaluate(() => window.__snake.dpadVisible())).toBe(false);
  await expect(page.locator("#dpad")).toBeHidden();
  await page.evaluate(() => window.__snake.setDpad(true));
  await expect(page.locator("#dpad")).toBeVisible();
  await page.locator(".dpad-up").tap();
  await page.waitForFunction(() => window.__snake.state().dir === 3, null, { timeout: 2000 });
  await page.locator(".dpad-left").tap();
  await page.waitForFunction(() => window.__snake.state().dir === 2, null, { timeout: 2000 });
  await page.evaluate(() => window.__snake.setDpad(false));
  await expect(page.locator("#dpad")).toBeHidden();
});
