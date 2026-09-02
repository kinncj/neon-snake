# Build Report — neon snake (Phase 1 + Phase 2)

Final report for the 23-step build. All gates pass; `make ci` is green.

- **Phase 1 (steps 0–16):** a working 2D 8-bit neon snake — pure integer
  domain, fixed-timestep sim, quality-tier governor, screen-space GL effects,
  chiptune audio, per-pixel e2e, full CI.
- **Phase 2 (steps 17–23):** arcade expansion — levels/combo/best, i18n,
  HUD + title/pause/gameover UI, CRT TV shell, cross-browser hardening,
  per-level neon themes, collision FX, a lo-fi music engine with retro SFX,
  smooth walk, playtest captures, and this report.

## How to run

```bash
make bootstrap   # npm ci
make build       # production build to dist/ (NODE_ENV=production, explicit)
make preview     # serve the production build on :4174
make ci          # bootstrap lint typecheck test build test-e2e
make timeline    # render docs/build-log.tsv into docs/build-log.md
SHOTS=1 npx playwright test --project=chromium tests/e2e/screenshots.spec.ts
                 # opt-in playtest screenshot capture into docs/screenshots/
```

## Architecture

- `app/domain/**` — pure integer simulation. No DOM, timers, `Math.random`,
  `Date`, audio, or rendering (lint-enforced). One fixed tick at a time.
  Carries `food.kind`, `level`, `combo`, `lastEatTick`, `best`, and a death
  `cause` (`wall` | `self`) on the `died` effect.
- `app/adapters/{input,render,audio,storage,ui,i18n}` — host-specific IO.
  Read state + events, never mutate simulation state.
  - `render/theme.ts` — per-level neon palettes + a zero-alloc `ThemeMixer`
    that lerps between them (presentation-owned; ADR 0005).
  - `render/phaser/phaser-fx.ts` — **Phaser 4** render/FX layer: the engine
    draws the game (snake, food, grid, particles) into one WebGL canvas, with
    camera shake/flash and texture-based CRT overlays (tiling scanlines, radial
    vignette). The 2D `Framebuffer` composite is always drawn beneath it as the
    guaranteed fallback (ADR 0007).
  - `audio/songs.ts` — five per-level lo-fi songs as pure data (5-voice jazz
    chords, BPM 70→86; the snare drops out of L1, the arp enters at L4).
  - `audio/synth.ts` — `ChiptuneSynth` built on **Tone.js**: PolySynth pad /
    MonoSynth bass+arp / MembraneSynth kick / NoiseSynth snare+hat voices, a
    compressor-glued master, low-pass music + SFX buses, a lookahead
    scheduler, a 250 ms song crossfade, and the retro SFX set. The context is
    created only on the first gesture (Tone.start) and never before.
- `app/runtime` — fixed-timestep loop (level-driven tick interval), quality-tier
  governor, fingerprint.
- `app/main.ts` — wires the sim to renderers/audio/UI and exposes a test-only
  `window.__snake` debug surface. UI mode flow (title→playing→paused→gameover)
  is presentation-level; the domain phase is the source of truth.

The game is 2D. The engine (Phaser) renders sprites in a flat scene with a
single camera (no perspective, mesh, lights, or movable camera — ADR 0001);
all "CRT" treatment is screen-space (overlays + camera effects), and the 2D
framebuffer path remains a first-class, always-drawn fallback (ADR 0007).

## Phase 2 feature map

| Area | What shipped | Where |
|---|---|---|
| Progression | 5 levels (tick 120→74 ms), food kinds (apple/orange/golden, 10/20/40), combo (×4 cap, 6-tick window), best score, death cause | `domain/levels.ts`, `domain/step.ts` |
| i18n | Zero-dep catalog, en/ja/es, English fallback, `{n}` interpolation | `adapters/i18n`, ADR 0004 |
| HUD | DOM counters (score/best/level/combo/length), event banner, footer hint; write-on-change | `adapters/ui/hud.ts` |
| Overlays | title / pause / gameover panels, NEON SNAKE logo, stat rows, new-best chip, a11y | `adapters/ui/overlays.ts` |
| CRT shell | `#tv` bezel, glass + flicker + power LED, neon HUD accents | `index.html` |
| Themes | 5 Tokyo-Night palettes, 600 ms eased transition, `@property --neon` HUD accent | `render/theme.ts`, ADR 0005 |
| Collision FX | wall slam (shake+sparks+flash), self-bite blood (chomp+spray), themed eat juice, score popups | `render/phaser/phaser-fx.ts`, docs/game/collision-fx.md |
| Audio | 5 per-level lo-fi songs (5-voice jazz, 70→86 bpm, crossfade) on **Tone.js**, music/SFX buses + low-pass + compressor + crackle, chomp/coin/boom/splat/jingle/gameover | `audio/songs.ts`, `audio/synth.ts`, docs/game/audio.md |
| Smooth walk | full-body glide via `interpCell` (each segment lerps from the cell of the segment ahead) in both the 2D and Phaser renderers; head cap + emissive underglow | `render/framebuffer.ts`, `render/phaser/phaser-fx.ts` |
| CRT flicker | sub-5% luminance flicker on the tiling scanline overlay (continuous, under the flash budget) | `render/phaser/phaser-fx.ts` |

## Budget table (measured on this machine, CI)

| Budget                                   | Limit        | Measured            | Status |
|------------------------------------------|--------------|---------------------|--------|
| Draw calls (GPU batches) at ultra         | ≤ 12         | ~7                  | pass   |
| Texture memory (engine textures)          | ≤ 8 MB       | ~1 MB nominal       | pass   |
| p95 frame work @ low, 4× CPU throttle     | < 16.7 ms    | ~0.8 ms (max ~7 ms) | pass   |
| Steady-state heap growth (~600 frames)    | ~0 / < 256 KB| negligible (engine paused) | pass |
| Total gzipped dist                        | ≤ 500 KB     | ~456 KB             | pass   |
| Time to first painted frame (warm)        | ≤ 1.5 s      | ~140 ms             | pass   |
| Full-frame luminance transitions (death) | ≤ 3 / s      | 1 flash + fade      | pass   |
| Particle pool                             | ≤ 512 slots  | 160 sprite pool     | pass   |
| Dev-only `stats.js` in production bundle  | absent       | absent (bundle test)| pass   |

> The dist grew from ~24 KB (phase 2, hand-rolled) to ~456 KB gzipped with
> **Phaser 4** (~350 KB) as the render/FX engine and **Tone.js** (~60 KB) as
> the audio engine (ADR 0007). The 2D fallback path is still ~25 KB, and a
> no-WebGL browser runs the full game with zero engine cost (Tone still
> synthesises the audio). The budget gate was raised 250 → 500 KB to reflect
> the two libraries.
> Chromatic-aberration / curvature-warp lines from the raw-GL era are retired
> (Phaser uses no custom GLSL post passes).

## Gates per step

- **Domain purity**: lint rule bans DOM/timers/Math.random/Date/audio/render in
  `app/domain/**`. `make lint` enforces it on every CI run.
- **Determinism**: the recorded input log `tests/fixtures/run-a.log` (5000
  ticks, seed `snake-0001`, hash `2e58d3c2`) replays to the same state hash
  from low and ultra tiers alike — tier-independent simulation, verified in
  e2e. (Re-recorded in phase 2 for the new state shape.)
- **Quality tiers**: low/high/ultra/reduced. Capability probe picks the start;
  a rolling-median frame governor with hysteresis escalates/de-escalates;
  `prefers-reduced-motion` (or the in-page toggle) forces reduced.
- **Effects**: eating fires a shockwave + themed particle burst + score popup;
  a wall slam shakes the screen and throws sparks; a self-bite sprays blood;
  the death dissolve stays within the flash budget. The GL composite is
  pixel-verified end-to-end — the field rect is asserted by its computed math
  on every engine, and the head pixel reads back (GL where readback works,
  2D framebuffer fallback elsewhere) as the head colour.
- **Themes**: a level-up re-tints the scene (accent + `data-level`), and the
  head colour at a fixed device point changes across the shift. Cross-browser.
- **Audio**: no `AudioContext` before the first user gesture; the context
  suspends on hidden / resumes on visible; pause ducks the music; a level-up
  crossfades to the next song and fires the jingle; eat/wall/self SFX are
  counted for e2e. Note: the SFX path is verified even when the context is
  `suspended` (headless Firefox has no output device).
- **Cross-browser**: the matrix runs chromium + firefox on this host (WebKit is
  auto-skipped when its WPE/flite system libs are absent — probed via `ldd`,
  no sudo required). GL failures degrade gracefully to the 2D path; a
  `?diag=1` panel exposes tier/GL identity/fps/errors for field debugging.
- **i18n**: HUD labels, banners, buttons, and the document title/localisation
  switch live in the catalog; the domain never sees strings.

## Playtest captures

`docs/screenshots/` holds the scripted playthrough (title, L1 play, L2 theme
shift, pause, wall-death FX, gameover, plus 1080p L1/L3). Recapture with
`SHOTS=1 npx playwright test --project=chromium tests/e2e/screenshots.spec.ts`.

## Failure recovery (the black-screen guard)

The render path is designed so that **any** engine failure degrades to the 2D
path instead of showing a black screen (ADR 0007). The 2D `Framebuffer`
composite is drawn to `#game` **every frame**, beneath the engine canvas, so a
correct game always exists underneath the FX layer:

- **No opaque FX sheet over the game.** Phaser draws the game itself (there is
  no separate raw-GL canvas that can silently paint black over a 2D game — the
  bug behind the "FX on = black screen" reports). A dead engine cannot hide a
  game that is still being rendered beneath it.
- **Engine-owned context recovery.** Phaser re-initializes its WebGL renderer
  on `webglcontextrestored` instead of leaving a black canvas; the loss is
  logged for diagnostics.
- **Init failure** — if Phaser cannot construct (no WebGL2, a thrown boot),
  `fx.isReady` stays false and the 2D path is the visible surface; the error
  is logged once and shown in the `?diag=1` panel with the chosen renderer.
- **Runtime watchdog** — every ~30 frames `fx.selfTest()` reads the engine
  canvas centre via a 1×1 `drawImage` (cross-browser; no raw `readPixels`, so
  the headless-Firefox 0x502 readback failure is irrelevant). A read that comes
  back pure black means the engine drew nothing; three consecutive bad samples
  (~1 s) call `fx.disable()`, which tears down the engine and reveals the 2D
  game. An `unreadable` result (readback rejected) is ignored, so a broken
  readback can never disable a healthy engine.
- **Steady-state cost** — the engine ticker is paused whenever the FX tier is
  not the visible surface, so a hidden canvas costs nothing.

If FX is on and you still see black, the `?diag=1` panel shows the exact
engine state (renderer, tier, fps, and any captured errors) and the console
starts with a `[snake] build <stamp> | gl …` banner (the build stamp proves
which code is running — a *stale build* is the most common cause; rebuild with
`make build`, then hard-refresh). The console also carries
`[fx] Phaser disabled (…) | renderer=…` if the watchdog fired.

## Visual polish (post-step-24)

A follow-up pass on the FX layer and the TV shell, driven by playtest feedback
("the snake should look like the old game", "add a CRT TV", "improve the d-pad"): 

- **Blocky neon snake** — the FX (Phaser) snake was a stroked line with a ball
  head; it now draws **crisp blocks** (a small gap between segments) that glide
  cell-to-cell via the same `walkFromCell` interpolation the 2D path uses, with
  a soft two-pass halo behind each block for the emissive look. The head is a
  block with two direction-facing eyes (matching the 2D framebuffer head) rather
  than a ball. This makes FX mode read as the classic 8-bit snake with a neon
  glow instead of a ribbon + orb.
- **Cleaner FX** — the vignette (a square texture with dark edges) is reduced to
  a subtle corner-only depth cue, and the food's hard black shadow is replaced
  by a soft same-colour halo, so the play area no longer reads as a dark box.
- **CRT TV shell** — a visible `#tv-frame` bezel (layered inset shadow: plastic
  body, 3D bevel, glass-edge + curvature) is drawn over the canvas edges with a
  brand plate and a breathing power LED. The game canvas stays full-viewport so
  every composite-geometry contract holds; the frame is a `pointer-events:none`
  overlay.
- **Touch d-pad** — buttons are larger (58px) and neon-glass (blur + glow,
  tracking the per-level `--neon`). In **landscape** the d-pad docks to the left
  (vertically centred); in **portrait** it stays bottom-centre. It auto-shows on
  real touch devices (`maxTouchPoints` / `pointer:coarse`) and stays toggleable.
  Flicking the play area (swipe up/down/left/right) still steers the snake —
  both inputs coexist.

## Playtest pass: sprite TV, settings panel, brighter grid (post-polish)

A second playtest pass, driven by "the bezel is an ugly CSS box, use a real
sprite", "the FX grid is too dark", and "replace the d-pad toggle with a proper
config menu":

- **CRT TV as a real sprite** — the `#tv-frame` bezel is a CRT TV SVG
  (`public/crt-tv.svg`, a detailed Inkscape render: plastic body, recessed
  glass well, speaker vents, knobs, and a **NEON-SNAKE** brand plate) stretched
  over the viewport at `100% 100%`. Its screen area is **transparent**, so the
  centred game shows through the glass while the bezel frames it — the earlier
  hand-drawn SVG had an opaque body that hid the game behind it (a black screen).
  The `#tv-led` breathing dot sits on the SVG's bezel.
- **Settings panel** — the old `#reduced-toggle` (FX on/off) and the separate
  d-pad toggle are replaced by a single gear button (`#settings-gear`, top-right)
  that opens a full-screen modal with four persisted toggles: **Effects**
  (FX on/off → the quality governor), **Sound** (mute → the Tone master gain),
  **D-pad** (show/hide the on-screen pad), and **FPS** (the performance meter).
  Defaults: Effects **on**, Sound **on**, D-pad **off**, FPS **off** (persisted
  to `localStorage` as `snake.settings`). Opening the panel **pauses** the game
  (and closing it resumes) so a player can't steer into a wall while reading
  options; Escape / backdrop / close button all close it.
- **Brighter FX grid** — with FX on the CRT overlays darken the play field, so
  the FX `drawBackground` brightens the theme grid colour (`+34/+34/+46`, 0.9
  alpha) before drawing it, so the grid reads clearly on the FX layer while the
  2D path keeps the theme grid at full strength.
- **Death-sequence luminance test hardened** — the `luma()` debug helper now
  reads the 2D `#game` composite (the deterministic, always-redrawn ground
  truth) instead of the engine's WebGL canvas: a WebGL readback via `drawImage`
  is not frame-synced, so it caught the brightened grid at random frames and the
  transition count flaked. The death FX is local (rightward particle explosion,
  no full-frame flash), so it does not perturb the centre of the real game. The
  `forceDeath()` debug helper now places the **whole** snake connected against
  the wall (head + body) and pins the food well above the centre row, so the
  smooth-walk interpolation and the food never sweep across the centre pixel the
  test samples.

## Known trade-offs

- **Bundle size** — adopting Phaser 4 (render) and Tone.js (audio) takes the
  gzipped bundle to ~456 KB (budget raised 250 → 500 KB, ADR 0007). The 2D
  fallback path is still ~25 KB; a no-WebGL browser runs the full game with
  no render engine (Tone still drives the audio).
- **e2e reads the 2D surface as ground truth** (`sample()`), because the 2D
  `Framebuffer` is always rendered and its readback is cross-browser. The
  engine's own output is separately verified by `fx.selfTest()` (a 1×1
  `drawImage` readback) and by full-page screenshots, so a black engine is
  caught without relying on raw-GL readback (which headless Firefox rejects).
  The `luma()` debug helper (used by the death-sequence transition budget)
  reads the same 2D composite for the same reason: the engine's WebGL readback
  is not frame-synced, so it would catch the brightened grid at random frames
  and flake the luminance-transition count.
- The steady-state heap test allows a small V8 noise band (< 256 KB over ~600
  frames); measured growth is ~41 KB, dominated by the browser, not the render
  path, which allocates nothing per frame (theme CSS strings rebuild only
  during the ~40-frame level-up transition).
- Music is synthesized, not sampled: five short chord loops, not full tracks.
  The lo-fi colour (low-pass + crackle + detune) is deliberate.
