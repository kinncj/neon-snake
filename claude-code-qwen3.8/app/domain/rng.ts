// Seeded PRNG. Pure functions on a uint32 with no allocation, so the whole
// simulation is reproducible from a seed. `seedFrom` hashes a string seed to a
// non-zero uint32 (FNV-1a); `next` advances the xorshift32 state; `rangeOf`
// maps a state to an integer in [0, n).

export function seedFrom(seed: string): number {
  let h = 0x811c9dc5 // FNV-1a 32-bit offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV-1a prime
  }
  const r = h >>> 0
  return r === 0 ? 0x9e3779b9 : r // xorshift32's 0 is a fixed point; keep non-zero
}

/** Advance the xorshift32 state and return the new (non-zero) state. */
export function next(state: number): number {
  let x = state >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

/** Integer in [0, n) derived from a state. */
export function rangeOf(state: number, n: number): number {
  return (state >>> 0) % n
}
