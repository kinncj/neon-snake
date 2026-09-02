import { describe, expect, it } from 'vitest'
import { next, rangeOf, seedFrom } from '../../app/domain/rng'

describe('rng', () => {
  it('seedFrom is deterministic and non-zero', () => {
    expect(seedFrom('snake-0001')).toBe(seedFrom('snake-0001'))
    expect(seedFrom('snake-0001')).toBeGreaterThan(0)
    expect(seedFrom('a')).not.toBe(seedFrom('b'))
  })

  it('next advances the state and stays a uint32', () => {
    const s0 = seedFrom('x')
    const s1 = next(s0)
    const s2 = next(s1)
    expect(s1).not.toBe(s0)
    expect(s1).toBeGreaterThanOrEqual(0)
    expect(s1).toBeLessThan(2 ** 32)
    expect(s2).not.toBe(s1)
  })

  it('rangeOf always lands in [0, n)', () => {
    let s = seedFrom('y')
    for (let i = 0; i < 1000; i++) {
      s = next(s)
      const v = rangeOf(s, 32)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(32)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('the stream is reproducible from a seed', () => {
    const a: number[] = []
    let s = seedFrom('repro')
    for (let i = 0; i < 16; i++) {
      s = next(s)
      a.push(s)
    }
    const b: number[] = []
    s = seedFrom('repro')
    for (let i = 0; i < 16; i++) {
      s = next(s)
      b.push(s)
    }
    expect(a).toEqual(b)
    // different seed -> different stream
    const c: number[] = []
    s = seedFrom('repro-2')
    for (let i = 0; i < 16; i++) {
      s = next(s)
      c.push(s)
    }
    expect(c).not.toEqual(a)
  })
})
