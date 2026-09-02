import { describe, expect, it } from 'vitest'
import { FixedTimestepLoop, MAX_CATCHUP } from '../../app/runtime/loop'

describe('fixed-timestep loop', () => {
  it('the first update banks the clock and runs no tick', () => {
    let ticks = 0
    const loop = new FixedTimestepLoop(120, () => {
      ticks++
    })
    expect(loop.update(0)).toBe(0)
    expect(ticks).toBe(0)
  })

  it('runs one tick per elapsed interval and returns alpha', () => {
    let ticks = 0
    const loop = new FixedTimestepLoop(120, () => {
      ticks++
    })
    loop.update(0)
    expect(loop.update(120)).toBeCloseTo(0)
    expect(ticks).toBe(1)
    expect(loop.update(240)).toBeCloseTo(0)
    expect(ticks).toBe(2)
    const alpha = loop.update(240 + 40) // 40ms into the next tick
    expect(alpha).toBeCloseTo(40 / 120, 5)
    expect(ticks).toBe(2)
  })

  it('catches up multiple ticks but caps at MAX_CATCHUP', () => {
    let ticks = 0
    const loop = new FixedTimestepLoop(120, () => {
      ticks++
    })
    loop.update(0)
    loop.update(1000) // far more than one tick, but clamped to MAX_CATCHUP
    expect(ticks).toBe(MAX_CATCHUP)
  })

  it('never runs more than MAX_CATCHUP ticks on a huge jump', () => {
    let ticks = 0
    const loop = new FixedTimestepLoop(120, () => {
      ticks++
    })
    loop.update(0)
    loop.update(1_000_000)
    expect(ticks).toBe(MAX_CATCHUP)
  })

  it('ignores backwards time (no negative delta)', () => {
    let ticks = 0
    const loop = new FixedTimestepLoop(120, () => {
      ticks++
    })
    loop.update(500)
    loop.update(400) // went backwards
    expect(ticks).toBe(0)
  })
})
