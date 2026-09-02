import { EFFECT_ATE, EFFECT_DIED, EFFECT_LEVELUP, CAUSE_WALL } from "../../domain/types";
import { type Song, type MusicEvent, songForLevel, eventsInWindow, beatSeconds } from "./songs";

/**
 * Procedural audio on Tone.js. No asset bytes: every sound is synthesised
 * from preallocated voices. The Tone module (and with it the AudioContext)
 * is loaded only inside `enable()`, which the runtime calls from a user
 * gesture, so no context exists before one. The engine consumes the same
 * effect stream the renderer does and never touches simulation state.
 */
type ToneNS = typeof import("tone");

export type SfxName = "chomp" | "coin" | "levelup" | "boom" | "splat" | "gameover";

/** Simultaneous voice gain is capped: extra voices are ducked to fit. */
export const VOICE_GAIN_CAP = 0.8;

/** Scale factor to apply to a new voice of `gain` given `activeSum` already sounding. */
export function duckScale(activeSum: number, gain: number, cap = VOICE_GAIN_CAP): number {
  if (activeSum + gain <= cap) return 1;
  const room = cap - activeSum;
  return room <= 0 ? 0 : room / gain;
}

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export type VoiceName = "pulse" | "triangle" | "lead" | "noise" | "membrane";

/** Per-voice envelopes (seconds / level). */
export const VOICES: Record<VoiceName, { adsr: Adsr; gain: number }> = {
  pulse: { adsr: { attack: 0.005, decay: 0.08, sustain: 0.4, release: 0.12 }, gain: 0.32 },
  triangle: { adsr: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }, gain: 0.3 },
  lead: { adsr: { attack: 0.01, decay: 0.12, sustain: 0.3, release: 0.25 }, gain: 0.28 },
  noise: { adsr: { attack: 0.002, decay: 0.12, sustain: 0.0, release: 0.08 }, gain: 0.25 },
  membrane: { adsr: { attack: 0.001, decay: 0.35, sustain: 0.0, release: 0.4 }, gain: 0.45 }
};

/** Which sound a domain effect plays, if any. */
export function sfxForEffect(kind: number, arg: number, combo: number): SfxName | null {
  if (kind === EFFECT_ATE) return combo > 1 ? "coin" : "chomp";
  if (kind === EFFECT_LEVELUP) return "levelup";
  if (kind === EFFECT_DIED) return arg === CAUSE_WALL ? "boom" : "splat";
  return null;
}

/** One scheduled note of an SFX pattern: relative offset (s), note, duration (s). */
export interface SfxNote {
  voice: VoiceName;
  at: number;
  note: string;
  dur: number;
  vel: number;
}

/** SFX patterns: short, bright, chiptune. */
export const SFX: Record<SfxName, readonly SfxNote[]> = {
  chomp: [
    { voice: "pulse", at: 0, note: "C5", dur: 0.05, vel: 0.9 },
    { voice: "pulse", at: 0.05, note: "G5", dur: 0.06, vel: 0.8 }
  ],
  coin: [
    { voice: "lead", at: 0, note: "B5", dur: 0.06, vel: 0.9 },
    { voice: "lead", at: 0.07, note: "E6", dur: 0.18, vel: 0.9 }
  ],
  levelup: [
    { voice: "lead", at: 0, note: "C5", dur: 0.1, vel: 0.9 },
    { voice: "lead", at: 0.1, note: "E5", dur: 0.1, vel: 0.9 },
    { voice: "lead", at: 0.2, note: "G5", dur: 0.1, vel: 0.9 },
    { voice: "lead", at: 0.3, note: "C6", dur: 0.35, vel: 1.0 },
    { voice: "pulse", at: 0.3, note: "E6", dur: 0.35, vel: 0.6 }
  ],
  boom: [
    { voice: "membrane", at: 0, note: "C1", dur: 0.5, vel: 1.0 },
    { voice: "noise", at: 0, note: "C1", dur: 0.35, vel: 0.9 },
    { voice: "triangle", at: 0.02, note: "A1", dur: 0.3, vel: 0.7 }
  ],
  splat: [
    { voice: "noise", at: 0, note: "C1", dur: 0.12, vel: 0.9 },
    { voice: "membrane", at: 0.02, note: "G1", dur: 0.2, vel: 0.7 },
    { voice: "pulse", at: 0.03, note: "F#3", dur: 0.08, vel: 0.5 }
  ],
  gameover: [
    { voice: "triangle", at: 0, note: "E4", dur: 0.25, vel: 0.8 },
    { voice: "triangle", at: 0.28, note: "C4", dur: 0.25, vel: 0.8 },
    { voice: "triangle", at: 0.56, note: "A3", dur: 0.6, vel: 0.9 },
    { voice: "pulse", at: 0.56, note: "E3", dur: 0.6, vel: 0.5 }
  ]
};

export const STORAGE_KEY = "snake.audio";

export interface AudioEngine {
  /** Create the context and voices; call from a user gesture. */
  enable(): Promise<boolean>;
  /** True once `enable()` succeeded. */
  enabled(): boolean;
  /** True if an AudioContext has been created by this engine. */
  contextCreated(): boolean;
  setMuted(v: boolean): void;
  muted(): boolean;
  /** Dispatch a domain effect. Cheap no-op before enable(). */
  onEffect(kind: number, arg: number, combo: number): void;
  trigger(name: SfxName): void;
  /** Sum of voice gains currently sounding (for the ducking budget). */
  voiceSum(): number;
  lastSfx(): string;
  /** The raw AudioContext state, or "none" before enable(). */
  contextState(): string;
  suspend(): void;
  resume(): void;
  /** Crossfades (250 ms) to the song for `level`; no-op before enable(). */
  playSong(level: number): void;
  /** Name of the song currently playing, or "" when silent. */
  song(): string;
  /** Recent song-player transitions, oldest first (debugging aid). */
  history(): string[];
  stopSong(): void;
}

/** Crossfade length between songs. */
export const CROSSFADE_S = 0.25;
/** Scheduler: wake every TICK_MS and book events up to LOOKAHEAD_S ahead. */
export const SCHED_TICK_MS = 100;
export const SCHED_LOOKAHEAD_S = 0.3;

export interface AudioOptions {
  storage?: Storage | null;
  loadTone?: () => Promise<ToneNS>;
}

const ACTIVE_CAP = 32;

export function createAudio(opts: AudioOptions = {}): AudioEngine {
  const storage = opts.storage ?? null;
  let tone: ToneNS | null = null;
  let master: import("tone").Gain | null = null;
  let sfxBus: import("tone").Filter | null = null;
  let musicBus: import("tone").Filter | null = null;
  let voices: {
    pulse: import("tone").PolySynth;
    triangle: import("tone").PolySynth;
    lead: import("tone").PolySynth;
    noise: import("tone").NoiseSynth;
    membrane: import("tone").MembraneSynth;
  } | null = null;
  let isMuted = storage?.getItem(STORAGE_KEY) === "off";
  let last = "";
  let enabling: Promise<boolean> | null = null;

  // Song player: two music lanes (A/B) so a level-up can crossfade.
  interface Lane {
    gain: import("tone").Gain;
    chord: import("tone").PolySynth;
    bass: import("tone").MonoSynth;
    kick: import("tone").MembraneSynth;
    snare: import("tone").NoiseSynth;
    hat: import("tone").NoiseSynth;
    arp: import("tone").Synth;
    song: Song | null;
    /** Song start in context seconds. */
    startAt: number;
    /** Beats scheduled so far. */
    beat: number;
    /** Bumped whenever the lane starts; a stale fade-out must not clear it. */
    epoch: number;
    /** Context time up to which notes have been booked on this lane's voices. */
    scheduledUntil: number;
  }
  let lanes: [Lane, Lane] | null = null;
  let activeLane = 0;
  let schedTimer = 0;
  const events: MusicEvent[] = [];
  let wantedLevel = 0;
  const hist: string[] = [];
  const note = (s: string): void => {
    if (hist.length >= 24) hist.shift();
    hist.push(s);
  };

  // Voice accounting for ducking: start/end/gain per scheduled voice, a ring.
  const activeStart = new Float64Array(ACTIVE_CAP);
  const activeEnd = new Float64Array(ACTIVE_CAP);
  const activeGain = new Float32Array(ACTIVE_CAP);
  let activeCursor = 0;

  /** Gain of every voice sounding anywhere inside [from, to). */
  const sum = (from: number, to: number = from): number => {
    let s = 0;
    for (let i = 0; i < ACTIVE_CAP; i++) {
      if (activeStart[i]! <= to && activeEnd[i]! > from) s += activeGain[i]!;
    }
    return s;
  };

  const applyMute = (): void => {
    if (master) master.gain.rampTo(isMuted ? 0 : 0.9, 0.05);
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY, isMuted ? "off" : "on");
      } catch {
        /* quota or privacy mode: ignore */
      }
    }
  };

  async function build(): Promise<boolean> {
    try {
      const T = await (opts.loadTone ?? (() => import("tone")))();
      await T.start();
      tone = T;
      master = new T.Gain(isMuted ? 0 : 0.9).toDestination();
      const comp = new T.Compressor({ threshold: -18, ratio: 4, attack: 0.004, release: 0.12 }).connect(master);
      sfxBus = new T.Filter({ frequency: 6500, type: "lowpass", rolloff: -12 }).connect(comp);
      musicBus = new T.Filter({ frequency: 1800, type: "lowpass", rolloff: -12 }).connect(comp);
      const pulse = new T.PolySynth(T.Synth, {
        oscillator: { type: "pulse", width: 0.3 },
        envelope: VOICES.pulse.adsr,
        volume: -8
      }).connect(sfxBus);
      const triangle = new T.PolySynth(T.Synth, {
        oscillator: { type: "triangle" },
        envelope: VOICES.triangle.adsr,
        volume: -6
      }).connect(sfxBus);
      const lead = new T.PolySynth(T.Synth, {
        oscillator: { type: "square" },
        envelope: VOICES.lead.adsr,
        volume: -10
      }).connect(sfxBus);
      const noise = new T.NoiseSynth({ noise: { type: "white" }, envelope: VOICES.noise.adsr, volume: -10 }).connect(sfxBus);
      const membrane = new T.MembraneSynth({
        pitchDecay: 0.06,
        octaves: 8,
        envelope: VOICES.membrane.adsr,
        volume: -4
      }).connect(sfxBus);
      pulse.maxPolyphony = 6;
      triangle.maxPolyphony = 6;
      lead.maxPolyphony = 4;
      voices = { pulse, triangle, lead, noise, membrane };
      lanes = [makeLane(T, musicBus), makeLane(T, musicBus)];
      if (wantedLevel > 0) startSong(wantedLevel);
      return true;
    } catch {
      tone = null;
      voices = null;
      return false;
    }
  }

  function makeLane(T: ToneNS, bus: import("tone").Filter): Lane {
    const gain = new T.Gain(0).connect(bus);
    const chord = new T.PolySynth(T.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.08, decay: 0.4, sustain: 0.55, release: 0.9 },
      volume: -14
    }).connect(gain);
    chord.maxPolyphony = 8;
    const bass = new T.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.4 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3, baseFrequency: 120, octaves: 2 },
      volume: -9
    }).connect(gain);
    const kick = new T.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 }, volume: -10 }).connect(gain);
    const snare = new T.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.1 }, volume: -18 }).connect(gain);
    const hat = new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }, volume: -26 }).connect(gain);
    const arp = new T.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 }, volume: -20 }).connect(gain);
    return { gain, chord, bass, kick, snare, hat, arp, song: null, startAt: 0, beat: 0, epoch: 0, scheduledUntil: 0 };
  }

  function scheduleLane(lane: Lane, until: number): void {
    if (!tone || !lane.song) return;
    const spb = beatSeconds(lane.song);
    const toBeat = (until - lane.startAt) / spb;
    if (toBeat <= lane.beat) return;
    events.length = 0;
    eventsInWindow(lane.song, lane.beat, toBeat, events);
    for (const e of events) {
      const at = lane.startAt + e.at * spb;
      const dur = Math.max(0.05, e.dur * spb);
      // A voice refuses a note scheduled behind one it already holds; skip
      // rather than let an engine assertion escape into the frame loop.
      try {
        switch (e.voice) {
          case "chord": lane.chord.triggerAttackRelease(e.note, dur, at, e.vel); break;
          case "bass": lane.bass.triggerAttackRelease(e.note, dur, at, e.vel); break;
          case "kick": lane.kick.triggerAttackRelease("C1", dur, at, e.vel); break;
          case "snare": lane.snare.triggerAttackRelease(dur, at, e.vel); break;
          case "hat": lane.hat.triggerAttackRelease(dur, at, e.vel); break;
          case "arp": lane.arp.triggerAttackRelease(e.note, dur, at, e.vel); break;
        }
      } catch {
        note(`skip ${e.voice}@${at.toFixed(3)}`);
      }
      if (at + dur > lane.scheduledUntil) lane.scheduledUntil = at + dur;
    }
    lane.beat = toBeat;
  }

  function schedulerTick(): void {
    if (!tone || !lanes) return;
    const until = tone.now() + SCHED_LOOKAHEAD_S;
    scheduleLane(lanes[activeLane]!, until);
  }

  function startSong(level: number): void {
    if (!tone || !lanes || !musicBus) return;
    const song = songForLevel(level);
    const cur = lanes[activeLane]!;
    note(`play L${level} ${song.name} cur=${cur.song?.name ?? "-"} lane=${activeLane}`);
    if (cur.song === song) return;
    const nextIdx = cur.song ? 1 - activeLane : activeLane;
    const next = lanes[nextIdx]!;
    const now = tone.now();
    // Crossfade: the old lane ramps out while the new one ramps in.
    if (cur.song && nextIdx !== activeLane) {
      cur.gain.gain.cancelScheduledValues(now);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
      cur.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_S);
      const old = cur;
      const epoch = old.epoch;
      window.setTimeout(() => {
        // Only clear the lane if it was not restarted during the fade.
        if (old.epoch !== epoch) return;
        note(`faded ${old.song?.name ?? "-"}`);
        old.song = null;
        old.chord.releaseAll();
      }, CROSSFADE_S * 1000 + 50);
    }
    next.song = song;
    // Never book behind notes this lane already holds from an earlier song.
    next.startAt = Math.max(now + 0.05, next.scheduledUntil + 0.02);
    next.beat = 0;
    next.epoch++;
    next.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_S);
    musicBus.frequency.rampTo(song.cutoff, CROSSFADE_S);
    activeLane = nextIdx;
    scheduleLane(next, now + SCHED_LOOKAHEAD_S);
    if (!schedTimer) schedTimer = window.setInterval(schedulerTick, SCHED_TICK_MS);
  }

  function play(name: SfxName): void {
    if (!tone || !voices) return;
    const now = tone.now();
    last = name;
    for (const n of SFX[name]) {
      const g = VOICES[n.voice].gain * n.vel;
      const at = now + n.at + 0.005;
      const end = at + n.dur + VOICES[n.voice].adsr.release;
      const scale = duckScale(sum(at, end), g);
      if (scale <= 0.02) continue;
      const vel = Math.min(1, n.vel * scale);
      const i = activeCursor;
      activeCursor = (activeCursor + 1) % ACTIVE_CAP;
      activeStart[i] = at;
      activeEnd[i] = end;
      activeGain[i] = g * scale;
      switch (n.voice) {
        case "noise":
          voices.noise.triggerAttackRelease(n.dur, at, vel);
          break;
        case "membrane":
          voices.membrane.triggerAttackRelease(n.note, n.dur, at, vel);
          break;
        default:
          voices[n.voice].triggerAttackRelease(n.note, n.dur, at, vel);
      }
    }
  }

  return {
    enable() {
      if (voices) return Promise.resolve(true);
      if (!enabling) enabling = build();
      return enabling;
    },
    enabled: () => voices !== null,
    contextCreated: () => tone !== null,
    setMuted(v) {
      isMuted = v;
      applyMute();
    },
    muted: () => isMuted,
    onEffect(kind, arg, combo) {
      const name = sfxForEffect(kind, arg, combo);
      if (!name) return;
      play(name);
      if (kind === EFFECT_DIED) play("gameover");
    },
    trigger: play,
    voiceSum: () => (tone ? sum(tone.now()) : 0),
    lastSfx: () => last,
    contextState: () => (tone ? String(tone.getContext().rawContext.state) : "none"),
    suspend() {
      if (tone) void (tone.getContext().rawContext as AudioContext).suspend();
    },
    resume() {
      if (tone) void (tone.getContext().rawContext as AudioContext).resume();
    },
    playSong(level) {
      wantedLevel = level;
      if (!lanes) note(`queued L${level}`);
      startSong(level);
    },
    song: () => (lanes && lanes[activeLane]!.song ? lanes[activeLane]!.song!.name : ""),
    history: () => hist.slice(),
    stopSong() {
      if (!tone || !lanes) return;
      const cur = lanes[activeLane]!;
      cur.gain.gain.rampTo(0, CROSSFADE_S);
      cur.song = null;
      wantedLevel = 0;
      if (schedTimer) {
        window.clearInterval(schedTimer);
        schedTimer = 0;
      }
    }
  };
}
