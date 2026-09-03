import { describe, expect, it } from 'vitest'
import { DEFAULT_LIFE_MS, PARTICLE_CAP, ParticleSystem } from '../../app/adapters/render/particles'

describe('ParticleSystem.burst', () => {
  it('spawns the requested count and tracks `active`', () => {
    const p = new ParticleSystem()
    const n = p.burst(100, 100, 32)
    expect(n).toBe(32)
    expect(p.active).toBe(32)
  })

  it('a burst at a slot is deterministic (reproducible trajectories)', () => {
    const a = new ParticleSystem()
    const b = new ParticleSystem()
    a.burst(50, 50, 8)
    b.burst(50, 50, 8)
    a.update(40)
    b.update(40)
    const xsA: number[] = []
    const xsB: number[] = []
    a.forEachLive((i) => xsA.push(a.xAt(i)))
    b.forEachLive((i) => xsB.push(b.xAt(i)))
    expect(xsA).toEqual(xsB)
  })

  it('a directional burst (angleCenter=0) launches rightward', () => {
    const p = new ParticleSystem()
    p.burst(100, 100, 16, { angleCenter: 0, angleSpread: 0.3, speed: 200 })
    p.update(20)
    let allRight = true
    p.forEachLive((i) => {
      if (p.xAt(i) < 100) allRight = false
    })
    expect(allRight).toBe(true)
  })

  it('respects a full-circle default spread', () => {
    const p = new ParticleSystem()
    p.burst(128, 120, 24, { speed: 120 })
    p.update(30)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    p.forEachLive((i) => {
      minX = Math.min(minX, p.xAt(i))
      maxX = Math.max(maxX, p.xAt(i))
      minY = Math.min(minY, p.yAt(i))
      maxY = Math.max(maxY, p.yAt(i))
    })
    // Particles should have spread in both axes (a circle, not a line).
    expect(maxX - minX).toBeGreaterThan(0)
    expect(maxY - minY).toBeGreaterThan(0)
  })
})

describe('ParticleSystem.update', () => {
  it('retires particles after their life expires', () => {
    const p = new ParticleSystem()
    p.burst(10, 10, 16, { lifeMs: 100 })
    expect(p.active).toBe(16)
    p.update(100)
    expect(p.active).toBe(0)
  })

  it('alpha decays from 1 toward 0 over life', () => {
    const p = new ParticleSystem()
    p.burst(0, 0, 4, { lifeMs: 100 })
    let slot = -1
    p.forEachLive((i) => (slot = i))
    expect(slot).toBeGreaterThanOrEqual(0)
    const alpha0 = p.alphaAt(slot)
    p.update(50)
    const alphaHalf = p.alphaAt(slot)
    expect(alpha0).toBeCloseTo(1, 5)
    expect(alphaHalf).toBeCloseTo(0.5, 5)
  })

  it('does nothing for a non-positive dt', () => {
    const p = new ParticleSystem()
    p.burst(5, 5, 8, { lifeMs: DEFAULT_LIFE_MS })
    const before = p.active
    p.update(0)
    p.update(-10)
    expect(p.active).toBe(before)
  })
})

describe('ParticleSystem ring eviction', () => {
  it('evicts the oldest when the buffer overflows PARTICLE_CAP', () => {
    const p = new ParticleSystem()
    // Overfill: more particles than capacity.
    p.burst(0, 0, PARTICLE_CAP + 64, { lifeMs: 10_000 })
    // Active can never exceed capacity.
    expect(p.active).toBeLessThanOrEqual(PARTICLE_CAP)
    expect(p.active).toBe(PARTICLE_CAP)
  })

  it('reset clears everything', () => {
    const p = new ParticleSystem()
    p.burst(0, 0, 100)
    expect(p.active).toBe(100)
    p.reset()
    expect(p.active).toBe(0)
  })
})
