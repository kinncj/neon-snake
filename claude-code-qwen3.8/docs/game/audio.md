# Audio: procedural SFX and per-level lo-fi BGM

All audio is **procedural — there are no asset bytes.** SFX is synthesized on the
sanctioned Phase-3 engine **Tone.js 15.1.22** (`app/adapters/audio/synth.ts`, ADR 0007);
BGM is a set of chord-progression loops rendered offline to buffers
(`app/adapters/audio/songs.ts`). The *decision logic* (which effect triggers which
voice, the game-over sting layering, mute + persistence, `lastSfx()`) is pure and
engine-agnostic and unit-tested in Node against a stub engine.

## Autoplay policy — "no AudioContext before a gesture"

Importing `tone` eagerly creates its shared `AudioContext`, so `tone` is imported only
via a dynamic `import('tone')` inside `ensure()` — which `createSound()` calls from the
**first real `keydown` / `pointerdown`**. Before that gesture the module (and its
context) does not exist and `soundReady()` is false. The e2e
`audio.spec.ts` asserts no `AudioContext` before a gesture and that a real input
unlocks it. The context **suspends** when the tab hides (CPU/battery) and resumes on
show.

## SFX voice library

| Voice | Recipe | Engine voice | Trigger |
|---|---|---|---|
| `ate` | triangle, 659→880 Hz | MonoSynth | eating (no combo) |
| `coin` | square, 987→1318 Hz | MonoSynth | eating on a combo (replaces the chomp) |
| `levelup` | square, 523→659→784→1046 Hz | PolySynth | level-up jingle |
| `boom` | sawtooth, 110→55 Hz | MembraneSynth thud | wall death |
| `splat` | triangle, 440→220→110 Hz | NoiseSynth white burst | self-bite |
| `gameover` | sawtooth, 392→330→262→196 Hz | MonoSynth | the sting closing out any death |

`soundNameForEffect(kind, combo, cause)` is the pure mapping: `ate` → `combo > 1 ?
'coin' : 'ate'`; `levelup` → `levelup`; `died` → `cause === 'self' ? 'splat' : 'boom'`;
movement / growth / spawn are silent. A death **layers the game-over sting under** the
cause-specific hit; the sting is scheduled *first* so `lastSfx()` still reports the
cause voice (`boom` / `splat`), which the death-FX e2e gate reads.

## Bus, ducking, and mute

The graph: per-voice synths → **SFX low-pass (4000 Hz)** → **SFX bus (`DUCK_GAIN 0.8`)**
→ **master (`VOLUME 0.9`)** → compressor → destination; BGM plugs into a native **music
bus (`MUSIC_LEVEL 0.16`)** wired to the same master. The `0.8` duck caps the summed
voice level so a cluster of overlapping voices can't clip (the e2e `audio.spec.ts`
pins `duckGain() === 0.8`).

Mute is keyboard-reachable — **`M`** and a labelled, focusable `🔊`/`🔇` control — and
persists to `localStorage['snake.sound']` (the single source of truth; the settings
panel's Sound toggle is a live view of this handle, so the two never drift). The
accessible label is localized and re-read on a locale change.

## Per-level lo-fi BGM

Five tracks, one per level (70 → 86 bpm, jazz-extended chords). Each is a 4/4
chord-progression loop rendered **once** (offline) into an `AudioBuffer` and played
looped by an `AudioBufferSourceNode` — a level-up **crossfades** (250 ms fade out / in)
so the change settles rather than clicks. Track selection (`name` / `bpm`) is set
synchronously each frame so the debug/e2e surface can read it without waiting on audio;
the buffer render + source are best-effort and never block the sim.

| Level | Track | BPM | Snare | Arp | Progression |
|---|---|---|---|---|---|
| 1 | `cozy-bedroom` | 70 | — | — | Am7 · Fmaj7 · Cmaj7 · G7 |
| 2 | `window-seat` | 74 | ✓ | — | Dm9 · Bbmaj7 · Gm7 · C7 |
| 3 | `rainy-train` | 78 | ✓ | — | Em9 · Cmaj7 · Am7 · G7 |
| 4 | `park-bench` | 82 | ✓ | ✓ | Cmaj7 · Am7 · Fmaj7 · G7 |
| 5 | `skyline-view` | 86 | ✓ | ✓ | Fmaj7 · Am7 · Dm7 · Bbmaj7 |

The lo-fi glue per bar: a low-passed **pad** (two detuned triangles per chord tone), a
**sub-octave sine bass** on beat 1, a **kick** on 1 & 3, a **band-passed snare** on 2 &
4 (when the track has one), 8th-note **hats**, and — when the track has one — a
16th-note **arpeggio** cycling the chord. All runs through a gentle master low-pass →
compressor. `Math.random` is used only for the drum **noise** (audio, not domain) and
never enters the replay hash.

## Allocation

The Tone graph (voices + buses + master + compressor) is built **once**, lazily, and
reused for every trigger. `consume()` only schedules notes on the existing voices — it
allocates nothing in steady state (the effect sink's `len` is 0 most frames). The BGM
buffer is rendered once per track and cached, so steady-state level play allocates
nothing.
