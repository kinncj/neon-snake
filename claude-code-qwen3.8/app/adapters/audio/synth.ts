// Procedural SFX on the sanctioned Phase-3 engine (ADR 0007): **Tone.js 15.1.22**.
// The decision logic lives here and is engine-agnostic and pure: which effect
// triggers which voice (`soundNameForEffect`), the game-over sting layering, the
// combo coin, mute + persistence, and the `lastSfx()` bookkeeping the e2e death-FX
// gate reads. The *audio* lives in a swappable `SfxEngine`: the browser wires it
// to a Tone.js graph (PolySynth/MonoSynth/MembraneSynth/NoiseSynth voices over a
// low-pass SFX bus, a compressor-glued master, and a music bus for the BGM), and
// the unit tests inject a stub so the decision logic is testable in Node.
//
// "Preallocated, then reused": the Tone graph (voices + buses + master +
// compressor) is built ONCE, lazily, in `ensure()`, and reused for every trigger.
// `consume()` only schedules notes on the existing voices — it allocates nothing
// of its own in steady state.
//
// Autoplay policy — "no AudioContext before a gesture." Importing the `tone`
// module eagerly creates its shared AudioContext at module load, so `tone` is
// imported ONLY here, via a dynamic `import('tone')` inside `ensure()` — which
// `createSound()` calls only from the first real keydown/pointerdown. Before that
// gesture the module (and its context) does not exist and `soundReady()` is false.
// Mute is keyboard-reachable ('M') via a labelled, focusable control; the enable
// state persists in localStorage; the context suspends when the tab hides.
import type { EffectCause, EffectKind, EffectSink } from '../../domain/types'
import { subscribe, t } from '../i18n'

/** The dynamically-imported Tone.js module (typed, not `any`). */
type ToneModule = typeof import('tone')

export type SoundName = 'ate' | 'levelup' | 'boom' | 'splat' | 'gameover' | 'coin'

/**
 * The ducking gain on the voice bus: it caps the summed voice level at 0.8 of
 * full scale so a cluster of overlapping voices can't clip. The test pins it.
 */
export const DUCK_GAIN: number = 0.8
/** Base master gain when sound is enabled (before the 0.8 duck still applies). */
const VOLUME: number = 0.9
/** Background-music bus level: the lo-fi BGM sits well below the SFX voices. */
export const MUSIC_LEVEL: number = 0.16
/** SFX bus low-pass cutoff (Hz) — the whole SFX bus is lo-fi, not just the pad. */
const SFX_BUS_HZ: number = 4000

/** Minimal storage surface (so the persistence logic is testable in Node). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SOUND_KEY: string = 'snake.sound'

/** The per-voice recipe. `wave` is a Web Audio oscillator type (Tone reuses it). */
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

// The voice library. Ate = a quick chomp; level-up = an ascending jingle;
// a coin replaces the chomp on a combo; wall death = a low boom; self-bite =
// a wet splat; game-over = a falling sawtooth sting.
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
  boom: {
    // Wall death: a hard low impact that rumbles out (drives the sparks + shock).
    wave: 'sawtooth',
    notes: [110.0, 55.0],
    noteDur: 0.05,
    noteGap: 0.04,
    env: { a: 0.002, d: 0.12, s: 0.5, r: 0.22 },
    filterHz: 1200,
    peak: 0.45,
  },
  splat: {
    // Self-bite: a quick wet pitch-drop "squish."
    wave: 'triangle',
    notes: [440.0, 220.0, 110.0],
    noteDur: 0.04,
    noteGap: 0.03,
    env: { a: 0.002, d: 0.06, s: 0.4, r: 0.1 },
    filterHz: 2200,
    peak: 0.32,
  },
  gameover: {
    // The sting that closes out any death: a falling sawtooth sweep.
    wave: 'sawtooth',
    notes: [392.0, 329.63, 261.63, 196.0],
    noteDur: 0.16,
    noteGap: 0.13,
    env: { a: 0.005, d: 0.14, s: 0.3, r: 0.38 },
    filterHz: 1800,
    peak: 0.28,
  },
  coin: {
    // Combo reward: a bright two-note coin, pitched above the chomp.
    wave: 'square',
    notes: [987.77, 1318.51],
    noteDur: 0.06,
    noteGap: 0.06,
    env: { a: 0.002, d: 0.05, s: 0.5, r: 0.12 },
    filterHz: 6000,
    peak: 0.2,
  },
}

/**
 * Which SFX (if any) an emitted effect triggers. Only the meaningful game
 * events sound; movement/growth/spawn are silent. A death resolves by cause
 * (wall → boom, self → splat); the game-over sting is layered on top by
 * `consume`. A chomp becomes a coin on a combo. Pure — unit-tested.
 */
export function soundNameForEffect(
  kind: EffectKind,
  combo: number,
  cause: EffectCause,
): SoundName | null {
  switch (kind) {
    case 'ate':
      return combo > 1 ? 'coin' : 'ate'
    case 'levelup':
      return 'levelup'
    case 'died':
      return cause === 'self' ? 'splat' : 'boom'
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

/**
 * The swappable audio engine. The browser implementation (`ToneSfxEngine`) is
 * built on Tone.js; unit tests inject a stub so the decision logic in
 * `SoundSynth` is exercised without a real (or any) AudioContext.
 */
export interface SfxEngine {
  /** Build the graph once (gesture-gated); resolve the context handle, or null. */
  ensure(): Promise<unknown>
  /** Whether the graph has been built. */
  ready(): boolean
  /** The context state ('none' before a gesture, else 'running'/'suspended'/…). */
  contextState(): string
  /** Schedule the named voice on the existing graph (no graph allocation). */
  play(name: SoundName): void
  /** Ramp the master gain (mute). */
  setMaster(v: number): void
  /** The BGM bus (native node wired into the master; null before a gesture). */
  musicBus(): GainNode | null
  suspend(): Promise<void>
  resume(): Promise<void>
  /** Tear the graph down. */
  detach(): void
}

/** A built voice: schedule its recipe's note sequence + dispose the Tone node. */
interface BuiltVoice {
  play(freqs: readonly number[], noteGap: number, noteDur: number): void
  dispose(): void
}

/**
 * Build one Tone.js voice for a recipe. The synth TYPE is chosen per voice so the
 * palette uses the sanctioned voices (PolySynth/MonoSynth/MembraneSynth/NoiseSynth):
 * the low wall-impact boom is a MembraneSynth thud, the wet self-bite is a
 * NoiseSynth burst, the level-up jingle is a PolySynth (polyphonic, no cut-off),
 * and the short chomps/sting are MonoSynths. All output into `out` (the SFX bus).
 * `Tone` is the dynamically-imported module (typed as `ToneModule`, not `any`).
 */
function makeVoice(Tone: ToneModule, name: SoundName, out: AudioNode): BuiltVoice {
  const r = VOICE_RECIPES[name]
  const vol = Tone.gainToDb(r.peak)
  if (name === 'boom') {
    const s = new Tone.MembraneSynth({ volume: vol, pitchDecay: r.env.d })
    s.connect(out)
    const thud = r.notes[r.notes.length - 1] ?? 55 // the lowest note = the thud
    return {
      play(freqs, _gap, dur) {
        const f = freqs[freqs.length - 1] ?? thud
        s.triggerAttackRelease(f, Math.max(0.12, dur + r.env.r), Tone.now())
      },
      dispose: () => s.dispose(),
    }
  }
  if (name === 'splat') {
    const s = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: r.env.a, decay: r.env.d, sustain: r.env.s, release: r.env.r },
      volume: vol,
    })
    s.connect(out)
    const total = Math.max(0.05, r.notes.length * (r.noteGap + r.noteDur))
    return {
      play: () => s.triggerAttackRelease(total, Tone.now()),
      dispose: () => s.dispose(),
    }
  }
  if (name === 'levelup') {
    const s = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: r.wave },
      envelope: { attack: r.env.a, decay: r.env.d, sustain: r.env.s, release: r.env.r },
      filter: { type: 'lowpass', frequency: r.filterHz },
      volume: vol,
    })
    s.connect(out)
    return {
      play(freqs, gap, dur) {
        const t = Tone.now()
        freqs.forEach((f, i) => {
          if (f > 0) s.triggerAttackRelease(f, Math.max(0.05, dur), t + i * gap)
        })
      },
      dispose: () => s.dispose(),
    }
  }
  // Default: a MonoSynth per recipe wave (chomp / coin / game-over sting).
  const s = new Tone.MonoSynth({
    oscillator: { type: r.wave },
    envelope: { attack: r.env.a, decay: r.env.d, sustain: r.env.s, release: r.env.r },
    filter: { type: 'lowpass', frequency: r.filterHz },
    volume: vol,
  })
  s.connect(out)
  return {
    play(freqs, gap, dur) {
      const t = Tone.now()
      freqs.forEach((f, i) => {
        if (f > 0) s.triggerAttackRelease(f, Math.max(0.05, dur), t + i * gap)
      })
    },
    dispose: () => s.dispose(),
  }
}

/**
 * The Tone.js engine. It is built ONLY from `ensure()` (gesture-gated): the
 * dynamic `import('tone')` is what creates Tone's shared AudioContext, so nothing
 * exists before the first input. The graph: per-voice Tone synths → SFX low-pass
 * → SFX bus (the 0.8 duck) → master → compressor → destination; the BGM plugs into
 * a native music bus wired to the master so it is muted by the same control.
 */
class ToneSfxEngine implements SfxEngine {
  private t: ToneModule | null = null
  private handle: AudioContext | null = null
  private built = false
  private voices = new Map<SoundName, BuiltVoice>()
  private master: GainNode | null = null
  private music: GainNode | null = null

  async ensure(): Promise<unknown> {
    if (this.handle) return this.handle
    try {
      const Tone: ToneModule = await import('tone')
      this.t = Tone
      const ctx = Tone.context.rawContext as AudioContext

      // Native glue in Tone's context (native nodes keep the BGM path unchanged).
      const sfxLp = ctx.createBiquadFilter()
      sfxLp.type = 'lowpass'
      sfxLp.frequency.value = SFX_BUS_HZ
      const sfxBus = ctx.createGain()
      sfxBus.gain.value = DUCK_GAIN // caps the summed SFX voices at 0.8
      const master = ctx.createGain()
      master.gain.value = 0 // set by setMaster() once the enable state is known
      const compressor = ctx.createDynamicsCompressor()
      sfxLp.connect(sfxBus)
      sfxBus.connect(master)
      master.connect(compressor)
      compressor.connect(ctx.destination)

      // BGM bus: a native node the songs plug into, wired to the shared master.
      const music = ctx.createGain()
      music.gain.value = MUSIC_LEVEL
      music.connect(master)

      for (const name of Object.keys(VOICE_RECIPES) as SoundName[]) {
        this.voices.set(name, makeVoice(Tone, name, sfxLp))
      }

      this.master = master
      this.music = music
      this.built = true

      // The gesture: resume the (suspended) Tone context.
      await Tone.start()
      this.handle = ctx
      return ctx
    } catch {
      // Tone unavailable or the context could not be created → no audio. The 2D
      // render and the rest of the game are unaffected; we keep retrying cheaply.
      this.built = false
      return null
    }
  }

  ready(): boolean {
    return this.built && this.handle !== null
  }

  contextState(): string {
    return this.t ? this.t.context.state : 'none'
  }

  play(name: SoundName): void {
    const v = this.voices.get(name)
    if (!v) return
    const r = VOICE_RECIPES[name]
    v.play(r.notes, r.noteGap, r.noteDur)
  }

  setMaster(v: number): void {
    if (this.master) this.master.gain.value = v
  }

  musicBus(): GainNode | null {
    return this.music
  }

  async suspend(): Promise<void> {
    const c = this.handle
    if (c && c.state === 'running') {
      try {
        await c.suspend()
      } catch {
        // ignore
      }
    }
  }

  async resume(): Promise<void> {
    const c = this.handle
    if (this.t && c && c.state === 'suspended') {
      try {
        await this.t.start()
      } catch {
        // ignore
      }
    }
  }

  detach(): void {
    for (const v of this.voices.values()) {
      try {
        v.dispose()
      } catch {
        // ignore
      }
    }
    this.voices.clear()
    this.master = null
    this.music = null
    this.built = false
    this.handle = null
  }
}

export class SoundSynth {
  private readonly storage: StorageLike
  private readonly engineFactory: () => SfxEngine
  private engine: SfxEngine | null = null
  private handle: unknown = null
  private lastPlayed: SoundName | '' = ''
  enabled: boolean

  constructor(storage: StorageLike, engineFactory?: () => SfxEngine) {
    this.storage = storage
    this.engineFactory = engineFactory ?? (() => new ToneSfxEngine())
    this.enabled = readSoundEnabled(storage)
  }

  /**
   * Lazily build the engine graph (only called from a user gesture) and return
   * the context handle (or null when audio is unavailable). Idempotent.
   */
  async ensureContext(): Promise<unknown> {
    if (this.handle) return this.handle
    if (!this.engine) this.engine = this.engineFactory()
    this.handle = await this.engine.ensure()
    // Apply the persisted enable state to the master once the graph exists.
    this.engine.setMaster(this.enabled ? VOLUME : 0)
    return this.handle
  }

  /**
   * Read the frame's effects and play the matching voices. No-op before a
   * gesture (no context) or when sound is disabled. Zero steady-state
   * allocation: `sink.len` is 0 most frames and the mapping allocates nothing.
   */
  consume(sink: EffectSink, combo = 1): void {
    if (!this.enabled || !this.handle) return
    for (let i = 0; i < sink.len; i++) {
      const e = sink.buf[i]!
      const name = soundNameForEffect(e.kind, combo, e.cause)
      // A death layers the game-over sting under the cause-specific hit
      // (boom/splat). Scheduling the sting first keeps `lastSfx()` reporting
      // the cause-specific voice, which the death FX is keyed on.
      if (e.kind === 'died') this.play('gameover')
      if (name) this.play(name)
    }
  }

  private play(name: SoundName): void {
    if (!this.engine || !this.handle) return
    if (this.engine.contextState() === 'suspended') return
    this.lastPlayed = name
    this.engine.play(name)
  }

  /** Set (and persist) the sound-enabled state. Zeroes the master gain when off. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    writeSoundEnabled(this.storage, enabled)
    this.engine?.setMaster(enabled ? VOLUME : 0)
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

  /** Whether the (post-gesture) context has been created. */
  isReady(): boolean {
    return this.handle !== null
  }

  /** The context state, or 'none' before a gesture. */
  contextState(): string {
    return this.engine ? this.engine.contextState() : 'none'
  }

  /** The voice-bus ducking gain (0.8), for the e2e gate. */
  duckGain(): number {
    return DUCK_GAIN
  }

  /**
   * The last SFX voice actually scheduled (or '' before a gesture / muted).
   * Exposed for the e2e death-FX gate: a wall death reports 'boom', a
   * self-bite 'splat' (the game-over sting is scheduled first, under it).
   */
  lastSfx(): string {
    return this.lastPlayed
  }

  /** The BGM bus (null before a gesture); the songs route through it. */
  musicBus(): GainNode | null {
    return this.engine?.musicBus() ?? null
  }

  /** Suspend the context (tab hidden) to save CPU. Safe no-op if absent. */
  async suspend(): Promise<void> {
    await this.engine?.suspend()
  }

  /** Resume the context (tab shown). Only when sound is enabled. */
  async resume(): Promise<void> {
    if (this.enabled) await this.engine?.resume()
  }

  detach(): void {
    this.engine?.detach()
    this.engine = null
    this.handle = null
  }
}

/** The audio adapter handle returned to the runtime wiring. */
export interface SoundHandle {
  root: HTMLElement
  consume(sink: EffectSink, combo?: number): void
  setEnabled(enabled: boolean): void
  toggle(): void
  soundEnabled(): boolean
  isMuted(): boolean
  isReady(): boolean
  contextState(): string
  duckGain(): number
  /** The last SFX voice scheduled ('' before a gesture); the e2e death-FX gate. */
  lastSfx(): string
  /** The shared BGM bus (null before a gesture); the songs route through it. */
  musicBus(): GainNode | null
  detach(): void
}

/**
 * Wire the SoundSynth to the page: the labelled mute control, the 'M' shortcut,
 * the first-gesture AudioContext unlock (the dynamic `import('tone')` happens
 * inside `ensureContext`, so no context exists before the gesture), and the
 * visibility suspend/resume. Returns the handle plus the control to append.
 */
export function createSound(): SoundHandle {
  const synth = new SoundSynth(window.localStorage)

  // Gesture-gated unlock: build the Tone graph (and create the context) on the
  // first real input, then stop listening. Idempotent if audio is unavailable.
  let unlocked = false
  const onGesture = (): void => {
    if (unlocked) return
    void (async () => {
      const ok = await synth.ensureContext()
      if (ok) {
        unlocked = true
        window.removeEventListener('keydown', onGesture)
        window.removeEventListener('pointerdown', onGesture)
      }
    })()
  }
  window.addEventListener('keydown', onGesture)
  window.addEventListener('pointerdown', onGesture)

  // Labelled control: a real, focusable <button> (keyboard-reachable via Tab +
  // Enter, and the 'M' shortcut below).
  const root = document.createElement('button')
  root.type = 'button'
  root.id = 'sound-toggle'
  // The accessible label is localized (i18n) and re-read on a locale change.
  const syncLabel = (): void => {
    root.setAttribute('aria-label', t('sound.toggle'))
  }
  syncLabel()
  const unsubscribeLocale = subscribe(syncLabel)
  root.style.cssText = [
    'position:fixed',
    'top:calc(var(--bezel) + 12px)',
    'right:calc(var(--bezel) + 12px)',
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
    consume: (sink, combo) => synth.consume(sink, combo),
    setEnabled: (v) => synth.setEnabled(v),
    toggle: () => synth.toggle(),
    soundEnabled: () => synth.soundEnabled(),
    isMuted: () => synth.isMuted(),
    isReady: () => synth.isReady(),
    contextState: () => synth.contextState(),
    duckGain: () => synth.duckGain(),
    lastSfx: () => synth.lastSfx(),
    musicBus: () => synth.musicBus(),
    detach(): void {
      window.removeEventListener('keydown', onGesture)
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVis)
      unsubscribeLocale()
      synth.detach()
      root.remove()
    },
  }
}
