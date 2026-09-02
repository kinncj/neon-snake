import { describe, expect, it } from 'vitest'
import {
  DE_ESCALATE_MS,
  ESCALATE_MS,
  FRAME_WINDOW,
  MIN_INTERVAL_FRAMES,
  QualityGovernor,
  medianOf,
  startingTier,
  type QualityProbe,
  type Tier,
} from '../../app/runtime/quality'

const probe = (over: Partial<QualityProbe> = {}): QualityProbe => ({
  webgl2: true,
  maxTextureSize: 16384,
  cores: 8,
  prefersReducedMotion: false,
  ...over,
})

/** Feed `n` frames of the given duration. */
function feed(g: QualityGovernor, ms: number, n: number): void {
  for (let i = 0; i < n; i++) g.feed(ms)
}

describe('startingTier', () => {
  it('strong hardware starts at ultra', () => {
    expect(startingTier(probe())).toBe('ultra')
  })
  it('no WebGL2 starts at low', () => {
    expect(startingTier(probe({ webgl2: false }))).toBe('low')
  })
  it('few cores or a tiny max texture start at high', () => {
    expect(startingTier(probe({ cores: 2 }))).toBe('high')
    expect(startingTier(probe({ maxTextureSize: 2048 }))).toBe('high')
  })
  it('prefers-reduced-motion forces reduced regardless of hardware', () => {
    expect(startingTier(probe({ prefersReducedMotion: true }))).toBe('reduced')
  })
})

describe('medianOf', () => {
  it('returns the middle value for an odd count', () => {
    expect(medianOf([5, 1, 3], 3)).toBe(3)
  })
  it('averages the two middle values for an even count', () => {
    expect(medianOf([4, 1, 3, 2], 4)).toBe(2.5)
  })
  it('handles a single value', () => {
    expect(medianOf([7], 1)).toBe(7)
  })
  it('ignores values past len', () => {
    expect(medianOf([5, 1, 999], 2)).toBe(3)
  })
})

describe('QualityGovernor escalation', () => {
  it('escalates low -> high -> ultra once the median drops below the threshold', () => {
    const g = new QualityGovernor('low')
    // fill the 120-frame window with fast frames (< 11 ms)
    feed(g, 5, FRAME_WINDOW)
    expect(g.tier).toBe('high')
    feed(g, 5, MIN_INTERVAL_FRAMES) // cooldown + a fresh window
    expect(g.tier).toBe('ultra')
  })

  it('cannot escalate past the ceiling', () => {
    const g = new QualityGovernor('high', 'high') // ceiling = high (no ultra)
    feed(g, 5, FRAME_WINDOW + MIN_INTERVAL_FRAMES + 10)
    expect(g.tier).toBe('high')
  })

  it('does not change while the window is not full', () => {
    const g = new QualityGovernor('ultra')
    feed(g, 20, FRAME_WINDOW - 1) // 119 frames, not yet full
    expect(g.tier).toBe('ultra')
  })
})

describe('QualityGovernor de-escalation', () => {
  it('de-escalates ultra -> high -> low when the median rises past the threshold', () => {
    const g = new QualityGovernor('ultra')
    feed(g, DE_ESCALATE_MS + 2, FRAME_WINDOW)
    expect(g.tier).toBe('high')
    feed(g, DE_ESCALATE_MS + 2, MIN_INTERVAL_FRAMES)
    expect(g.tier).toBe('low')
  })

  it('stops at low and never goes below', () => {
    const g = new QualityGovernor('low')
    feed(g, DE_ESCALATE_MS + 5, FRAME_WINDOW + MIN_INTERVAL_FRAMES + 10)
    expect(g.tier).toBe('low')
  })
})

describe('QualityGovernor cooldown', () => {
  it('waits MIN_INTERVAL_FRAMES between changes', () => {
    const g = new QualityGovernor('ultra')
    // de-escalate to high
    feed(g, DE_ESCALATE_MS + 2, FRAME_WINDOW)
    expect(g.tier).toBe('high')
    // immediately try to de-escalate again, but only a few frames have passed
    // (framesSinceChange was reset to 0) — must not change yet.
    feed(g, DE_ESCALATE_MS + 2, MIN_INTERVAL_FRAMES - 1)
    expect(g.tier).toBe('high')
    // one more frame completes the cooldown; now the (already-full) window
    // still reads slow, so it may de-escalate to low.
    feed(g, DE_ESCALATE_MS + 2, 1)
    expect(g.tier).toBe('low')
  })
})

describe('QualityGovernor reduced override', () => {
  it('setEffectsEnabled(false) forces reduced', () => {
    const g = new QualityGovernor('ultra')
    g.setEffectsEnabled(false)
    expect(g.tier).toBe('reduced')
  })
  it('the governor never walks out of reduced while effects are off', () => {
    const g = new QualityGovernor('ultra')
    g.setEffectsEnabled(false)
    feed(g, 5, FRAME_WINDOW + MIN_INTERVAL_FRAMES + 10)
    expect(g.tier).toBe('reduced')
  })
  it('re-enabling effects releases the override back to low', () => {
    const g = new QualityGovernor('ultra')
    g.setEffectsEnabled(false)
    expect(g.tier).toBe('reduced')
    g.setEffectsEnabled(true)
    expect(g.tier).toBe('low')
  })
  it('a reduced-start governor stays reduced under fast frames', () => {
    const g = new QualityGovernor('reduced')
    feed(g, 5, FRAME_WINDOW + MIN_INTERVAL_FRAMES + 10)
    expect(g.tier).toBe('reduced')
  })
})

describe('QualityGovernor set()', () => {
  it('a forced set (e.g. GL context loss) overrides the current tier', () => {
    const g = new QualityGovernor('ultra')
    g.set('low')
    expect(g.tier).toBe('low')
  })
  it('set(reduced) sets the forced override', () => {
    const g = new QualityGovernor('high')
    const t: Tier = 'reduced'
    g.set(t)
    feed(g, 5, FRAME_WINDOW + MIN_INTERVAL_FRAMES + 10)
    expect(g.tier).toBe('reduced')
  })
})
