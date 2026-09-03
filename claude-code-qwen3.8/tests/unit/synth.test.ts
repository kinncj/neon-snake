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
  type SfxEngine,
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
    expect(soundNameForEffect('ate', 1, 'none')).toBe('ate')
    expect(soundNameForEffect('levelup', 0, 'none')).toBe('levelup')
    // A death resolves by cause: wall → boom, self → splat.
    expect(soundNameForEffect('died', 0, 'wall')).toBe('boom')
    expect(soundNameForEffect('died', 0, 'self')).toBe('splat')
    expect(soundNameForEffect('died', 0, 'none')).toBe('boom')
  })
  it('swaps the chomp for a coin on a combo', () => {
    expect(soundNameForEffect('ate', 1, 'none')).toBe('ate')
    expect(soundNameForEffect('ate', 2, 'none')).toBe('coin')
    expect(soundNameForEffect('ate', 5, 'none')).toBe('coin')
  })
  it('is silent for movement/growth/spawn', () => {
    expect(soundNameForEffect('turned', 0, 'none')).toBeNull()
    expect(soundNameForEffect('grew', 0, 'none')).toBeNull()
    expect(soundNameForEffect('spawned', 0, 'none')).toBeNull()
  })
})

// ---- the voice recipe table + ducking constant --------------------------
describe('voice recipes', () => {
  it('the ducking gain caps the voice bus at 0.8', () => {
    expect(DUCK_GAIN).toBe(0.8)
  })
  it('every event voice is well-formed', () => {
    const WAVES = new Set(['sine', 'square', 'sawtooth', 'triangle'])
    for (const name of [
      'ate',
      'levelup',
      'boom',
      'splat',
      'gameover',
      'coin',
    ] as SoundName[]) {
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

// ---- SoundSynth: the engine-agnostic SFX decision logic -----------------
// The audio itself is the sanctioned Phase-3 engine (Tone.js, ADR 0007), which
// needs a real AudioContext and is exercised in the browser by the e2e gate.
// Here a stub engine records which voices are scheduled so the DECISION logic —
// the effect→voice mapping, the game-over sting layering, the combo coin, mute,
// and the gesture-gating — is testable in Node, without any Web Audio.
class StubEngine implements SfxEngine {
  plays: SoundName[] = []
  master = 0
  state = 'running'
  built = false
  private bus: GainNode | null = null
  async ensure(): Promise<unknown> {
    if (this.built) return { state: this.state }
    this.built = true
    return { state: this.state }
  }
  ready(): boolean {
    return this.built
  }
  contextState(): string {
    return this.state
  }
  play(name: SoundName): void {
    if (this.built) this.plays.push(name)
  }
  setMaster(v: number): void {
    this.master = v
  }
  musicBus(): GainNode | null {
    return this.bus
  }
  async suspend(): Promise<void> {
    if (this.built) this.state = 'suspended'
  }
  async resume(): Promise<void> {
    if (this.built) this.state = 'running'
  }
  detach(): void {
    this.built = false
    this.plays = []
  }
}

describe('SoundSynth (engine-agnostic decision logic)', () => {
  it('constructs without a context; no gesture means no audio', () => {
    // The default factory (ToneSfxEngine) is not invoked until ensure, so a
    // fresh synth holds no context and reports none / not-ready / no last SFX.
    const synth = new SoundSynth(memStorage())
    expect(synth.isReady()).toBe(false)
    expect(synth.contextState()).toBe('none')
    expect(synth.lastSfx()).toBe('')
    const sink = createSink()
    sinkPush(sink, 'ate', 1, 1, 10, 'none')
    synth.consume(sink) // no context → no-op
    expect(synth.lastSfx()).toBe('')
  })

  it('ensureContext builds the engine once, applies the master, and is idempotent', async () => {
    const stub = new StubEngine()
    const synth = new SoundSynth(memStorage(), () => stub)
    expect(synth.isReady()).toBe(false)
    const h = await synth.ensureContext()
    expect(h).toBeTruthy()
    expect(synth.isReady()).toBe(true)
    expect(stub.master).toBeCloseTo(0.9) // enabled → full volume
    expect(synth.duckGain()).toBe(0.8)
    expect(await synth.ensureContext()).toBe(h) // idempotent: same handle
    expect(stub.plays).toEqual([]) // ensure schedules nothing
  })

  it('consume schedules the mapped voice and records lastSfx', async () => {
    const stub = new StubEngine()
    const synth = new SoundSynth(memStorage(), () => stub)
    await synth.ensureContext()
    const sink = createSink()
    sinkPush(sink, 'ate', 17, 15, 10, 'none')
    synth.consume(sink)
    expect(stub.plays).toEqual(['ate'])
    expect(synth.lastSfx()).toBe('ate')
  })

  it('layers the game-over sting under a wall death (boom) and self (splat)', async () => {
    const stub = new StubEngine()
    const synth = new SoundSynth(memStorage(), () => stub)
    await synth.ensureContext()
    const wall = createSink()
    sinkPush(wall, 'died', 16, 15, 0, 'wall')
    synth.consume(wall)
    // The sting is scheduled first, then the cause-specific hit → lastSfx is the hit.
    expect(stub.plays).toEqual(['gameover', 'boom'])
    expect(synth.lastSfx()).toBe('boom')

    const self = createSink()
    sinkPush(self, 'died', 16, 15, 0, 'self')
    synth.consume(self)
    expect(stub.plays[stub.plays.length - 1]).toBe('splat')
    expect(synth.lastSfx()).toBe('splat')
  })

  it('swaps the chomp for a coin on a combo', async () => {
    const stub = new StubEngine()
    const synth = new SoundSynth(memStorage(), () => stub)
    await synth.ensureContext()
    const sink = createSink()
    sinkPush(sink, 'ate', 17, 15, 10, 'none')
    synth.consume(sink, 2)
    expect(stub.plays).toContain('coin')
  })

  it('does not schedule while the context is suspended', async () => {
    const stub = new StubEngine()
    const synth = new SoundSynth(memStorage(), () => stub)
    await synth.ensureContext()
    stub.state = 'suspended'
    const sink = createSink()
    sinkPush(sink, 'ate', 1, 1, 10, 'none')
    synth.consume(sink)
    expect(stub.plays).toEqual([])
  })

  it('setEnabled(false) zeroes the master and silences consume', async () => {
    const stub = new StubEngine()
    const synth = new SoundSynth(memStorage(), () => stub)
    await synth.ensureContext()
    synth.setEnabled(false)
    expect(stub.master).toBe(0)
    expect(synth.isMuted()).toBe(true)
    const sink = createSink()
    sinkPush(sink, 'ate', 1, 1, 10, 'none')
    const before = stub.plays.length
    synth.consume(sink) // disabled → no-op
    expect(stub.plays.length).toBe(before)
  })

  it('toggle() flips the enable state and persists it', async () => {
    const st = memStorage()
    const synth = new SoundSynth(st, () => new StubEngine())
    await synth.ensureContext()
    synth.toggle()
    expect(synth.soundEnabled()).toBe(false)
    expect(readSoundEnabled(st)).toBe(false)
    synth.toggle()
    expect(synth.soundEnabled()).toBe(true)
    expect(readSoundEnabled(st)).toBe(true)
  })
})
