// Game wiring. Connects the pure domain to the runtime loop, the 2D framebuffer
// (always drawn as the guaranteed fallback), and the input queue, and exposes a
// small `window.__snake` debug API for the e2e suite. Rendering and audio are
// read-only observers of state and emitted effects; they never mutate state.
import { enqueue } from './domain/intents'
import { tickMsForLevel } from './domain/levels'
import { init, step } from './domain/step'
import { createSink, sinkReset, type Intent, type SnakeState } from './domain/types'
import { createGamepad } from './adapters/input/gamepad'
import { createKeyboard } from './adapters/input/keyboard'
import { createDpad, createSwipe } from './adapters/input/touch'
import { Framebuffer, type Layout } from './adapters/render/framebuffer'
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
let state: SnakeState = init(SEED)
const sink = createSink()
let frozen = false
let currentAlpha = 0

/** Apply a turn/pause (or restart, which re-inits from the same seed). */
function applyIntent(intent: Intent): void {
  if (intent.kind === 'restart') state = init(state.seed)
  else state = enqueue(state, intent)
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

function resize(): void {
  fb.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
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
  fb.draw(state, currentAlpha, themeForLevel(state.level).palette)
  sinkReset(sink)
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
}
