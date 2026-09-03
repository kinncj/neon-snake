import { expect, test } from '@playwright/test'

// Step 15 gate: procedural Web Audio SFX. An AudioContext is created only after
// an explicit user gesture; mute is keyboard-reachable ('M') via a labelled,
// focusable control; the enable state persists in localStorage; and the
// voice-bus ducking gain is 0.8. The assertions are on the control/state, not
// on audible output (headless audio is not a reliable assertion target).

test('no AudioContext before a gesture, unlocked by real input', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  // No gesture yet: the adapter has not created an AudioContext.
  expect(await page.evaluate(() => window.__snake.soundReady())).toBe(false)

  // A real key press is a user gesture → the context is unlocked.
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(120)
  expect(await page.evaluate(() => window.__snake.soundReady())).toBe(true)
})

test('mute is keyboard-reachable and the control is labelled', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  const btn = page.locator('#sound-toggle')
  await expect(btn).toBeVisible()
  expect(await btn.getAttribute('aria-label')).toMatch(/sound/i)
  // A real, focusable button (keyboard-reachable via Tab + Enter).
  expect(await btn.getAttribute('aria-pressed')).toBe('true') // default: sound on

  expect(await page.evaluate(() => window.__snake.soundEnabled())).toBe(true)

  // 'M' mutes; the control reflects the new state.
  await page.keyboard.press('m')
  await page.waitForTimeout(60)
  expect(await page.evaluate(() => window.__snake.soundEnabled())).toBe(false)
  expect(await page.evaluate(() => window.__snake.soundMuted())).toBe(true)
  expect(await btn.getAttribute('aria-pressed')).toBe('false')

  // 'M' again un-mutes.
  await page.keyboard.press('m')
  await page.waitForTimeout(60)
  expect(await page.evaluate(() => window.__snake.soundEnabled())).toBe(true)
  expect(await btn.getAttribute('aria-pressed')).toBe('true')
})

test('the sound enable state persists in localStorage', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  await page.evaluate(() => window.__snake.setSoundEnabled(false))
  await page.waitForTimeout(60)
  expect(await page.evaluate(() => window.__snake.soundEnabled())).toBe(false)
  expect(await page.evaluate(() => window.localStorage.getItem('snake.sound'))).toBe('0')

  // Reload: the persisted "off" state survives.
  await page.reload()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__snake.soundEnabled())).toBe(false)
  expect(await page.evaluate(() => window.localStorage.getItem('snake.sound'))).toBe('0')
})

test('the voice-bus ducking gain caps voices at 0.8', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(60)
  expect(await page.evaluate(() => window.__snake.soundDuck())).toBe(0.8)
})
