// Game wiring. Connects the pure domain to the runtime loop, the 2D framebuffer
// (always drawn as the guaranteed fallback), and the input queue, and exposes a
// small `window.__snake` debug API for the e2e suite. Rendering and audio are
// read-only observers of state and emitted effects; they never mutate state.
import { enqueue } from './domain/intents'
import { tickMsForLevel } from './domain/levels'
import { init, step } from './domain/step'
import { createSink, sinkReset, type Intent, type SnakeState } from './domain/types'
import { Framebuffer, type Layout } from './adapters/render/framebuffer'
import { themeForLevel } from './adapters/render/theme'
import { FixedTimestepLoop } from './runtime/loop'

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

function resize(): void {
  fb.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
}

function frame(now: number): void {
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
}
