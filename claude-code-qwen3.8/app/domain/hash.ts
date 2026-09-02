// Canonical state hash. FNV-1a (32-bit) over a fixed serialisation of the
// simulation state — tick, dir, pending queue, bodyLen, body (x,y pairs), food,
// score, phase, rng. Derived/auxiliary fields (level, combo, lastEatTick,
// highScore, seed) are excluded because they are a pure function of the
// included fields. Effects are excluded (the sink is reset each frame). The
// result is deterministic across instances, runs, and quality tiers.
import type { SnakeState } from './types'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function phaseCode(p: SnakeState['phase']): number {
  return p === 'playing' ? 0 : p === 'paused' ? 1 : 2
}

export function hash(s: SnakeState): string {
  let h = FNV_OFFSET
  const feed32 = (n: number): void => {
    for (let b = 0; b < 4; b++) {
      h ^= (n >>> (8 * b)) & 0xff
      h = Math.imul(h, FNV_PRIME)
    }
  }
  const feed1 = (n: number): void => {
    h ^= n & 0xff
    h = Math.imul(h, FNV_PRIME)
  }

  feed32(s.tick)
  feed1(s.dir)
  feed1(s.pendingLen)
  for (let i = 0; i < s.pendingLen; i++) feed1(s.pendingDir[i] ?? 0)
  feed32(s.bodyLen)
  for (let i = 0; i < s.bodyLen; i++) {
    feed32(s.bodyX[i] ?? 0)
    feed32(s.bodyY[i] ?? 0)
  }
  feed32(s.foodX)
  feed32(s.foodY)
  feed32(s.score)
  feed1(phaseCode(s.phase))
  feed32(s.rng)
  return (h >>> 0).toString(16).padStart(8, '0')
}
