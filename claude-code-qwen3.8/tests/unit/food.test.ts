import { describe, expect, it } from 'vitest'
import { init, step } from '../../app/domain/step'
import { createSink, GRID_W } from '../../app/domain/types'

// Put food directly in front of the head so the next step eats it.
function aimAtHead(s: ReturnType<typeof init>): void {
  const hx = s.bodyX[0]!
  const hy = s.bodyY[0]!
  const dx = [0, 1, 0, -1][s.dir]!
  const dy = [-1, 0, 1, 0][s.dir]!
  s.foodX = hx + dx
  s.foodY = hy + dy
}

describe('food / growth / score', () => {
  it('eating grows the snake and raises the score', () => {
    const s = init('f')
    const lenBefore = s.bodyLen
    aimAtHead(s)
    const sink = createSink()
    step(s, sink)
    expect(s.bodyLen).toBe(lenBefore + 1)
    expect(s.score).toBeGreaterThan(0)
    const kinds = sink.buf.slice(0, sink.len).map((e) => e.kind)
    expect(kinds).toContain('ate')
    expect(kinds).toContain('grew')
  })

  it('eating respawns food onto a free cell', () => {
    const s = init('f2')
    aimAtHead(s)
    step(s, createSink())
    expect(s.foodX).toBeGreaterThanOrEqual(0)
    expect(s.foodX).toBeLessThan(GRID_W)
    expect(s.foodY).toBeGreaterThanOrEqual(0)
    // the new food is not sitting on a body cell
    expect(s.occ[s.foodY * GRID_W + s.foodX]).toBe(0)
  })

  it('combo multiplies the score when eating within the window', () => {
    const s = init('f3')
    const sink = createSink()
    // first eat (combo 1 -> 10 pts)
    aimAtHead(s)
    const v1 = s.score
    step(s, sink)
    expect(s.score - v1).toBe(10)
    expect(s.combo).toBe(1)
    // second eat one tick later (within the 6-tick window -> combo 2 -> 20 pts)
    aimAtHead(s)
    const v2 = s.score
    step(s, sink)
    expect(s.score - v2).toBe(20)
    expect(s.combo).toBe(2)
  })

  it('the combo window resets when the gap exceeds 6 ticks', () => {
    const s = init('f4')
    const sink = createSink()
    aimAtHead(s)
    step(s, sink) // eat #1
    // let 7 empty ticks pass (food parked far away)
    s.foodX = 0
    s.foodY = 0
    for (let i = 0; i < 7; i++) step(s, sink)
    // eat #2 is now 8 ticks after #1 -> combo resets to 1
    aimAtHead(s)
    const v = s.score
    step(s, sink)
    expect(s.combo).toBe(1)
    expect(s.score - v).toBe(10)
  })
})
