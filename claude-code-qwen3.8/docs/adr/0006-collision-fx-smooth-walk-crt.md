# ADR 0006 — Collision FX, distinct SFX, smooth walk, and the CRT finish

- **Status:** accepted
- **Date:** 2026-09-03
- **Area:** presentation / FX + audio (`app/adapters/render/phaser/phaser-fx.ts`,
  `app/adapters/render/framebuffer.ts`, `app/adapters/audio/synth.ts`,
  `app/adapters/audio/songs.ts`, `app/adapters/ui/overlays.ts`, `app/main.ts`)

## Context

Step 23 dials in the production look and the collision feel on top of the
architecture established earlier: the pure integer domain (steps 7–8), the
screen-space Phaser FX engine compositing over an always-drawn 2D framebuffer
(ADR 0001), the procedural Web Audio SFX bus (step 15), and the per-level lo-fi
BGM (step 22). Four things are still rough or missing:

- **Death is undifferentiated.** Every death plays the same SFX and spawns the
  same burst, so a wall crash and a self-bite sound and look identical. The domain
  already emits a `died` effect carrying a `cause` (`wall | self | none`, ADR
  0003); the presentation just does not key off it.
- **The snake does not glide on the FX path.** The 2D ground-truth composite
  already interpolates each segment from its previous cell to its current cell by
  `alpha`, but the FX engine draws the snake at the current cell (crisp cells, no
  glide) — so when the FX layer is active the snake snaps instead of gliding.
- **The CRT finish is under-tuned.** The scanline mask and the letterbox vignette
  are present but too faint to read as CRT.
- **There is no safety net for a stuck frame.** If the FX engine's WebGL context
  degrades, nothing re-checks the render is still alive.

One hard constraint runs through all of this: **post-FX must not obscure the
playable area** (the user flagged the dark radial vignette). Any darkening must
stay off the field the player is looking at.

## Decision

**Key every death effect off the emitted `cause`; give the FX snake the same
alpha-glide as the 2D path; tune the CRT to the spec; and arm a watchdog.** The
domain is untouched — all of this reads the `died` effect's `cause` and the
existing body/prev-body, and mutates only presentation state.

**Collision FX + distinct SFX, keyed off `cause`.** In `handleEffects`, the `died`
case branches on `e.cause`:

- **Wall death → sparks + shake + shockwave + a local flash.** The particle burst
  is *directional* — it flies off the wall it hit (right/left/top/bottom), so the
  impact reads as a crash *into* the surface. The flash is local to that wall (the
  FX `flash(power, dir)` already draws the flash on only the struck half, never
  sweeping the centre of the play). The screen shakes hard (`shake(12)`), and a
  radial shockwave expands from the head.
- **Self-bite → a wet "blood" splatter.** A *radial* burst in a fixed, theme-
  agnostic red (`BLOOD`, blood is red on any palette), a smaller shake, and a
  softer full-frame flash. A fixed colour rather than a per-theme `danger` value
  keeps the `Palette` interface unchanged (both renderers consume it).
- **The SFX split on the same `cause`.** `soundNameForEffect(kind, combo, cause)`
  is now pure and unit-tested: a death resolves to `boom` (wall) or `splat`
  (self). `consume` additionally schedules a **game-over sting** under the hit, so
  both deaths also close with the same "you died" jingle. A chomp becomes a **coin**
  when `combo > 1` (the domain's combo multiplier, `state.combo`), which is why
  `consume` now takes the combo. The new voices are: `boom` (a low sawtooth rumble),
  `splat` (a quick wet pitch-drop), `gameover` (the falling-sawtooth sting), and
  `coin` (a bright two-note coin).

**Both deaths dissolve into the gameover panel.** The death burst scatters the
snake's head into particles (the dissolve), and the gameover overlay now *fades in*
over it (a 320 ms opacity animation on entering the gameover mode, in
`overlays.ts`). The overlay covers the screen only after death, so it never
interferes with the play.

**Smooth walk: the FX snake glides by `alpha`, with an emissive afterglow trail.**
The 2D framebuffer already keeps a previous-tick body snapshot (`capturePrev`); it
now exposes it read-only (`prevBody()`) and `main.ts` passes it into
`fx.setFrame(...)`. The FX `drawSnake` interpolates each segment's cell from
previous to current by `alpha` — the *same* interpolation the 2D path uses — so
the two renderers agree on the glide. An **emissive afterglow trail** is drawn as a
fading glow at the head's *previous* cell, whose alpha is `(1 - alpha) * 0.26`: as
the head glides forward the glow it left behind dies out. This is a discrete glow
trail, deliberately **not** a smeared motion-blur/ghost.

**CRT finish, tuned to the spec and confined off the playfield.** The scanline
mask is raised to the spec's base of **0.16** (a 1px line every 4px — scanline
*texture*, not a darkening). The slow single-sine luminance flicker keeps its
**~4.2 s** period. The vignette peak is raised to **0.9**, but it is drawn **only
in the letterbox strips** (the margins outside the field), fading from 0.9 at the
outer edge toward the field — so it never darkens the playable area, per the
constraint. The flicker and scanlines are kept at low amplitude so they add CRT
character without reducing legibility.

**250 ms song crossfade.** The BGM crossfade is tightened from ~0.8 s to a **250 ms**
crossfade (a 250 ms fade-out of the outgoing loop + a 250 ms fade-in of the
incoming one). Note on the spec's "look-ahead scheduler": the BGM is pre-rendered
as a whole into an `AudioBuffer` loop and played by an `AudioBufferSourceNode`
(step 22), so the entire loop is scheduled up front — which is more robust than a
per-note look-ahead scheduler, so no separate scheduler is added.

**Black-frame watchdog.** Every 60 frames `main.ts` verifies two things and
auto-recovers: (1) the 2D ground truth is still producing content — a
`framebuffer.sampleMax()` (the brightest pixel's R+G+B) below a low threshold means
the 2D composite went black, so it re-sizes the 2D display (resetting its context
and forcing a fresh composite); (2) the FX, if enabled, is still healthy (`fx.healthy()`
— the WebGL context is alive and not lost) — otherwise it degrades to the 2D path
(`governorLost()` → `low` → FX off). A `recoveries` counter and `frameBrightness()` /
`watchdogRecoveries()` / `fxHealthy()` debug hooks make the watchdog observable to
the e2e gate.

## Consequences

**Positive**

- Wall deaths and self-bites are now audibly and visually distinct (boom vs splat,
  directional sparks vs a radial blood splatter), driven purely by the `cause` the
  domain already emits — no new domain plumbing.
- The coin-on-combo SFX rewards fast eating and reuses the domain's existing combo
  multiplier, so the reward is consistent with the scoring.
- The FX snake now glides identically to the 2D ground truth (same `alpha`
  interpolation of the same prev/current body), so the two renderers agree on the
  motion and the "smooth walk" holds whether or not the FX layer is active.
- The afterglow trail is discrete and cheap (one fading glow), so it reads as an
  emissive trail without the cost or legibility hit of a motion-blur history buffer.
- The CRT finish is dialed to the spec (0.16 scanline, 0.9 vignette, 4.2 s flicker)
  while the vignette stays strictly in the letterbox — the playfield is never
  darkened.
- The watchdog gives a bounded, observable safety net: a stuck-black 2D frame is
  re-rendered and an unhealthy FX is degraded to the 2D path, so the playable render
  does not die.

**Negative / accepted costs**

- `consume` now takes the combo and keys off `cause`, so the SFX mapping is slightly
  richer to reason about (mitigated by the pure, unit-tested `soundNameForEffect`).
- The 250 ms crossfade is brisk; the outgoing and incoming tracks overlap briefly.
  Accepted — it matches the spec and the pre-rendered loop makes the swap clean.
- The watchdog's `sampleMax()` reads the 256×240 offscreen buffer every 60 frames.
  That is a small, infrequent read (well under a frame budget), and it only runs to
  *detect* a failure — the steady state (a bright frame) does not recover anything.
- The FX afterglow + glide add a few draw calls to the FX snake; the FX batch count
  stays well under the target (a handful of Graphics objects).

## Supersession

ADR 0007 (step 24) supersedes the *render-path* decision of this ADR when it adopts
Phaser 4 + Tone.js as the sanctioned engine. The collision FX, distinct SFX,
smooth-walk interpolation, CRT finish, and watchdog described here are the behaviour
ADR 0007 carries over to the adopted engine; they are specified here on the current
Phaser-FX + 2D + Web Audio architecture so the feature set is pinned before the
migration.

## Alternatives considered

- **A per-theme `danger` colour for the self-bite "blood".** Rejected: it would widen
  the `Palette` interface both renderers consume (and re-tint the FX layer's palette
  destructure) for a colour — blood — that is red on every palette anyway. A single
  fixed `BLOOD` constant in the FX driver is simpler and reads correctly on all five
  themes.
- **A full multi-cell motion-blur/ghosting trail for the smooth walk.** Rejected: the
  spec calls for an *emissive afterglow trail (not motion blur/ghosting)*, and a
  history buffer of head positions costs extra draw calls and smears legibility. A
  single fading glow at the previous cell is cheaper, deterministic, and reads as an
  emissive trail.
- **Keying the death SFX off a new "died-wall" / "died-self" effect kind.** Rejected:
  the domain already carries a `cause` on the single `died` effect (ADR 0003); the
  presentation can branch on `cause` without new effect kinds or new domain code.
- **A per-note look-ahead audio scheduler for the BGM.** Rejected: the BGM is
  pre-rendered into an `AudioBuffer` loop (step 22), so the whole loop is scheduled
  up front — more robust than a per-note look-ahead scheduler, so none is added.
- **A full-screen (over-the-field) CRT vignette.** Rejected: it would darken the
  playfield, which the user explicitly flagged. The vignette is confined to the
  letterbox strips (the margins outside the field) so the post-FX never obscures the
  playable area.
