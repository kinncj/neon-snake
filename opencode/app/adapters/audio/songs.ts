/**
 * Per-level lo-fi songs. Pure data — no Web Audio here. The synth
 * (ChiptuneSynth, built on Tone.js) is the only module that touches the audio
 * graph; this table is what it plays.
 *
 * Each song is a four-chord loop with a tempo and a set of pattern switches.
 * The aesthetic is "relaxing study session": warm jazz-extended harmony,
 * a low speed ceiling, and energy that climbs via the *drum pattern layers*
 * (snare entering at L2, arpeggio at L4) rather than raw tempo.
 *
 * Notes are MIDI numbers. Every chord holds **five voices**: the triad plus
 * a 7th (+11) and a 9th (+14), which gives the pad its complex, warm colour.
 *
 *   - bass:  the chord root, an octave down (mono synth, muted)
 *   - pad:   the full five-voice chord (detuned triangle, slow attack)
 *   - arp:   16th-note chord-tone cycling (square, quiet) when enabled
 *
 * Lo-fi treatment (applied by the synth, not the data): the whole music bus
 * runs through a ~3.5 kHz low-pass with a faint vinyl-crackle bed, so even a
 * bright arp lands dusty and warm.
 */

export interface Song {
  /** display name (docs/diagnostics only — not user-facing UI). */
  readonly name: string;
  /** tempo; the step grid is 16th notes at this bpm. */
  readonly bpm: number;
  /** chord loop; each entry is five MIDI voices, ascending. */
  readonly chords: readonly (readonly number[])[];
  /** pattern switches for the step sequencer. */
  readonly patterns: {
    /** 16th-note hats (offbeats). */
    hat: boolean;
    /** snare on beats 2 and 4 (absent at L1 — an ambient intro). */
    snare: boolean;
    /** kick on beats 1 and 3. */
    kick: boolean;
    /** 8th-note bass following the chord root. */
    bass: boolean;
    /** sustained five-voice pad over the chord. */
    pad: boolean;
    /** 16th-note arp through the chord tones. */
    arp: boolean;
  };
}

/**
 * Five songs, one per level. The tempo ceiling is 86 bpm (a relaxed study
 * context); the energy curve is carried by the drums + arp, not the tempo.
 */
export const SONGS: readonly Song[] = [
  {
    // Level 1: pure late-night chill. A soft modal drift; the snare stays
    // off so the player settles into a steady focus loop.
    name: "cozy-bedroom",
    bpm: 70,
    chords: [
      [41, 48, 55, 60, 64], // Fmaj9 (F, C, G, C, E)
      [45, 52, 57, 60, 64], // Am7   (A, E, A, C, E)
      [43, 50, 57, 59, 62], // G6/9  (G, D, A, B, D)
      [40, 47, 53, 55, 59] // Em7   (E, B, F#, G, B)
    ],
    patterns: { hat: true, snare: false, kick: true, bass: true, pad: true, arp: false }
  },
  {
    // Level 2: rainy afternoon cafe. A lazy backbeat snare joins.
    name: "window-seat",
    bpm: 74,
    chords: [
      [45, 52, 59, 60, 64], // Am9   (A, E, B, C, E)
      [50, 57, 62, 65, 69], // Dm7   (D, A, D, F, A)
      [43, 50, 57, 59, 64], // G13   (G, D, A, B, E)
      [48, 55, 59, 62, 64] // Cmaj9 (C, G, B, D, E)
    ],
    patterns: { hat: true, snare: true, kick: true, bass: true, pad: true, arp: false }
  },
  {
    // Level 3: misty twilight. Deeper modal-jazz extensions.
    name: "rainy-train",
    bpm: 78,
    chords: [
      [46, 53, 60, 61, 65], // Bbm9   (Bb, F, C, Db, F)
      [41, 48, 55, 56, 60], // Fm9    (F, C, G, Ab, C)
      [44, 51, 58, 60, 63], // Abmaj9 (Ab, Eb, Bb, C, Eb)
      [43, 50, 57, 58, 62] // G7b9   (G, D, A, Bb, D)
    ],
    patterns: { hat: true, snare: true, kick: true, bass: true, pad: true, arp: false }
  },
  {
    // Level 4: sunny day. Keeps the tempo low but introduces a gentle arp.
    name: "park-bench",
    bpm: 82,
    chords: [
      [48, 55, 59, 62, 64], // Cmaj9    (C, G, B, D, E)
      [41, 48, 55, 57, 60], // Fmaj7#11 (F, C, G, A, C)
      [43, 50, 57, 59, 64], // G13      (G, D, A, B, E)
      [40, 47, 53, 55, 59] // Em7      (E, B, F#, G, B)
    ],
    patterns: { hat: true, snare: true, kick: true, bass: true, pad: true, arp: true }
  },
  {
    // Level 5: a propulsive but smooth sunset conclusion. Maxes at 86 bpm.
    name: "skyline-view",
    bpm: 86,
    chords: [
      [45, 52, 59, 60, 64], // Am9   (A, E, B, C, E)
      [41, 48, 55, 60, 64], // Fmaj9 (F, C, G, C, E)
      [43, 50, 57, 59, 62], // G6/9  (G, D, A, B, D)
      [44, 51, 58, 60, 63] // Abmaj7 (Ab, Eb, Bb, C, Eb) — a smooth lift
    ],
    patterns: { hat: true, snare: true, kick: true, bass: true, pad: true, arp: true }
  }
];

/** Seconds per 16th-note step at a song's tempo. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/** The song for a level (1-based, clamped). */
export function songForLevel(level: number): Song {
  const idx = Math.min(Math.max(level - 1, 0), SONGS.length - 1);
  return SONGS[idx]!;
}

/**
 * Voice the chord for a 16-step bar. Returns, per step index:
 *   bass — the root an octave below, on 8th notes when patterns.bass
 *   pad  — upper chord tones held across the bar (emitted at step 0)
 *   arp  — cycling chord tone on every 16th when patterns.arp
 *   kick/snare/hat — the drum grid
 * Pure: used by the scheduler and by the unit tests.
 */
export interface StepVoice {
  readonly bass: number | null;
  readonly pad: readonly number[] | null;
  readonly arp: number | null;
  readonly kick: boolean;
  readonly snare: boolean;
  readonly hat: boolean;
}

export function voiceBar(song: Song, barIndex: number): readonly StepVoice[] {
  const chord = song.chords[barIndex % song.chords.length]!;
  const root = chord[0]!;
  const tones = chord;
  const p = song.patterns;
  const steps: StepVoice[] = [];
  for (let s = 0; s < 16; s++) {
    steps.push({
      bass: p.bass && s % 2 === 0 ? root - 12 : null,
      pad: p.pad && s === 0 ? tones.slice(1) : null,
      arp: p.arp ? tones[(s + (barIndex % 4)) % tones.length]! : null,
      kick: p.kick && (s === 0 || s === 8 || (p.snare && s === 14)),
      snare: p.snare && (s === 4 || s === 12),
      hat: p.hat && s % 2 === 1
    });
  }
  return steps;
}
