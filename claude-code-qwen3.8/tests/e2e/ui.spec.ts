import { expect, test } from '@playwright/test'

// Step 19 gate: the score/best/level HUD, the title / pause / gameover overlays
// (UI modes `title | playing | paused | gameover`), the MAX state past the top
// threshold, and i18n re-render of the HUD + overlay labels. The sim steps only
// in the `playing` mode, so every gameplay assertion begins with `start()`.

function text(page: import('@playwright/test').Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s)?.textContent ?? '').trim(), sel)
}

function display(page: import('@playwright/test').Page, id: string): Promise<string> {
  return page.evaluate((i) => document.getElementById(i)?.style.display ?? 'absent', id)
}

test('a fresh session shows the title screen and begins on start()', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(80)

  expect(await page.evaluate(() => window.__snake.uiMode())).toBe('title')
  expect(await display(page, 'ui-title')).toBe('flex')
  // The snake is drawn but frozen behind the title; the sim has not advanced.
  expect((await page.evaluate(() => window.__snake.get())).tick).toBe(0)

  await page.evaluate(() => window.__snake.start())
  await page.waitForTimeout(80)
  expect(await page.evaluate(() => window.__snake.uiMode())).toBe('playing')
  expect(await display(page, 'ui-title')).toBe('none')
})

test('the HUD shows score / best / level and reads MAX past the top threshold', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(80)

  // Fresh state: score 0, level 1 (the top threshold 1500 is level 5 → MAX).
  expect(await text(page, '#hud [data-hud-value="score"]')).toBe('0')
  expect(await text(page, '#hud [data-hud-value="level"]')).toBe('1')

  // Past the top threshold the level reads MAX (the ceiling, not a sixth level).
  await page.evaluate(() => window.__snake.setScore(1500))
  await page.waitForTimeout(80)
  expect(await text(page, '#hud [data-hud-value="score"]')).toBe('1500')
  expect(await text(page, '#hud [data-hud-value="level"]')).toBe('MAX')

  // Below the top threshold the level number is shown (999 → level 4).
  await page.evaluate(() => window.__snake.setScore(999))
  await page.waitForTimeout(80)
  expect(await text(page, '#hud [data-hud-value="score"]')).toBe('999')
  expect(await text(page, '#hud [data-hud-value="level"]')).toBe('4')
})

test('the pause overlay shows while paused and hides when resumed', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  await page.evaluate(() => window.__snake.setFrozen(true)) // keep the pose deterministic
  await page.waitForTimeout(60)

  expect(await page.evaluate(() => window.__snake.uiMode())).toBe('playing')
  expect(await display(page, 'ui-pause')).toBe('none')

  await page.keyboard.press('KeyP')
  await page.waitForTimeout(80)
  expect(await page.evaluate(() => window.__snake.uiMode())).toBe('paused')
  expect(await display(page, 'ui-pause')).toBe('flex')

  await page.keyboard.press('KeyP')
  await page.waitForTimeout(80)
  expect(await page.evaluate(() => window.__snake.uiMode())).toBe('playing')
  expect(await display(page, 'ui-pause')).toBe('none')
})

test('the gameover overlay shows after a wall death', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  // Head at (16,15) facing right; the right wall is 15 cells away. Unfrozen from
  // `start()`, the snake runs straight into the wall. Poll for the death (the
  // death is a few seconds out at the L1 120 ms tick).
  await page.waitForFunction(() => window.__snake.uiMode() === 'gameover', { timeout: 10000 })
  expect(await display(page, 'ui-gameover')).toBe('flex')
  // The gameover screen shows the final score and the persisted best.
  const final = await page.evaluate(() => {
    const s = window.__snake.get()
    return { score: s.score, best: s.highScore }
  })
  expect(await text(page, '#ui-gameover [data-stat="score"]')).toBe(String(final.score))
  expect(await text(page, '#ui-gameover [data-stat="best"]')).toBe(String(final.best))
})

test('HUD and overlay labels re-render on a locale change', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(80)

  // Title visible (en): the localized start hint is the English string.
  expect(await text(page, '.ui-title-start')).toBe('Press any key to start')

  await page.evaluate(() => window.__snake.setLocale('ja'))
  await page.waitForTimeout(80)
  expect(await text(page, '.ui-title-start')).toBe('任意のキーでスタート')
  expect(await text(page, '#hud [data-hud-label="score"]')).toBe('スコア')
})
