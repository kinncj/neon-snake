import {
  type Dir, type EffectSink, type Intent, type State,
  GRID_W, GRID_H, CELL_COUNT, MAX_PENDING, START_LEN,
  DIR_DX, DIR_DY, DIR_RIGHT,
  EFFECT_TURNED, EFFECT_ATE, EFFECT_GREW, EFFECT_SPAWNED, EFFECT_DIED, EFFECT_LEVELUP,
  CAUSE_WALL, CAUSE_SELF,
  packCell, cellX, cellY, emit, intentKind
} from "./types";
import { seedFrom, next, rangeOf } from "./rng";
import { enqueue } from "./intents";
import { levelForScore, foodValueForLevel, nextCombo } from "./levels";

/** Rejection-sampling attempts before falling back to a linear scan. */
export const SPAWN_ATTEMPTS = 256;

/** Allocates a fresh state for `seed` (the only allocation the domain makes). */
export function init(seed: string): State {
  const s: State = {
    seed: seedFrom(seed),
    tick: 0,
    dir: DIR_RIGHT,
    pending: new Uint8Array(MAX_PENDING),
    pendingLen: 0,
    body: new Uint16Array(CELL_COUNT),
    bodyLen: 0,
    foodX: 0,
    foodY: 0,
    score: 0,
    phase: "playing",
    rng: 1,
    lastEatTick: -1,
    combo: 1,
    level: 1
  };
  reset(s);
  return s;
}

/** Re-initialises `s` in place from its own seed. No allocation. */
export function reset(s: State): void {
  s.tick = 0;
  s.dir = DIR_RIGHT;
  s.pendingLen = 0;
  s.pending.fill(0);
  s.body.fill(0);
  const cx = GRID_W >> 1;
  const cy = GRID_H >> 1;
  for (let i = 0; i < START_LEN; i++) s.body[i] = packCell(cx - i, cy);
  s.bodyLen = START_LEN;
  s.score = 0;
  s.phase = "playing";
  s.rng = s.seed;
  s.lastEatTick = -1;
  s.combo = 1;
  s.level = 1;
  spawnFood(s);
}

/**
 * Applies a player intent. Turns and pause go through the intent buffer;
 * restart re-initialises in place with the same seed from any phase.
 */
export function apply(s: State, intent: Intent): boolean {
  if (intentKind(intent) === "restart") {
    reset(s);
    return true;
  }
  return enqueue(s, intent);
}

function occupied(s: State, cell: number): boolean {
  for (let i = 0; i < s.bodyLen; i++) if (s.body[i] === cell) return true;
  return false;
}

/**
 * Places the food on an unoccupied cell: rejection-sample with the PRNG up
 * to SPAWN_ATTEMPTS times, then fall back to a deterministic linear scan
 * from the last sampled cell. Returns false when the grid is full.
 */
export function spawnFood(s: State): boolean {
  let cell = 0;
  for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
    s.rng = next(s.rng);
    cell = rangeOf(s.rng, CELL_COUNT);
    if (!occupied(s, cell)) {
      s.foodX = cellX(cell);
      s.foodY = cellY(cell);
      return true;
    }
  }
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = (cell + i) % CELL_COUNT;
    if (!occupied(s, c)) {
      s.foodX = cellX(c);
      s.foodY = cellY(c);
      return true;
    }
  }
  return false;
}

/**
 * Advances the simulation by exactly one tick. Only `playing` states move;
 * `paused` and `gameover` return unchanged and emit nothing.
 */
export function step(s: State, sink: EffectSink): State {
  if (s.phase !== "playing") return s;
  s.tick++;

  // Consume the oldest pending turn.
  if (s.pendingLen > 0) {
    const d = s.pending[0] as Dir;
    s.pending.copyWithin(0, 1, s.pendingLen);
    s.pendingLen--;
    if (d !== s.dir) {
      s.dir = d;
      const head = s.body[0]!;
      emit(sink, EFFECT_TURNED, cellX(head), cellY(head), d);
    }
  }

  const head = s.body[0]!;
  const hx = cellX(head);
  const hy = cellY(head);
  const nx = hx + DIR_DX[s.dir]!;
  const ny = hy + DIR_DY[s.dir]!;

  // Walls are solid: the head stays on its last cell and the run ends.
  if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) {
    s.phase = "gameover";
    emit(sink, EFFECT_DIED, hx, hy, CAUSE_WALL);
    return s;
  }

  const eating = nx === s.foodX && ny === s.foodY;
  const target = packCell(nx, ny);

  // Self collision: the tail cell vacates this tick unless we grow, so it is
  // only an obstacle when eating.
  const lastIdx = eating ? s.bodyLen : s.bodyLen - 1;
  for (let i = 0; i < lastIdx; i++) {
    if (s.body[i] === target) {
      s.phase = "gameover";
      emit(sink, EFFECT_DIED, hx, hy, CAUSE_SELF);
      return s;
    }
  }

  // Growth keeps the old tail in place: shift one more cell, then extend.
  const shiftLen = eating ? s.bodyLen : s.bodyLen - 1;
  s.body.copyWithin(1, 0, shiftLen);
  s.body[0] = target;

  if (eating) {
    s.bodyLen++;
    // Combo: chain eats inside the window; the multiplier applies to this eat.
    s.combo = nextCombo(s.combo, s.lastEatTick < 0 ? -1 : s.tick - s.lastEatTick);
    const points = foodValueForLevel(s.level) * s.combo;
    s.score += points;
    s.lastEatTick = s.tick;
    emit(sink, EFFECT_ATE, nx, ny, points);
    emit(sink, EFFECT_GREW, nx, ny, s.bodyLen);
    if (spawnFood(s)) emit(sink, EFFECT_SPAWNED, s.foodX, s.foodY);
  }

  // Progression is re-derived from the score every tick (tier-independent).
  const level = levelForScore(s.score);
  if (level !== s.level) {
    s.level = level;
    emit(sink, EFFECT_LEVELUP, nx, ny, level);
  }
  return s;
}
