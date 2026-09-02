/**
 * Mutable view of a State for tests. init()/reinit() return the readonly
 * State interface, but every test that needs to rig a position casts the
 * returned reference to MutStateLike and writes through it (tests only —
 * the production code path only ever mutates via step.ts's MutState).
 */
import type { Dir, FoodKind, Phase } from "../../../app/domain/types";

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
  phase: Phase;
  rng: number;
}
