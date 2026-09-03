#!/usr/bin/env node
// Production-look capture (step 23). Builds fresh, serves dist/ on a dedicated
// port, drives the game to eight states (title, L1..L5, gameover, paused), and
// writes 8 PNGs to docs/screenshots/. The 2D framebuffer is the ground-truth
// render (always drawn), so the captures hold regardless of headless WebGL; where
// the engine is available the FX layer (scanlines / letterbox vignette) composites
// on top. Run with: node scripts/capture-screenshots.mjs
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}/docs/screenshots`
const PORT = 4317
const BASE = `http://127.0.0.1:${PORT}`

function run(label, cmd, args) {
  console.log(`[shot] ${label}…`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`[shot] FAILED: ${label} (exit ${r.status ?? 1})`)
    process.exit(r.status ?? 1)
  }
}

run('build', 'npm', ['run', 'build'])
mkdirSync(outDir, { recursive: true })

// Serve dist/ on a dedicated port for the duration of the capture.
const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error('preview server did not become ready')
}

try {
  await waitReady()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()

  const snap = (name) => page.screenshot({ path: `${outDir}/${name}.png` }).then(() => console.log(`[shot] wrote ${name}.png`))
  // The FX layer (scanlines / letterbox vignette) is enabled where the engine is
  // available; harmless if headless has no WebGL (the 2D path still renders).
  const fxOn = () => page.evaluate(() => window.__snake.setEffectsEnabled(true))

  // 1) Title screen (L1 midnight-cyan, frozen behind the title).
  await page.goto(BASE)
  await page.waitForTimeout(300)
  await snap('01-title')

  // A fresh run settled to a level (re-tints the scene) at a static, readable pose.
  async function levelShot(score, name) {
    await page.goto(BASE) // fresh session → title
    await page.evaluate(() => window.__snake.start())
    await page.evaluate((n) => window.__snake.setScore(n), score)
    await page.evaluate(() => window.__snake.setFrozen(true))
    await fxOn()
    await page.waitForTimeout(250)
    await snap(name)
  }
  await levelShot(0, '02-level1-midnight-cyan')
  await levelShot(150, '03-level2-neon-magenta')
  await levelShot(400, '04-level3-electric-violet')
  await levelShot(800, '05-level4-tokyo-sunset')
  await levelShot(1500, '06-level5-golden-hour')

  // 7) Gameover: a wall death, then the dissolve-in panel.
  await page.goto(BASE)
  await page.evaluate(() => window.__snake.start())
  await fxOn()
  await page.waitForFunction(() => window.__snake.uiMode() === 'gameover', { timeout: 10000 })
  await page.waitForTimeout(400) // let the 320 ms dissolve-in settle
  await snap('07-gameover')

  // 8) Paused: the pause overlay over a running board.
  await page.goto(BASE)
  await page.evaluate(() => window.__snake.start())
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => window.__snake.uiMode() === 'paused', { timeout: 5000 })
  await page.waitForTimeout(200)
  await snap('08-paused')

  await ctx.close()
  await browser.close()
  console.log('[shot] done — 8 PNGs in docs/screenshots/')
} finally {
  server.kill('SIGTERM')
}
