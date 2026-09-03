import { expect, test } from '@playwright/test'

async function snap(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.__snake.get())
}

test('keyboard controls restart, pause, and turn', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.waitForTimeout(120)

  // restart (applied while frozen) -> fresh state
  await page.keyboard.press('KeyR')
  await page.waitForTimeout(60)
  let s = await snap(page)
  expect(s.phase).toBe('playing')
  expect(s.tick).toBe(0)

  // pause toggles immediately (independent of the loop)
  await page.keyboard.press('KeyP')
  await page.waitForTimeout(40)
  expect((await snap(page)).phase).toBe('paused')
  await page.keyboard.press('KeyP')
  await page.waitForTimeout(40)
  expect((await snap(page)).phase).toBe('playing')

  // a buffered turn applies on the next tick (up from right)
  await page.keyboard.press('ArrowUp')
  await page.evaluate(() => window.__snake.unfreeze())
  await page.waitForTimeout(280)
  s = await snap(page)
  expect(s.dir).toBe(0)
})

test('on-screen d-pad is hidden by default and steers when shown', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.waitForTimeout(80)

  expect(await page.evaluate(() => window.__snake.dpadVisible())).toBe(false)
  await page.evaluate(() => window.__snake.setDpadVisible(true))
  // The d-pad buttons carry localized accessible labels (i18n); fresh pages
  // default to English, so the up key is labelled "Move up".
  const up = page.locator('#dpad button[aria-label="Move up"]')
  await expect(up).toBeVisible()

  await up.click()
  await page.evaluate(() => window.__snake.unfreeze())
  await page.waitForTimeout(280)
  expect((await snap(page)).dir).toBe(0)
})

test('a touch swipe steers the snake', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.waitForTimeout(100)

  // dispatch a synthetic upward swipe on the game surface (dx=0, dy=-80). A plain
  // Event with the touch props attached keeps it cross-browser (the Touch/
  // TouchEvent constructors are not all exposed in headless Firefox).
  await page.evaluate(() => {
    const el = document.getElementById('game') as HTMLElement
    const dispatch = (type: string, x: number, y: number): void => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(ev, {
        touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
        changedTouches: [{ clientX: x, clientY: y }],
      })
      el.dispatchEvent(ev)
    }
    dispatch('touchstart', 100, 180)
    dispatch('touchend', 100, 100)
  })
  await page.evaluate(() => window.__snake.unfreeze())
  await page.waitForTimeout(280)
  expect((await snap(page)).dir).toBe(0)
})
