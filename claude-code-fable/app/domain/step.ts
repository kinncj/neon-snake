import {
  type Dir, type EffectSink, type State,
  GRID_W, GRID_H, CELL_COUNT, MAX_PENDING, START_LEN,
  DIR_DX, DIR_DY, DIR_RIGHT,
  EFFECT_TURNED,
  packCell, cellX, cellY, emit
} from "./types";
import { seedFrom } from "./rng";

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
  s.foodX = cx + 6;
  s.foodY = cy;
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

  // Shift the body by index: every cell takes the position of the one ahead.
  s.body.copyWithin(1, 0, s.bodyLen - 1);
  s.body[0] = packCell(nx, ny);
  return s;
}
