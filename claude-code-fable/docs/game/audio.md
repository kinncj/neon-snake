# Audio

Everything is synthesised on Tone.js (`app/adapters/audio/synth.ts`,
`songs.ts`, ADR 0007). No asset bytes ship. The engine (and the
`AudioContext`) is created only on the first user gesture; until then every
audio call is a no-op.

## Signal path

```
SFX voices ──► SFX bus (low-pass 6.5 kHz) ──┐
                                            ├──► compressor ──► master gain ──► destination
music lane A / lane B ──► music bus (low-pass 1.4–2.3 kHz, per song) ──┘
```

`setMuted` ramps the master gain (50 ms); the state persists in
`localStorage` under `snake.audio`. The context suspends on
`visibilitychange: hidden` and resumes when visible.

## SFX

| Event | Sound |
|---|---|
| eat | `chomp` — two quick pulse notes (C5 → G5) |
| eat inside a combo | `coin` — lead B5 → E6 |
| level-up | `levelup` — a four-note jingle (C5 E5 G5 C6) with a pulse fifth |
| wall death | `boom` — membrane C1 + white noise + a low triangle |
| self-bite | `splat` — short noise + membrane G1 + a dull pulse |
| any death | `gameover` — a descending triangle line (E4 C4 A3) |

Voices: pulse (`PolySynth`, pulse wave), triangle (`PolySynth`), lead
(`PolySynth`, square), noise (`NoiseSynth`), membrane (`MembraneSynth`),
each with its own ADSR. The simultaneous voice gain is capped at **0.8**:
a new note is scaled down to fit under the cap or skipped, using the exact
overlap of its window with the notes already booked.

## Songs

Five lo-fi tracks, one per level, jazz-extended chords (maj7/9, m9, 7/9),
70 → 86 bpm:

| Level | Song | bpm | Extras |
|---|---|---|---|
| 1 | cozy-bedroom | 70 | no snare |
| 2 | window-seat | 74 | snare |
| 3 | rainy-train | 78 | snare |
| 4 | park-bench | 82 | snare + arp |
| 5 | skyline-view | 86 | snare + arp |

Each bar: a held chord (triangle poly), a sine bass on 1 and the "and" of
3, a kick on 1 and 3, a snare on 2 and 4 when enabled, lazily swung hats
on every eighth, and an offbeat arpeggio on the arp songs.

A look-ahead scheduler (100 ms tick, 300 ms horizon) books notes from a
pure event generator (`eventsInWindow`) so adjacent windows never repeat
or drop an event. Two lanes allow a **250 ms crossfade** on level-up or
restart; a lane is never re-booked behind notes it already holds, and a
restart during a fade cancels the fade's cleanup.
