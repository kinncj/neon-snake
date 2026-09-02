import { expect, test } from '@playwright/test'

test('tier is exposed and the Effects toggle forces reduced', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  const tier = await page.evaluate(() => window.__snake.tier())
  expect(['low', 'high', 'ultra', 'reduced']).toContain(tier)

  // Turning effects off is a hard override: it forces `reduced` immediately.
  await page.evaluate(() => window.__snake.setEffectsEnabled(false))
  expect(await page.evaluate(() => window.__snake.tier())).toBe('reduced')

  // Re-enabling releases the override back onto the performance ladder.
  await page.evaluate(() => window.__snake.setEffectsEnabled(true))
  expect(await page.evaluate(() => window.__snake.tier())).toBe('low')
})
