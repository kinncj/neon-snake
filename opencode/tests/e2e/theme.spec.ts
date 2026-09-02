import { expect, test } from "@playwright/test";
import { play } from "./snake-debug";

/**
 * Per-level neon themes, end to end. A level-up must visibly re-tint the
 * scene: the HUD accent variable (--neon) and the data-level hook move, and
 * the snake's on-screen colour shifts toward the new palette, then settles.
 *
 * The accent/level assertions are cross-browser; the pixel assertion uses the
 * same composite math the renderer uses and reads the 2D framebuffer (the
 * cross-browser source of truth).
 */

const read = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = window.__snake!;
    const c = s.composite();
    // a point well inside the field (the snake's start row), device coords
    const x = Math.floor(c.offX + 164 * c.scale);
    const y = Math.floor(c.offY + 124 * c.scale);
    const cs = getComputedStyle(document.getElementById("screen")!);
    return {
      accent: cs.getPropertyValue("--neon").trim(),
      level: s.state.level,
      dataLevel:
        (document.getElementById("screen") as HTMLElement).dataset.level ?? "",
      px: s.sample(x, y)
    };
  });

test("level-up re-tints the scene and settles on the new palette", async ({
  page
}) => {
  await play(page);
  const before = await read(page);
  expect(before.level).toBe(1);

  // One apple (10 pts, combo >= 1) puts 140 over the 150 level-2 boundary.
  await page.evaluate(() => {
    window.__snake!.bumpScore(140);
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(() => window.__snake!.state.level === 2);
  await page.waitForTimeout(900); // let the 600ms transition settle

  const after = await read(page);
  expect(after.level).toBe(2);
  expect(after.dataLevel).toBe("2");
  expect(after.accent).not.toBe(before.accent);
  // the same device point changed colour across the palette shift
  expect(after.px).not.toEqual(before.px);
});

test("theme accent variable is exposed and readable", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
  const accent = await page.evaluate(() =>
    getComputedStyle(document.getElementById("screen")!)
      .getPropertyValue("--neon")
      .trim()
  );
  expect(accent).toMatch(/rgb\(\d+,\d+,\d+\)|^#/);
});
