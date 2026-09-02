# Audio: lo-fi music engine + retro SFX

All sound is synthesized procedurally in Web Audio via **Tone.js** — no
samples, no audio files. Tone.js is the standard Web Audio library for
code-only games (ADR 0007): real synth voices (`PolySynth`/`MonoSynth`/
`MembraneSynth`/`NoiseSynth`), a compressor, and low-pass buses, driven by a
lookahead scheduler. The design goal is the requested flavour: **badass
arcade stabs under a lo-fi blanket** — Mario/Sonic-style SFX that land warm
and dusty because every voice runs through a low-pass, and per-level songs
that carry the game's energy curve.

## Architecture

```
                ┌──── master (Gain 0.9) ─► Compressor ──── destination
                │
   musicBus ──► 3.5kHz low-pass (Q 0.7)  ◄── pad / bass / arp / kick / snare / hat / crackle
   sfxBus  ──► 6kHz  low-pass (Q 0.5)  ◄── chomp / coin / boom / splat / jingle / gameover
```

- **Tone.js voices.** The pad is a `PolySynth` (5-voice triangle chord), the
  bass/arp are `MonoSynth`s, the kick is a `MembraneSynth`, and the snare/hat
  are `NoiseSynth`s. SFX use dedicated `MembraneSynth`/`NoiseSynth`/`Synth`
  voices on the SFX bus. The master runs through a `Compressor` so a full
  5-voice chord + drums can't clip.

- **Two buses.** Music and SFX are separated so a level-up jingle cuts
  through the bed and ducking (pause) can scale the music without muting
  the UI.
- **Lo-fi blanket.** The music bus's ~3.5 kHz low-pass is the single
  biggest "lo-fi" lever: bright square-wave arps land muffled and warm
  instead of clinical. A faint **vinyl-crackle** loop (sparse high-passed
  pops, gain 0.02, under everything) adds the tape/record texture. Pads
  carry a ±4-cent detune drift for the tape-wobble feel.
- **Duck cap.** `DUCK_CAP = 0.8` bounds the summed voice gain so a full
  chord can't clip the master. Pause ducks everything to 0.4× via
  `setDucked`.

## Web Audio rules honoured

- **No `AudioContext` before a gesture.** `unlock()` runs on the first
  pointer/key event (capture phase, so overlay panels can't swallow it).
- **Visibility.** `suspend()` on hidden, `resume()` on visible — no
  background CPU or surprise audio.
- **Headless-safe.** Every method no-ops cleanly when there is no
  `AudioContext` (unit-tested in Node); SFX count even when the context is
  `suspended` (headless Firefox has no output device) so the event path is
  still verifiable — the nodes are simply silent.

## Per-level songs

Five songs, one per level (`app/adapters/audio/songs.ts`, pure data). The
aesthetic is a **relaxing study session**: warm jazz-extended harmony (every
chord holds **five voices** — triad + 7th + 9th), a **low speed ceiling
(86 bpm)**, and energy that climbs through the *drum pattern layers* (the
snare enters at L2, the arpeggio at L4) rather than raw tempo.

| Level | Song           | BPM | Mood / progression                          |
|-------|----------------|-----|---------------------------------------------|
| 1     | cozy-bedroom   | 70  | Fmaj9–Am7–G6/9–Em7 — late-night drift, **no snare** |
| 2     | window-seat    | 74  | Am9–Dm7–G13–Cmaj9 — cafe, a lazy backbeat snare joins |
| 3     | rainy-train    | 78  | Bbm9–Fm9–Abmaj9–G7b9 — misty modal-jazz extensions |
| 4     | park-bench     | 82  | Cmaj9–Fmaj7#11–G13–Em7 — sunny, the gentle arp enters |
| 5     | skyline-view   | 86  | Am9–Fmaj9–G6/9–Abmaj7 — propulsive sunset conclusion |

BPM climbs monotonically (70 → 86) with the level, matching the tick-rate
curve, so the music and the snake get busier together — but the tempo stays
chill by design (the speed ceiling is 86 bpm). A 16-step (one bar) voice
table is computed per chord bar and **cached** — the scheduler's steady state
allocates nothing but short-lived WebAudio nodes.

A level-up **crossfades** the music bus (250 ms down, swap song, fade
back), fires the jingle, and re-targets the song via `setSong(level)`.
`setSong` is idempotent per level and safe pre-unlock (it remembers the
level and applies on first unlock).

## Voices

- **Bass** — `MonoSynth` (sine oscillator, low-pass), muted, 8th notes on the
  chord root −12.
- **Pad** — `PolySynth` (triangle), the upper chord voices (all five minus
  the root) an octave up, slow 120 ms attack, detune drift, held across the
  bar. The 7th/9th give it the warm jazz colour.
- **Arp** — `MonoSynth` (square), quiet 16th notes cycling the five chord
  tones (levels 4-5).
- **Kick** — `MembraneSynth` sub drop, 110 ms.
- **Snare** — `NoiseSynth` (pink) band-passed at 1.8 kHz, 120 ms, on beats 2
  & 4 (absent at level 1 for an ambient intro).
- **Hat** — `NoiseSynth` (white) high-passed at 6 kHz, 40 ms, offbeat 16ths.

## SFX

| Trigger       | Sound                                                                 |
|---------------|-----------------------------------------------------------------------|
| Eat apple     | `chomp()` — filtered-noise bite + falling sine thud, twice            |
| Combo ≥ 2     | `coin()` — rising two-note square blip (76→83)                        |
| Wall death    | `boom()` — sub drop (120→35 Hz) + low-passed noise crash              |
| Self death    | `splat()` — band-passed "wet" noise (350 Hz) + low thump              |
| Level-up      | `jingle()` — four-note triangle marimba arpeggio (72-76-79-84)        |
| Game over     | `gameover()` — slow detuned saw descend (67-63-58)                    |
| UI pause/toggle | `click()` — short high-passed noise tick                         |

SFX methods count into `sfxCounts` (exposed on `audio.info().sfx`) for e2e
verification. The legacy `blip(voice, midi)` remains for diagnostics.

## Files

- `app/adapters/audio/songs.ts` — song table + `voiceBar` (pure, unit-tested).
- `app/adapters/audio/synth.ts` — `ChiptuneSynth` built on **Tone.js**:
  master compressor, music/SFX buses, Tone voices, crackle, lookahead
  scheduler, crossfade, SFX.
- `tests/unit/audio.test.ts` — song data invariants + locked no-op matrix.
- `tests/e2e/audio.spec.ts` — gesture unlock, visibility, ducking, and the
  new song-switch + SFX-count tests.
