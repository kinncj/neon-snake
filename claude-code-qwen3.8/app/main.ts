// Game wiring. Connects the pure domain to the runtime loop, the 2D framebuffer
// (always drawn as the guaranteed fallback), and the input queue, and exposes a
// small `window.__snake` debug API for the e2e suite. Rendering and audio are
// read-only observers of state and emitted effects; they never mutate state.
import { enqueue } from './domain/intents'
import { levelForScore, tickMsForLevel } from './domain/levels'
import { init, step } from './domain/step'
import {
  CELL_PX,
  GRID_W,
  createSink,
  sinkReset,
  type Effect,
  type Intent,
  type SnakeState,
} from './domain/types'
import { createSound, type SoundHandle } from './adapters/audio/synth'
import { getLocale, setLocale } from './adapters/i18n'
import { createGamepad } from './adapters/input/gamepad'
import { createKeyboard } from './adapters/input/keyboard'
import { createDpad, createSwipe } from './adapters/input/touch'
import { Framebuffer, type Layout } from './adapters/render/framebuffer'
import { ParticleSystem } from './adapters/render/particles'
import { fxActive, PhaserFx, type FxTier } from './adapters/render/phaser/phaser-fx'
import { themeForLevel } from './adapters/render/theme'
import { createHighscore } from './adapters/storage/highscore'
import { createHud, type Hud } from './adapters/ui/hud'
import { createOverlays, type Overlays, type UiMode } from './adapters/ui/overlays'
import { FixedTimestepLoop } from './runtime/loop'
import {
  QualityGovernor,
  startingTier,
  type QualityProbe,
  type Tier,
} from './runtime/quality'

const SEED = 'snake-0001'

const stage = document.getElementById('stage')
if (!stage) throw new Error('missing #stage')
const canvas = document.createElement('canvas')
canvas.id = 'game'
stage.appendChild(canvas)

const fb = new Framebuffer(canvas)
const particles = new ParticleSystem()
// The playfield renders inside the TV bezel: #screen is inset by --bezel, so the
// canvas is sized to the glass rather than the viewport. Cache the screen's
// viewport offset so the DOM score popups (position:fixed, viewport-relative)
// land on the cell, which is now offset into the screen by the bezel.
const screenEl = document.getElementById('screen')
let screenOx = 0
let screenOy = 0
// The FX engine composites on top of the 2D framebuffer. It is defensive: if
// WebGL is unavailable (or the context is lost) it stays hidden and the 2D path
// beneath remains the visible render. `fxActive(tier)` gates it.
const fx = new PhaserFx(stage, {
  onContextLoss: () => governorLost(),
})
fx.init()
let state: SnakeState = init(SEED)
const sink = createSink()
let frozen = false
let currentAlpha = 0

// UI mode (presentation-only; the domain has no `title` phase). The sim steps
// only while the mode is `playing` and not debug-frozen. `title` is the initial
// state: the snake is drawn but frozen behind the title screen until the player
// (or the `start()` debug hook) begins a run.
let started = false
function startGame(): void {
  if (started) return
  started = true
  frozen = false
  loop.reset()
}
function currentUiMode(): UiMode {
  if (!started) return 'title'
  if (state.phase === 'gameover') return 'gameover'
  if (state.phase === 'paused') return 'paused'
  return 'playing'
}

// High score: mirrored to localStorage (with a checksum) by the storage adapter.
// Seed the session best from storage; the domain bumps `highScore` on death.
const hs = createHighscore(window.localStorage)
state.highScore = hs.load()

/** Apply a turn/pause (or restart, which re-inits from the same seed). */
function applyIntent(intent: Intent): void {
  if (intent.kind === 'restart') {
    state = init(state.seed)
    state.highScore = hs.load() // keep the (persisted) best across restarts
    particles.reset()
  } else state = enqueue(state, intent)
}

const loop = new FixedTimestepLoop(tickMsForLevel(state.level), () => {
  fb.capturePrev(state)
  step(state, sink)
})

// Input adapters (keyboard/gamepad/touch) push intents here; drained each frame.
const intentQueue: Intent[] = []
function drainIntents(): void {
  while (intentQueue.length > 0) {
    const intent = intentQueue.shift()
    if (intent) applyIntent(intent)
  }
}

const pushIntent = (intent: Intent): void => {
  intentQueue.push(intent)
}
createKeyboard(pushIntent)
createGamepad(pushIntent)
createSwipe(pushIntent, canvas)
const dpad = createDpad(pushIntent) // hidden by default; the settings panel owns visibility
document.body.appendChild(dpad.root)

// Sound: gesture-gated procedural Web Audio. The adapter owns the labelled mute
// control and the 'M' shortcut; its enable state persists in localStorage. It
// reads the same effect sink the FX layer consumes and never touches state.
const sound: SoundHandle = createSound()
document.body.appendChild(sound.root)

// HUD + overlays (step 19): read-only presentation of score/best/level and the
// title/pause/gameover screens + score popups + level-up banner. Both read the
// domain state and the i18n catalog; neither mutates state.
const hud: Hud = createHud()
const overlays: Overlays = createOverlays()
document.body.appendChild(hud.root)
document.body.appendChild(overlays.root)

// Quality governor: probe the hardware once, pick a starting tier, then let the
// rolling frame-time median move it. `reduced` (OS or user Effects-off) is a
// hard override the governor never walks out of.
function probeQuality(): QualityProbe {
  let webgl2 = false
  let maxTextureSize = 0
  try {
    const probeCanvas = document.createElement('canvas')
    const gl = probeCanvas.getContext('webgl2')
    if (gl) {
      webgl2 = true
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    // no WebGL2 — governor stays capped at low
  }
  return {
    webgl2,
    maxTextureSize,
    cores: navigator.hardwareConcurrency ?? 1,
    prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  }
}

const qualityProbe = probeQuality()
const governor = new QualityGovernor(startingTier(qualityProbe), qualityProbe.webgl2 ? 'ultra' : 'low')
let lastTier: Tier = governor.tier

/** GL context loss: drop to low so the FX layer stays off (2D remains visible). */
function governorLost(): void {
  governor.set('low')
}

/** Convert a grid cell centre to framebuffer pixels. */
function cellPx(cx: number, cy: number): { x: number; y: number } {
  return { x: cx * CELL_PX + CELL_PX / 2, y: cy * CELL_PX + CELL_PX / 2 }
}

/** Convert a grid cell centre to on-screen CSS pixels (for the DOM score popups). */
function cellCss(cx: number, cy: number): { x: number; y: number } {
  const lay = fb.getLayout()
  const dpr = window.devicePixelRatio || 1
  const fx = cx * CELL_PX + CELL_PX / 2
  const fy = cy * CELL_PX + CELL_PX / 2
  return {
    x: screenOx + (lay.offX + fx * lay.scale) / dpr,
    y: screenOy + (lay.offY + fy * lay.scale) / dpr,
  }
}

/** Parse a #rrggbb colour to a 0-255 RGB triple (FX particle colouring). */
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Consume the frame's emitted effects and drive the presentation FX (particles,
 * flash, shake, shockwave) and the DOM popups (score "+N", level-up banner).
 * Read-only with respect to domain state — we only read the effects and the
 * current state to position the FX / popups.
 */
function handleEffects(s: SnakeState): void {
  for (let i = 0; i < sink.len; i++) {
    const e: Effect = sink.buf[i]!
    switch (e.kind) {
      case 'ate': {
        const c = cellPx(e.x, e.y)
        const [r, g, b] = hexRgb(themeForLevel(s.level).palette.food)
        particles.burst(c.x, c.y, 14, { color: [r, g, b], speed: 70, lifeMs: 480, size: 1.4 })
        const css = cellCss(e.x, e.y)
        overlays.showScorePop(e.value, css.x, css.y)
        break
      }
      case 'levelup': {
        const c = cellPx(s.bodyX[0] ?? 0, s.bodyY[0] ?? 0)
        const [r, g, b] = hexRgb(themeForLevel(s.level).palette.accent)
        particles.burst(c.x, c.y, 26, { color: [r, g, b], speed: 110, lifeMs: 700, size: 1.6 })
        fx.levelUpPulse()
        overlays.showLevelUp(e.value)
        break
      }
      case 'died': {
        const hx = s.bodyX[0] ?? 0
        const hy = s.bodyY[0] ?? 0
        const c = cellPx(hx, hy)
        const [r, g, b] = hexRgb(themeForLevel(s.level).palette.accent)
        let dir = 0 // 0 = full frame
        if (e.cause === 'wall') {
          // Wall death: particles fly off the wall (right/left), flash is local.
          if (hx >= GRID_W - 1) dir = 1
          else if (hx <= 0) dir = -1
        }
        particles.burst(c.x, c.y, 40, { color: [r, g, b], speed: 150, lifeMs: 900, size: 1.8 })
        fx.flash(1, dir)
        fx.shake(10)
        fx.shockwave(c.x, c.y)
        hs.save(s.highScore) // the domain bumped highScore to the final score
        break
      }
      default:
        break // turned / grew / spawned: no FX
    }
  }
}

function resize(): void {
  // Size the framebuffer to the glass (#screen), which is inset by the bezel.
  const w = screenEl?.clientWidth ?? window.innerWidth
  const h = screenEl?.clientHeight ?? window.innerHeight
  fb.resize(w, h, window.devicePixelRatio || 1)
  fx.resize(fb.getLayout())
  if (screenEl) {
    const r = screenEl.getBoundingClientRect()
    screenOx = r.left
    screenOy = r.top
  }
}

/**
 * One presentation frame's body (everything after the sim advances): particle
 * update, the 2D composite (ground truth), effect + audio consumption, and the
 * FX-engine gate. Extracted so the perf benchmark can drive it synchronously.
 * Steady-state, this allocates nothing (particles inactive, sink empty, palette
 * is a pre-existing reference, FX off at the low tier).
 */
function renderFrame(dt: number, alpha: number): void {
  particles.update(dt)
  const pal = themeForLevel(state.level).palette
  fb.draw(state, alpha, pal, particles)
  handleEffects(state)
  sound.consume(sink) // read-only: plays voices off the frame's emitted effects
  sinkReset(sink)
  // Gate the FX engine by the governor's tier (recompute only on a change).
  const t = governor.tier
  if (t !== lastTier) {
    lastTier = t
    fx.setEnabled(fxActive(t), t as FxTier)
  }
  if (fx.enabled) fx.setFrame(state, alpha, pal, particles)
}

let lastFrameTime = 0
function frame(now: number): void {
  // Feed the governor the real wall-clock frame cost (sim + render).
  const frameMs = lastFrameTime === 0 ? 0 : now - lastFrameTime
  lastFrameTime = now
  if (frameMs > 0) governor.feed(frameMs)

  drainIntents()
  loop.tickMs = tickMsForLevel(state.level)
  const mode = currentUiMode()
  // The sim steps only while actively playing; title / paused / gameover freeze
  // it (the 2D + HUD + overlay render still run every frame).
  if (mode === 'playing' && !frozen) currentAlpha = loop.update(now)
  renderFrame(frameMs > 0 ? frameMs : 16, currentAlpha)
  hud.update(state)
  // The sim may have just changed the phase this frame (e.g. a wall death), so
  // the overlays read the mode AFTER the step — the screen tracks the current
  // phase in the same frame it occurs.
  overlays.update(currentUiMode(), state)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
window.addEventListener('orientationchange', resize)
resize()

// Any key press or tap on the title screen begins a run (real players). The e2e
// suite drives the same transition explicitly via `window.__snake.start()`.
const beginOnInput = (): void => {
  if (!started) startGame()
}
window.addEventListener('keydown', beginOnInput)
window.addEventListener('pointerdown', beginOnInput)

requestAnimationFrame(frame)

// ---- debug API (window.__snake) ------------------------------------------
export interface SnakeDebugState {
  tick: number
  score: number
  phase: string
  level: number
  bodyLen: number
  seed: string
  dir: number
  foodX: number
  foodY: number
  headX: number
  headY: number
  highScore: number
  layout: Layout
}

declare global {
  interface Window {
    __snake: {
      get(): SnakeDebugState
      queue(intent: Intent): void
      freeze(): void
      unfreeze(): void
      setFrozen(v: boolean): void
      setDpadVisible(v: boolean): void
      dpadVisible(): boolean
      tier(): Tier
      setEffectsEnabled(v: boolean): void
      fxWebgl(): boolean
      fxEnabled(): boolean
      particleCount(): number
      /** Debug-only: place food at a cell so e2e can drive a deterministic eat. */
      placeFood(x: number, y: number): void
      /** Debug-only: persist a high score (with its checksum) for e2e. */
      setHighscore(n: number): void
      soundEnabled(): boolean
      setSoundEnabled(v: boolean): void
      soundReady(): boolean
      soundMuted(): boolean
      soundDuck(): number
      /** Debug: the AudioContext state ('none' pre-gesture, else 'running'/'suspended'). */
      contextState(): string
      /** Debug: the active locale (i18n). */
      locale(): string
      /** Debug: switch locale (i18n) so e2e can verify the re-render. */
      setLocale(l: 'en' | 'ja' | 'es'): void
      /** Debug: the active UI mode (`title | playing | paused | gameover`). */
      uiMode(): string
      /** Debug: begin a run (title → playing); mirrors the any-key/tap start. */
      start(): void
      /** Debug-only: set the score (and re-derive the level) so e2e can reach the MAX HUD state. */
      setScore(n: number): void
      /** Debug-only perf: drive `n` steady-state render frames (sim frozen). */
      perfWarm(n: number): number
      /** Debug-only perf: drive `sample` timed render frames and return stats (ms). */
      perfRun(sample: number): { p95: number; min: number; max: number; mean: number; count: number }
    }
  }
}

window.__snake = {
  get(): SnakeDebugState {
    return {
      tick: state.tick,
      score: state.score,
      phase: state.phase,
      level: state.level,
      bodyLen: state.bodyLen,
      seed: state.seed,
      dir: state.dir,
      foodX: state.foodX,
      foodY: state.foodY,
      headX: state.bodyX[0] ?? 0,
      headY: state.bodyY[0] ?? 0,
      highScore: state.highScore,
      layout: fb.getLayout(),
    }
  },
  queue(intent: Intent): void {
    intentQueue.push(intent)
  },
  freeze(): void {
    frozen = true
  },
  unfreeze(): void {
    frozen = false
    loop.reset()
  },
  setFrozen(v: boolean): void {
    frozen = v
  },
  setDpadVisible(v: boolean): void {
    dpad.setVisible(v)
  },
  dpadVisible(): boolean {
    return dpad.isVisible()
  },
  tier(): Tier {
    return governor.tier
  },
  setEffectsEnabled(v: boolean): void {
    governor.setEffectsEnabled(v)
  },
  fxWebgl(): boolean {
    return fx.webgl
  },
  fxEnabled(): boolean {
    return fx.enabled
  },
  particleCount(): number {
    return particles.active
  },
  placeFood(x: number, y: number): void {
    state.foodX = x
    state.foodY = y
  },
  setHighscore(n: number): void {
    state.highScore = n
    hs.save(n)
  },
  soundEnabled(): boolean {
    return sound.soundEnabled()
  },
  setSoundEnabled(v: boolean): void {
    sound.setEnabled(v)
  },
  soundReady(): boolean {
    return sound.isReady()
  },
  soundMuted(): boolean {
    return sound.isMuted()
  },
  soundDuck(): number {
    return sound.duckGain()
  },
  contextState(): string {
    return sound.contextState()
  },
  locale(): string {
    return getLocale()
  },
  setLocale(l: 'en' | 'ja' | 'es'): void {
    setLocale(l)
  },
  uiMode(): string {
    return currentUiMode()
  },
  start(): void {
    startGame()
  },
  setScore(n: number): void {
    state.score = n
    state.level = levelForScore(n)
  },
  perfWarm(n: number): number {
    const was = frozen
    frozen = true
    for (let i = 0; i < n; i++) renderFrame(16, currentAlpha)
    frozen = was
    return n
  },
  perfRun(sample: number): { p95: number; min: number; max: number; mean: number; count: number } {
    const was = frozen
    frozen = true
    const buf = new Float32Array(sample)
    for (let i = 0; i < sample; i++) {
      const t0 = performance.now()
      renderFrame(16, currentAlpha)
      buf[i] = performance.now() - t0
    }
    frozen = was
    const copy = Array.from(buf)
    copy.sort((a, b) => a - b)
    const idx = Math.min(sample - 1, Math.ceil(0.95 * sample) - 1)
    let sum = 0
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < sample; i++) {
      const v = buf[i] ?? 0
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }
    return { p95: copy[idx] ?? 0, min, max, mean: sum / sample, count: sample }
  },
}
