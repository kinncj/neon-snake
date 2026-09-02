import {
  type Dir, type EffectSink, type State,
  GRID_W, GRID_H, CELL_COUNT, MAX_PENDING, START_LEN,
  DIR_DX, DIR_DY, DIR_RIGHT,
  EFFECT_TURNED, EFFECT_ATE, EFFECT_GREW, EFFECT_SPAWNED,
  packCell, cellX, cellY, emit
} from "./types";
import { seedFrom, next, rangeOf } from "./rng";

/** Points per food before any level or combo scaling. */
export const FOOD_VALUE = 10;

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
  const nx = cellX(head) + DIR_DX[s.dir]!;
  const ny = cellY(head) + DIR_DY[s.dir]!;
  const eating = nx === s.foodX && ny === s.foodY;

  // Growth keeps the old tail in place: shift one more cell, then extend.
  const shiftLen = eating ? s.bodyLen : s.bodyLen - 1;
  s.body.copyWithin(1, 0, shiftLen);
  s.body[0] = packCell(nx, ny);

  if (eating) {
    s.bodyLen++;
    s.score += FOOD_VALUE;
    s.lastEatTick = s.tick;
    emit(sink, EFFECT_ATE, nx, ny, FOOD_VALUE);
    emit(sink, EFFECT_GREW, nx, ny, s.bodyLen);
    if (spawnFood(s)) emit(sink, EFFECT_SPAWNED, s.foodX, s.foodY);
  }
  return s;
}
