import { describe, expect, it } from 'vitest'
import {
  DUCK_GAIN,
  SOUND_KEY,
  SoundSynth,
  VOICE_RECIPES,
  readSoundEnabled,
  soundNameForEffect,
  writeSoundEnabled,
  type SoundName,
  type StorageLike,
} from '../../app/adapters/audio/synth'
import { createSink, sinkPush } from '../../app/domain/types'

// ---- pure persistence helpers -------------------------------------------
function memStorage(initial: Record<string, string> = {}): StorageLike {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

describe('sound persistence', () => {
  it('defaults to enabled when nothing is stored', () => {
    expect(readSoundEnabled(memStorage())).toBe(true)
  })
  it('honours explicit on/off values', () => {
    expect(readSoundEnabled(memStorage({ [SOUND_KEY]: '0' }))).toBe(false)
    expect(readSoundEnabled(memStorage({ [SOUND_KEY]: '1' }))).toBe(true)
  })
  it('treats any non-0 value as enabled (robust to garbage)', () => {
    expect(readSoundEnabled(memStorage({ [SOUND_KEY]: 'yes' }))).toBe(true)
  })
  it('round-trips a write', () => {
    const st = memStorage()
    writeSoundEnabled(st, false)
    expect(readSoundEnabled(st)).toBe(false)
    writeSoundEnabled(st, true)
    expect(readSoundEnabled(st)).toBe(true)
  })
  it('never throws when storage is unavailable', () => {
    const boom: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => undefined,
    }
    expect(readSoundEnabled(boom)).toBe(true)
    expect(() => writeSoundEnabled(boom, true)).not.toThrow()
  })
})

// ---- the effect → sound mapping (consumes the shared sink) --------------
describe('soundNameForEffect', () => {
  it('maps the meaningful game events to voices', () => {
    expect(soundNameForEffect('ate')).toBe('ate')
    expect(soundNameForEffect('levelup')).toBe('levelup')
    expect(soundNameForEffect('died')).toBe('died')
  })
  it('is silent for movement/growth/spawn', () => {
    expect(soundNameForEffect('turned')).toBeNull()
    expect(soundNameForEffect('grew')).toBeNull()
    expect(soundNameForEffect('spawned')).toBeNull()
  })
})

// ---- the voice recipe table + ducking constant --------------------------
describe('voice recipes', () => {
  it('the ducking gain caps the voice bus at 0.8', () => {
    expect(DUCK_GAIN).toBe(0.8)
  })
  it('every Phase-1 voice is well-formed', () => {
    const WAVES = new Set(['sine', 'square', 'sawtooth', 'triangle'])
    for (const name of ['ate', 'levelup', 'died'] as SoundName[]) {
      const r = VOICE_RECIPES[name]
      expect(WAVES.has(r.wave)).toBe(true)
      expect(r.notes.length).toBeGreaterThan(0)
      for (const f of r.notes) expect(f).toBeGreaterThan(0)
      expect(r.env.a).toBeGreaterThan(0)
      expect(r.env.d).toBeGreaterThanOrEqual(0)
      expect(r.env.r).toBeGreaterThan(0)
      expect(r.env.s).toBeGreaterThanOrEqual(0)
      expect(r.env.s).toBeLessThanOrEqual(1)
      expect(r.noteDur).toBeGreaterThan(0)
      expect(r.noteGap).toBeGreaterThan(0)
      expect(r.filterHz).toBeGreaterThan(0)
      expect(r.peak).toBeGreaterThan(0)
      expect(r.peak).toBeLessThanOrEqual(1)
    }
  })
})

// ---- a minimal Web Audio double -----------------------------------------
// Just enough surface for SoundSynth to build its graph and schedule envelopes.
// Tracks created gain/filter/oscillator nodes so the "preallocated, then
// reused" property is observable: gain nodes are allocated once in
// ensureContext and reused (not re-allocated) on every trigger.
interface FakeNodes {
  gains: number
  filters: number
  oscs: number
  master: { value: number } | null
}
function makeCtx() {
  const nodes: FakeNodes = { gains: 0, filters: 0, oscs: 0, master: null }
  const dest = {} as object
  const param = (value = 0) => {
    let v = value
    return {
      get value() {
        return v
      },
      set value(n: number) {
        v = n
      },
      cancelScheduledValues() {
        v = 0
      },
      setValueAtTime(n: number) {
        v = n
      },
      linearRampToValueAtTime(n: number) {
        v = n
      },
    }
  }
  const gain = () => {
    nodes.gains++
    const g = { gain: param(0), connect(t: unknown) { if (t === dest) nodes.master = g.gain } }
    return g
  }
  const filter = () => {
    nodes.filters++
    return { type: 'lowpass' as string, frequency: param(4000), connect() { /* noop */ } }
  }
  const osc = () => {
    nodes.oscs++
    return { type: 'sine' as string, frequency: param(440), connect() { /* noop */ }, start() { /* noop */ }, stop() { /* noop */ } }
  }
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: dest,
    createGain: gain,
    createBiquadFilter: filter,
    createOscillator: osc,
    suspend: async () => {
      ctx.state = 'suspended'
    },
    resume: async () => {
      ctx.state = 'running'
    },
  }
  return { ctx, nodes }
}

describe('SoundSynth node allocation', () => {
  it('preallocates the pool once and reuses gain nodes across triggers', () => {
    const { ctx, nodes } = makeCtx()
    const synth = new SoundSynth(memStorage(), () => ctx as unknown as AudioContext)
    expect(synth.isReady()).toBe(false)
    const c = synth.ensureContext()
    expect(c).toBeTruthy()
    expect(synth.isReady()).toBe(true)
    expect(synth.duckGain()).toBe(0.8)
    const gainsAtInit = nodes.gains
    const filtersAtInit = nodes.filters
    // Idempotent: a second ensureContext returns the same context, allocates nothing.
    expect(synth.ensureContext()).toBe(c)
    expect(nodes.gains).toBe(gainsAtInit)

    // An 'ate' (2 notes) creates oscillators but reuses the preallocated
    // gain/filter nodes — the node counts other than oscillators stay constant.
    const sink = createSink()
    sinkPush(sink, 'ate', 17, 15, 10, 'none')
    const oscsBefore = nodes.oscs
    synth.consume(sink)
    expect(nodes.oscs).toBe(oscsBefore + 2)
    expect(nodes.gains).toBe(gainsAtInit)
    expect(nodes.filters).toBe(filtersAtInit)
  })

  it('setEnabled(false) zeroes the master gain and silences consume', () => {
    const { ctx, nodes } = makeCtx()
    const synth = new SoundSynth(memStorage(), () => ctx as unknown as AudioContext)
    synth.ensureContext()
    expect(nodes.master).not.toBeNull()
    expect(nodes.master!.value).toBeCloseTo(0.9) // enabled → full volume
    synth.setEnabled(false)
    expect(nodes.master!.value).toBe(0)
    expect(synth.isMuted()).toBe(true)
    const sink = createSink()
    sinkPush(sink, 'ate', 1, 1, 10, 'none')
    const before = nodes.oscs
    synth.consume(sink) // disabled → no-op
    expect(nodes.oscs).toBe(before)
  })

  it('toggle() flips the enable state and persists it', () => {
    const st = memStorage()
    const { ctx } = makeCtx()
    const synth = new SoundSynth(st, () => ctx as unknown as AudioContext)
    synth.ensureContext()
    synth.toggle()
    expect(synth.soundEnabled()).toBe(false)
    expect(readSoundEnabled(st)).toBe(false)
    synth.toggle()
    expect(synth.soundEnabled()).toBe(true)
    expect(readSoundEnabled(st)).toBe(true)
  })
})
