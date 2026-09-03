import { expect, test } from '@playwright/test'

// Step 10 gate: the 2D framebuffer renders the full field at an integer 1:1 cell
// scale with no clipping across viewports, and a mid-session resize leaves the
// simulation state unchanged. The ground truth is the always-rendered 2D
// `#game` surface.
function cellCenter(page: import('@playwright/test').Page, cx: number, cy: number) {
  return page.evaluate(([x, y]) => {
    const sn = window.__snake.get()
    const c = document.getElementById('game') as HTMLCanvasElement
    const g = c.getContext('2d')!
    const px = Math.floor(sn.layout.offX + (x * 8 + 4) * sn.layout.scale)
    const py = Math.floor(sn.layout.offY + (y * 8 + 4) * sn.layout.scale)
    const d = g.getImageData(px, py, 1, 1).data
    return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0 }
  }, [cx, cy] as [number, number])
}

test('framebuffer renders the full field and survives a mid-session resize', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('#game')
  await expect(canvas).toBeVisible()

  // Freeze the simulation so the field is stable to sample.
  await page.evaluate(() => window.__snake.setFrozen(true))
  await page.waitForTimeout(150)

  const vw = await page.evaluate(() => window.innerWidth)
  const box = (await canvas.boundingBox()) ?? { width: 0, height: 0, x: 0 }
  // The playfield is the glass (#screen), inset by the TV bezel. It fills the
  // glass — most of the viewport — but is strictly inset from the viewport edge.
  expect(box.x).toBeGreaterThan(0)
  expect(box.width).toBeLessThan(vw)
  expect(box.width).toBeGreaterThanOrEqual(vw * 0.85)

  const sn = await page.evaluate(() => window.__snake.get())
  // Head cell renders in the head colour (bright), i.e. the field is drawn.
  const head = await cellCenter(page, sn.headX, sn.headY)
  expect(head.r + head.g + head.b).toBeGreaterThan(60)

  // The food cell is not the background (the food is drawn).
  const food = await cellCenter(page, sn.foodX, sn.foodY)
  expect(food.r + food.g + food.b).toBeGreaterThan(40)

  // Mid-session resize: the simulation state must be unchanged.
  const before = await page.evaluate(() => {
    const s = window.__snake.get()
    return { tick: s.tick, score: s.score, phase: s.phase, headX: s.headX, headY: s.headY }
  })
  await page.setViewportSize({ width: 640, height: 480 })
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => {
    const s = window.__snake.get()
    return { tick: s.tick, score: s.score, phase: s.phase, headX: s.headX, headY: s.headY }
  })
  expect(after).toEqual(before)

  // Still filling the glass (inset by the bezel) after the resize.
  const vw2 = await page.evaluate(() => window.innerWidth)
  const box2 = (await canvas.boundingBox()) ?? { width: 0, height: 0 }
  expect(box2.width).toBeGreaterThanOrEqual(vw2 * 0.85)

  await page.evaluate(() => window.__snake.setFrozen(false))
})
