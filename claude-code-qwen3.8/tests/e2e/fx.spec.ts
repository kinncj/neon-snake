import { expect, test } from '@playwright/test'

// Step 23 gate: collision FX (wall death → sparks + shake + shockwave; the
// death dissolves into the gameover panel), the black-frame watchdog (the 2D
// ground truth stays bright and is re-armed if it goes black), and the distinct
// death SFX (a wall death schedules the 'boom' hit, the game-over sting layered
// under it). The ground truth is the always-rendered 2D `#game` surface, so the
// FX / watchdog assertions hold even where headless WebGL is unavailable.

/** A fresh run begins with the head at (16,15) facing right; it runs into the
 *  right wall (15 cells) → a deterministic wall death. */
async function startAndDie(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  await page.waitForFunction(() => window.__snake.uiMode() === 'gameover', { timeout: 10000 })
}

test('a wall death drives a collision-FX spark burst that dissolves into gameover', async ({ page }) => {
  await startAndDie(page)

  // The collision FX scattered the head into sparks; the burst is still live
  // (it lives ~900 ms) and the gameover panel dissolved in over the snake.
  expect(await page.evaluate(() => window.__snake.particleCount())).toBeGreaterThan(0)
  const disp = await page.evaluate(
    () => (document.getElementById('ui-gameover') as HTMLElement)?.style.display ?? 'absent',
  )
  expect(disp).toBe('flex')

  // The 2D ground truth is still alive (snake + grid + food), so the watchdog's
  // health signal reads well above the near-black background.
  expect(await page.evaluate(() => window.__snake.frameBrightness())).toBeGreaterThan(300)
})

test('the 2D ground truth stays healthy and the black-frame watchdog is armed', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  await page.waitForTimeout(250)

  // A healthy frame keeps the 2D composite bright (bg ~50; snake/food > 330).
  expect(await page.evaluate(() => window.__snake.frameBrightness())).toBeGreaterThan(300)
  // A healthy session needs no watchdog auto-recovery.
  expect(await page.evaluate(() => window.__snake.watchdogRecoveries())).toBe(0)

  // The FX health flag is a stable boolean, and an enabled FX implies a healthy
  // engine (it only runs while the WebGL context is alive).
  const st = await page.evaluate(() => ({
    healthy: window.__snake.fxHealthy(),
    webgl: window.__snake.fxWebgl(),
    enabled: window.__snake.fxEnabled(),
  }))
  expect(typeof st.healthy).toBe('boolean')
  expect(typeof st.webgl).toBe('boolean')
  if (st.enabled) expect(st.healthy).toBe(true)
})

test('a wall death plays the boom SFX (the game-over sting is layered under it)', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  // A real keydown both satisfies the autoplay gesture (unlocks the AudioContext)
  // and keeps the snake running right into the wall. Poll up to ~1.5 s for the
  // context to be running; if headless audio is unavailable, skip (the SFX
  // mapping itself is unit-tested).
  const running = await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      if (window.__snake.soundReady() && window.__snake.contextState() === 'running') return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return window.__snake.contextState() === 'running'
  })
  if (!running) {
    await page.keyboard.press('ArrowRight') // attempt the gesture once more
    const again = await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        if (window.__snake.soundReady() && window.__snake.contextState() === 'running') return true
        await new Promise((r) => setTimeout(r, 50))
      }
      return window.__snake.contextState() === 'running'
    })
    test.skip(!again, 'Web Audio is not running in this environment (SFX mapping is unit-tested)')
  }

  // The snake runs straight into the right wall (16,15) → a wall death.
  await page.waitForFunction(() => window.__snake.uiMode() === 'gameover', { timeout: 10000 })
  // `consume` schedules the game-over sting first, then the cause-specific hit,
  // so `lastSfx()` reports the cause-specific voice: 'boom' for a wall death.
  expect(await page.evaluate(() => window.__snake.lastSfx())).toBe('boom')
})
