/**
 * Chiptune synth — procedural Web Audio, no asset bytes.
 *
 * The pure note/envelope/ducking math (freqFromMidi, duckScale, adsrLevel, the
 * voice table and the 16-step loop) is unit-tested. The Web-Audio graph is
 * built only inside `build()`, which runs on the first user gesture (unlock),
 * so the module honours the "no AudioContext before a gesture" rule and stays
 * safe to import in Node (where there is no AudioContext and every method is a
 * clean no-op until unlocked).
 *
 * Web Audio rules honoured here:
 *   - no AudioContext is created until the first user gesture (unlock)
 *   - the context is suspended when the page is hidden, resumed when visible
 *   - a duck lowers the music bus while the game is paused
 *   - a hard mute (independent of the duck) zeros the master
 *   - the duck cap bounds the summed simultaneous voice gain
 *
 * Sequencing is a standard Web-Audio *lookahead* scheduler: notes are queued
 * ~100 ms ahead on an interval timer, so dropped frames never desynchronise
 * the loop. (The per-level song data and the lo-fi drum voices arrive in the
 * later audio steps; this step ships the core chiptune loop + SFX.)
 */

import * as Tone from "tone";
import {
  songForLevel,
  stepSeconds,
  voiceBar,
  type Song,
  type StepVoice
} from "./songs";

export type VoiceName = "pulse" | "triangle" | "noise" | "lead";

/** SFX bus low-pass (Hz): keeps the retro stabs warm, not clinical. */
const SFX_LOWPASS_HZ = 6000;
/** Music bus low-pass (Hz): the lo-fi colour. */
const MUSIC_LOWPASS_HZ = 3500;
const SONG_COUNT = 5;
/** Crossfade duration between songs (ms). */
const SONG_FADE_MS = 250;

/** Per-voice character. `peak` is the voice's max gain before the duck cap. */
export interface VoiceSpec {
  readonly name: VoiceName;
  readonly wave: OscillatorType; // used for the osc voices
  readonly peak: number;
  /** ADSR in seconds. */
  readonly a: number;
  readonly d: number;
  readonly s: number; // sustain level (0..1 of peak)
  readonly r: number;
}

export const VOICES: Record<VoiceName, VoiceSpec> = {
  pulse: { name: "pulse", wave: "square", peak: 0.3, a: 0.005, d: 0.08, s: 0.6, r: 0.09 },
  triangle: { name: "triangle", wave: "triangle", peak: 0.34, a: 0.01, d: 0.1, s: 0.5, r: 0.12 },
  noise: { name: "noise", wave: "square", peak: 0.16, a: 0.002, d: 0.05, s: 0.3, r: 0.05 },
  lead: { name: "lead", wave: "square", peak: 0.3, a: 0.02, d: 0.12, s: 0.7, r: 0.18 }
};

/** Hard ceiling on the summed voice gain (the duck cap). */
export const DUCK_CAP = 0.8;

export function freqFromMidi(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Peak-normalised gain for a chord of simultaneous voices so their sum never
 * exceeds DUCK_CAP. Returns a per-voice multiplier in (0, 1].
 */
export function duckScale(peaks: number[]): number {
  const sum = peaks.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 1;
  return sum <= DUCK_CAP ? 1 : DUCK_CAP / sum;
}

/**
 * Envelope level at time `t` (seconds) into a note of total duration `dur`.
 * Pure: documents the ADSR shape the synth applies.
 */
export function adsrLevel(spec: VoiceSpec, t: number, dur: number): number {
  const peak = spec.peak;
  if (t < 0) return 0;
  const { a, d, s, r } = spec;
  const sustainStart = a + d;
  const releaseStart = Math.max(sustainStart, dur - r);
  if (t < a) return peak * (t / a);
  if (t < sustainStart) {
    const k = (t - a) / d;
    return peak * (1 - k * (1 - s));
  }
  if (t < releaseStart) return peak * s;
  if (t < dur) return peak * s * ((dur - t) / r);
  return 0;
}

/** A 16-step chiptune loop. null = rest. MIDI note numbers. */
export interface Step {
  readonly lead: number | null;
  readonly bass: number | null;
  readonly hat: boolean;
}

/** One bar of the loop (fixed, procedural). */
export const LOOP: readonly Step[] = [
  { lead: 72, bass: 48, hat: true },
  { lead: null, bass: null, hat: false },
  { lead: 74, bass: null, hat: false },
  { lead: null, bass: null, hat: false },
  { lead: 76, bass: 50, hat: true },
  { lead: null, bass: null, hat: false },
  { lead: 74, bass: null, hat: false },
  { lead: 72, bass: null, hat: true },
  { lead: 71, bass: 47, hat: false },
  { lead: null, bass: null, hat: false },
  { lead: 72, bass: null, hat: false },
  { lead: null, bass: null, hat: false },
  { lead: 74, bass: 50, hat: true },
  { lead: null, bass: null, hat: false },
  { lead: 76, bass: null, hat: false },
  { lead: 79, bass: 52, hat: true }
];

/** Seconds per 16th-note step at the base tempo (120 bpm). */
export const STEP_SECONDS = 0.125;

/**
 * Times passed to Tone instruments are plain seconds — a bare number is parsed
 * in the default unit (seconds). This helper documents that intent.
 */
function T(sec: number): number {
  return sec;
}

/** The debug/e2e readout shape (also the `audio.info()` return type). */
export type SynthDebug = {
  unlocked: boolean;
  running: boolean;
  state: string;
  master: number;
  voices: VoiceName[];
  duckCap: number;
  ducked: boolean;
  muted: boolean;
  song: number;
  sfx: Record<string, number>;
};

export class ChiptuneSynth {
  /** True once the graph has been built (after the first gesture). */
  private ready = false;
  /** True once unlock() has been called (even if the graph is still building). */
  private started = false;
  private ducked = false;
  private muted = false;
  private masterBase = 0.9;

  // ---- Web-Audio graph (built lazily in build()) --------------------------
  private master: Tone.Gain | null = null;
  private musicBus: Tone.Gain | null = null;
  private sfxBus: Tone.Gain | null = null;
  private pad: Tone.PolySynth | null = null;
  private bass: Tone.MonoSynth | null = null;
  private arp: Tone.MonoSynth | null = null;
  private kick: Tone.MembraneSynth | null = null;
  private snare: Tone.NoiseSynth | null = null;
  private hat: Tone.NoiseSynth | null = null;
  private sfxOsc: Tone.PolySynth | null = null;
  private sfxNoise: Tone.NoiseSynth | null = null;

  // ---- sequencer state ----------------------------------------------------
  private song: Song = songForLevel(1);
  private songLevel = 1;
  private pendingSong: Song | null = null;
  private seqTimer: number | null = null;
  private nextStepAt = 0;
  private stepIndex = 0;
  private barCount = 0;
  private voiceCache: readonly StepVoice[] | null = null;
  private cachedBar = -1;
  private songFadeTimer: number | null = null;

  /** SFX counters (event-driven; debug + e2e only). */
  readonly sfxCounts: Record<string, number> = {
    chomp: 0,
    coin: 0,
    boom: 0,
    splat: 0,
    jingle: 0,
    gameover: 0,
    click: 0
  };

  get unlocked(): boolean {
    return this.ready;
  }

  /**
   * Create the AudioContext (via Tone.start) and build the graph. Idempotent.
   * In Node (no AudioContext) this is a clean no-op and the synth stays
   * locked.
   */
  unlock(): void {
    if (this.started) return;
    this.started = true;
    const AC =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : typeof window !== "undefined"
          ? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
    if (AC === undefined) return; // Node / non-browser: stay locked.
    void (Tone.start() as unknown as Promise<unknown>)
      .then(() => {
        this.build();
        this.ready = true;
      })
      .catch(() => {
        // Context could not start (e.g. autoplay-blocked). Stay locked; the
        // next gesture (or a resume) can retry.
        this.started = false;
      });
  }

  /** Build the Web-Audio graph. Only runs in a real browser, post-gesture. */
  private build(): void {
    const dest = Tone.getDestination();
    // Master: gentle glue compression so a full chord + stabs can't clip.
    this.master = new Tone.Gain(this.masterBase);
    if (this.muted) this.master.gain.value = 0; // honour a mute set before unlock
    const comp = new Tone.Compressor({ threshold: -12, ratio: 3, attack: 0.003, release: 0.25 });
    this.master.connect(comp);
    comp.connect(dest);
    // Music bus: everything melodic runs through the lo-fi low-pass.
    this.musicBus = new Tone.Gain(this.ducked ? 0.4 : 1);
    const musicLP = new Tone.Filter(MUSIC_LOWPASS_HZ, "lowpass");
    musicLP.Q.value = 0.7;
    this.musicBus.connect(musicLP);
    musicLP.connect(this.master);
    // SFX bus: a gentler low-pass keeps the stabs warm.
    this.sfxBus = new Tone.Gain(0.9);
    const sfxLP = new Tone.Filter(SFX_LOWPASS_HZ, "lowpass");
    sfxLP.Q.value = 0.5;
    this.sfxBus.connect(sfxLP);
    sfxLP.connect(this.master);

    // ---- music voices (into the music bus) --------------------------------
    // Pad: the 5-voice lo-fi chord bed (detuned triangle, long release).
    this.pad = new Tone.PolySynth({
      maxPolyphony: 5,
      voice: Tone.Synth,
      options: {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.12, decay: 0.3, sustain: 0.6, release: 0.5 },
        volume: -20
      }
    });
    this.pad.connect(this.musicBus);
    // Bass: a soft sine root underneath the chords.
    this.bass = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      filter: { Q: 2, frequency: 700 },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.2 },
      volume: -12
    });
    this.bass.connect(this.musicBus);
    // Arp: a sparse square figure (L4/L5 only).
    this.arp = new Tone.MonoSynth({
      oscillator: { type: "square" },
      envelope: { attack: 0.003, decay: 0.07, sustain: 0.2, release: 0.09 },
      volume: -28
    });
    this.arp.connect(this.musicBus);
    // Kick: a low membrane thud on the beat.
    this.kick = new Tone.MembraneSynth({
      octaves: 10,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0.4, release: 0.25 },
      volume: -5
    });
    this.kick.connect(this.musicBus);
    // Snare: a band-passed pink-noise backbeat (absent on L1).
    this.snare = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0.25, release: 0.12 },
      volume: -16
    });
    const snareBP = new Tone.Filter(1800, "bandpass");
    snareBP.Q.value = 0.9;
    this.snare.connect(snareBP);
    snareBP.connect(this.musicBus);
    // Hat: a high-passed white-noise tick on the offbeat 16ths.
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0.15, release: 0.02 },
      volume: -26
    });
    const hatHP = new Tone.Filter(6000, "highpass");
    hatHP.Q.value = 0.7;
    this.hat.connect(hatHP);
    hatHP.connect(this.musicBus);

    // ---- SFX voices (into the sfx bus) ------------------------------------
    // Polysynths so overlapping hits (a double blip in chomp, the multi-note
    // gameover) use separate voices instead of retriggering one envelope.
    this.sfxOsc = new Tone.PolySynth({
      maxPolyphony: 8,
      voice: Tone.Synth,
      options: {
        oscillator: { type: VOICES.pulse.wave },
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.16 },
        volume: -14
      }
    });
    this.sfxOsc.connect(this.sfxBus);
    this.sfxNoise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0.2, release: 0.1 },
      volume: -8
    });
    const sfxNoiseBP = new Tone.Filter(1200, "bandpass");
    sfxNoiseBP.Q.value = 0.8;
    this.sfxNoise.connect(sfxNoiseBP);
    sfxNoiseBP.connect(this.sfxBus);

    this.startCrackle();
    // Apply a song that was requested before unlock.
    if (this.pendingSong !== null) {
      this.song = this.pendingSong;
      this.pendingSong = null;
    }
    // Start the lookahead scheduler at the song's tempo.
    this.nextStepAt = Tone.now() + 0.06;
    this.startSequencer();
  }

  /** Vinyl crackle: a sparse-pop loop, high-passed, at a very low gain (a
   *  faint bed under the music). Raw Web Audio; one ambient texture. */
  private startCrackle(): void {
    try {
      const raw = Tone.context.rawContext;
      const len = Math.floor(raw.sampleRate * 2);
      const buf = raw.createBuffer(1, len, raw.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < 80; i++) {
        const at = Math.floor(Math.random() * len);
        const amp = 0.12 + Math.random() * 0.45;
        const tail = 1 + Math.floor(Math.random() * 3);
        for (let t = 0; t < tail && at + t < len; t++) {
          d[at + t]! += amp * (1 - t / tail) * (Math.random() > 0.5 ? 1 : -1);
        }
      }
      const src = raw.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = raw.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      const g = raw.createGain();
      g.gain.value = 0.02; // faint, under everything
      src.connect(hp);
      hp.connect(g);
      g.connect(raw.destination);
      src.start();
    } catch {
      // Crackle is optional colour; never let it break the graph build.
    }
  }

  private startSequencer(): void {
    if (this.seqTimer !== null) return;
    this.seqTimer = window.setInterval(() => this.schedule(), 40);
  }

  /**
   * Lookahead scheduler: queue the current song's voices that fall inside the
   * next 100 ms. The voice table is cached per bar (recomputed only when the
   * chord bar wraps), so the steady state allocates nothing but short-lived
   * Tone note events.
   */
  private schedule(): void {
    if (!this.ready) return;
    const state = Tone.context.state;
    if (state !== "running") return;
    try {
      const dt = stepSeconds(this.song.bpm);
      const horizon = Tone.now() + 0.1;
      while (this.nextStepAt < horizon) {
        const bar = this.barCount;
        const inBar = this.stepIndex;
        const chordBar = bar % this.song.chords.length;
        if (this.cachedBar !== chordBar) {
          this.cachedBar = chordBar;
          this.voiceCache = voiceBar(this.song, chordBar);
        }
        const v = this.voiceCache![inBar]!;
        const t = T(this.nextStepAt);
        if (v.bass !== null) this.bass?.triggerAttackRelease(freqFromMidi(v.bass), T(dt * 1.8), t);
        if (v.pad !== null)
          this.pad?.triggerAttackRelease(v.pad.map(freqFromMidi), T(16 * dt), t);
        if (v.arp !== null) this.arp?.triggerAttackRelease(freqFromMidi(v.arp), T(dt), t);
        if (v.kick) this.kick?.triggerAttackRelease(36, 0.2, t);
        if (v.snare) this.snare?.triggerAttackRelease(T(0.14), t);
        if (v.hat) this.hat?.triggerAttackRelease(T(0.05), t);
        this.nextStepAt += dt;
        this.stepIndex = (this.stepIndex + 1) % 16;
        if (this.stepIndex === 0) this.barCount++;
      }
    } catch {
      // A scheduling error must never take down the timer; the music just
      // skips a step. Never let it throw out of the interval callback.
    }
  }

  // ---- song control -------------------------------------------------------

  /**
   * Switch to a level's song. Crossfades the music bus down, swaps the song and
   * tempo, fades back up. Before unlock it simply remembers the level (a
   * `pendingSong`), applied on the first build.
   */
  setSong(level: number): void {
    const clamped = Math.min(Math.max(level, 1), SONG_COUNT);
    if (clamped === this.songLevel) return;
    this.songLevel = clamped; // remember immediately (pre-unlock too)
    const target = songForLevel(clamped);
    if (!this.ready || this.musicBus === null) {
      this.pendingSong = target;
      return;
    }
    const apply = (): void => {
      this.song = target;
      this.voiceCache = null;
      this.cachedBar = -1;
      this.barCount = 0;
      this.stepIndex = 0;
      try {
        Tone.Transport.bpm.value = target.bpm;
      } catch {
        // Transport may be unavailable in odd contexts; the scheduler reads
        // bpm from the song data directly, so this is non-fatal.
      }
    };
    const bus = this.musicBus;
    if (Tone.context.state !== "running") {
      apply();
      return;
    }
    bus.gain.rampTo(0, 0.05);
    if (this.songFadeTimer !== null) window.clearTimeout(this.songFadeTimer);
    this.songFadeTimer = window.setTimeout(() => {
      apply();
      bus.gain.rampTo(1, 0.08);
      this.songFadeTimer = null;
    }, SONG_FADE_MS);
  }

  // ---- SFX (retro stabs through the sfx bus) ------------------------------
  // Every SFX wraps its Tone calls in `safe()`: a Web Audio scheduling error
  // (e.g. "time must be >= last scheduled time") must NEVER propagate to the
  // render loop, or it would kill the rAF chain and freeze the game.

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Swallow a scheduling error; the audio just misses a note.
    }
  }

  /** Apple chomp: a short square thud + a filtered-noise bite, twice. */
  chomp(): void {
    if (!this.ready) return;
    this.sfxCounts.chomp!++;
    this.safe(() => {
      const now = T(Tone.now());
      this.sfxOscNote(180, now, 0.09);
      this.sfxNoise?.triggerAttackRelease(T(0.06), now);
      this.sfxOscNote(140, T(Tone.now() + 0.07), 0.08);
    });
  }

  /** Combo coin: rising two-note square blip (Sonic-style). */
  coin(): void {
    if (!this.ready) return;
    this.sfxCounts.coin!++;
    this.safe(() => {
      const now = Tone.now();
      this.sfxOscNote(76, now, 0.05);
      this.sfxOscNote(83, now + 0.06, 0.09);
    });
  }

  /** Wall boom: a low drop + a big low-passed noise crash. */
  boom(): void {
    if (!this.ready) return;
    this.sfxCounts.boom!++;
    this.safe(() => {
      const now = T(Tone.now());
      this.sfxOscNote(120, now, 0.3);
      this.sfxNoise?.triggerAttackRelease(T(0.4), now);
    });
  }

  /** Self-bite splat: a wet band-passed noise burst + a low thump. */
  splat(): void {
    if (!this.ready) return;
    this.sfxCounts.splat!++;
    this.safe(() => {
      const now = T(Tone.now());
      this.sfxNoise?.triggerAttackRelease(T(0.2), now);
      this.sfxOscNote(90, T(Tone.now() + 0.03), 0.15);
    });
  }

  /** Level-up jingle: four-note arpeggio. */
  jingle(): void {
    if (!this.ready) return;
    this.sfxCounts.jingle!++;
    this.safe(() => {
      const now = Tone.now();
      const notes = [72, 76, 79, 84];
      for (let i = 0; i < notes.length; i++) {
        this.sfxOscNote(notes[i]!, now + i * 0.07, 0.12);
      }
    });
  }

  /** Game over: a slow detuned descend. */
  gameover(): void {
    if (!this.ready) return;
    this.sfxCounts.gameover!++;
    this.safe(() => {
      const now = Tone.now();
      const notes = [67, 63, 58];
      for (let i = 0; i < notes.length; i++) {
        const tSec = now + i * 0.18;
        this.sfxOscNote(notes[i]!, tSec, 0.2);
        this.sfxOscNote(notes[i]! - 1, tSec, 0.2); // detuned double
      }
    });
  }

  /** UI click (pause/toggle). */
  click(): void {
    if (!this.ready) return;
    this.sfxCounts.click!++;
    this.safe(() => {
      this.sfxNoise?.triggerAttackRelease(T(0.03), T(Tone.now()));
    });
  }

  /** One-shot SFX note through the sfx bus (square, fixed level). */
  private sfxOscNote(freqOrMidi: number, atSec: number, dur: number): void {
    const osc = this.sfxOsc;
    if (osc === null) return;
    // Low values (<120) are treated as raw Hz thuds; otherwise as MIDI.
    const freq = freqOrMidi < 120 ? freqOrMidi : freqFromMidi(freqOrMidi);
    osc.triggerAttackRelease(freq, T(dur), T(atSec));
  }

  /** One-shot SFX blip (e.g. on eat). No-op until unlocked. */
  blip(voice: VoiceName, midi: number): void {
    if (!this.ready) return;
    if (Tone.context.state !== "running") return;
    this.safe(() => {
      const nowSec = T(Tone.now());
      if (voice === "noise") {
        this.sfxNoise?.triggerAttackRelease(T(0.09), nowSec);
        return;
      }
      this.sfxOscNote(midi, nowSec, 0.22);
    });
  }

  /** Suspend/resume with page visibility. */
  suspend(): void {
    if (this.ready && Tone.context.state === "running") {
      void (Tone.context.rawContext as AudioContext).suspend();
    }
  }

  resume(): void {
    if (this.ready && Tone.context.state === "suspended") {
      void (Tone.context.rawContext as AudioContext).resume();
    }
  }

  getState(): string {
    if (!this.ready) return "locked";
    const s = Tone.context.state;
    return s === "running" || s === "suspended" ? s : "suspended";
  }

  setDucked(v: boolean): void {
    if (v === this.ducked) return;
    this.ducked = v;
    if (this.ready && this.musicBus !== null) {
      this.musicBus.gain.rampTo(v ? 0.4 : 1, 0.05);
    }
  }

  /** Hard mute (settings). Independent of the duck, which only lowers the
   *  music bus while paused; mute zeros the master so nothing plays. */
  setMuted(v: boolean): void {
    if (v === this.muted) return;
    this.muted = v;
    if (this.ready && this.master !== null) {
      this.master.gain.rampTo(v ? 0 : this.masterBase, 0.04);
    }
  }

  debug(): SynthDebug {
    return {
      unlocked: this.unlocked,
      running: this.ready && Tone.context.state === "running",
      state: this.getState(),
      master: this.masterBase,
      voices: Object.keys(VOICES) as VoiceName[],
      duckCap: DUCK_CAP,
      ducked: this.ducked,
      muted: this.muted,
      song: this.songLevel,
      sfx: { ...this.sfxCounts }
    };
  }
}
