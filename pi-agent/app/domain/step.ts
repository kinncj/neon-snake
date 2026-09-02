import { enqueue } from "./intents";
import {
  COMBO_WINDOW_TICKS,
  foodKindForLevel,
  foodValueForKind,
  levelForScore,
  MAX_COMBO
} from "./levels";
import { next, rangeOf, seedFrom } from "./rng";
import { GRID_H, GRID_W } from "./types";
import type {
  Cause,
  Cell,
  Dir,
  Effect,
  EffectKind,
  EffectSink,
  FoodKind,
  Intent,
  State
} from "./types";

/**
 * Long-lived simulation core. State is a single preallocated record that is
 * mutated in place; every public function returns the same reference.
 *
 * Progression (phase 2): level is re-derived from score every tick; eating
 * advances the combo multiplier, which scales the fruit's base value. Death
 * effects carry their cause ("wall" | "self") so the presentation layer can
 * react differently without the domain knowing why.
 */
type MutCell = { x: number; y: number };
type MutFood = { x: number; y: number; kind: FoodKind };
type MutEffect = { kind: EffectKind; x: number; y: number; cause: Cause };

/** Explicit mutable view of the long-lived State record. */
interface MutState {
  tick: number;
  dir: Dir;
  pendingLen: number;
  pending: Dir[];
  bodyLen: number;
  body: Cell[];
  food: MutFood;
  score: number;
  level: number;
  combo: number;
  lastEatTick: number;
  best: number;
  phase: State["phase"];
  rng: number;
}

const DX: readonly number[] = [0, 1, 0, -1];
const DY: readonly number[] = [-1, 0, 1, 0];

const TOTAL_CELLS = GRID_W * GRID_H;
const SPAWN_ATTEMPTS = 256;
const START_LEVEL = 1;

function setCell(arr: readonly Cell[], i: number, x: number, y: number): void {
  const c = arr[i] as MutCell;
  c.x = x;
  c.y = y;
}

function occupied(m: MutState, idx: number): boolean {
  const x = idx % GRID_W;
  const y = Math.floor(idx / GRID_W);
  for (let i = 0; i < m.bodyLen; i++) {
    const c = m.body[i] as MutCell;
    if (c.x === x && c.y === y) return true;
  }
  return false;
}

/**
 * Rejection-sample a free cell with rangeOf; after 256 misses fall back to a
 * deterministic linear scan starting at the last sampled index. The spawned
 * fruit's kind is fixed by the current level, not the RNG, so the fruit mix
 * is a deterministic function of progression.
 */
function spawnFood(m: MutState): void {
  let idx = 0;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    m.rng = next(m.rng);
    idx = rangeOf(m.rng, TOTAL_CELLS);
    if (!occupied(m, idx)) break;
  }
  for (let i = 0; i < TOTAL_CELLS; i++) {
    const j = (idx + i) % TOTAL_CELLS;
    if (!occupied(m, j)) {
      idx = j;
      break;
    }
  }
  if (occupied(m, idx)) {
    // Grid full: terminal win.
    m.phase = "gameover";
  }
  m.food.x = idx % GRID_W;
  m.food.y = Math.floor(idx / GRID_W);
  m.food.kind = foodKindForLevel(m.level);
}

function resetBody(m: MutState): void {
  m.bodyLen = 3;
  const hx = GRID_W >> 1;
  const hy = GRID_H >> 1;
  for (let i = 0; i < m.body.length; i++) setCell(m.body, i, 0, 0);
  setCell(m.body, 0, hx, hy);
  setCell(m.body, 1, hx - 1, hy);
  setCell(m.body, 2, hx - 2, hy);
}

/** Reset progression bookkeeping (best is deliberately kept across games). */
function resetProgression(m: MutState): void {
  m.level = START_LEVEL;
  m.combo = 0;
  m.lastEatTick = 0;
}

export function init(seed: string): State {
  const m = {
    tick: 0,
    dir: 1 as Dir,
    pendingLen: 0,
    pending: [] as Dir[],
    bodyLen: 3,
    body: [] as Cell[],
    food: { x: 0, y: 0, kind: "apple" as FoodKind },
    score: 0,
    level: START_LEVEL,
    combo: 0,
    lastEatTick: 0,
    best: 0,
    phase: "playing" as State["phase"],
    rng: seedFrom(seed)
  };
  for (let i = 0; i < TOTAL_CELLS; i++) m.body.push({ x: 0, y: 0 });
  m.pending.push(1, 1);
  resetBody(m);
  spawnFood(m);
  return m;
}

/** Preallocated effect sink; effect slots are reused, never reallocated. */
export function makeSink(capacity: number): EffectSink {
  const items: Effect[] = [];
  for (let i = 0; i < capacity; i++)
    items.push({ kind: "spawned", x: 0, y: 0, cause: "none" });
  return { items, count: 0 };
}

function emit(
  sink: EffectSink,
  kind: EffectKind,
  x: number,
  y: number,
  cause: Cause = "none"
): void {
  if (sink.count >= sink.items.length) return;
  const e = sink.items[sink.count] as MutEffect;
  e.kind = kind;
  e.x = x;
  e.y = y;
  e.cause = cause;
  sink.count++;
}

function die(m: MutState, sink: EffectSink, cause: Cause): void {
  m.phase = "gameover";
  m.best = m.score > m.best ? m.score : m.best;
  const head = m.body[0] as MutCell;
  emit(sink, "died", head.x, head.y, cause);
}

/**
 * One fixed tick. No-op while paused or gameover (returns the state, emits
 * nothing). Mutates in place and returns the same reference.
 */
export function step(s: State, sink: EffectSink): State {
  const m = s as MutState;
  if (m.phase !== "playing") return s;
  m.tick++;

  if (m.pendingLen > 0) {
    m.dir = m.pending[0]!;
    m.pending[0] = m.pending[1]!;
    m.pendingLen--;
    const head = m.body[0] as MutCell;
    emit(sink, "turned", head.x, head.y);
  }

  const head = m.body[0] as MutCell;
  const nx = head.x + DX[m.dir]!;
  const ny = head.y + DY[m.dir]!;

  // Walls are solid.
  if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) {
    die(m, sink, "wall");
    return s;
  }

  const ate = nx === m.food.x && ny === m.food.y;

  // Self collision. The tail cell is vacated this tick unless the snake grew.
  const last = ate ? m.bodyLen : m.bodyLen - 1;
  for (let i = 1; i < last; i++) {
    const c = m.body[i] as MutCell;
    if (c.x === nx && c.y === ny) {
      die(m, sink, "self");
      return s;
    }
  }

  // Shift body cells by index; no allocation. Growth skips the tail shift.
  const upper = ate ? m.bodyLen : m.bodyLen - 1;
  for (let i = upper; i > 0; i--) {
    const src = m.body[i - 1] as MutCell;
    const dst = m.body[i] as MutCell;
    dst.x = src.x;
    dst.y = src.y;
  }
  setCell(m.body, 0, nx, ny);

  if (ate) {
    // Combo: quick successive eats raise the multiplier (capped); a gap
    // longer than the window drops it back to 1.
    const inWindow =
      m.combo > 0 && m.tick - m.lastEatTick <= COMBO_WINDOW_TICKS;
    m.combo = inWindow ? Math.min(m.combo + 1, MAX_COMBO) : 1;
    m.lastEatTick = m.tick;

    const gained = foodValueForKind(m.food.kind) * m.combo;
    m.score += gained;
    m.best = m.score > m.best ? m.score : m.best;
    m.bodyLen++;

    const newLevel = levelForScore(m.score);
    if (newLevel > m.level) {
      m.level = newLevel;
      emit(sink, "levelup", nx, ny);
    }

    emit(sink, "ate", m.food.x, m.food.y, "none");
    emit(sink, "grew", m.food.x, m.food.y, "none");
    spawnFood(m);
    emit(sink, "spawned", m.food.x, m.food.y, "none");
  }
  return s;
}

/**
 * Seed the best score from persistence (adapter calls this at boot). The
 * domain owns the value; the storage layer owns where it comes from.
 */
export function setBest(s: State, best: number): State {
  (s as MutState).best = best;
  return s;
}

/** Turn intents buffer; pause toggles playing/paused. No-op in gameover. */
export function applyIntent(s: State, intent: Intent): State {
  const m = s as MutState;
  if (m.phase === "gameover") return s;
  if (intent.kind === "turn") return enqueue(s, intent);
  if (intent.kind === "pause") {
    if (m.phase === "playing") m.phase = "paused";
    else if (m.phase === "paused") m.phase = "playing";
    return s;
  }
  return s;
}

/** In-place restart with the same seed. Best score is kept. */
export function reinit(s: State, seed: string): State {
  const m = s as MutState;
  m.tick = 0;
  m.dir = 1;
  m.pendingLen = 0;
  m.pending[0] = 1;
  m.pending[1] = 1;
  m.score = 0;
  m.phase = "playing";
  m.rng = seedFrom(seed);
  resetProgression(m);
  resetBody(m);
  spawnFood(m);
  return s;
}
