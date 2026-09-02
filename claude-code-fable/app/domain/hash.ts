import { type State, cellX, cellY } from "./types";

/**
 * Canonical serialisation of the simulation state: everything that feeds
 * the next tick, nothing that does not (effects are excluded). Two states
 * with equal serialisations evolve identically.
 */
export function serialize(s: State): string {
  let out = "t" + s.tick + "|d" + s.dir + "|p";
  for (let i = 0; i < s.pendingLen; i++) out += s.pending[i];
  out += "|n" + s.bodyLen + "|b";
  for (let i = 0; i < s.bodyLen; i++) {
    const c = s.body[i]!;
    out += cellX(c) + "," + cellY(c) + ";";
  }
  out += "|f" + s.foodX + "," + s.foodY;
  out += "|s" + s.score + "|" + s.phase + "|r" + s.rng;
  out += "|c" + s.combo + "|e" + s.lastEatTick;
  return out;
}

/** FNV-1a 32-bit over `serialize(s)`, as 8 lowercase hex digits. */
export function hash(s: State): string {
  const text = serialize(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
