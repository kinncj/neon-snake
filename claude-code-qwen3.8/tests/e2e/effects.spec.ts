import { expect, test } from '@playwright/test'

// Step 14 gate: the Phaser FX layer is gated by the quality governor, the 2D
// framebuffer remains the ground-truth render (always drawn), and a
// deterministic eat drives a particle burst. The ground truth is the
// always-rendered 2D `#game` surface, so these hold even where headless WebGL
// is unavailable (FX layer then stays hidden and `fxEnabled()` is false).
//
// Assertions avoid assuming a static sim pose: the snake moves during page load
// and the head is interpolated between ticks, so we read the live state and
// assert on invariant properties (the neon snake is always drawn opaque; the
// eat is driven one cell ahead of wherever the head currently is).
/** Max channel-sum over the whole 2D surface (bg is ~50; snake/food are > 330). */
function maxBrightness(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let max = 0
    for (let i = 0; i < d.length; i += 4) {
      const s = (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0)
      if (s > max) max = s
    }
    return max
  })
}

test('FX layer is gated by the quality governor', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  // `fxWebgl()` reports whether the engine context came up (may be false in
  // headless). Either way it is a stable boolean.
  const webgl = await page.evaluate(() => window.__snake.fxWebgl())
  expect(typeof webgl).toBe('boolean')

  const enabled = await page.evaluate(() => window.__snake.fxEnabled())
  expect(typeof enabled).toBe('boolean')

  // Turning effects off is a hard override → `reduced` → FX layer disabled.
  await page.evaluate(() => window.__snake.setEffectsEnabled(false))
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__snake.tier())).toBe('reduced')
  expect(await page.evaluate(() => window.__snake.fxEnabled())).toBe(false)

  // Re-enable and confirm consistency: enabled === webgl && (high|ultra).
  await page.evaluate(() => window.__snake.setEffectsEnabled(true))
  await page.waitForTimeout(100)
  const st = await page.evaluate(() => ({
    webgl: window.__snake.fxWebgl(),
    enabled: window.__snake.fxEnabled(),
    tier: window.__snake.tier(),
  }))
  const highTier = st.tier === 'high' || st.tier === 'ultra'
  expect(st.enabled).toBe(st.webgl && highTier)
})

test('2D framebuffer stays the ground-truth render regardless of FX state', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  // The 2D surface always draws the neon snake fully opaque (head/food sum >
  // 330; background is ~50), independent of whether the FX layer is active.
  expect(await maxBrightness(page)).toBeGreaterThan(300)

  // Force FX off (hard override → reduced → FX layer hidden). The 2D ground
  // truth must keep rendering — it never depends on the engine canvas.
  await page.evaluate(() => window.__snake.setEffectsEnabled(false))
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => window.__snake.fxEnabled())).toBe(false)
  expect(await maxBrightness(page)).toBeGreaterThan(300)

  await page.evaluate(() => window.__snake.setEffectsEnabled(true))
})

test('a deterministic eat drives a particle burst on the 2D surface', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start()) // title → playing

  // Freeze immediately and read the LIVE head pose (it may have advanced during
  // page load). Place food exactly one cell ahead of the current head so the
  // very next tick is a guaranteed clean eat (in-bounds on a fresh board, clear
  // of the 3-segment body which trails behind the head).
  await page.evaluate(() => window.__snake.setFrozen(true))
  const cell = await page.evaluate(() => {
    const s = window.__snake.get()
    const dx = [0, 1, 0, -1][s.dir] ?? 0
    const dy = [-1, 0, 1, 0][s.dir] ?? 0
    return { nx: s.headX + dx, ny: s.headY + dy }
  })
  await page.evaluate(([x, y]) => window.__snake.placeFood(x, y), [cell.nx, cell.ny] as [number, number])
  await page.evaluate(() => window.__snake.setFrozen(false))

  // Wait for a sim tick (~120 ms) plus margin; the burst lives ~480 ms, so the
  // particles are still live when we sample. (The loop clamps catch-up to 5
  // ticks, so the head can never skip past the food to a wall here.)
  await page.waitForTimeout(300)
  const count = await page.evaluate(() => window.__snake.particleCount())
  expect(count).toBeGreaterThan(0)

  // The eat also advanced the score (a food is worth 10 at level 1).
  const score = await page.evaluate(() => window.__snake.get().score)
  expect(score).toBeGreaterThan(0)
})
