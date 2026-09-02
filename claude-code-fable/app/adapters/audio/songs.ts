import { MAX_LEVEL } from "../../domain/levels";

/**
 * Five lo-fi tracks, one per level, 70 → 86 bpm, jazz-extended chords.
 * Pure data plus a pure scheduler: `eventsInWindow` turns a beat range into
 * note events, so the player only has to convert beats to seconds.
 */
export type SongName = "cozy-bedroom" | "window-seat" | "rainy-train" | "park-bench" | "skyline-view";

export interface Song {
  name: SongName;
  bpm: number;
  /** Chords, one per bar (4 beats), as note names; extended voicings. */
  chords: readonly (readonly string[])[];
  /** Bass note per bar. */
  bass: readonly string[];
  snare: boolean;
  arp: boolean;
  /** Low-pass cutoff for the music bus while this song plays (Hz). */
  cutoff: number;
}

export const SONGS: readonly Song[] = [
  {
    name: "cozy-bedroom",
    bpm: 70,
    chords: [["D3", "F#3", "A3", "C#4", "E4"], ["B2", "D3", "F#3", "A3", "C#4"], ["G3", "B3", "D4", "F#4"], ["A3", "C#4", "E4", "G4", "B4"]],
    bass: ["D2", "B1", "G2", "A2"],
    snare: false,
    arp: false,
    cutoff: 1400
  },
  {
    name: "window-seat",
    bpm: 74,
    chords: [["F3", "A3", "C4", "E4", "G4"], ["D3", "F3", "A3", "C4", "E4"], ["Bb2", "D3", "F3", "A3", "C4"], ["C3", "E3", "G3", "Bb3", "D4"]],
    bass: ["F2", "D2", "Bb1", "C2"],
    snare: true,
    arp: false,
    cutoff: 1600
  },
  {
    name: "rainy-train",
    bpm: 78,
    chords: [["A2", "C3", "E3", "G3", "B3"], ["F3", "A3", "C4", "E4"], ["D3", "F3", "A3", "C4", "E4"], ["E3", "G#3", "B3", "D4", "F4"]],
    bass: ["A1", "F2", "D2", "E2"],
    snare: true,
    arp: false,
    cutoff: 1800
  },
  {
    name: "park-bench",
    bpm: 82,
    chords: [["Eb3", "G3", "Bb3", "D4", "F4"], ["C3", "Eb3", "G3", "Bb3", "D4"], ["Ab2", "C3", "Eb3", "G3", "Bb3"], ["Bb2", "D3", "F3", "Ab3", "C4"]],
    bass: ["Eb2", "C2", "Ab1", "Bb1"],
    snare: true,
    arp: true,
    cutoff: 2000
  },
  {
    name: "skyline-view",
    bpm: 86,
    chords: [["G3", "B3", "D4", "F#4", "A4"], ["E3", "G3", "B3", "D4", "F#4"], ["C3", "E3", "G3", "B3", "D4"], ["D3", "F#3", "A3", "C4", "E4"]],
    bass: ["G1", "E2", "C2", "D2"],
    snare: true,
    arp: true,
    cutoff: 2300
  }
];

export function songForLevel(level: number): Song {
  const i = Math.min(Math.max(level, 1), MAX_LEVEL) - 1;
  return SONGS[i]!;
}

export type MusicVoice = "chord" | "bass" | "kick" | "snare" | "hat" | "arp";

/** A note event in beats: `at` beats from the song start, `dur` in beats. */
export interface MusicEvent {
  voice: MusicVoice;
  at: number;
  dur: number;
  note: string;
  vel: number;
}

export const BEATS_PER_BAR = 4;

/** Song length in beats (one pass through the chord loop). */
export function songBeats(song: Song): number {
  return song.chords.length * BEATS_PER_BAR;
}

/**
 * Emits every event with `from <= at < to` into `out` (beats are taken
 * modulo the loop length, so any window works). Returns the count pushed.
 * The pattern per bar: chord on beat 1 (held), bass on 1 and the "and" of
 * 3, kick on 1 and 3, snare on 2 and 4 (when enabled), hats on every
 * eighth at a lazy swing, and an arpeggio on the offbeats (when enabled).
 */
export function eventsInWindow(song: Song, from: number, to: number, out: MusicEvent[]): number {
  const loop = songBeats(song);
  let n = 0;
  const startBar = Math.floor(from / BEATS_PER_BAR);
  const endBar = Math.ceil(to / BEATS_PER_BAR);
  for (let bar = startBar; bar < endBar; bar++) {
    const base = bar * BEATS_PER_BAR;
    const idx = ((bar % song.chords.length) + song.chords.length) % song.chords.length;
    const chord = song.chords[idx]!;
    const bass = song.bass[idx]!;
    const push = (voice: MusicVoice, at: number, dur: number, note: string, vel: number): void => {
      if (at >= from && at < to) {
        out.push({ voice, at, dur, note, vel });
        n++;
      }
    };
    for (const note of chord) push("chord", base, 3.6, note, 0.5);
    push("bass", base, 1.5, bass, 0.8);
    push("bass", base + 2.5, 1.2, bass, 0.6);
    push("kick", base, 0.25, "C1", 0.9);
    push("kick", base + 2, 0.25, "C1", 0.7);
    if (song.snare) {
      push("snare", base + 1, 0.2, "C1", 0.6);
      push("snare", base + 3, 0.2, "C1", 0.65);
    }
    for (let e = 0; e < 8; e++) {
      const swing = e % 2 === 1 ? 0.08 : 0;
      push("hat", base + e * 0.5 + swing, 0.1, "C1", e % 2 === 0 ? 0.35 : 0.22);
    }
    if (song.arp) {
      for (let e = 0; e < 4; e++) {
        const note = chord[(e + 1) % chord.length]!;
        push("arp", base + e + 0.5, 0.4, note, 0.45);
      }
    }
  }
  void loop;
  return n;
}

/** Seconds per beat. */
export function beatSeconds(song: Song): number {
  return 60 / song.bpm;
}
