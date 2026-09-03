// Game wiring. Connects the pure domain to the runtime loop, the 2D framebuffer
// (always drawn as the guaranteed fallback), and the input queue, and exposes a
// small `window.__snake` debug API for the e2e suite. Rendering and audio are
// read-only observers of state and emitted effects; they never mutate state.
import { enqueue } from './domain/intents'
import { tickMsForLevel } from './domain/levels'
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
import { createGamepad } from './adapters/input/gamepad'
import { createKeyboard } from './adapters/input/keyboard'
import { createDpad, createSwipe } from './adapters/input/touch'
import { Framebuffer, type Layout } from './adapters/render/framebuffer'
import { ParticleSystem } from './adapters/render/particles'
import { fxActive, PhaserFx, type FxTier } from './adapters/render/phaser/phaser-fx'
import { themeForLevel } from './adapters/render/theme'
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

/** Apply a turn/pause (or restart, which re-inits from the same seed). */
function applyIntent(intent: Intent): void {
  if (intent.kind === 'restart') {
    state = init(state.seed)
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

/** Parse a #rrggbb colour to a 0-255 RGB triple (FX particle colouring). */
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Consume the frame's emitted effects and drive the presentation FX (particles,
 * flash, shake, shockwave). Read-only with respect to domain state — we only
 * read the effects and the current state to position the FX.
 */
function handleEffects(s: SnakeState): void {
  for (let i = 0; i < sink.len; i++) {
    const e: Effect = sink.buf[i]!
    switch (e.kind) {
      case 'ate': {
        const c = cellPx(e.x, e.y)
        const [r, g, b] = hexRgb(themeForLevel(s.level).palette.food)
        particles.burst(c.x, c.y, 14, { color: [r, g, b], speed: 70, lifeMs: 480, size: 1.4 })
        break
      }
      case 'levelup': {
        const c = cellPx(s.bodyX[0] ?? 0, s.bodyY[0] ?? 0)
        const [r, g, b] = hexRgb(themeForLevel(s.level).palette.accent)
        particles.burst(c.x, c.y, 26, { color: [r, g, b], speed: 110, lifeMs: 700, size: 1.6 })
        fx.levelUpPulse()
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
        break
      }
      default:
        break // turned / grew / spawned: no FX
    }
  }
}

function resize(): void {
  fb.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
  fx.resize(fb.getLayout())
}

let lastFrameTime = 0
function frame(now: number): void {
  // Feed the governor the real wall-clock frame cost (sim + render).
  const frameMs = lastFrameTime === 0 ? 0 : now - lastFrameTime
  lastFrameTime = now
  if (frameMs > 0) governor.feed(frameMs)

  drainIntents()
  loop.tickMs = tickMsForLevel(state.level)
  if (!frozen) currentAlpha = loop.update(now)
  // Advance the FX particles, then draw the 2D composite (the ground truth).
  particles.update(frameMs > 0 ? frameMs : 16)
  const pal = themeForLevel(state.level).palette
  fb.draw(state, currentAlpha, pal, particles)
  handleEffects(state)
  sinkReset(sink)
  // Gate the FX engine by the governor's tier (recompute only on a change).
  const t = governor.tier
  if (t !== lastTier) {
    lastTier = t
    fx.setEnabled(fxActive(t), t as FxTier)
  }
  if (fx.enabled) fx.setFrame(state, currentAlpha, pal, particles)
  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
window.addEventListener('orientationchange', resize)
resize()
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
}
