import "./style.css";
import { init, step, apply } from "./domain/step";
import { hash } from "./domain/hash";
import { parseLog, replay } from "./domain/replay";
import {
  type State, createSink, resetSink, effectAt, packCell, cellX, cellY,
  EFFECT_ATE, EFFECT_DIED, EFFECT_LEVELUP, GRID_W, GRID_H, CELL_PX, CAUSE_WALL, intentKind
} from "./domain/types";
import { tickMsForLevel, foodForLevel } from "./domain/levels";
import { createLoop } from "./runtime/loop";
import { type Tier, createGovernor, probeCapabilities, tierForCapabilities, prefersReducedMotion } from "./runtime/quality";
import { createFramebuffer, type FruitKind } from "./adapters/render/framebuffer";
import { createThemeState, updateTheme, settled as themeSettled } from "./adapters/render/theme";
import { createIntentQueue } from "./adapters/input/queue";
import { attachKeyboard } from "./adapters/input/keyboard";
import { createGamepadPoller } from "./adapters/input/gamepad";
import { attachTouch, createDpad } from "./adapters/input/touch";
import { type FxLayer, createPhaserFx } from "./adapters/render/phaser/phaser-fx";
import { createAudio } from "./adapters/audio/synth";
import { createHighScore } from "./adapters/storage/highscore";
import { type Locale, detectLocale, setLocale, getLocale, bindDom } from "./adapters/i18n";
import { createHud } from "./adapters/ui/hud";
import { type UiMode, createOverlays } from "./adapters/ui/overlays";

// Locale: `?lang=` wins, then the browser's languages, then English.
setLocale(detectLocale(new URLSearchParams(window.location.search).get("lang"), navigator.languages ?? [navigator.language]));

const display = document.getElementById("display") as HTMLCanvasElement;
const fxCanvas = document.getElementById("fx") as HTMLCanvasElement;
const state = init("snake-0001");
const sink = createSink();
const fb = createFramebuffer();
let fruit: FruitKind = foodForLevel(state.level);
let firstTickAt = -1;
// Presentation owns colour: one live palette re-tinted from the level.
const theme = createThemeState(state.level);
let lastAccent = "";

// Quality: probe once, then let the governor move the tier at runtime.
const caps = probeCapabilities(document, navigator);
const governor = createGovernor(tierForCapabilities(caps));
governor.setForcedReduced(prefersReducedMotion(window));

// Input: every adapter pushes into one queue; the loop drains it per frame.
const queue = createIntentQueue();
attachKeyboard(window, queue);
const gamepad = createGamepadPoller(navigator, queue);
attachTouch(display, queue);
const dpad = createDpad(queue);
document.body.appendChild(dpad.root);
bindDom(document);

// Audio: the engine (and its AudioContext) is created on the first gesture.
let storage: Storage | null = null;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}
const audio = createAudio({ storage });
const highscore = createHighScore(storage);
const muteBtn = document.getElementById("mute") as HTMLButtonElement;
function reflectMute(): void {
  muteBtn.setAttribute("aria-pressed", audio.muted() ? "true" : "false");
  muteBtn.textContent = audio.muted() ? "\u266a\u0338" : "\u266a";
}
function toggleMute(): void {
  audio.setMuted(!audio.muted());
  reflectMute();
}
muteBtn.addEventListener("click", () => {
  toggleMute();
  muteBtn.blur();
});
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !e.repeat) toggleMute();
});
reflectMute();
const firstGesture = (): void => {
  void audio.enable();
  window.removeEventListener("keydown", firstGesture);
  window.removeEventListener("pointerdown", firstGesture);
  window.removeEventListener("touchstart", firstGesture);
};
window.addEventListener("keydown", firstGesture);
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("touchstart", firstGesture, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") audio.suspend();
  else audio.resume();
});

// UI: the title screen holds the simulation until the first move.
const hud = createHud(document.getElementById("hud") as HTMLElement);
const overlays = createOverlays(document.getElementById("overlay") as HTMLElement);
overlays.setTouch(window.matchMedia("(pointer: coarse)").matches);
let started = false;
let lastCause: "wall" | "self" | null = null;
let newBest = false;

function uiMode(): UiMode {
  if (!started) return "title";
  if (state.phase === "paused") return "paused";
  if (state.phase === "gameover") return "gameover";
  return "playing";
}

function syncUi(): void {
  const mode = uiMode();
  if (mode !== overlays.mode()) {
    overlays.setMode(mode, mode === "gameover" ? { score: state.score, best: highscore.get(), newBest, cause: lastCause } : undefined);
  }
  hud.update(state, highscore.get());
}

function drainIntents(): void {
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    const kind = intentKind(i);
    if (!started) {
      // Any turn or restart starts the run; pause is meaningless on the title.
      if (kind === "pause") continue;
      started = true;
      loop.resetAccumulator();
    }
    if (kind === "restart") {
      lastCause = null;
      newBest = false;
    }
    apply(state, i);
  }
}

// The engine layer is created lazily the first time a tier needs it and is
// put to sleep (ticker paused, canvas hidden) whenever the tier drops.
let fx: FxLayer | null = null;
let fxLoading = false;
let fxFailed = false;
let appliedTier: Tier | "" = "";

function wantsEngine(t: Tier): boolean {
  return t === "high" || t === "ultra";
}

function ensureFx(): void {
  if (fx || fxLoading || fxFailed || !caps.webgl2) return;
  fxLoading = true;
  createPhaserFx(fxCanvas, fb.fit)
    .then((layer) => {
      fx = layer;
      fxLoading = false;
      appliedTier = "";
    })
    .catch(() => {
      fxFailed = true;
      fxLoading = false;
      governor.pin("low");
    });
}

function syncTier(): void {
  const t = governor.tier();
  if (wantsEngine(t)) ensureFx();
  if (t === appliedTier) return;
  appliedTier = t;
  if (fx) fx.setTier(t);
}

function resize(): void {
  fb.resize(display, window.devicePixelRatio || 1);
  if (fx) fx.resize(fb.fit);
}
window.addEventListener("resize", resize);
resize();

function dispatchEffects(): void {
  for (let i = 0; i < sink.len; i++) {
    const slot = effectAt(sink, i);
    const kind = sink.kind[slot]!;
    if (fx && (kind === EFFECT_ATE || kind === EFFECT_DIED || kind === EFFECT_LEVELUP)) {
      fx.onEffect(kind, sink.x[slot]!, sink.y[slot]!, sink.arg[slot]!, state);
    }
    audio.onEffect(kind, sink.arg[slot]!, state.combo);
    if (kind === EFFECT_ATE) hud.popup(sink.arg[slot]!, sink.x[slot]!, sink.y[slot]!, fb.fit, window.devicePixelRatio || 1);
    if (kind === EFFECT_LEVELUP) hud.banner(sink.arg[slot]!);
    if (kind === EFFECT_DIED) {
      lastCause = sink.arg[slot] === CAUSE_WALL ? "wall" : "self";
      newBest = highscore.submit(state.score);
    }
  }
}

const frameTimes = new Float32Array(600);
const frameWork = new Float32Array(600);
let frameCursor = 0;
let frameCount = 0;

const loop = createLoop({
  tickMs: () => tickMsForLevel(state.level),
  onTick() {
    if (!started) return;
    resetSink(sink);
    step(state, sink);
    if (firstTickAt < 0 && state.tick >= 1) firstTickAt = performance.now();
    fruit = foodForLevel(state.level);
    dispatchEffects();
  },
  onFrame(alpha, frameMs) {
    const t0 = performance.now();
    governor.sample(frameMs);
    syncTier();
    gamepad.poll();
    drainIntents();
    syncUi();
    const palette = updateTheme(theme, state.level, frameMs);
    if (palette.accent !== lastAccent) {
      lastAccent = palette.accent;
      hud.setAccent(palette.accent);
      document.documentElement.style.setProperty("--accent", palette.accent);
    }
    fb.draw(state, alpha, palette, { fruit, grid: true });
    fb.composite(display, "#000000");
    if (fx) fx.render(state, alpha, palette, fruit);
    frameTimes[frameCursor] = frameMs;
    frameWork[frameCursor] = performance.now() - t0;
    frameCursor = (frameCursor + 1) % frameTimes.length;
    frameCount++;
  }
});
loop.start();

/**
 * Places the whole snake against the right wall, heading into it, with the
 * food parked above the centre row and no turns queued, so the very next
 * tick is a wall death. Tests use it to get a deterministic death.
 */
function forceDeath(cause: "wall" | "self" = "wall"): void {
  const cy = GRID_H >> 1;
  state.pendingLen = 0;
  state.phase = "playing";
  if (cause === "wall") {
    state.dir = 0;
    for (let i = 0; i < state.bodyLen; i++) state.body[i] = packCell(GRID_W - 1 - i, cy);
  } else {
    // A hook: heading up from (hx, cy) into (hx, cy-1), which is body[3].
    const hx = GRID_W >> 1;
    state.dir = 3;
    state.bodyLen = Math.max(state.bodyLen, 5);
    const hook = [[hx, cy], [hx - 1, cy], [hx - 1, cy - 1], [hx, cy - 1], [hx + 1, cy - 1]];
    for (let i = 0; i < state.bodyLen; i++) {
      const j = Math.min(i, hook.length - 1);
      const extra = i - j; // beyond the hook, trail off to the right along the row above
      state.body[i] = packCell(Math.min(GRID_W - 1, hook[j]![0]! + extra), hook[j]![1]!);
    }
  }
  state.foodX = GRID_W >> 1;
  state.foodY = cy - 4;
  loop.resetAccumulator();
}

/** Parks the food directly ahead of the head so the next tick is an eat. */
function foodAhead(): void {
  const h = state.body[0]!;
  const x = cellX(h) + [1, 0, -1, 0][state.dir]!;
  const y = cellY(h) + [0, 1, 0, -1][state.dir]!;
  if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) {
    state.foodX = x;
    state.foodY = y;
  }
}

/** Debug surface for the e2e suite; read-only unless a method says otherwise. */
const debug = {
  hash: () => hash(state),
  state: () => ({
    tick: state.tick,
    dir: state.dir,
    phase: state.phase,
    score: state.score,
    bodyLen: state.bodyLen,
    head: [cellX(state.body[0]!), cellY(state.body[0]!)],
    food: [state.foodX, state.foodY],
    level: state.level
  }),
  fit: () => ({ ...fb.fit }),
  /** Stops the loop (simulation and rendering) so a test can read a stable frame. */
  freeze: () => loop.stop(),
  unfreeze: () => loop.start(),
  forceDeath,
  foodAhead,
  tier: () => governor.tier(),
  autoTier: () => governor.autoTier(),
  setTier: (t: Tier | null) => {
    governor.pin(t);
    syncTier();
  },
  caps: () => ({ ...caps }),
  fx: () => ({
    present: fx !== null,
    loading: fxLoading,
    failed: fxFailed,
    alive: fx ? fx.alive() : false,
    frames: fx ? fx.frames() : 0,
    drawCount: fx ? fx.drawCount() : 0,
    bloom: fx ? fx.bloom() : 0
  }),
  loseContext: () => fx?.loseContext(),
  audio: () => ({
    enabled: audio.enabled(),
    contextCreated: audio.contextCreated(),
    contextState: audio.contextState(),
    muted: audio.muted(),
    lastSfx: audio.lastSfx(),
    voiceSum: audio.voiceSum()
  }),
  setDpad: (v: boolean) => dpad.setVisible(v),
  dpadVisible: () => dpad.isVisible(),
  /** RGBA of the display canvas (the 2D composite) at a backing-store pixel. */
  sample(x: number, y: number): number[] {
    const ctx = display.getContext("2d");
    if (!ctx) return [0, 0, 0, 0];
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]!];
  },
  /** RGBA of the 256x240 framebuffer (the 2D ground truth before scaling). */
  fbSample: (x: number, y: number): number[] => fb.pixel(x, y),
  /** RGBA of the engine canvas at a backing-store pixel (1x1 drawImage readback). */
  glSample: (x: number, y: number): number[] => (fx ? fx.sample(x, y) : [0, 0, 0, 0]),
  /** Grid cell of body segment i (0 = head). */
  bodyCell: (i: number) => [cellX(state.body[i]!), cellY(state.body[i]!)],
  /** Backing-store pixel at the centre of a grid cell. */
  cellPixel: (x: number, y: number) => [
    fb.fit.dx + Math.floor((x + 0.5) * CELL_PX * fb.fit.scale),
    fb.fit.dy + Math.floor((y + 0.5) * CELL_PX * fb.fit.scale)
  ],
  /** Replays an input log on a fresh engine and returns the hash. */
  replay: (logText: string, ticks: number, seed = "snake-0001") => replay(seed, parseLog(logText), ticks),
  frameTimes: () => Array.from(frameTimes.subarray(0, Math.min(frameCount, frameTimes.length))),
  /** Per-frame CPU work of the loop body (tick + draw + composite), ms. */
  frameWork: () => Array.from(frameWork.subarray(0, Math.min(frameCount, frameWork.length))),
  highscore: () => highscore.get(),
  locale: () => getLocale(),
  setLocale: (l: Locale) => setLocale(l),
  frameCount: () => frameCount,
  /** ms from navigation start to the first simulation tick (after start()). */
  tti: () => firstTickAt,
  /** Leaves the title screen without turning (tests). */
  start: () => {
    if (!started) {
      started = true;
      loop.resetAccumulator();
    }
  },
  uiMode,
  /** Adds points directly (tests): progression re-derives on the next tick. */
  addScore: (n: number) => {
    state.score += n;
  },
  combo: () => state.combo,
  palette: () => ({ ...theme.palette }),
  theme: () => ({ name: theme.current.name, settled: themeSettled(theme), ...theme.palette }),
  build: typeof __SNAKE_BUILD__ === "string" ? __SNAKE_BUILD__ : "dev"
};
(window as unknown as { __snake: typeof debug }).__snake = debug;
export type { State };
