import { describe, expect, it } from 'vitest'
import { enqueueTurn } from '../../app/domain/intents'
import { init, step } from '../../app/domain/step'
import { createSink } from '../../app/domain/types'

// Move food off the test path so a single step never accidentally eats.
function parkFood(s: ReturnType<typeof init>): void {
  s.foodX = 0
  s.foodY = 0
}

describe('movement', () => {
  it('the head advances one cell in the heading each tick', () => {
    const s = init('m')
    parkFood(s)
    const hx = s.bodyX[0]!
    const hy = s.bodyY[0]!
    step(s, createSink())
    expect(s.bodyX[0]).toBe(hx + 1) // dir = 1 (right)
    expect(s.bodyY[0]).toBe(hy)
    expect(s.tick).toBe(1)
  })

  it('the body follows the head with length preserved', () => {
    const s = init('m2')
    parkFood(s)
    const lenBefore = s.bodyLen
    step(s, createSink())
    expect(s.bodyLen).toBe(lenBefore)
    // the neck now sits on the previous head cell
    expect(s.bodyX[1]).toBe(16)
    expect(s.bodyY[1]).toBe(15)
  })

  it('a buffered turn applies on the next tick', () => {
    const s = init('m3')
    parkFood(s)
    enqueueTurn(s, 0) // up
    step(s, createSink())
    expect(s.dir).toBe(0)
    expect(s.bodyX[0]).toBe(16) // x unchanged moving up
    expect(s.bodyY[0]).toBe(14) // y-1
    expect(s.pendingLen).toBe(0)
  })

  it('a paused simulation advances nothing', () => {
    const s = init('m4')
    parkFood(s)
    const before = s.tick
    s.phase = 'paused'
    step(s, createSink())
    expect(s.tick).toBe(before)
    expect(s.bodyX[0]).toBe(16)
  })
})
