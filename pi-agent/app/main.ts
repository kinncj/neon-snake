// Entry point: display canvas, fixed-timestep simulation, render loop.
/// <reference types="vite/client" />
import { hash } from "./domain/hash";
import { applyIntent, init, makeSink, reinit, setBest, step } from "./domain/step";
import { tickMsForLevel } from "./domain/levels";
import type { Dir, Intent, State } from "./domain/types";
import { PhaserFx } from "./adapters/render/phaser/phaser-fx";
import { ChiptuneSynth } from "./adapters/audio/synth";
import { Framebuffer, computeComposite, composite, fillComposite, type MutableComposite } from "./adapters/render/framebuffer";
import { ThemeMixer } from "./adapters/render/theme";
import { attachGamepad } from "./adapters/input/gamepad";
import { attachTouch } from "./adapters/input/touch";
import { attachKeyboard, IntentQueue } from "./adapters/input/keyboard";
import { loadBest, saveBest } from "./adapters/storage/highscore";
import { buildHud } from "./adapters/ui/hud";
import { buildOverlays, type UiMode } from "./adapters/ui/overlays";
import { buildFpsMeter } from "./adapters/ui/fps";
import { buildSettings, loadSettings } from "./adapters/ui/settings";
import { detectLocale, t } from "./adapters/i18n";
import type { Locale } from "./adapters/i18n/strings";
import { FixedLoop } from "./runtime/loop";
import {
  TierGovernor,
  pickInitialTier,
  probeCapabilities,
  passesFor,
  type Tier
} from "./runtime/quality";

const SEED = "snake-0001";

const stage = document.getElementById("stage")!;
const screen = document.getElementById("screen")!;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const dctx = canvas.getContext("2d")!;
// The effects layer draws into its own WebGL2 canvas layered above the 2D
// one; it is visible only when the tier runs post passes (high/ultra).
const glCanvas = document.createElement("canvas");
glCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
stage.append(glCanvas);
// The engine (Phaser) renders the game + FX into this canvas, layered above
// the 2D #game canvas. It is visible only when the tier runs FX (high/ultra);
// the 2D composite underneath is the guaranteed fallback if it is disabled.
const fx = new PhaserFx(glCanvas);

const state: State = init(SEED);
// Best score comes from persistence (adapter); the domain just receives it.
let storedBest = loadBest();
setBest(state, storedBest);
const sink = makeSink(64);
const fb = new Framebuffer();
// Per-level colour story: the mixer lerps toward the active level's palette
// (600ms ease-out) whenever the domain's level moves. Zero steady-state
// alloc; css strings are cached and only rebuilt while a shift is live.
const theme = new ThemeMixer(state.level);
fb.setTheme(theme);

// Locale: user choice (persisted) beats browser detection. All UI strings
// resolve through the i18n adapter; the domain never sees them.
const LOCALE_KEY = "snake.locale";
const LOCALES: readonly Locale[] = ["en", "ja", "es"];
let locale: Locale = (() => {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOCALE_KEY);
  } catch {
    /* storage unavailable */
  }
  if (saved !== null && LOCALES.includes(saved as Locale)) return saved as Locale;
  return detectLocale(navigator.language);
})();

const inputQueue = new IntentQueue();

// Audio: no AudioContext exists until the first user gesture unlocks the
// synth. The current level's song is applied on unlock (and on level-up),
// so the music always matches the run.
const synth = new ChiptuneSynth();
const unlockAudio = (): void => {
  synth.unlock();
  synth.setSong(state.level);
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
};
// Capture phase: overlay panels stopPropagation on pointerdown, so a
// bubble-phase window listener would miss the gesture that starts the game.
window.addEventListener("pointerdown", unlockAudio, { capture: true });
window.addEventListener("keydown", unlockAudio);
// Suspend the context when the page is hidden so it never runs in the background.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") synth.suspend();
  else synth.resume();
});

let sawInput = false;
let lastUiMode: UiMode | null = null; // drives the pause banner on transitions
const loop = new FixedLoop({
  onTick: () => {
    // Intents apply before the tick's step (replay semantics).
    let gotIntent = false;
    for (;;) {
      const intent = inputQueue.pop();
      if (intent === null) break;
      gotIntent = true;
      if (intent.kind === "restart") reinit(state, SEED);
      else applyIntent(state, intent);
    }
    step(state, sink);
    // Level-driven speed: the domain says how fast the game is (ms per tick);
    // the loop follows it. Only written on change so the hot path stays quiet.
    const want = tickMsForLevel(state.level);
    if (want !== loop.tickInterval) loop.setTickMs(want);
    // HUD events: first input swaps the footer hint.
    if (gotIntent && !sawInput) {
      sawInput = true;
      hud.markFirstInput();
    }
    // Mode-transition banners: fires exactly once per entering-paused edge
    // (mode-based, so a start-then-pause squeezed between ticks still works).
    const m = uiMode();
    if (m !== lastUiMode && m === "paused") hud.banner("banner.paused");
    lastUiMode = m;
    overlays.setMode(m, state, storedBest);
    // Effects stay in the sink until the render loop consumes them: a frame
    // can contain up to 5 ticks worth of effects and the effects layer reads
    // them once per rendered frame. Sink capacity (64) >> 5 ticks * 4 max.
  }
});

attachKeyboard(inputQueue, window);
attachGamepad(inputQueue);
const touch = attachTouch(inputQueue, stage, canvas);
const dpad = touch.dpad;

// Quality tier: capability probe picks the start, the rolling frame median
// adjusts it. The settings "Effects" toggle (or prefers-reduced-motion)
// overrides. FX is ON by default; a user who turns it off is a "reduced" user.
const mediaQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
let userReduced = false; // owned by the settings state below
const sysReduced = (): boolean => (mediaQuery !== null ? mediaQuery.matches : false);
const governor = new TierGovernor(pickInitialTier(probeCapabilities()), userReduced || sysReduced());
if (mediaQuery !== null) {
  mediaQuery.addEventListener("change", () => governor.setReduced(userReduced || sysReduced()));
}

// FPS meter (production; toggled from settings) + the settings panel. The
// panel's callbacks reach into the subsystems it configures; opening it
// pauses the game (and closing it resumes) so a player can't steer into a
// wall while reading the options.
const fpsMeter = buildFpsMeter(screen);
let wasPlayingForSettings = false;
const settings = buildSettings(screen, locale, loadSettings(), {
  setFx: (v) => {
    userReduced = !v;
    governor.setReduced(userReduced || sysReduced());
  },
  setAudio: (v) => synth.setMuted(!v),
  setDpad: (v) => dpad.setVisible(v),
  setFps: (v) => fpsMeter.setEnabled(v),
  onOpen: () => {
    wasPlayingForSettings = uiMode() === "playing";
    if (wasPlayingForSettings) applyIntent(state, { kind: "pause" });
  },
  onClose: () => {
    if (wasPlayingForSettings && state.phase === "paused") applyIntent(state, { kind: "pause" });
    wasPlayingForSettings = false;
  }
});
// Apply the persisted settings at boot (FX on, sound on, pad off, fps off by
// default). `settings.state` is the live copy the panel edits.
{
  const s = settings.state;
  userReduced = !s.fx;
  governor.setReduced(userReduced || sysReduced());
  synth.setMuted(!s.audio);
  dpad.setVisible(s.dpad);
  fpsMeter.setEnabled(s.fps);
}

// HUD: counters + banner + footer. Built once; per-frame work is number
// comparisons and write-on-change textContent (zero steady-state alloc).
const hud = buildHud(screen, locale);
document.title = t(locale, "title");
document.documentElement.lang = locale;

function applyLocale(l: Locale): void {
  locale = l;
  document.title = t(l, "title");
  document.documentElement.lang = l;
  hud.setLocale(l);
  overlays.setLocale(l);
  settings.setLocale(l);
}

// --- UI mode flow (presentation only; the domain phase is the source) ---
// title -> (any key/tap) -> playing -> (P) -> paused -> (P) -> playing
// gameover -> (R/Enter/tap) -> restart -> playing
const overlays = buildOverlays(screen, locale, uiAction);
let uiTitle = true;
// The game boots behind the title screen, paused (domain stays pure: the
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
  synth.setSong(state.level);
  markInput();
}

function uiAction(): void {
  const m = uiMode();
  if (m === "title") startGame();
  else if (m === "paused") startGame();
  else if (m === "gameover") restartGame();
}

// Keyboard drives the overlays too: any key starts from the title; R/Enter
// restarts from game over. (attachKeyboard still delivers the intents — a
// turn pressed on the title just pre-queues the first move.)
window.addEventListener("keydown", (ev) => {
  if (ev.repeat) return;
  const m = uiMode();
  if (m === "title") {
    if (ev.key === "r" || ev.key === "R") restartGame();
    else startGame();
  } else if (m === "gameover" && (ev.key === "r" || ev.key === "R" || ev.key === "Enter" || ev.key === " ")) {
    restartGame();
  }
});
overlays.setMode(uiMode(), state, storedBest);

// Backing store is cssPx * devicePixelRatio; CSS size comes from the sheet.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(stage.clientWidth * dpr);
  canvas.height = Math.round(stage.clientHeight * dpr);
  glCanvas.width = canvas.width;
  glCanvas.height = canvas.height;
  fx.resize(canvas.width, canvas.height);
}

window.addEventListener("resize", resize);
resize();
// Startup banner: which build this page is running and whether the engine
// came up. Always logged (even without ?diag=1) so a console glance settles
// "is this the new code?" — the most common cause of a "black screen with
// FX" report is a stale build on the user's side.
{
  const stamp =
    typeof __SNAKE_BUILD__ !== "undefined" ? __SNAKE_BUILD__ : "dev";
  const gi = fx.glInfo();
  console.info(
    `[snake] build ${stamp} | gl ${
      fx.isReady ? `${gi.renderer || "webgl2"} (${gi.version})` : "UNAVAILABLE — 2D path"
    }` +
      (fx.initError ? ` | init error: ${fx.initError}` : "")
  );
}
loop.start();

let lastDraw = performance.now();
let glFailReported = false;
let sfxFailReported = false;
// Score popups: a small DOM pool (4 nodes) for the "+N" juice on eat.
// Event-driven: a node is repositioned and its CSS animation restarted only
// on an eat; the steady state does nothing.
const popups: HTMLElement[] = (() => {
  const out: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const d = document.createElement("div");
    d.className = "score-pop";
    d.style.display = "none";
    screen.append(d);
    out.push(d);
  }
  return out;
})();
let popupIdx = 0;
let prevScore = state.score;
let lastDeathCause: "none" | "wall" | "self" = "none";

// Preallocated per-frame state (steady-state allocation budget: zero).
const info: MutableComposite = { deviceW: 0, deviceH: 0, scale: 1, offX: 0, offY: 0, drawW: 0, drawH: 0 };
const FRAME_SAMPLES = 240;
const frameWork = new Float64Array(FRAME_SAMPLES);
let frameWorkIdx = 0;
let frameWorkN = 0;
// GL watchdog: if the effects layer is "ready" but producing a pure-black
// frame (a driver broke the pipeline at runtime without losing the
// context), sample every 30 frames and disable GL after 3 consecutive bad
// reads (~1 s). The 2D path then takes over, so the game keeps working.
let frameCount = 0;
let fxBadStreak = 0;
// Whether the engine ticker is currently paused (it runs only while the FX
// tier is the visible surface; otherwise the 2D path owns the pixels and
// Phaser's render loop is paused to keep steady-state heap/CPU at zero).
let fxPaused = false;
function draw(): void {
  const w0 = performance.now();
  const now = w0;
  const dt = now - lastDraw;
  governor.recordFrame(dt);
  lastDraw = now;
  fillComposite(canvas.width, canvas.height, info);
  // Colour story: re-target on level change, advance the transition. A
  // live shift also refreshes the HUD accent variable (event-driven, so
  // the steady state does nothing).
  const shifting = theme.setLevel(state.level) || theme.update(dt);
  if (shifting) {
    screen.style.setProperty("--neon", theme.accentCss);
    screen.dataset.level = String(state.level);
  }
  fb.render(state, loop.alpha);
  const tier = governor.effective();
  const fxActive = (tier === "high" || tier === "ultra") && fx.isReady;
  // Keep the engine ticker alive only while it is the visible surface. Once
  // the scene has booted (isReady), pause it on low/reduced so a hidden
  // canvas costs nothing in steady state.
  if (fx.isReady) {
    const wantPaused = !fxActive;
    if (wantPaused !== fxPaused) {
      fxPaused = wantPaused;
      fx.setPaused(fxPaused);
    }
  }
  try {
    if (fxActive) {
      // The 2D composite is ALWAYS drawn to #game (the guaranteed fallback).
      // The engine canvas layers above it; if the engine is ever disabled,
      // a correct 2D game is already sitting there, fully revealed.
      composite(dctx, fb.canvas, info, theme.bgCss);
      glCanvas.style.visibility = "visible";
      fx.render(
        state,
        sink,
        dt,
        now,
        tier,
        info.offX,
        info.offY,
        info.scale,
        { bg: theme.bg, snake: theme.snake, accent: theme.accent, head: theme.head, grid: theme.grid },
        loop.alpha
      );
    } else {
      glCanvas.style.visibility = "hidden";
      const [shx, shy] = fx.shakeOffset();
      composite(dctx, fb.canvas, info, theme.bgCss, shx, shy);
    }
  } catch (err) {
    // An engine frame failure must never kill the render loop; report once.
    if (!glFailReported) {
      glFailReported = true;
      console.error("FX frame failed, falling back to 2D:", err);
    }
    if (glFailReported) glCanvas.style.visibility = "hidden";
  }
  // Watchdog: only meaningful while the GL canvas is the visible surface.
  // "unreadable" (readback rejected by the engine) is ignored — a black
  // read on an engine whose readback is broken is not evidence of a dead
  // pipeline.
  frameCount++;
  if (fx.isReady && glCanvas.style.visibility === "visible" && frameCount % 30 === 0) {
    const probe = fx.selfTest();
    if (probe === "ok") {
      fxBadStreak = 0;
    } else if (probe === "black" && ++fxBadStreak >= 3) {
      fx.disable("watchdog: pipeline produced a black frame");
    }
  }
  // SFX for the frame's effects (no-op until the synth is unlocked).
  const gained = state.score - prevScore;
  // SFX dispatch is wrapped: an audio/scheduling error must NEVER kill the
  // render loop (the synth's own methods are internally safe; this is the
  // belt-and-suspenders net). The 2D composite and HUD below always run.
  try {
    for (let i = 0; i < sink.count; i++) {
      const e = sink.items[i]!;
      if (e.kind === "ate") {
        synth.chomp();
        if (state.combo >= 2) synth.coin();
        if (gained > 0) {
          const el = popups[popupIdx]!;
          popupIdx = (popupIdx + 1) & 3;
          const px = (e.x + 0.5) * 8 * info.scale + info.offX;
          const py = (e.y + 0.5) * 8 * info.scale + info.offY;
          el.style.left = px + "px";
          el.style.top = py + "px";
          el.style.display = "block";
          el.textContent = "+" + String(gained);
          el.classList.remove("show");
          void el.offsetWidth; // restart the CSS animation
          el.classList.add("show");
        }
      } else if (e.kind === "levelup") {
        synth.jingle();
        synth.setSong(state.level);
      } else if (e.kind === "died") {
        lastDeathCause = e.cause === "wall" || e.cause === "self" ? e.cause : "none";
        if (e.cause === "wall") synth.boom();
        else synth.splat();
        synth.gameover();
      }
    }
    synth.setDucked(state.phase === "paused");
  } catch (err) {
    if (!sfxFailReported) {
      sfxFailReported = true;
      console.error("SFX dispatch failed (ignored, game continues):", err);
    }
  }
  prevScore = state.score;
  // HUD: counters sync from state; banners from this frame's effects. The
  // high score is persisted when a run ends with a new best.
  hud.sync(state);
  hud.onEffects(sink, state, storedBest);
  for (let i = 0; i < sink.count; i++) {
    if (sink.items[i]!.kind === "died" && state.best > storedBest) {
      saveBest(state.best);
      storedBest = state.best;
    }
  }
  sink.count = 0;
  frameWork[frameWorkIdx] = performance.now() - w0; // per-frame CPU work
  frameWorkIdx = (frameWorkIdx + 1) % FRAME_SAMPLES;
  if (frameWorkN < FRAME_SAMPLES) frameWorkN++;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// --- Diagnostics (?diag=1): engine status + recent errors -----------------
// Production self-diagnostics: when a player reports "broken on my browser",
// this panel shows the render path, GL identity, canvas geometry, fps, and
// the last few runtime errors. Zero cost when the param is absent.
const diagPanel: HTMLElement | null = new URLSearchParams(location.search).has(
  "diag"
)
  ? (() => {
      const p = document.createElement("div");
      p.id = "diag";
      p.style.cssText =
        "position:absolute;left:12px;bottom:12px;z-index:11;max-width:420px;" +
        "background:rgba(3,4,12,0.9);border:1px solid rgba(255,209,102,0.5);" +
        "border-radius:4px;padding:8px 10px;font:11px/1.5 'Courier New',monospace;" +
        "color:#ffd166;white-space:pre-wrap;pointer-events:none;";
      screen.append(p);
      const errs: string[] = [];
      const pushErr = (s: string): void => {
        errs.push(s.slice(0, 180));
        if (errs.length > 4) errs.shift();
      };
      window.addEventListener("error", (e) => pushErr("error: " + e.message));
      window.addEventListener("unhandledrejection", (e) =>
        pushErr("rejection: " + String(e.reason).slice(0, 160))
      );
      const origErr = console.error.bind(console);
      console.error = (...args: unknown[]): void => {
        pushErr("console: " + args.map((a) => String(a)).join(" "));
        origErr(...args);
      };
      let frames = 0;
      const origRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb: FrameRequestCallback) => {
        frames++;
        return origRaf(cb);
      };
      let fpsWindow = frames;
      setInterval(() => {
        const fps = frames - fpsWindow;
        fpsWindow = frames;
        const g = fx.glInfo();
        p.textContent =
          `tier ${governor.effective()} (pinned ${governor.perfTier})\n` +
          `gl ${fx.isReady ? g.renderer || g.version : "UNAVAILABLE — 2D fallback"}\n` +
          `canvas ${canvas.width}×${canvas.height} @${window.devicePixelRatio}x\n` +
          `fps≈${fps} drawCalls ${fx.drawCalls}\n` +
          (errs.length > 0 ? "errors:\n" + errs.join("\n") : "no errors");
      }, 1000);
      return p;
    })()
  : null;
void diagPanel;

// Debug surface for e2e tests. Not part of the runtime API.
interface Fingerprint {
  tick: number;
  score: number;
  bodyLen: number;
  head: [number, number];
  food: [number, number];
  phase: State["phase"];
  dir: State["dir"];
  hash: string;
}

interface DebugApi {
  state: State;
  canvas: HTMLCanvasElement;
  composite(): ReturnType<typeof computeComposite>;
  tier: {
    effective(): Tier;
    perf(): Tier;
    passes(): string[];
    pinPerf(t: Tier): void;
    setReduced(v: boolean): void;
  };
  fingerprint(): Fingerprint;
  fx: {
    ready(): boolean;
    selfTest(): "ok" | "black" | "unreadable";
    disable(reason?: string): void;
    forceTier(t: "low" | "high" | "ultra"): void;
    info(): {
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
    };
    teleportFoodAhead(): void;
    forceDeath(): void;
  };
  replayLog(text: string, seed: string): string;
  deathCause(): "none" | "wall" | "self";
  luma(): number;
  perf(): { p95: number; p50: number; max: number; n: number };
  setLocale(l: Locale): void;
  bumpScore(n: number): void;
  ui: { mode(): string; start(): void };
  audio: {
    info(): {
      unlocked: boolean;
      running: boolean;
      state: string;
      master: number;
      voices: string[];
      duckCap: number;
      ducked: boolean;
      song: number;
      sfx: Record<string, number>;
    };
    unlock(): void;
    duck(v: boolean): void;
    blip(voice: "pulse" | "triangle" | "noise" | "lead", midi: number): void;
  };
  freeze(): void;
  unfreeze(): void;
  sample(x: number, y: number): number[];
}

// 2D framebuffer readback in device coordinates: maps a device pixel into
// the 256x240 fb via the composite rect and reads the source of truth.
// Letterbox points emulate the 2D display composite (flat bg fill).
function sample2d(x: number, y: number): number[] {
  const fx2 = Math.floor((x - info.offX) / info.scale);
  const fy2 = Math.floor((y - info.offY) / info.scale);
  if (fx2 < 0 || fx2 >= 256 || fy2 < 0 || fy2 >= 240) return [5, 6, 15, 255];
  const d = fb.canvas.getContext("2d")!.getImageData(fx2, fy2, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
}

(window as { __snake?: unknown }).__snake = {
  state,
  canvas,
  composite: () => computeComposite(canvas.width, canvas.height),
  tier: {
    effective: (): Tier => governor.effective(),
    perf: (): Tier => governor.perfTier,
    passes: (): string[] => [...passesFor(governor.effective())],
    pinPerf: (t: Tier) => {
      if (t === "reduced") governor.setReduced(true);
      else governor.pinPerf(t);
    },
    setReduced: (v: boolean) => governor.setReduced(v)
  },
  fingerprint: (): Fingerprint => ({
    tick: state.tick,
    score: state.score,
    bodyLen: state.bodyLen,
    head: [state.body[0]!.x, state.body[0]!.y],
    food: [state.food.x, state.food.y],
    phase: state.phase,
    dir: state.dir,
    hash: hash(state)
  }),
  freeze: () => {
    if (state.phase === "playing") applyIntent(state, { kind: "pause" });
  },
  unfreeze: () => {
    if (state.phase === "paused") applyIntent(state, { kind: "pause" });
  },
  sample: (x: number, y: number): number[] => {
    // Reads the 2D game surface (the 256x240 framebuffer, which is always
    // rendered fresh each frame regardless of the FX tier). This is the
    // cross-browser source of truth for the game image — no WebGL readback,
    // so the old Firefox default-FB 0x502 readback failure cannot affect the
    // e2e content contracts. The engine's own output is separately verified
    // by fx.selfTest() (a drawImage readback) and by full-page screenshots.
    return sample2d(x, y);
  },
  perf: (): { p95: number; p50: number; max: number; n: number } => {
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
  audio: {
    info: () => synth.debug(),
    unlock: (): void => synth.unlock(),
    duck: (v: boolean): void => synth.setDucked(v),
    blip: (voice: "pulse" | "triangle" | "noise" | "lead", midi: number): void => synth.blip(voice, midi)
  },
  setLocale: (l: Locale): void => {
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      /* storage unavailable */
    }
    applyLocale(l);
  },
  ui: {
    mode: (): UiMode => uiMode(),
    start: (): void => uiAction()
  },
  bumpScore: (n: number): void => {
    // Debug-only mutation for e2e: jump the score (level re-derives on the
    // next eat). Not part of the runtime API.
    (state as { score: number }).score = n;
  },
  luma: (): number => {
    // Reads the centre pixel of the 2D #game composite — the deterministic
    // source of truth that is redrawn every frame from the (frozen-during-
    // death) state. We deliberately do NOT read the engine (Phaser/WebGL)
    // canvas here: a WebGL readback via drawImage is not frame-synced, so it
    // catches the brightened grid at random frames and the death-sequence
    // transition count flakes. The death FX is local (rightward particles,
    // no full-frame flash), so it does not perturb the centre of the real
    // game; reading the 2D composite is a stable full-frame luminance sample.
    const x = Math.floor(canvas.width / 2);
    const y = Math.floor(canvas.height / 2);
    const d = dctx.getImageData(x, y, 1, 1).data;
    const r = d[0] ?? 0, g = d[1] ?? 0, b = d[2] ?? 0;
    return (r + g + b) / (3 * 255);
  },
  fx: {
    ready: (): boolean => fx.isReady,
    selfTest: (): "ok" | "black" | "unreadable" => fx.selfTest(),
    disable: (reason?: string): void => fx.disable(reason ?? "debug-disable"),
    forceTier: (t: "low" | "high" | "ultra"): void => {
      governor.pinPerf(t);
    },
    info: () => {
      const tier = governor.effective();
      return {
        tier,
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
    teleportFoodAhead: (): void => {
      const head = state.body[0]!;
      const dx = [0, 1, 0, -1][state.dir]!;
      const dy = [-1, 0, 1, 0][state.dir]!;
      const food = state.food as { x: number; y: number };
      let x = head.x + dx;
      let y = head.y + dy;
      for (let i = 0; i < 16 && x >= 0 && x < 32 && y >= 0 && y < 30; i++) {
        if (x !== food.x || y !== food.y) break;
        x += dx;
        y += dy;
      }
      food.x = x;
      food.y = y;
    },
    forceDeath: (): void => {
      // Place the WHOLE snake against the right wall (head + connected body)
      // moving right: the next tick is a wall death. Setting the entire body
      // (not just the head) keeps the walk-interpolation short — the neck is
      // adjacent to the head, so the snake never lerps across the field past
      // the centre pixel, which is exactly what the death-sequence luminance
      // budget samples. (Teleporting only the head made it sweep through the
      // centre every tick and flake the transition count.)
      const mut = state as unknown as {
        dir: Dir;
        phase: State["phase"];
        body: { x: number; y: number }[];
        bodyLen: number;
        pendingLen: number;
        food: { x: number; y: number; kind: string };
      };
      for (let i = 0; i < mut.bodyLen; i++) {
        const c = mut.body[i]!;
        c.x = 31 - i;
        c.y = 15;
      }
      // Pin the food well above the centre row so it and its halo never
      // perturb the centre pixel the death-sequence luminance budget samples.
      mut.food.x = 16;
      mut.food.y = 4;
      // Clear any queued turns so the next step applies dir (right) verbatim
      // rather than a pending turn that would steer the head off the wall.
      mut.pendingLen = 0;
      mut.dir = 1;
      if (mut.phase !== "playing") mut.phase = "playing";
    }
  },
  deathCause: (): "none" | "wall" | "self" => lastDeathCause,
  replayLog: (text: string, seed: string): string => {
    const byTick = new Map<number, { kind: string; dir: number }[]>();
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      const parts = line.split(",");
      const tick = Number(parts[0]);
      const list = byTick.get(tick) ?? [];
      list.push({ kind: parts[1] ?? "", dir: Number(parts[2] ?? 0) });
      byTick.set(tick, list);
    }
    const s2 = init(seed);
    const k2 = makeSink(64);
    for (let t = 1; t <= 5000; t++) {
      const its = byTick.get(t);
      if (its !== undefined) {
        for (const it of its) {
          const intent: Intent =
            it.kind === "pause"
              ? { kind: "pause" }
              : it.kind === "restart"
                ? { kind: "restart" }
                : { kind: "turn", dir: it.dir as Dir };
          if (intent.kind === "restart") reinit(s2, seed);
          else applyIntent(s2, intent);
        }
      }
      step(s2, k2);
      k2.count = 0;
    }
    return hash(s2);
  }
} satisfies DebugApi;
