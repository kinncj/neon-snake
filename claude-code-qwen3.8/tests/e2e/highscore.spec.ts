import { expect, test } from '@playwright/test'

// Step 16 gate: the high score persists in localStorage with a checksum. A valid
// stored score is loaded into the session; a tampered score (score changed but
// checksum stale) is discarded and reset to 0. The sim is frozen so an unrelated
// death can't repersist a stale value mid-test.

test('a fresh session has no high score', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__snake.get().highScore)).toBe(0)
})

test('a valid high score round-trips across a reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.evaluate(() => window.__snake.setHighscore(1234))
  await page.waitForTimeout(50)

  await page.reload()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__snake.get().highScore)).toBe(1234)
})

test('a tampered high score is discarded and reset to 0', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.evaluate(() => window.__snake.setHighscore(500))
  await page.waitForTimeout(50)

  // Forge a higher score but keep the (now-wrong) checksum → must be rejected.
  await page.evaluate(() => {
    window.localStorage.setItem('snake.highscore', JSON.stringify({ s: 999_999, c: '00000000' }))
  })

  await page.reload()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__snake.get().highScore)).toBe(0)
})
