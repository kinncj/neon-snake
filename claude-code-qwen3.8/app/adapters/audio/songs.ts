// Per-level lo-fi BGM. No asset bytes: each track is a short chord-progression
// loop rendered ONCE into an AudioBuffer (offline) and played back looped by an
// AudioBufferSourceNode. A level-up crossfades to the next track (fade the old
// source out, fade the new one in) so the change settles rather than clicks.
//
// Like the SFX, the BGM is gesture-gated (it only plays once the shared
// AudioContext exists — created on the first real input) and routes through the
// synth's music bus, so the global mute ('M' / the toggle) silences it too. The
// runtime drives it read-only with `tick(level, active)` each frame: the track
// selection (name/bpm) is pure and synchronous (unit-tested, e2e-readable),
// while the buffer render + source are best-effort and never block the sim.
//
// `Math.random` is used only for the drum noise, which is audio (not domain)
// and never part of the replay hash.

export interface SongTrack {
  /** Stable id (e.g. 'cozy-bedroom'); read by the debug/e2e surface, not shown. */
  readonly name: string
  /** Tempo in beats per minute (70 → 86 across the five levels). */
  readonly bpm: number
  /** Whether the backbeat snare is present (cozy-bedroom plays drums-free). */
  readonly snare: boolean
  /** Whether a 16th-note arpeggio runs over the chords. */
  readonly arp: boolean
  /** One 4/4 bar per entry; each bar is a set of note names (the chord). */
  readonly bars: readonly (readonly string[])[]
}

// The five tracks, one per level (L1 → L5). Jazz-extended chords, 70 → 86 bpm.
// `cozy-bedroom` has no snare; `park-bench` and `skyline-view` add the arpeggio.
export const TRACKS: readonly SongTrack[] = [
  {
    name: 'cozy-bedroom',
    bpm: 70,
    snare: false,
    arp: false,
    bars: [
      ['A2', 'C3', 'E3', 'G3', 'A3'], // Am7
      ['F2', 'A2', 'C3', 'E3'], // Fmaj7
      ['C3', 'E3', 'G3', 'B3'], // Cmaj7
      ['G2', 'B2', 'D3', 'F3'], // G7
    ],
  },
  {
    name: 'window-seat',
    bpm: 74,
    snare: true,
    arp: false,
    bars: [
      ['D3', 'F3', 'A3', 'C4', 'E4'], // Dm9
      ['Bb2', 'D3', 'F3', 'A3'], // Bbmaj7
      ['G3', 'Bb3', 'D4', 'F4'], // Gm7
      ['C3', 'E3', 'G3', 'Bb3'], // C7
    ],
  },
  {
    name: 'rainy-train',
    bpm: 78,
    snare: true,
    arp: false,
    bars: [
      ['E3', 'G3', 'B3', 'D4'], // Em9
      ['C3', 'E3', 'G3', 'B3'], // Cmaj7
      ['A2', 'C3', 'E3', 'A3'], // Am7
      ['G2', 'B2', 'D3', 'F3'], // G7
    ],
  },
  {
    name: 'park-bench',
    bpm: 82,
    snare: true,
    arp: true,
    bars: [
      ['C3', 'E3', 'G3', 'B3'], // Cmaj7
      ['A2', 'C3', 'E3', 'G3'], // Am7
      ['F2', 'A2', 'C3', 'E3'], // Fmaj7
      ['G2', 'B2', 'D3', 'F3'], // G7
    ],
  },
  {
    name: 'skyline-view',
    bpm: 86,
    snare: true,
    arp: true,
    bars: [
      ['F3', 'A3', 'C4', 'E4'], // Fmaj7
      ['A3', 'C4', 'E4', 'G4'], // Am7
      ['D3', 'F3', 'A3', 'C4'], // Dm7
      ['Bb2', 'D3', 'F3', 'A3'], // Bbmaj7
    ],
  },
]

export const SONG_COUNT: number = TRACKS.length

/**
 * 1-based level → 0-based track index, clamped to `[0, SONG_COUNT-1]`. An
 * out-of-range level still resolves to a valid track (never undefined).
 * Pure — unit-tested.
 */
export function trackForLevel(level: number): number {
  const idx = level - 1
  if (idx < 0) return 0
  if (idx >= SONG_COUNT) return SONG_COUNT - 1
  return idx
}

/** The track at a 0-based index, or undefined out of range. */
export function trackAt(index: number): SongTrack | undefined {
  return TRACKS[index]
}

// Semitone offsets for note-name parsing ('C#4' / 'Bb3' → frequency in Hz).
const SEMI: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

/** A note name (e.g. 'A4', 'Bb3') to a frequency in Hz (A4 = 440). */
export function noteFreq(name: string): number {
  const m = /^([A-G][b#]?)(\d)$/.exec(name)
  if (!m) return 0
  const semi = SEMI[m[1]!] ?? 0
  const midi = (Number(m[2]!) + 1) * 12 + semi
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** A mono white-noise buffer (for snare/hi-hat); the only Math.random here. */
function noiseBuffer(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i]! = Math.random() * 2 - 1
  return buf
}

/**
 * Render one loop of a track into an AudioBuffer (offline — no device, no
 * gesture needed). The loop is `bars` × 4 beats: a low-passed pad (two detuned
 * triangles per chord tone), a sub-octave bass on beat 1, a kick on 1 & 3, a
 * band-passed snare on 2 & 4 (when the track has a snare), 8th-note hats, and —
 * when the track has an arpeggio — 16th notes cycling the chord.
 */
async function renderLoop(track: SongTrack, sampleRate: number): Promise<AudioBuffer> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!Ctor) throw new Error('OfflineAudioContext unavailable')

  const beat = 60 / track.bpm
  const bar = beat * 4
  const total = bar * track.bars.length
  const off = new Ctor(1, Math.ceil(total * sampleRate), sampleRate)

  // The lo-fi glue: a gentle master low-pass → compressor → output.
  const masterLp = off.createBiquadFilter()
  masterLp.type = 'lowpass'
  masterLp.frequency.value = 3200
  const comp = off.createDynamicsCompressor()
  const outGain = off.createGain()
  outGain.gain.value = 0.9
  masterLp.connect(comp)
  comp.connect(outGain)
  outGain.connect(off.destination)
  const noise = noiseBuffer(off, 1)

  /** A soft chord-tone pad (two detuned triangles) held across `dur` seconds. */
  const pad = (freq: number, t0: number, dur: number): void => {
    const f = off.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 2600
    const g = off.createGain()
    const rel = Math.max(0.1, dur - 0.12)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.07) // soft attack
    g.gain.setValueAtTime(0.14, t0 + rel)
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur) // release
    for (const cents of [-6, 6]) {
      const o = off.createOscillator()
      o.type = 'triangle'
      o.frequency.value = freq
      o.detune.value = cents
      o.connect(f)
      o.start(t0)
      o.stop(t0 + dur + 0.05)
    }
    f.connect(g)
    g.connect(masterLp)
  }
  /** A sub-octave bass note (sine) on the bar's first beat. */
  const bass = (freq: number, t0: number, dur: number): void => {
    const f = off.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900
    const g = off.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.04)
    g.gain.setValueAtTime(0.22, t0 + dur - 0.1)
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur)
    const o = off.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    o.connect(f)
    f.connect(g)
    g.connect(masterLp)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }
  /** A kick: a sine pitch-sweep with a fast decay. */
  const kick = (t0: number): void => {
    const g = off.createGain()
    g.gain.setValueAtTime(0.5, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18)
    const o = off.createOscillator()
    o.frequency.setValueAtTime(120, t0)
    o.frequency.exponentialRampToValueAtTime(44, t0 + 0.16)
    o.connect(g)
    g.connect(masterLp)
    o.start(t0)
    o.stop(t0 + 0.2)
  }
  /** A band-passed noise snare. */
  const snare = (t0: number): void => {
    const f = off.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 1800
    const g = off.createGain()
    g.gain.setValueAtTime(0.28, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14)
    const s = off.createBufferSource()
    s.buffer = noise
    s.connect(f)
    f.connect(g)
    g.connect(masterLp)
    s.start(t0)
    s.stop(t0 + 0.15)
  }
  /** A short high-passed noise hat at the given level. */
  const hat = (t0: number, level: number): void => {
    const f = off.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7000
    const g = off.createGain()
    g.gain.setValueAtTime(level, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05)
    const s = off.createBufferSource()
    s.buffer = noise
    s.connect(f)
    f.connect(g)
    g.connect(masterLp)
    s.start(t0)
    s.stop(t0 + 0.06)
  }
  /** A quiet 16th-note arpeggio pluck. */
  const pluck = (freq: number, t0: number): void => {
    const g = off.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.07, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16)
    const o = off.createOscillator()
    o.type = 'triangle'
    o.frequency.value = freq
    o.connect(g)
    g.connect(masterLp)
    o.start(t0)
    o.stop(t0 + 0.18)
  }

  for (let b = 0; b < track.bars.length; b++) {
    const barStart = b * bar
    const chord = track.bars[b]!
    // Pad + sub bass (the bass is the lowest chord tone an octave down).
    let low = Infinity
    for (const n of chord) {
      const f = noteFreq(n)
      if (f > 0) {
        pad(f, barStart, bar)
        if (f < low) low = f
      }
    }
    if (Number.isFinite(low)) bass(low / 2, barStart, bar)
    // Drums.
    kick(barStart)
    kick(barStart + 2 * beat)
    if (track.snare) {
      snare(barStart + beat)
      snare(barStart + 3 * beat)
    }
    for (let h = 0; h < 8; h++) hat(barStart + (h * beat) / 2, h % 2 === 1 ? 0.1 : 0.05)
    // Arpeggio (16ths cycling the chord tones), when the track has one.
    if (track.arp) {
      const tones = chord.map(noteFreq).filter((f) => f > 0)
      for (let s = 0; s < 16 && tones.length > 0; s++) {
        const f = tones[(s % tones.length)]!
        pluck(f, barStart + (s * beat) / 4)
      }
    }
  }

  return off.startRendering()
}

/**
 * The runtime BGM engine. The track selection (name/bpm) is set synchronously
 * in `tick` so the debug/e2e surface can read it without waiting on audio; the
 * buffer render + source are best-effort and never block the sim.
 */
class SongEngine {
  private readonly src: { musicBus(): GainNode | null }
  private trackName = ''
  private trackBpm = 0
  private levelValue = -1
  private active = false
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null
  private buffers = new Map<number, AudioBuffer>()
  private source: AudioBufferSourceNode | null = null
  private fade: GainNode | null = null
  /** The track being rendered or played; set the moment a render starts so a
   *  repeated tick at the same level doesn't re-trigger (and re-render) it. */
  private currentIdx = -1
  private renderToken = 0

  constructor(src: { musicBus(): GainNode | null }) {
    this.src = src
  }

  /**
   * Read-only per-frame drive: set the current track from the level (synchronous
   * name/bpm), then — only when active and the shared bus exists — play it,
   * crossfading on a level change. Steady state (same level, already playing)
   * allocates nothing.
   */
  tick(level: number, active: boolean): void {
    const idx = trackForLevel(level)
    const track = TRACKS[idx]!
    this.trackName = track.name
    this.trackBpm = track.bpm
    this.levelValue = level
    this.active = active
    if (!this.bus) {
      const b = this.src.musicBus()
      if (b) {
        this.bus = b
        // The bus is created on the online SFX context, so its context is an
        // AudioContext at runtime (typed as the base class, hence the cast).
        this.ctx = b.context as AudioContext
      }
    }
    if (!active || !this.ctx || !this.bus) {
      this.stopSource()
      this.currentIdx = -1
      return
    }
    if (idx !== this.currentIdx) this.playThis(idx)
  }

  /** A ~1s crossfade into `idx` (rendering its loop first if not yet cached). */
  private playThis(idx: number): void {
    const ctx = this.ctx
    const bus = this.bus
    if (!ctx || !bus) return
    const track = TRACKS[idx]!
    this.currentIdx = idx // claim it now so a render in flight isn't re-triggered
    const token = ++this.renderToken
    const start = (buf: AudioBuffer): void => {
      if (token !== this.renderToken || !this.active) return // stale or deactivated
      this.stopSource()
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.loop = true
      const g = ctx.createGain()
      const now = ctx.currentTime
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(1, now + 0.8) // fade in
      s.connect(g)
      g.connect(bus)
      s.start()
      this.source = s
      this.fade = g
      this.currentIdx = idx
    }
    const cached = this.buffers.get(idx)
    if (cached) {
      start(cached)
      return
    }
    void renderLoop(track, ctx.sampleRate)
      .then((buf) => {
        this.buffers.set(idx, buf)
        start(buf)
      })
      .catch(() => {
        // Rendering failed — stay silent; the 2D render and SFX are unaffected.
      })
  }

  /** Fade the current source out and stop it (does not clear `currentIdx`). */
  private stopSource(): void {
    const s = this.source
    const ctx = this.ctx
    if (s && ctx) {
      const now = ctx.currentTime
      const g = this.fade
      if (g) {
        try {
          g.gain.cancelScheduledValues(now)
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now)
          g.gain.linearRampToValueAtTime(0.0001, now + 0.4)
        } catch {
          // ignore
        }
      }
      try {
        s.stop(now + 0.5)
      } catch {
        // ignore
      }
    }
    this.source = null
    this.fade = null
  }

  name(): string {
    return this.trackName
  }
  bpm(): number {
    return this.trackBpm
  }
  /** The level the current track was set for. */
  level(): number {
    return this.levelValue
  }
  /** Whether a buffer source is currently active (a track is playing). */
  playing(): boolean {
    return this.source !== null
  }
  detach(): void {
    this.stopSource()
    this.buffers.clear()
  }
}

export interface SongHandle {
  /** Read-only per-frame drive: set the track from the level; play when active. */
  tick(level: number, active: boolean): void
  name(): string
  bpm(): number
  level(): number
  playing(): boolean
  detach(): void
}

/**
 * Build the BGM engine off the shared music bus (so it is gesture-gated and
 * muted by the same control as the SFX). Returns the read-only handle the
 * runtime drives each frame.
 */
export function createSongs(src: { musicBus(): GainNode | null }): SongHandle {
  const engine = new SongEngine(src)
  return {
    tick: (level, active) => engine.tick(level, active),
    name: () => engine.name(),
    bpm: () => engine.bpm(),
    level: () => engine.level(),
    playing: () => engine.playing(),
    detach: () => engine.detach(),
  }
}
