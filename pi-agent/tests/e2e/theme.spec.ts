/**
 * Per-level neon themes, end to end. A level-up must visibly re-tint the
 * scene: the HUD accent variable and the data-level hook move, and the
 * snake's on-screen colour shifts toward the new palette, then settles.
 *
 * The accent/level assertions are cross-browser; the pixel assertion uses
 * the same composite math the renderer uses and tolerates any tier (the
 * debug readback falls back to the 2D framebuffer where GL readback is
 * unavailable).
 */
import { test, expect } from "@playwright/test";
import { play } from "./snake-debug";

test("level-up re-tints the scene and settles on the new palette", async ({
  page
}) => {
  await play(page);

  const before = await page.evaluate(() => {
    const s = window.__snake!;
    const c = s.composite();
    // a point well inside the field (the snake's start row), device coords
    const x = Math.floor(c.offX + 164 * c.scale);
    const y = Math.floor(c.offY + 124 * c.scale);
    return { accent: s.fx.info().theme.accent, level: s.state.level, head: s.sample(x, y) };
  });
  expect(before.level).toBe(1);

  // One apple (10 pts, combo >= 1) puts 140 over the 150 level-2 boundary.
  await page.evaluate(() => {
    window.__snake!.bumpScore(140);
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(() => window.__snake!.state.level === 2);
  await page.waitForTimeout(900); // let the 600ms transition settle

  const after = await page.evaluate(() => {
    const s = window.__snake!;
    const c = s.composite();
    const x = Math.floor(c.offX + 164 * c.scale);
    const y = Math.floor(c.offY + 124 * c.scale);
    return {
      accent: s.fx.info().theme.accent,
      level: s.state.level,
      dataLevel: (document.getElementById("screen") as HTMLElement).dataset.level,
      head: s.sample(x, y)
    };
  });
  expect(after.level).toBe(2);
  expect(after.dataLevel).toBe("2");
  expect(after.accent).not.toBe(before.accent);
  // the same device point changed colour across the palette shift
  expect(after.head).not.toEqual(before.head);
});

test("theme accent variable is exposed and readable", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await page.waitForFunction(() => window.__snake !== undefined);
  const accent = await page.evaluate(() =>
    window.__snake!.fx.info().theme.accent
  );
  expect(accent).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
});
