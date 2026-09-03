import { expect, test } from '@playwright/test'

// P4.3 — the death-sequence luminance budget. The death FX (flash, shake,
// particles) lives on the FX layer (the WebGL canvas), composited over the 2D
// framebuffer (the always-drawn ground truth). `luma()` here reads the 2D
// composite's centre pixel — deterministic, always-redrawn — NOT the engine's
// not-frame-synced WebGL readback (which caught the brightened FX grid at random
// frames and flaked the transition count). `forceDeath()` places the whole snake
// connected against the wall, pins the food above the centre row, and clears the
// turn queue, so the death is immediate and the centre pixel stays stable.

/** The 2D composite's centre-pixel brightness (R+G+B); deterministic. */
function luma(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.__snake.centerLuma())
}

test('the death sequence stays within the luminance-transition budget', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  await page.waitForTimeout(120)

  // Force an immediate wall death (the whole snake against the right wall).
  await page.evaluate(() => window.__snake.forceDeath())

  // Sample the 2D composite's centre pixel at ~20 Hz over ~1 s (the death FX
  // window). The 2D composite is the deterministic ground truth, so the centre
  // pixel — the background grid, clear of the head/food — is stable: the FX
  // layer (flash/shake/particles) sits on a separate canvas and does not reach it.
  const samples: number[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < 1000) {
    samples.push(await luma(page))
    await page.waitForTimeout(50)
  }
  expect(samples.length).toBeGreaterThanOrEqual(10)

  // Count luminance transitions (a change above a small threshold between
  // consecutive samples). The budget is ≤ 3/s; the stable 2D composite yields
  // ~0, so this holds with wide margin.
  const THRESH = 30
  let transitions = 0
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0)) > THRESH) transitions += 1
  }
  const seconds = (samples.length * 50) / 1000
  const perSecond = transitions / seconds
  expect(perSecond).toBeLessThanOrEqual(3)
})
