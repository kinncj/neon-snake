import { expect, test } from '@playwright/test'

// Step 22 gate: the per-level lo-fi BGM selects the right track for each level
// (70 → 86 bpm) and crossfades on a level change. The track selection is set
// synchronously and read via the debug API, so the gate is deterministic in a
// headless browser (actual playback needs a real gesture + audio device, which
// we deliberately do not assert here).

const TRACKS = [
  { score: 0, name: 'cozy-bedroom', bpm: 70 },
  { score: 150, name: 'window-seat', bpm: 74 },
  { score: 400, name: 'rainy-train', bpm: 78 },
  { score: 800, name: 'park-bench', bpm: 82 },
  { score: 1500, name: 'skyline-view', bpm: 86 },
]

test('the BGM follows the level and crossfades on a level-up', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  await page.evaluate(() => window.__snake.setFrozen(true)) // keep the score stable
  await page.waitForTimeout(80)

  // Level 1: the cozy-bedroom track at 70 bpm.
  expect(await page.evaluate(() => window.__snake.songName())).toBe('cozy-bedroom')
  expect(await page.evaluate(() => window.__snake.songBpm())).toBe(70)

  // A level-up crossfades to the next track (level 3 → rainy-train at 78 bpm).
  await page.evaluate(() => window.__snake.setScore(400))
  await page.waitForTimeout(80)
  expect(await page.evaluate(() => window.__snake.songName())).toBe('rainy-train')
  expect(await page.evaluate(() => window.__snake.songBpm())).toBe(78)
})

test('every level maps to its own track and tempo', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__snake.start())
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.waitForTimeout(80)

  for (const t of TRACKS) {
    await page.evaluate((s) => window.__snake.setScore(s), t.score)
    await page.waitForTimeout(60)
    expect(await page.evaluate(() => window.__snake.songName())).toBe(t.name)
    expect(await page.evaluate(() => window.__snake.songBpm())).toBe(t.bpm)
  }
})
