import type { State } from "./types";

const FNV_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a hex over the canonical serialisation of State. Effects are not
 * hashed. The serialisation order is fixed:
 *   tick, dir, pendingLen, pending[0..pendingLen],
 *   bodyLen, body[0..bodyLen] as x,y, food.x, food.y, food.kind,
 *   score, level, combo, lastEatTick, best, phase, rng
 */
export function hash(s: State): string {
  let h = FNV_BASIS;
  const mixStr = (str: string): void => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, FNV_PRIME) >>> 0;
    }
    // field separator, so "1,23" != "12,3"
    h ^= 0x1f;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  };

  mixStr(String(s.tick));
  mixStr(String(s.dir));
  mixStr(String(s.pendingLen));
  for (let i = 0; i < s.pendingLen; i++) mixStr(String(s.pending[i]));
  mixStr(String(s.bodyLen));
  for (let i = 0; i < s.bodyLen; i++) {
    const c = s.body[i]!;
    mixStr(String(c.x));
    mixStr(String(c.y));
  }
  mixStr(String(s.food.x));
  mixStr(String(s.food.y));
  mixStr(s.food.kind);
  mixStr(String(s.score));
  mixStr(String(s.level));
  mixStr(String(s.combo));
  mixStr(String(s.lastEatTick));
  mixStr(String(s.best));
  mixStr(s.phase);
  mixStr(String(s.rng));

  return h.toString(16).padStart(8, "0");
}
