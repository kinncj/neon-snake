// Quality-tier selection and the frame-time governor.
//
// Tiers: `low` (2D composite only), `high` (engine snake/food/grid/particles +
// camera shake/flash), `ultra` (high + CRT scanline overlay, radial vignette,
// luminance flicker), `reduced` (low visuals, static — no shake/displacement).
//
// The governor is a rolling 120-frame median: it de-escalates when the median
// frame time exceeds 18 ms and escalates when it drops below 11 ms, at most
// once per 180 frames. `reduced` is a hard override — prefers-reduced-motion or
// the user's Effects toggle forces it and the governor never walks out of it.
//
// No DOM access here: the probe values are read by the caller (main.ts) and
// injected, which keeps this module testable without a browser.

export type Tier = 'low' | 'high' | 'ultra' | 'reduced'

export const FRAME_WINDOW: number = 120
export const DE_ESCALATE_MS: number = 18
export const ESCALATE_MS: number = 11
export const MIN_INTERVAL_FRAMES: number = 180

/** The performance ladder, in ascending order. `reduced` is not on the ladder. */
const LADDER: readonly Tier[] = ['low', 'high', 'ultra']

export interface QualityProbe {
  webgl2: boolean
  maxTextureSize: number
  cores: number
  prefersReducedMotion: boolean
}

/**
 * Starting tier from capability: no WebGL2 → low; a weak GPU/CPU (few cores or
 * a tiny max texture) starts at high; otherwise ultra. The governor can move
 * either way from any of these.
 */
export function startingTier(p: QualityProbe): Tier {
  if (p.prefersReducedMotion) return 'reduced'
  if (!p.webgl2) return 'low'
  if (p.cores < 4 || p.maxTextureSize < 4096) return 'high'
  return 'ultra'
}

/** Median of the first `len` values (test helper; the governor sorts in place). */
export function medianOf(values: ArrayLike<number>, len: number): number {
  const n = Math.min(len, values.length)
  if (n === 0) return 0
  const sorted: number[] = new Array(n)
  for (let i = 0; i < n; i++) sorted[i] = values[i]!
  sorted.sort((a, b) => a - b)
  const lo = (n - 1) >> 1
  return n % 2 === 1 ? sorted[lo]! : (sorted[lo]! + sorted[lo + 1]!) / 2
}

export class QualityGovernor {
  private readonly buf: Float32Array
  /** Scratch for the in-place median sort — zero steady-state allocation. */
  private readonly scratch: Float32Array
  private readonly ceilingIdx: number
  private head = 0
  private count = 0
  private framesSinceChange = MIN_INTERVAL_FRAMES
  private current: Tier
  /** Hard override: prefers-reduced-motion or the user's Effects toggle off. */
  private forcedReduced: boolean

  /**
   * `ceiling` caps escalation — without WebGL2 the engine cannot render, so the
   * ladder stops at `low` even if the machine is fast.
   */
  constructor(start: Tier, ceiling: Tier = 'ultra') {
    this.buf = new Float32Array(FRAME_WINDOW)
    this.scratch = new Float32Array(FRAME_WINDOW)
    this.ceilingIdx = Math.max(0, LADDER.indexOf(ceiling))
    this.current = start
    this.forcedReduced = start === 'reduced'
  }

  /** Median of the ring, sorted in place on the scratch buffer (no allocation). */
  private median(): number {
    const n = this.count
    const s = this.scratch
    // The current window is the last `n` writes; with a wrapping ring it starts
    // at (head - n) mod FRAME_WINDOW.
    const start = (this.head - n + FRAME_WINDOW) % FRAME_WINDOW
    for (let i = 0; i < n; i++) s[i] = this.buf[(start + i) % FRAME_WINDOW]!
    for (let i = 1; i < n; i++) {
      const v = s[i]!
      let j = i - 1
      while (j >= 0 && s[j]! > v) {
        s[j + 1] = s[j]!
        j--
      }
      s[j + 1] = v
    }
    const lo = (n - 1) >> 1
    return n % 2 === 1 ? s[lo]! : (s[lo]! + s[lo + 1]!) / 2
  }

  /** The governor's current tier. */
  get tier(): Tier {
    return this.current
  }

  /** The user's Effects toggle: off forces `reduced`, on releases the override. */
  setEffectsEnabled(enabled: boolean): void {
    this.forcedReduced = !enabled
    if (!enabled) this.current = 'reduced'
    else if (this.current === 'reduced') this.current = 'low'
  }

  /**
   * Feed one frame's time (ms). Returns the tier after any change. A change
   * needs a full 120-frame window, the median past a threshold, and at least
   * MIN_INTERVAL_FRAMES since the last change.
   */
  feed(ms: number): Tier {
    this.framesSinceChange++
    this.buf[this.head] = ms
    this.head = (this.head + 1) % FRAME_WINDOW
    this.count = Math.min(this.count + 1, FRAME_WINDOW)

    if (this.forcedReduced || this.count < FRAME_WINDOW || this.framesSinceChange < MIN_INTERVAL_FRAMES) {
      return this.current
    }

    const med = this.median()
    const idx = LADDER.indexOf(this.current)
    if (idx === -1) return this.current // reduced is not on the ladder

    if (med > DE_ESCALATE_MS && idx > 0) {
      const next = LADDER[idx - 1]!
      this.current = next
      this.framesSinceChange = 0
    } else if (med < ESCALATE_MS && idx < this.ceilingIdx) {
      const next = LADDER[idx + 1]!
      this.current = next
      this.framesSinceChange = 0
    }
    return this.current
  }

  /** A forced tier change (e.g. GL context loss drops to low). Resets cooldown. */
  set(tier: Tier): void {
    this.current = tier
    this.forcedReduced = tier === 'reduced'
    this.framesSinceChange = 0
  }
}
