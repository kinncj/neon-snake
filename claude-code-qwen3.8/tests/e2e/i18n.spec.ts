import { expect, test } from '@playwright/test'

// Step 18 gate: the UI reads from the i18n catalog and `setLocale` re-renders it.
// The sound control's accessible label is the shipped, always-present localized
// string, so it is the end-to-end probe: driving the locale through the debug API
// must re-render the label (the subscribe/re-render contract), not just flip
// internal state.

const EN_LABEL = 'Toggle sound (M)'
const JA_LABEL = 'サウンド切替 (M)'

test('defaults to English and setLocale re-renders the localized label', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(100)

  const label = page.locator('#sound-toggle')
  expect(await page.evaluate(() => window.__snake.locale())).toBe('en')
  expect(await label.getAttribute('aria-label')).toBe(EN_LABEL)

  await page.evaluate(() => window.__snake.setLocale('ja'))
  expect(await page.evaluate(() => window.__snake.locale())).toBe('ja')
  // The re-render is synchronous with the locale change (no paint wait needed),
  // but allow a frame for good measure.
  await page.waitForTimeout(30)
  expect(await label.getAttribute('aria-label')).toBe(JA_LABEL)

  // Back to English re-renders it again.
  await page.evaluate(() => window.__snake.setLocale('en'))
  await page.waitForTimeout(30)
  expect(await label.getAttribute('aria-label')).toBe(EN_LABEL)
})
