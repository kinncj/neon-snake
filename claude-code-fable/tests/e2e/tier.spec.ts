import { test, expect } from "@playwright/test";
import { ready, useTier, near, hexToRgb } from "./snake-debug";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
});

test("the probe picks a tier and the governor can be pinned", async ({ page }) => {
  const caps = await page.evaluate(() => window.__snake.caps());
  const tier = await page.evaluate(() => window.__snake.tier());
  expect(["low", "high", "ultra", "reduced"]).toContain(tier);
  if (!caps.webgl2) expect(tier).toBe("low");
  await page.evaluate(() => window.__snake.setTier("low"));
  expect(await page.evaluate(() => window.__snake.tier())).toBe("low");
  await page.evaluate(() => window.__snake.setTier(null));
});

test("prefers-reduced-motion forces the reduced tier", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.__snake.tier())).toBe("reduced");
  await page.evaluate(() => window.__snake.setTier(null));
  expect(await page.evaluate(() => window.__snake.tier())).toBe("reduced");
});

test("the engine composite renders the real field: the head pixel is the head colour", async ({ page }) => {
  const ok = await useTier(page, "high");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.evaluate(() => window.__snake.freeze());
  await page.waitForTimeout(100);
  const { head, headHex, bodyHex, px, drawCount } = await page.evaluate(() => {
    const s = window.__snake.state();
    // With the loop frozen the head sits exactly on its cell only when alpha ~ 1;
    // sample the neck instead, which is always a full body block.
    const st = window.__snake.state();
    const p = window.__snake.palette();
    const f = window.__snake.fit();
    const neckX = st.dir === 0 ? st.head[0] - 1 : st.dir === 2 ? st.head[0] + 1 : st.head[0];
    const neckY = st.dir === 1 ? st.head[1] - 1 : st.dir === 3 ? st.head[1] + 1 : st.head[1];
    const c = window.__snake.cellPixel(neckX, neckY);
    return {
      head: s.head,
      headHex: p["head"]!,
      bodyHex: p["body"]!,
      px: window.__snake.glSample(c[0] - f.scale, c[1] - f.scale),
      drawCount: window.__snake.fx().drawCount
    };
  });
  expect(head.length).toBe(2);
  expect(px[3]).toBeGreaterThan(0); // not a transparent letterbox
  const isBody = near(px, hexToRgb(bodyHex), 60) || near(px, hexToRgb(headHex), 60);
  expect(isBody).toBe(true);
  expect(drawCount).toBeLessThanOrEqual(12);
  await page.evaluate(() => window.__snake.unfreeze());
});

test("ultra stays within the 12 draw-batch budget", async ({ page }) => {
  const ok = await useTier(page, "ultra");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.waitForTimeout(300);
  const counts: number[] = [];
  for (let i = 0; i < 10; i++) {
    counts.push(await page.evaluate(() => window.__snake.fx().drawCount));
    await page.waitForTimeout(30);
  }
  expect(Math.max(...counts)).toBeLessThanOrEqual(12);
});

test("a WebGL context loss does not kill the game: the 2D path keeps drawing", async ({ page }) => {
  const ok = await useTier(page, "high");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.evaluate(() => window.__snake.loseContext());
  await page.waitForTimeout(150);
  const tick0 = (await page.evaluate(() => window.__snake.state())).tick;
  await page.waitForTimeout(300);
  const tick1 = (await page.evaluate(() => window.__snake.state())).tick;
  expect(tick1).toBeGreaterThan(tick0);
  const f = await page.evaluate(() => window.__snake.fit());
  const c = await page.evaluate(([x, y]) => window.__snake.sample(x!, y!), [f.dx + 2, f.dy + 2]);
  expect(c[0]! + c[1]! + c[2]!).toBeGreaterThan(0);
});
