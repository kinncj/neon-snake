import { expect, test } from '@playwright/test'

// Step 16 perf budget: at the low tier, under a 4x CPU throttle,
//   (1) p95 steady-state frame time < 16.7 ms (60 fps), and
//   (2) steady-state JS-heap growth over a 600-frame window (after a 1000-frame
//       warm-up) is bounded — i.e. the per-frame path leaks nothing (growth is
//       one-time scaffolding + GC noise, not proportional to the frame count).
//
// Frame time is measured on the real 2D render path (renderFrame). Allocation is
// measured as a forced-GC JSHeapUsedSize delta via CDP, so it reflects retained
// heap, not transient garbage.

const FRAME_BUDGET_MS = 16.7
const WARM = 1000
const SAMPLE = 600
// Retained-heap growth tolerated over the measured window. A real per-frame leak
// would grow with the frame count (600 x per-frame bytes) and blow past this;
// the bound absorbs one-time debug scaffolding + V8/GC timing noise.
const ALLOC_BUDGET_BYTES = 256 * 1024

test('steady-state frame time and allocation stay within budget', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(200)

  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await client.send('Performance.enable')

  const heapUsed = async (): Promise<number> => {
    const m = (await client.send('Performance.getMetrics')) as {
      metrics: Array<{ name: string; value: number }>
    }
    return m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0
  }
  const gc = async (): Promise<void> => {
    await page.evaluate(() => {
      const w = globalThis as { gc?: () => void }
      w.gc?.()
    })
  }

  // Warm-up: let JIT + renderer caches settle before measuring.
  await page.evaluate((n) => window.__snake.perfWarm(n), WARM)

  await gc()
  const baseline = await heapUsed()

  // Measured window: 600 steady-state render frames, timed.
  const stats = await page.evaluate((n) => window.__snake.perfRun(n), SAMPLE)

  await gc()
  const after = await heapUsed()
  const allocDelta = after - baseline

  console.log(
    `[perf] p95=${stats.p95.toFixed(2)}ms min=${stats.min.toFixed(2)}ms ` +
      `max=${stats.max.toFixed(2)}ms mean=${stats.mean.toFixed(2)}ms ` +
      `count=${stats.count} retainedDelta=${Math.round(allocDelta)}B`,
  )

  expect(
    stats.p95,
    `p95 frame time ${stats.p95.toFixed(2)}ms exceeds budget ${FRAME_BUDGET_MS}ms`,
  ).toBeLessThan(FRAME_BUDGET_MS)
  expect(
    allocDelta,
    `steady-state retained-heap growth ${Math.round(allocDelta)}B exceeds budget ${ALLOC_BUDGET_BYTES}B`,
  ).toBeLessThan(ALLOC_BUDGET_BYTES)
})
