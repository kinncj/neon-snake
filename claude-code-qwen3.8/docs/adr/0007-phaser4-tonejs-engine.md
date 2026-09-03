# ADR 0007 — Phaser 4 + Tone.js as the sanctioned engine

- **Status:** accepted
- **Date:** 2026-09-03
- **Area:** engine (render / FX + audio) — `app/adapters/render/phaser/phaser-fx.ts`,
  `app/adapters/audio/synth.ts`, `app/adapters/audio/songs.ts`

## Context

The user demanded, explicitly and repeatedly, a **real game engine — the best one
out there** — rather than hand-rolled WebGL / Web Audio. Phase 3 of the build
exists to adopt the sanctioned engines (the one dependency exception to Rule 2)
and to pin the feature set that earlier ADRs specified on hand-rolled paths.

By the time Phase 3 runs, the render side was already built **on the real Phaser
4.2.1 library** (steps 14 / 21 / 23): `phaser-fx.ts` is a thin `Phaser.Scene`
adapter over `Phaser.Game` (`type: Phaser.WEBGL`) with `Phaser.GameObjects.Graphics`
drawing the neon snake, food, particles, and the CRT post. What was **not** yet on
a sanctioned engine was the **audio**: the SFX synth (`synth.ts`) and the lo-fi BGM
(`songs.ts`) were hand-rolled Web Audio (raw `AudioContext`, `OscillatorNode`,
`OfflineAudioContext`). So this step does two different things:

- **Render (Phase 3a)** — confirms the render/FX path *is* the sanctioned Phaser
  4.2.1 engine, and pins its role: the 2D Canvas2D framebuffer (step 10) is the
  ground-truth render always drawn **beneath** the engine canvas. This is the fix
  for the original "FX on = black screen" failure — when the WebGL context degrades
  or headless has no WebGL, the 2D composite still shows the field.
- **Audio (Phase 3b)** — a genuine **migration** of the audio path from hand-rolled
  Web Audio to **Tone.js 15.1.22**.

One hard constraint runs through the audio migration: **"no `AudioContext` before a
gesture."** The autoplay rule and the e2e gate both require that no audio context
exists before the first real keydown / pointerdown.

A second constraint is the **no-obscure-play** rule (the user flagged the dark
radial vignette): the vignette stays strictly in the letterbox, off the playfield.
Nothing in this step darkens the field.

## Decision

**Adopt Phaser 4.2.1 (render/FX) + Tone.js 15.1.22 (audio). Only two runtime
deps: `phaser` + `tone`.** The domain and the 2D ground truth are untouched; the
render is already on Phaser; the audio engine is swapped behind a small interface.

### Render: Phaser 4.2.1 as the 2D render/FX engine

`phaser-fx.ts` is a `PhaserFx` wrapper around `Phaser.Game`
(`type: Phaser.WEBGL`, a single `FxScene`). It owns WebGL context-loss recovery and
is gated by the quality governor (the FX layer runs only on tiers that support
WebGL; headless / `low` run the 2D path only). It synthesizes the frame into one
WebGL canvas: a brightened grid at 0.9 alpha under the CRT overlays (so the field
reads clearly with FX on), a **blocky neon snake** (crisp `fillRect` blocks + a
`fillRoundedRect` halo + a direction-facing head with eyes — blocky, not a smooth
line/ball, to match the original), emissive-halo food, the particle system, and the
CRT post (scanline 0.16, letterbox-only vignette 0.9, slow ~4.2 s flicker). The
collision FX, the alpha-glide smooth walk + emissive afterglow, the 250 ms BGM
crossfade, and the black-frame watchdog specified by ADR 0006 all run on this
adopted engine.

### Audio: migrate the SFX to Tone.js behind a swappable `SfxEngine`

The **decision logic stays in `SoundSynth` and is engine-agnostic and pure** — the
effect→voice mapping (`soundNameForEffect`), the game-over sting layered *under* the
cause-specific hit (wall → `boom`, self → `splat`), the combo coin, mute +
localStorage persistence, and the `lastSfx()` bookkeeping the e2e death-FX gate
reads. The **audio** moves into a new `SfxEngine` interface; the browser wires it to
a `ToneSfxEngine` built on Tone.js, and the unit tests inject a stub so the decision
logic is testable in Node.

The `ToneSfxEngine` graph: per-voice **Tone synths → SFX low-pass (4 kHz) → SFX bus
(the 0.8 duck) → master gain → `Tone.Compressor` → destination**, with a **native
music bus** (a `GainNode` at the 0.16 music level) wired to the same master so the
BGM is silenced by the same mute control. The voice→synth type map uses the four
sanctioned voices:

| voice      | Tone synth      | why                                          |
|------------|-----------------|----------------------------------------------|
| `boom`     | `MembraneSynth` | the low wall-impact thud / rumble            |
| `splat`    | `NoiseSynth`    | the wet self-bite burst                       |
| `levelup`  | `PolySynth`     | a polyphonic ascending jingle (no cut-off)    |
| `ate`/`coin`/`gameover` | `MonoSynth` | short chomp / coin / falling sawtooth sting |

Each `MonoSynth`/`PolySynth`/`NoiseSynth` is configured from the (unchanged)
`VOICE_RECIPES` table — oscillator type, ADSR, low-pass, peak (converted to dB via
`Tone.gainToDb`). **The BGM keeps its offline-rendered `AudioBuffer` loop**
(step 22, `OfflineAudioContext`) — a pre-rendered loop is more robust than a per-note
lookahead scheduler — but is now **routed through the Tone context/master**, so it is
genuinely part of the audio engine; `songs.ts` is therefore unchanged.

### "No AudioContext before a gesture" — via a dynamic `import('tone')`

Tone.js creates its shared `AudioContext` **at module load**: the ESM entry does
`export const Transport = getContext()`, and `getContext()` swaps the `DummyContext`
for a real (suspended) `AudioContext` as soon as the browser has one. A **static**
`import ... from 'tone'` would therefore create an `AudioContext` at app start —
before any gesture — violating the contract.

So `tone` is imported **only** via a dynamic `import('tone')` inside
`ToneSfxEngine.ensure()`, which `createSound()` invokes **only from the first real
keydown / pointerdown**. Before that gesture the module (and its context) does not
exist, `soundReady()` is `false`, and `contextState()` is `'none'`. On the gesture,
`ensure()` imports Tone, builds the graph, and calls `Tone.start()` (resume). The
gesture handler is async (the dynamic import is awaited), and the e2e waits for
`soundReady()` to flip.

### Steady-state allocation

The Tone graph (voices + buses + master + compressor) is built **once** in `ensure()`
and reused; `consume()` only schedules notes on the existing synths (`Tone.now()`
relative), allocating nothing of its own. The BGM buffers are cached per track. This
holds the "≈ 0 steady-state allocation" budget (the FX engine's ticker is likewise
paused when FX is off).

## Consequences

**Positive**

- The render/FX and audio now both run on the sanctioned engines (Phaser 4.2.1 +
  Tone.js 15.1.22), with **exactly two runtime deps** (`phaser`, `tone`) — matching
  the build's Phase-3 budget (`≤ 500 KB gzipped`, `phaser ~350 KB + tone ~60 KB`).
- The "no `AudioContext` before a gesture" contract now holds **by construction**
  (the dynamic import defers the module — and its context — to the gesture), and the
  e2e gate confirms it.
- The audio decision logic is engine-agnostic and stays unit-tested (a stub engine
  verifies the mapping, the sting layering, the combo coin, mute, and gesture-gating
  in Node), while the real Tone graph is exercised by the browser e2e (`lastSfx()
  === 'boom'` on a wall death, `contextState() === 'running'` after a gesture).
- The four sanctioned voices (Poly/Mono/Membrane/NoiseSynth) give distinct,
  engine-native timbres (a thud, a wet burst, a jingle, a chomp) for free, keyed off
  the same `cause` the domain already emits (ADR 0003).
- The BGM keeps its robust offline-rendered loop while joining the Tone master, so
  the global mute silences SFX **and** BGM from one control.

**Negative / accepted costs**

- `tone` is a real runtime dep; its ESM entry is loaded on the first gesture as a
  separate chunk. First-gesture audio startup is a few extra ms (the dynamic import
  + graph build), bounded and within the e2e's wait. Accepted — it is the cost of
  deferring context creation to the gesture.
- The per-voice low-pass on `splat` (a `NoiseSynth`) is dropped (Tone's
  `NoiseSynth` exposes no `filter` in its options) — the unfiltered white-noise
  burst still reads as a wet splat; a timbre detail not asserted by any gate.
- The `ToneSfxEngine` builds native glue nodes (low-pass / SFX bus / master /
  compressor / music bus) inside Tone's context rather than as Tone components, so
  the native BGM path (`songs.ts`) stays unchanged and the `musicBus()` contract
  (`GainNode`) is preserved. A pragmatic seam, documented here.

## Supersession

This ADR **supersedes the render-path decision of ADR 0006** (which specified the
collision FX, smooth walk, CRT finish, and watchdog on the render path) and the
**hand-rolled Web Audio audio path** of step 15 / ADR 0006. The behaviours are
carried over to the adopted engine unchanged in *effect*: the cause-keyed collision
FX and distinct SFX, the alpha-glide smooth walk + emissive afterglow, the
letterbox-only CRT finish, the 250 ms BGM crossfade, and the black-frame watchdog
now run on Phaser 4.2.1 + Tone.js. ADR 0001 (2D ground truth beneath the engine)
remains in force as the guaranteed fallback.

## Alternatives considered

- **A static `import 'tone'`.** Rejected: the ESM entry creates Tone's
  `AudioContext` at module load (`export const Transport = getContext()`), so a
  static import creates a context before any gesture and breaks the
  "no context before a gesture" contract. The dynamic import defers it.
- **Keep the hand-rolled Web Audio SFX.** Rejected: the user explicitly demanded a
  real engine, and Phase 3 exists to adopt Tone.js. Web Audio stays *only* for the
  offline BGM render (an `OfflineAudioContext`), which is rendering, not the live
  engine.
- **A per-note lookahead scheduler for the BGM.** Rejected: the BGM is pre-rendered
  into an `AudioBuffer` loop (step 22) and scheduled up front — more robust than a
  per-note lookahead scheduler (carried from ADR 0006).
- **A full Tone.js BGM (a `Tone.Player` over the loop, crossfade on a Tone bus).**
  Considered and rejected in favour of keeping the native BGM bus: routing the
  native music bus into the Tone master is a smaller, lower-risk seam and keeps the
  well-tested `songs.ts` unchanged, while still making the BGM part of the Tone
  engine (same context/master/compressor/mute).
- **Other render engines (PixiJS / Three.js).** Rejected: the build specifies Phaser
  4 as the sanctioned 2D engine; Three.js would violate the 2D-only Rule 7 (scene
  graph / perspective), and the render was already built on Phaser 4.2.1.
