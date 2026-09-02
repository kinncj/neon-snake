// Seeded PRNG: pure functions over a uint32, no allocation, no entropy.

/** FNV-1a 32-bit over the UTF-16 code units of `s`; never returns zero. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h === 0 ? 0x9e3779b9 : h;
}

/** xorshift32: returns the next state (never zero for a non-zero input). */
export function next(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** Maps a state onto [0, n). */
export function rangeOf(state: number, n: number): number {
  return (state >>> 0) % n;
}
