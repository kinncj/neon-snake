// Test support: build a valid preallocated State directly.
//
// init() is the domain's only public constructor and it consumes the RNG,
// so tests that isolate one rule assemble the record by hand. The shape
// must match State exactly (fixed-length body/pending, head at body[0]).
import { BODY_CAP } from "../../../app/domain/types";
import type { Cell, Dir, FoodKind, State } from "../../../app/domain/types";

interface MutView {
  bodyLen: number;
  body: { x: number; y: number }[];
  food: { x: number; y: number; kind: FoodKind };
}

/**
 * Mutable view of the whole State record for test-only direct mutation. Used
 * to cast `init()`/`reinit()` results so a test can place the head, steer, and
 * seed score/level/combo the RNG would not arrange. Structurally mirrors
 * State with non-readonly fields and mutable body/food.
 */
export interface MutStateLike {
  tick: number;
  dir: Dir;
  pendingLen: number;
  pending: Dir[];
  bodyLen: number;
  body: { x: number; y: number }[];
  food: { x: number; y: number; kind: FoodKind };
  score: number;
  level: number;
  combo: number;
  lastEatTick: number;
  best: number;
  phase: State["phase"];
  rng: number;
}

/** Mutable mirror of the top-level scalar fields of State. */
export interface MutStateShape {
  tick: number;
  dir: Dir;
  pendingLen: number;
  pending: Dir[];
  bodyLen: number;
  food: { x: number; y: number; kind: FoodKind };
  score: number;
  level: number;
  combo: number;
  lastEatTick: number;
  best: number;
  phase: State["phase"];
  rng: number;
}

/** Overwrite scalar fields of a State record (test-only). */
export function patch(s: State, fields: Partial<MutStateShape>): void {
  Object.assign(s as unknown as MutStateShape, fields);
}

export function makeState(overrides: Partial<State> = {}): State {
  const body: Cell[] = [];
  for (let i = 0; i < BODY_CAP; i++) body.push({ x: 0, y: 0 });
  return {
    tick: 0,
    dir: 1,
    pendingLen: 0,
    pending: [1, 1],
    bodyLen: 3,
    body,
    food: { x: 5, y: 5, kind: "apple" },
    score: 0,
    level: 1,
    combo: 0,
    lastEatTick: 0,
    best: 0,
    phase: "playing",
    rng: 0x12345678,
    ...overrides
  };
}

/** Lay the snake (head first) over the given cells. */
export function placeBody(s: State, cells: Array<[number, number]>): void {
  const m = s as unknown as MutView;
  m.bodyLen = cells.length;
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i]!;
    m.body[i]!.x = p[0];
    m.body[i]!.y = p[1];
  }
}

export function setFood(
  s: State,
  x: number,
  y: number,
  kind: FoodKind = "apple"
): void {
  const m = s as unknown as MutView;
  m.food.x = x;
  m.food.y = y;
  m.food.kind = kind;
}
