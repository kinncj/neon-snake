// Entry point / composition root. Wires the pure domain to the runtime loop,
// the 2D framebuffer renderer, and (as later steps land) to input, audio,
// quality, and UI adapters.

import { init, makeSink, setBest, step } from "./domain/step";
import { applyIntent, reinit } from "./domain/step";
import { hash } from "./domain/hash";
import { tickMsForLevel } from "./domain/levels";
import {
  GRID_H,
  GRID_W,
  type Dir,
  type Intent,
  type State
} from "./domain/types";
import { Framebuffer } from "./adapters/render/framebuffer";
import { ThemeMixer } from "./adapters/render/theme";
import { PhaserFx } from "./adapters/render/phaser/phaser-fx";

/** The FX diagnostic object exposed to the e2e harness (debug-only). */
interface FxInfo {
  tier: string;
  bloom: number;
  particles: number;
  shockActive: boolean;
  deathActive: boolean;
  shakeActive: boolean;
  drawCalls: number;
  texMB: number;
  fbo: [number, number];
  gl: { version: string; renderer: string };
  fieldRect: number[];
  theme: { level: number; accent: string; bg: number[] };
}
import { ChiptuneSynth, type SynthDebug } from "./adapters/audio/synth";
import { loadBest, saveBest } from "./adapters/storage/highscore";
import { attachGamepad } from "./adapters/input/gamepad";
import { attachKeyboard } from "./adapters/input/keyboard";
import { IntentQueue } from "./adapters/input/queue";
import { attachTouch } from "./adapters/input/touch";
import { buildHud } from "./adapters/ui/hud";
import { buildOverlays, type UiMode } from "./adapters/ui/overlays";
import { buildSettings, loadSettings } from "./adapters/ui/settings";
import { buildFpsMeter } from "./adapters/ui/fps";
import { detectLocale, t } from "./adapters/i18n";
import type { Locale } from "./adapters/i18n/strings";
import { browserDriver, FixedLoop } from "./runtime/loop";
import {
  pickInitialTier,
  prefersReducedMotion,
  probeCapabilities,
  TierGovernor,
  type Tier
} from "./runtime/quality";

const el = document.getElementById("game");
if (!(el instanceof HTMLCanvasElement)) {
  throw new Error("missing #game canvas");
}
const fxEl = document.getElementById("fx");
if (!(fxEl instanceof HTMLCanvasElement)) {
  throw new Error("missing #fx canvas");
}
const framebuffer = new Framebuffer(el);
// The Phaser engine draws the game into the #fx canvas above the 2D ground
// truth; it is the visible surface only while the effective tier is
// high/ultra. The 2D composite is always drawn beneath (the fallback).
const fx = new PhaserFx(fxEl);
window.addEventListener("resize", () => {
  framebuffer.resize();
  const l = framebuffer.getLayout();
  fx.resize(l.W, l.H);
});
framebuffer.resize();
{
  const l = framebuffer.getLayout();
  fx.resize(l.W, l.H);
}

// ---- simulation wiring -------------------------------------------------
// A fixed seed keeps the game a pure function of (seed, intents), which is
// what makes it replayable. Input adapters (later steps) drive intents.
const SEED = "snake-0001";
const state = init(SEED);
// Per-level colour story: the mixer lerps toward the active level's palette
// (600ms ease-out) whenever the domain's level moves. Zero steady-state
// alloc; a live shift re-tints the 2D field (via the framebuffer palette) and
// the HUD accent (via the --neon variable), both only while the shift is live.
const theme = new ThemeMixer(state.level);
// Seed the best score from persistence (0 when absent/unreadable). The domain
// owns the value; the storage adapter owns where it comes from.
let storedBest = loadBest();
setBest(state, storedBest);
// 64 slots: a rendered frame can hold up to 5 ticks' worth of effects
// (catch-up cap) and each tick emits a handful, so the sink never overflows
// between the tick phase and the (single-per-frame) render-phase drain.
const sink = makeSink(64);

// Shared input queue: keyboard + gamepad push, the loop drains once per tick.
const intents = new IntentQueue(16);
const DRAIN = 8;
const drainBuf: Intent[] = new Array(DRAIN);
attachKeyboard(intents);
attachGamepad(intents);
// Touch: swipe-to-steer over the screen plus the on-screen d-pad, which
// starts hidden; the settings panel wires its toggle (and persistence).
const screen = document.getElementById("screen");
const touch =
  screen instanceof HTMLElement ? attachTouch(intents, screen, el) : null;

// ---- quality tiers -------------------------------------------------------
// One capability probe at boot picks the start tier; the governor then
// de/escalates on a rolling frame-time median. prefers-reduced-motion forces
// the reduced tier. (The settings Effects toggle, a later step, can also
// force reduced via setReduced.)
const governor = new TierGovernor(
  pickInitialTier(probeCapabilities()),
  prefersReducedMotion()
);

// ---- audio ----------------------------------------------------------------
// Procedural Web Audio, no asset bytes. No AudioContext is created until the
// first user gesture (browser autoplay policy); the gesture listeners below
// unlock + resume it. Mute is keyboard-reachable (M) and persists in
// localStorage. The context suspends when the page is hidden.
const synth = new ChiptuneSynth();
const MUTE_KEY = "snake.muted";
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  // Storage unavailable (private mode): default to unmuted.
}
if (muted) synth.setMuted(true);

function unlockAudio(): void {
  synth.unlock();
  synth.resume();
}
window.addEventListener("pointerdown", unlockAudio, { capture: true });
window.addEventListener("keydown", unlockAudio, { capture: true });

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") {
    muted = !muted;
    synth.setMuted(muted);
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Non-fatal: mute still applies for the session.
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") synth.suspend();
  else synth.resume();
});

// Raw frame period of the current frame (the FX layer's clock).
let lastFrameDt = 16.7;
// The cause of the most recent death (for the debug/e2e surface).
let lastDeathCause: "none" | "wall" | "self" = "none";
// Engine-ticker pause state (pause the Phaser ticker while it's hidden).
let fxPaused = false;
// Black-frame watchdog counters (a streak of black readbacks disables the
// engine and reveals the 2D path beneath it).
let frameCount = 0;
let fxBadStreak = 0;
let glFailReported = false;

// Per-frame CPU work ring (the perf budget's input): a fixed-capacity
// Float64Array that is overwritten in place, so the steady-state frame path
// allocates nothing. The perf() readout sorts a transient copy on demand.
const FRAME_SAMPLES = 240;
const frameWork = new Float64Array(FRAME_SAMPLES);
let frameWorkIdx = 0;
let frameWorkN = 0;

// ---- UI: locale, HUD, overlays, mode flow -------------------------------
// Locale: a persisted user choice beats browser detection. Every UI string
// resolves through the i18n adapter; the domain never sees the strings.
const LOCALE_KEY = "snake.locale";
const LOCALES: readonly Locale[] = ["en", "ja", "es"];
let locale: Locale = (() => {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOCALE_KEY);
  } catch {
    /* storage unavailable */
  }
  if (saved !== null && (LOCALES as readonly string[]).includes(saved))
    return saved as Locale;
  return detectLocale(navigator.language);
})();
document.title = t(locale, "title");
document.documentElement.lang = locale;
const screenEl = screen as HTMLElement;

// FPS meter (production; toggled from settings) + the settings panel. The
// panel's callbacks reach into the subsystems it configures; opening it
// pauses the game (and closing it resumes) so a player can't steer into a
// wall while reading the options. FX off = the user opted into reduced motion.
const dpad = touch!.dpad;
let userReduced = false; // owned by the settings state below
const fpsMeter = buildFpsMeter(screenEl);
let wasPlayingForSettings = false;
const settings = buildSettings(screenEl, locale, loadSettings(), {
  setFx: (v) => {
    userReduced = !v;
    governor.setReduced(userReduced || prefersReducedMotion());
  },
  setAudio: (v) => synth.setMuted(!v),
  setDpad: (v) => dpad.setVisible(v),
  setFps: (v) => fpsMeter.setEnabled(v),
  onOpen: () => {
    wasPlayingForSettings = uiMode() === "playing";
    if (wasPlayingForSettings) applyIntent(state, { kind: "pause" });
  },
  onClose: () => {
    if (wasPlayingForSettings && state.phase === "paused")
      applyIntent(state, { kind: "pause" });
    wasPlayingForSettings = false;
  }
});
// Apply the persisted settings at boot (FX on, sound on, pad off, fps off by
// default). `settings.state` is the live copy the panel edits.
{
  const s = settings.state;
  userReduced = !s.fx;
  governor.setReduced(userReduced || prefersReducedMotion());
  synth.setMuted(!s.audio);
  dpad.setVisible(s.dpad);
  fpsMeter.setEnabled(s.fps);
}

// Score popups: a small DOM pool (4 nodes) for the "+N" juice on eat.
// Event-driven: a node is repositioned and its CSS animation restarted only
// on an eat; the steady state does nothing.
const popups: HTMLElement[] = (() => {
  const out: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const d = document.createElement("div");
    d.className = "score-pop";
    d.style.display = "none";
    screenEl.append(d);
    out.push(d);
  }
  return out;
})();
let popupIdx = 0;
let prevScore = state.score;

// HUD: counters + banner + footer. Built once; per-frame work is number
// comparisons and write-on-change textContent (zero steady-state alloc).
const hud = buildHud(screenEl, locale);

function applyLocale(l: Locale): void {
  locale = l;
  document.title = t(l, "title");
  document.documentElement.lang = l;
  hud.setLocale(l);
  overlays.setLocale(l);
  settings.setLocale(l);
}

/** Reposition + animate the next pooled popup node at a field cell. */
function showPopup(
  gained: number,
  fx0: number,
  fy0: number,
  layout: ReturnType<typeof framebuffer.getLayout>
): void {
  const node = popups[popupIdx]!;
  popupIdx = (popupIdx + 1) & 3;
  const px = (fx0 + 0.5) * 8 * layout.scale + layout.ox;
  const py = (fy0 + 0.5) * 8 * layout.scale + layout.oy;
  node.style.left = px + "px";
  node.style.top = py + "px";
  node.style.display = "block";
  node.textContent = "+" + String(gained);
  node.classList.remove("show");
  void node.offsetWidth; // restart the CSS animation
  node.classList.add("show");
}

// --- UI mode flow (presentation only; the domain phase is the source) ---
// title -> (any key/tap) -> playing -> (P) -> paused -> (P) -> playing
// gameover -> (R/Enter/tap) -> restart -> playing
let uiTitle = true;
let sawInput = false;
let lastUiMode: UiMode | null = null; // drives the pause banner on transitions
// The game boots behind the title screen, paused (the domain stays pure: the
// runtime simply applies a pause intent at boot).
applyIntent(state, { kind: "pause" });

function uiMode(): UiMode {
  if (state.phase === "gameover") return "gameover";
  if (uiTitle) return "title";
  return state.phase === "paused" ? "paused" : "playing";
}

function markInput(): void {
  if (!sawInput) {
    sawInput = true;
    hud.markFirstInput();
  }
}

function startGame(): void {
  uiTitle = false;
  if (state.phase === "paused") applyIntent(state, { kind: "pause" });
  markInput();
}

function restartGame(): void {
  uiTitle = false;
  reinit(state, SEED);
  fx.reset();
  lastDeathCause = "none";
  synth.setSong(state.level);
  markInput();
}

function uiAction(): void {
  const m = uiMode();
  if (m === "title") startGame();
  else if (m === "paused") startGame();
  else if (m === "gameover") restartGame();
}

const overlays = buildOverlays(screenEl, locale, uiAction);

// Keyboard drives the overlays too: any key starts from the title; R/Enter/
// space restarts from game over. (attachKeyboard still delivers the intents
// — a turn pressed on the title just pre-queues the first move.)
window.addEventListener("keydown", (ev) => {
  if (ev.repeat) return;
  const m = uiMode();
  if (m === "title") {
    if (ev.key === "r" || ev.key === "R") restartGame();
    else startGame();
  } else if (
    m === "gameover" &&
    (ev.key === "r" || ev.key === "R" || ev.key === "Enter" || ev.key === " ")
  ) {
    restartGame();
  }
});
overlays.setMode(uiMode(), state, storedBest);

const loop = new FixedLoop(
  browserDriver(),
  tickMsForLevel(state.level),
  () => {
    // Apply this tick's input before stepping (intents take effect on this
    // tick's move), then advance one fixed tick. Restart needs the seed,
    // which only the wiring knows, so it is handled here (the domain exposes
    // reinit(seed); applyIntent handles turn/pause).
    let gotIntent = false;
    const n = intents.drain(DRAIN, drainBuf);
    for (let i = 0; i < n; i++) {
      const it = drainBuf[i]!;
      gotIntent = true;
      if (it.kind === "restart") {
        reinit(state, SEED);
        fx.reset();
        lastDeathCause = "none";
      } else applyIntent(state, it);
    }
    step(state, sink);
    // Re-derive the tick interval from the (possibly new) level each tick so
    // the loop runs at the level's fixed rate. The domain stays timeless.
    loop.setTickMs(tickMsForLevel(state.level));
    // HUD events: the first input swaps the footer hint.
    if (gotIntent && !sawInput) {
      sawInput = true;
      hud.markFirstInput();
    }
    // Mode-transition banner: fires exactly once per entering-paused edge
    // (mode-based, so a start-then-pause squeezed between ticks still works).
    const m = uiMode();
    if (m !== lastUiMode && m === "paused") hud.banner("banner.paused");
    lastUiMode = m;
    overlays.setMode(m, state, storedBest);
    // Emitted effects stay in the sink until the render loop consumes them:
    // a frame can hold up to 5 ticks' worth and each subsystem (FX, audio,
    // HUD, popups) reads them once per rendered frame.
  },
  (alpha) => {
    const layout = framebuffer.getLayout();
    // Colour story: re-target on a level change, then advance the transition.
    // A live shift re-tints the 2D field (framebuffer palette) and the HUD
    // accent (--neon); at steady state this does nothing (zero alloc).
    const shifting = theme.setLevel(state.level) || theme.update(lastFrameDt);
    if (shifting) {
      screenEl.style.setProperty("--neon", theme.accentCss);
      screenEl.dataset.level = String(state.level);
      framebuffer.setPalette({
        bg: theme.bgCss,
        grid: theme.gridCss,
        body: theme.snakeCss,
        head: theme.headCss,
        accent: theme.accentCss
      });
    }
    framebuffer.render(state, alpha);
    // The Phaser engine is the visible surface only while the effective tier
    // is high/ultra and it has booted. The 2D composite is ALWAYS drawn to
    // #game (the guaranteed fallback); the engine canvas layers above it. If
    // the engine is ever disabled a correct 2D game is already revealed.
    const tier = governor.effective();
    const fxActive = (tier === "high" || tier === "ultra") && fx.isReady;
    if (fx.isReady) {
      const wantPaused = !fxActive;
      if (wantPaused !== fxPaused) {
        fxPaused = wantPaused;
        fx.setPaused(fxPaused);
      }
    }
    try {
      if (fxActive) {
        const [shx, shy] = fx.shakeOffset();
        framebuffer.composite(shx, shy);
        fxEl.style.visibility = "visible";
        fx.render(
          state,
          sink,
          lastFrameDt,
          performance.now(),
          tier,
          layout.ox,
          layout.oy,
          layout.scale,
          { bg: theme.bg, snake: theme.snake, accent: theme.accent, head: theme.head, grid: theme.grid },
          alpha
        );
      } else {
        fxEl.style.visibility = "hidden";
        const [shx, shy] = fx.shakeOffset();
        framebuffer.composite(shx, shy);
      }
    } catch (err) {
      // An engine frame failure must never kill the render loop; report once.
      if (!glFailReported) {
        glFailReported = true;
        console.error("FX frame failed, falling back to 2D:", err);
      }
      fxEl.style.visibility = "hidden";
    }
    // Black-frame watchdog: only meaningful while the engine canvas is the
    // visible surface. A streak of black readbacks disables the engine and
    // reveals the 2D path. "unreadable" is ignored (a broken readback is not
    // evidence of a dead pipeline).
    frameCount++;
    if (fx.isReady && fxEl.style.visibility === "visible" && frameCount % 30 === 0) {
      const probe = fx.selfTest();
      if (probe === "ok") fxBadStreak = 0;
      else if (probe === "black" && ++fxBadStreak >= 3) {
        fx.disable("watchdog: pipeline produced a black frame");
      }
    }
    // Consume this frame's effects once. A frame can hold up to 5 ticks' worth
    // (catch-up); the FX visuals were already read in fx.render, so here the
    // audio, the HUD, and the popups read the sink once per rendered frame.
    const gained = state.score - prevScore;
    for (let i = 0; i < sink.count; i++) {
      const e = sink.items[i]!;
      if (e.kind === "ate") {
        synth.chomp();
        if (state.combo >= 2) synth.coin();
        if (gained > 0) showPopup(gained, e.x, e.y, layout);
      } else if (e.kind === "levelup") {
        synth.jingle();
        synth.setSong(state.level);
      } else if (e.kind === "died") {
        lastDeathCause = e.cause;
        if (e.cause === "wall") synth.boom();
        else synth.splat();
        synth.gameover();
      }
    }
    // Duck the music bus while paused; unduck when playing. (No-op if the
    // phase, and therefore the duck, is unchanged.)
    synth.setDucked(state.phase === "paused");
    prevScore = state.score;
    // HUD: counters sync from state; banners from this frame's effects. The
    // banner scan must read the PRE-death storedBest (new-best is judged
    // against what the player actually beat), so it runs before the
    // persistence loop below bumps storedBest.
    hud.sync(state);
    hud.onEffects(sink, state, storedBest);
    for (let i = 0; i < sink.count; i++) {
      // Persist the high score on a death that beat the stored best.
      if (sink.items[i]!.kind === "died" && state.best > storedBest) {
        saveBest(state.best);
        storedBest = state.best;
      }
    }
    sink.count = 0;
  },
  5,
  (deltaMs) => {
    lastFrameDt = deltaMs;
    governor.recordFrame(deltaMs);
  },
  (workMs) => {
    frameWork[frameWorkIdx] = workMs;
    frameWorkIdx = (frameWorkIdx + 1) % FRAME_SAMPLES;
    if (frameWorkN < FRAME_SAMPLES) frameWorkN++;
  }
);
loop.start();

// ---- debug API ----------------------------------------------------------
// The e2e suite drives and observes the game through window.__snake.
// It is the only sanctioned bridge between the test harness and the engine.
interface SnakeDebug {
  hash(): string;
  pause(): void;
  resume(): void;
  restart(): void;
  freeze(): void;
  unfreeze(): void;
  head(): { x: number; y: number };
  body1(): { x: number; y: number };
  bodyLen(): number;
  pendingLen(): number;
  phase(): string;
  level(): number;
  score(): number;
  setBest(best: number): void;
  bumpScore(n: number): void;
  readonly state: State;
  audio: {
    info(): SynthDebug;
    unlock(): void;
    blip(voice: "pulse" | "triangle" | "noise" | "lead", midi: number): void;
    suspend(): void;
    resume(): void;
    setDucked(v: boolean): void;
    setMuted(v: boolean): void;
    setSong(level: number): void;
    chomp(): void;
    coin(): void;
    boom(): void;
    splat(): void;
    jingle(): void;
    gameover(): void;
    click(): void;
  };
  tier(): string;
  perfTier(): string;
  pinTier(t: Exclude<Tier, "reduced">): void;
  setReduced(v: boolean): void;
  sample(x: number, y: number): [number, number, number];
  luma(): number;
  composite(): {
    deviceW: number;
    deviceH: number;
    scale: number;
    offX: number;
    offY: number;
    drawW: number;
    drawH: number;
  };
  fingerprint(): { hash: string; tick: number; bodyLen: number; score: number };
  perf(): { p95: number; p50: number; max: number; n: number };
  replayLog(text: string, seed: string): string;
  deathCause(): "none" | "wall" | "self";
  setLocale(l: Locale): void;
  ui: { mode(): string; start(): void };
  fx: {
    ready(): boolean;
    selfTest(): "ok" | "black" | "unreadable";
    disable(reason?: string): void;
    forceTier(t: "low" | "high" | "ultra"): void;
    info(): FxInfo;
    teleportFoodAhead(): void;
    forceDeath(): void;
  };
}
declare global {
  interface Window {
    __snake?: SnakeDebug;
  }
}

// Downscale target for luma() (one allocation at boot, never per call).
const lumaCanvas = document.createElement("canvas");
lumaCanvas.width = 64;
lumaCanvas.height = 36;
const lumaCtx = lumaCanvas.getContext("2d");
if (lumaCtx === null) throw new Error("no 2d context for luma probe");

// Mutable view over the long-lived State for the sanctioned debug bridge
// (same pattern as the engine's private view in step.ts): the `readonly`
// surface is the renderer/audio contract; only this bridge and the domain
// write to the record.
type MutState = {
  -readonly [K in keyof State]: State[K] extends readonly (infer T)[]
    ? { -readonly [M in keyof T]: T[M] }[]
    : State[K] extends object
      ? { -readonly [M in keyof State[K]]: State[K][M] }
      : State[K];
};

/** Place the food on the first free cell ahead of the head (along dir). */
function teleportFoodAhead(): void {
  if (state.phase === "gameover") return;
  const m = state as MutState;
  m.pendingLen = 0;
  const head = state.body[0]!;
  const dx = [0, 1, 0, -1][state.dir]!;
  const dy = [-1, 0, 1, 0][state.dir]!;
  let x = head.x + dx;
  let y = head.y + dy;
  for (let i = 0; i < GRID_W + GRID_H; i++) {
    let free = x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
    if (free) {
      for (let j = 0; j < state.bodyLen; j++) {
        const c = state.body[j]!;
        if (c.x === x && c.y === y) {
          free = false;
          break;
        }
      }
    }
    if (free) break;
    x += dx;
    y += dy;
  }
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) {
    // The walk ran out of grid; fall back to the first free cell.
    outer: for (let yy = 0; yy < GRID_H; yy++) {
      for (let xx = 0; xx < GRID_W; xx++) {
        let occupied = false;
        for (let j = 0; j < state.bodyLen; j++) {
          const c = state.body[j]!;
          if (c.x === xx && c.y === yy) {
            occupied = true;
            break;
          }
        }
        if (!occupied) {
          x = xx;
          y = yy;
          break outer;
        }
      }
    }
  }
  m.food.x = x;
  m.food.y = y;
}

/**
 * Pin the whole snake connected against the right wall, head at the wall
 * moving right: the very next tick is a wall death. The food is pinned above
 * the centre row and the turn queue is cleared, so the death is immediate.
 */
function forceDeath(): void {
  const m = state as MutState;
  m.pendingLen = 0;
  m.phase = "playing";
  m.dir = 1;
  const per = GRID_W - 1;
  for (let i = 0; i < state.bodyLen; i++) {
    const row = Math.min(8 + Math.floor(i / per), GRID_H - 1);
    const idx = i % per;
    const x = row % 2 === 0 ? GRID_W - 1 - idx : idx;
    const c = m.body[i]!;
    c.x = x;
    c.y = row;
  }
  m.food.x = 5;
  m.food.y = 3;
  lastDeathCause = "none";
}

window.__snake = {
  hash: () => hash(state),
  pause: () => {
    if (state.phase === "playing") applyIntent(state, { kind: "pause" });
  },
  resume: () => {
    if (state.phase === "paused") applyIntent(state, { kind: "pause" });
  },
  restart: () => {
    reinit(state, SEED);
    fx.reset();
    lastDeathCause = "none";
  },
  freeze: () => {
    if (state.phase === "playing") applyIntent(state, { kind: "pause" });
  },
  unfreeze: () => {
    if (state.phase === "paused") applyIntent(state, { kind: "pause" });
  },
  head: () => {
    const h = state.body[0]!;
    return { x: h.x, y: h.y };
  },
  body1: () => {
    const h = state.body[1]!;
    return { x: h.x, y: h.y };
  },
  bodyLen: () => state.bodyLen,
  pendingLen: () => state.pendingLen,
  phase: () => state.phase,
  level: () => state.level,
  score: () => state.score,
  setBest: (best: number) => {
    setBest(state, best);
  },
  // Debug-only: add to the score (and best) without eating, so a level-up can
  // be driven deterministically. The domain re-derives the level next tick.
  bumpScore: (n: number) => {
    const m = state as MutState;
    m.score += n;
    m.best = m.score > m.best ? m.score : m.best;
  },
  // The live domain record (read-only surface) for harness inspection.
  state,
  tier: () => governor.effective(),
  perfTier: () => governor.perfTier,
  pinTier: (t) => {
    governor.pinPerf(t);
  },
  setReduced: (v) => {
    governor.setReduced(v);
  },
  // Sample one device pixel of the 2D ground truth (the #game canvas).
  sample: (x, y) => {
    const g = el.getContext("2d");
    if (g === null) return [0, 0, 0];
    const d = g.getImageData(x, y, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!];
  },
  // Normalised full-frame luminance of the 2D composite (0..1): downscale
  // once into a tiny probe canvas, then a single getImageData.
  luma: () => {
    lumaCtx.drawImage(el, 0, 0, lumaCanvas.width, lumaCanvas.height);
    const d = lumaCtx.getImageData(0, 0, lumaCanvas.width, lumaCanvas.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    }
    return sum / (lumaCanvas.width * lumaCanvas.height * 255);
  },
  composite: () => {
    const l = framebuffer.getLayout();
    return {
      deviceW: l.W,
      deviceH: l.H,
      scale: l.scale,
      offX: l.ox,
      offY: l.oy,
      drawW: l.fw,
      drawH: l.fh
    };
  },
  fingerprint: () => ({
    hash: hash(state),
    tick: state.tick,
    bodyLen: state.bodyLen,
    score: state.score
  }),
  // Per-frame CPU work percentiles from the ring (a transient copy is sorted
  // on demand; the ring itself is never grown).
  perf: () => {
    const n = frameWorkN;
    if (n === 0) return { p95: 0, p50: 0, max: 0, n: 0 };
    const tmp: number[] = new Array(n);
    for (let i = 0; i < n; i++) tmp[i] = frameWork[i]!;
    tmp.sort((a, b) => a - b);
    return {
      p95: tmp[Math.min(n - 1, Math.floor(n * 0.95))]!,
      p50: tmp[Math.min(n - 1, Math.floor(n * 0.5))]!,
      max: tmp[n - 1]!,
      n
    };
  },
  // Replay a "tick,kind[,dir]" log over a fresh engine instance and return
  // the final state hash — the tier-independence gate drives this at both
  // low and ultra.
  replayLog: (text: string, seed: string): string => {
    const byTick = new Map<number, Intent[]>();
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const [tickStr, kind, dirStr] = line.split(",");
      const t = Number(tickStr);
      let intent: Intent;
      if (kind === "pause") intent = { kind: "pause" };
      else if (kind === "restart") intent = { kind: "restart" };
      else intent = { kind: "turn", dir: Number(dirStr) as Dir };
      const list = byTick.get(t);
      if (list === undefined) byTick.set(t, [intent]);
      else list.push(intent);
    }
    const rs = init(seed);
    const rsink = makeSink(32);
    for (let t = 1; t <= 5000; t++) {
      const its = byTick.get(t);
      if (its !== undefined) {
        for (const it of its) {
          if (it.kind === "restart") reinit(rs, seed);
          else applyIntent(rs, it);
        }
      }
      step(rs, rsink);
      rsink.count = 0;
    }
    return hash(rs);
  },
  deathCause: () => lastDeathCause,
  setLocale: (l: Locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      /* storage unavailable */
    }
    applyLocale(l);
  },
  ui: {
    mode: () => uiMode(),
    start: () => uiAction()
  },
  fx: {
    ready: () => fx.isReady,
    selfTest: () => fx.selfTest(),
    disable: (reason) => {
      fx.disable(reason ?? "debug");
    },
    forceTier: (t) => {
      governor.pinPerf(t);
      governor.setReduced(false);
    },
    info: () => {
      return {
        tier: governor.effective(),
        bloom: fx.bloomNow,
        particles: fx.particlesLive,
        shockActive: fx.shockActive,
        deathActive: fx.deathActive,
        shakeActive: fx.shakeActive,
        drawCalls: fx.drawCalls,
        texMB: fx.texMB,
        fbo: [fx.fboW, fx.fboH],
        gl: fx.glInfo(),
        fieldRect: [...fx.fieldRect()],
        theme: { level: state.level, accent: theme.accentCss, bg: [...theme.bg] }
      };
    },
    teleportFoodAhead,
    forceDeath
  },
  audio: {
    info: () => synth.debug(),
    unlock: () => {
      synth.unlock();
      synth.resume();
    },
    blip: (voice, midi) => {
      synth.blip(voice, midi);
    },
    suspend: () => synth.suspend(),
    resume: () => synth.resume(),
    setDucked: (v) => synth.setDucked(v),
    setMuted: (v) => {
      muted = v;
      synth.setMuted(v);
    },
    setSong: (level) => synth.setSong(level),
    chomp: () => synth.chomp(),
    coin: () => synth.coin(),
    boom: () => synth.boom(),
    splat: () => synth.splat(),
    jingle: () => synth.jingle(),
    gameover: () => synth.gameover(),
    click: () => synth.click()
  }
};
