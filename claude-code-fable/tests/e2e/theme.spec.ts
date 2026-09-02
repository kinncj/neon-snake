import { test, expect } from "@playwright/test";
import { ready, useTier, near, hexToRgb } from "./snake-debug";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
});

test("level 1 renders the midnight-cyan theme on the 2D path", async ({ page }) => {
  const theme = await page.evaluate(() => window.__snake.theme());
  expect(theme.name).toBe("midnight-cyan");
  expect(theme.accent).toBe("#00e5ff");
  const bg = await page.evaluate(() => window.__snake.fbSample(3, 3));
  expect(near(bg, hexToRgb(theme.bg), 6)).toBe(true);
  const accentVar = await page.evaluate(() => getComputedStyle(document.getElementById("hud")!).getPropertyValue("--accent").trim());
  expect(accentVar).toBe("#00e5ff");
});

test("a level-up re-tints the whole scene and settles on the new palette", async ({ page }) => {
  await page.evaluate(() => window.__snake.addScore(150));
  await page.waitForFunction(() => window.__snake.state().level === 2);
  await page.waitForFunction(() => window.__snake.theme().name === "neon-magenta" && window.__snake.theme().settled, null, { timeout: 3000 });
  const theme = await page.evaluate(() => window.__snake.theme());
  expect(theme.accent).toBe("#ff2e88");
  const bg = await page.evaluate(() => window.__snake.fbSample(3, 3));
  expect(near(bg, hexToRgb(theme.bg), 6)).toBe(true);
  const accentVar = await page.evaluate(() => getComputedStyle(document.getElementById("hud")!).getPropertyValue("--accent").trim());
  expect(accentVar).toBe("#ff2e88");
  // A body block two cells behind the head is the new body colour. Segments
  // glide between cells, so scan the cell and its neighbours for the block.
  const found = await page.evaluate((bodyHex) => {
    window.__snake.freeze(); // hold the frame so the cell cannot move under the probe
    const [bx, by] = window.__snake.bodyCell(2);
    const v = parseInt(bodyHex.slice(1), 16);
    const want = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    let hit = false;
    for (let y = by * 8 - 8; y < by * 8 + 16 && !hit; y++) {
      for (let x = bx * 8 - 8; x < bx * 8 + 16 && !hit; x++) {
        if (x < 0 || y < 0 || x >= 256 || y >= 240) continue;
        const c = window.__snake.fbSample(x, y);
        if (Math.abs(c[0]! - want[0]!) <= 8 && Math.abs(c[1]! - want[1]!) <= 8 && Math.abs(c[2]! - want[2]!) <= 8) hit = true;
      }
    }
    window.__snake.unfreeze();
    return hit;
  }, theme.body);
  expect(found).toBe(true);
});

test("the transition is gradual, not a snap", async ({ page }) => {
  await page.evaluate(() => window.__snake.addScore(400));
  await page.waitForFunction(() => window.__snake.state().level === 3);
  const mid = await page.evaluate(async () => {
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      out.push(window.__snake.theme().accent);
    }
    return out;
  });
  const distinct = new Set(mid);
  expect(distinct.size).toBeGreaterThan(2);
});

test("the engine layer follows the theme too", async ({ page }) => {
  const ok = await useTier(page, "high");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.evaluate(() => window.__snake.addScore(800));
  await page.waitForFunction(() => window.__snake.theme().name === "tokyo-sunset" && window.__snake.theme().settled, null, { timeout: 3000 });
  await page.waitForTimeout(150);
  const { px, bg } = await page.evaluate(() => {
    const f = window.__snake.fit();
    return { px: window.__snake.glSample(f.dx + 3 * f.scale, f.dy + 3 * f.scale), bg: window.__snake.theme().bg };
  });
  expect(px[3]).toBeGreaterThan(0);
  expect(near(px, hexToRgb(bg), 40)).toBe(true);
});
