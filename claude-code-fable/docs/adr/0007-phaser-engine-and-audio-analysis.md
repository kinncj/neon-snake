# ADR 0007 — Phaser 4 for render/FX, Tone.js for audio

## Status

Accepted. Supersedes the renderer and audio portion of ADR 0006; the
`stats.js` dev-only rule from ADR 0006 still holds.

## Context

The brief demanded a real game engine for the effects layer ("the best out
there") and left the audio engine open. ADR 0006 concluded that the 2D
framebuffer stays hand-rolled and that FX and audio were the candidates
for engines. This ADR selects them and records how they fit the
architecture without touching the domain.

## Options

### Render / FX

| Engine | Notes |
|---|---|
| **Phaser 4** (4.2.1) | Full 2D engine with a new WebGL renderer, per-object and per-camera filters (Glow, Blur, Vignette, Barrel, ColorMatrix…), camera shake/flash, Graphics batching, context-loss handling, a sleepable ticker. ~350 KB gzipped. Widely used for exactly this class of game. |
| PixiJS 8 | Excellent 2D renderer with filters, smaller core; no scene/camera conveniences, shake and flash would be bespoke again. |
| Three.js | A 3D engine; would violate the 2D-only rule by construction and adds a scene graph the brief forbids. |
| Hand-rolled WebGL2 | The path that produced the black-screen bug; every filter is bespoke and untested code. |

### Audio

| Engine | Notes |
|---|---|
| **Tone.js** (15.1.22) | Instruments (PolySynth/MonoSynth/MembraneSynth/NoiseSynth), envelopes, Gain/Filter/Compressor nodes, precise time-based scheduling, a lazily created context. ~80 KB gzipped. |
| Raw Web Audio | Everything from step 15 rebuilt by hand: voice allocation, look-ahead scheduling, node pooling. |
| Howler.js | Sample playback oriented; the game has no samples. |

## Decision

**Phaser 4** renders the FX layer; **Tone.js** renders the audio. Both are
adapters under `app/adapters/**` and only ever read domain state and the
effect stream.

### Phaser 4 (`app/adapters/render/phaser/phaser-fx.ts`)

- One transparent WebGL canvas (`#fx`) over the 2D composite (`#display`).
  The 2D framebuffer is always drawn beneath it; if the engine draws
  nothing (context loss, missing WebGL2, a failed load), the player still
  sees the game. This is what closes the "FX on = black screen" failure.
- The scene is a flat list of six `Graphics` objects: background + brighter
  grid, food with an emissive halo, blocky gliding snake blocks with
  direction-facing eyes (not a smooth line or a ball), particles, transient
  FX (shockwaves, wall-local flash, dissolve), and the scanline overlay.
  Glow filters on the snake and food layers provide the emissive bloom; a
  camera Vignette filter provides the radial darkening at ultra.
- The engine is loaded on demand (`import("phaser")`) the first time the
  tier needs it, so the 2D path stays small and fast to interactive; the
  ticker sleeps (`game.loop.sleep()`) and the canvas hides when the tier
  drops to `low`/`reduced`.
- Draw batches are measured on the raw GL context (`drawArrays`/
  `drawElements` per frame): 10 at ultra, within the ≤ 12 budget.
- Context loss is observed via the engine's `CONTEXT_LOST` event; a
  once-a-second black-frame watchdog in the runtime falls back to the 2D
  path and retries the engine after a cool-down.
- Death FX is full intensity but local: a wall death's sparks burst in the
  direction of travel (`angleSpread` 1.3 rad) and the flash is a band on
  the wall that was hit; the field centre never flashes.

### Tone.js (`app/adapters/audio/synth.ts`, `songs.ts`)

- Imported only inside `enable()`, which runs on the first user gesture,
  so no `AudioContext` exists before one (verified by an e2e that counts
  constructions from an init script).
- A compressor-glued master, a low-pass music bus and a brighter SFX bus;
  five SFX voices (pulse, triangle, lead, noise, membrane) with per-voice
  ADSR; a ducking budget that caps the simultaneous voice gain at 0.8.
- Two music lanes with a look-ahead scheduler (100 ms tick, 300 ms
  horizon) play the five per-level songs; a level-up crossfades lanes over
  250 ms and moves the music bus cutoff with the song.
- `setMuted` ramps the master gain; the mute state persists in
  `localStorage`; the context suspends on `visibilitychange`.

### Dependencies

Exactly two runtime packages: `phaser` and `tone`. Total transfer after
this decision: 465 KB gzipped (Phaser 373 KB, the Tone chunk 79 KB, the
game 12 KB), within the raised 500 KB budget.

## Consequences

- ADR 0001 still holds: everything is screen-space on a 2D image.
- The replay hash is unchanged by the engines (verified at every tier).
- The audio scheduler and the engine's frame pacing are both wall-clock
  based in the adapters; the domain remains tick-based and timeless.
