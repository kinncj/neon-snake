// Procedural Web Audio SFX. No asset bytes: every voice is synthesized from
// oscillators + a low-pass + a per-voice gain envelope (ADSR). The synth reads
// the shared EffectSink (the same ring the renderer consumes) and drives sounds
// off the emitted effect kinds — it never touches (much less mutates) domain
// state, which it does not even receive.
//
// "Preallocated nodes reused across triggers": the master chain (voice bus →
// 0.8 ducking gain → master gain) and a fixed pool of per-voice low-pass +
// gain nodes are built ONCE, lazily, and then reused for every subsequent
// trigger. The one node that cannot be reused is the OscillatorNode itself —
// the Web Audio spec forbids restarting a stopped oscillator — so a short-lived
// oscillator is created per note and left to GC; the expensive, sustaining
// gain/filter nodes are the preallocated, reused ones.
//
// Autoplay policy: no AudioContext is created until an explicit user gesture
// (the first keydown/pointerdown). `consume()` is a no-op before then. The
// enable state persists in localStorage; mute is keyboard-reachable ('M') and
// a labelled, focusable control; the context is suspended when the tab hides.
//
// Phase 1 ships pulse/triangle/lead voices. Phase 2 adds noise/membrane voices
// (kick/snare) for the lo-fi BGM — the pool and recipe table are shaped to
// absorb those without changing the trigger path.
import type { EffectKind, EffectSink } from '../../domain/types'

export type SoundName = 'ate' | 'levelup' | 'died'

/**
 * The ducking gain on the voice bus: it caps the summed voice level at 0.8 of
 * full scale so a cluster of overlapping voices can't clip. The test pins it.
 */
export const DUCK_GAIN: number = 0.8
/** Base master gain when sound is enabled (before the 0.8 duck still applies). */
const VOLUME: number = 0.9
/** How many preallocated voice channels are pooled (each: low-pass + gain). */
const POOL_SIZE: number = 8

/** Minimal storage surface (so the persistence logic is testable in Node). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SOUND_KEY: string = 'snake.sound'

/** The per-voice recipe. `wave` is a Web Audio oscillator type. */
export interface VoiceRecipe {
  wave: 'sine' | 'square' | 'sawtooth' | 'triangle'
  /** Frequencies (Hz) played in order. */
  notes: readonly number[]
  /** Seconds to hold each note's sustain. */
  noteDur: number
  /** Seconds between successive note starts (< noteDur overlaps them). */
  noteGap: number
  /** ADSR, in seconds: attack, decay, sustain LEVEL (0..1), release. */
  env: { a: number; d: number; s: number; r: number }
  /** Low-pass cutoff (Hz) for the voice. */
  filterHz: number
  /** Per-voice peak gain (pre-duck). Kept low so the sum stays under the cap. */
  peak: number
}

// The voice library. Ate = a quick upward blip; level-up = an ascending lead
// arpeggio; death = a falling sawtooth sweep. Phase 2 appends drum recipes.
export const VOICE_RECIPES: Readonly<Record<SoundName, VoiceRecipe>> = {
  ate: {
    wave: 'triangle',
    notes: [659.25, 880.0],
    noteDur: 0.08,
    noteGap: 0.05,
    env: { a: 0.004, d: 0.05, s: 0.4, r: 0.09 },
    filterHz: 4200,
    peak: 0.25,
  },
  levelup: {
    wave: 'square',
    notes: [523.25, 659.25, 783.99, 1046.5],
    noteDur: 0.12,
    noteGap: 0.09,
    env: { a: 0.004, d: 0.08, s: 0.5, r: 0.16 },
    filterHz: 5200,
    peak: 0.22,
  },
  died: {
    wave: 'sawtooth',
    notes: [392.0, 329.63, 261.63, 196.0],
    noteDur: 0.16,
    noteGap: 0.13,
    env: { a: 0.005, d: 0.14, s: 0.3, r: 0.38 },
    filterHz: 1800,
    peak: 0.28,
  },
}

/**
 * Which SFX (if any) an emitted effect triggers. Only the meaningful game
 * events sound; movement/growth/spawn are silent. Pure — unit-tested.
 */
export function soundNameForEffect(kind: EffectKind): SoundName | null {
  switch (kind) {
    case 'ate':
      return 'ate'
    case 'levelup':
      return 'levelup'
    case 'died':
      return 'died'
    default:
      return null
  }
}

/** Read the persisted sound-enabled flag (default: on). Never throws. */
export function readSoundEnabled(storage: StorageLike): boolean {
  try {
    const v = storage.getItem(SOUND_KEY)
    if (v === null) return true
    return v !== '0'
  } catch {
    return true
  }
}

/** Persist the sound-enabled flag. Never throws (storage may be unavailable). */
export function writeSoundEnabled(storage: StorageLike, enabled: boolean): void {
  try {
    storage.setItem(SOUND_KEY, enabled ? '1' : '0')
  } catch {
    // in-memory state still holds
  }
}

/** Construct a Web Audio context, or throw (the caller treats that as no audio). */
function defaultAudioContext(): AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) throw new Error('Web Audio is not available')
  return new Ctor()
}

interface VoiceChannel {
  filter: BiquadFilterNode
  gain: GainNode
}

export class SoundSynth {
  private readonly storage: StorageLike
  private readonly ctxFactory: () => AudioContext
  private ctx: AudioContext | null = null
  private voiceBus: GainNode | null = null
  private master: GainNode | null = null
  private readonly pool: VoiceChannel[] = []
  private poolIndex = 0
  enabled: boolean

  constructor(storage: StorageLike, ctxFactory?: () => AudioContext) {
    this.storage = storage
    this.ctxFactory = ctxFactory ?? defaultAudioContext
    this.enabled = readSoundEnabled(storage)
  }

  /**
   * Lazily create the AudioContext (only called from a user gesture) and build
   * the master chain + the preallocated voice pool once. Idempotent; returns
   * the context, or null when Web Audio is unavailable.
   */
  ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx
    let ctx: AudioContext
    try {
      ctx = this.ctxFactory()
    } catch {
      return null
    }
    this.ctx = ctx
    const voiceBus = ctx.createGain()
    voiceBus.gain.value = 1
    const duck = ctx.createGain()
    duck.gain.value = DUCK_GAIN // caps the summed voice bus at 0.8
    const master = ctx.createGain()
    master.gain.value = this.enabled ? VOLUME : 0
    voiceBus.connect(duck)
    duck.connect(master)
    master.connect(ctx.destination)
    this.voiceBus = voiceBus
    this.master = master
    for (let i = 0; i < POOL_SIZE; i++) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 4000
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(voiceBus)
      this.pool.push({ filter, gain })
    }
    this.poolIndex = 0
    return ctx
  }

  /**
   * Read the frame's effects and play the matching voices. No-op before a
   * gesture (no context) or when sound is disabled. Zero steady-state
   * allocation: `sink.len` is 0 most frames and the mapping allocates nothing.
   */
  consume(sink: EffectSink): void {
    if (!this.enabled || !this.ctx) return
    for (let i = 0; i < sink.len; i++) {
      const name = soundNameForEffect(sink.buf[i]!.kind)
      if (name) this.play(name)
    }
  }

  private play(name: SoundName): void {
    const ctx = this.ctx
    if (!ctx || !this.voiceBus || ctx.state === 'suspended') return
    const recipe = VOICE_RECIPES[name]
    const t0 = ctx.currentTime
    for (let k = 0; k < recipe.notes.length; k++) {
      const freq = recipe.notes[k] ?? 0
      if (freq <= 0) continue
      const channel = this.pool[this.poolIndex]
      // Round-robin over the preallocated channels: the gain + filter nodes are
      // reused; only the one-shot oscillator is created fresh.
      this.poolIndex = (this.poolIndex + 1) % POOL_SIZE
      if (!channel) continue
      const { a, d, s, r } = recipe.env
      const t = t0 + k * recipe.noteGap
      const sustainEnd = t + a + d + recipe.noteDur
      const g = channel.gain.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(0.0001, t)
      g.linearRampToValueAtTime(recipe.peak, t + a) // A
      g.linearRampToValueAtTime(recipe.peak * s, t + a + d) // D -> S
      g.setValueAtTime(recipe.peak * s, sustainEnd) // hold S
      g.linearRampToValueAtTime(0.0001, sustainEnd + r) // R
      channel.filter.frequency.value = recipe.filterHz
      const osc = ctx.createOscillator()
      osc.type = recipe.wave
      osc.frequency.value = freq
      osc.connect(channel.filter)
      osc.start(t)
      osc.stop(sustainEnd + r + 0.02)
    }
  }

  /** Set (and persist) the sound-enabled state. Zeroes the master gain when off. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    writeSoundEnabled(this.storage, enabled)
    if (this.master) this.master.gain.value = enabled ? VOLUME : 0
  }

  toggle(): void {
    this.setEnabled(!this.enabled)
  }

  soundEnabled(): boolean {
    return this.enabled
  }

  isMuted(): boolean {
    return !this.enabled
  }

  /** Whether the (post-gesture) AudioContext has been created. */
  isReady(): boolean {
    return this.ctx !== null
  }

  /** The AudioContext state, or 'none' before a gesture. */
  contextState(): string {
    return this.ctx ? this.ctx.state : 'none'
  }

  /** The voice-bus ducking gain (0.8), for the e2e gate. */
  duckGain(): number {
    return DUCK_GAIN
  }

  /** Suspend the context (tab hidden) to save CPU. Safe no-op if absent. */
  async suspend(): Promise<void> {
    const ctx = this.ctx
    if (ctx && ctx.state === 'running') {
      try {
        await ctx.suspend()
      } catch {
        // ignore
      }
    }
  }

  /** Resume the context (tab shown). Only when sound is enabled. */
  async resume(): Promise<void> {
    const ctx = this.ctx
    if (ctx && this.enabled && ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // ignore
      }
    }
  }
}

/** The audio adapter handle returned to the runtime wiring. */
export interface SoundHandle {
  root: HTMLElement
  consume(sink: EffectSink): void
  setEnabled(enabled: boolean): void
  toggle(): void
  soundEnabled(): boolean
  isMuted(): boolean
  isReady(): boolean
  contextState(): string
  duckGain(): number
  detach(): void
}

/**
 * Wire the SoundSynth to the page: the labelled mute control, the 'M' shortcut,
 * the first-gesture AudioContext unlock, and the visibility suspend/resume.
 * Returns the handle plus the control element to append to the document.
 */
export function createSound(): SoundHandle {
  const synth = new SoundSynth(window.localStorage)

  // Gesture-gated unlock: create the context on the first real input, then stop
  // listening. Idempotent if Web Audio is unavailable (we keep retrying cheaply).
  let unlocked = false
  const onGesture = (): void => {
    if (unlocked) return
    if (synth.ensureContext()) {
      unlocked = true
      window.removeEventListener('keydown', onGesture)
      window.removeEventListener('pointerdown', onGesture)
      void synth.resume()
    }
  }
  window.addEventListener('keydown', onGesture)
  window.addEventListener('pointerdown', onGesture)

  // Labelled control: a real, focusable <button> (keyboard-reachable via Tab +
  // Enter, and the 'M' shortcut below).
  const root = document.createElement('button')
  root.type = 'button'
  root.id = 'sound-toggle'
  root.setAttribute('aria-label', 'Toggle sound (M)')
  root.style.cssText = [
    'position:fixed',
    'top:12px',
    'right:12px',
    'z-index:60',
    'width:40px',
    'height:40px',
    'font-size:20px',
    'line-height:1',
    'border:1px solid rgba(255,255,255,.25)',
    'border-radius:10px',
    'background:rgba(255,255,255,.06)',
    'color:#fff',
    'cursor:pointer',
    'padding:0',
  ].join(';')
  const syncButton = (): void => {
    root.textContent = synth.isMuted() ? '🔇' : '🔊'
    root.setAttribute('aria-pressed', String(synth.soundEnabled()))
  }
  syncButton()
  const onToggle = (): void => {
    synth.toggle()
    syncButton()
  }
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    onToggle()
  })

  // Mute is keyboard-reachable: 'M' toggles (and also unlocks the context).
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyM') {
      e.preventDefault()
      onToggle()
    }
  }
  window.addEventListener('keydown', onKeyDown)

  // Suspend on visibilitychange to save CPU/battery; resume when the tab shows.
  const onVis = (): void => {
    if (document.hidden) void synth.suspend()
    else void synth.resume()
  }
  document.addEventListener('visibilitychange', onVis)

  return {
    root,
    consume: (sink) => synth.consume(sink),
    setEnabled: (v) => synth.setEnabled(v),
    toggle: () => synth.toggle(),
    soundEnabled: () => synth.soundEnabled(),
    isMuted: () => synth.isMuted(),
    isReady: () => synth.isReady(),
    contextState: () => synth.contextState(),
    duckGain: () => synth.duckGain(),
    detach(): void {
      window.removeEventListener('keydown', onGesture)
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVis)
      root.remove()
    },
  }
}
