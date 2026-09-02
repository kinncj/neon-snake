import { describe, expect, it } from 'vitest'
import { hash } from '../../app/domain/hash'
import { init, step } from '../../app/domain/step'
import { createSink, GRID_W, type Effect, type EffectSink } from '../../app/domain/types'

function findDied(sink: EffectSink): Effect | null {
  return sink.buf.slice(0, sink.len).find((e) => e.kind === 'died') ?? null
}

describe('collision', () => {
  it('dies on a wall with cause "wall"', () => {
    const s = init('w')
    // put the head on the right wall edge, heading right
    for (let i = 0; i < 3; i++) {
      s.bodyX[i] = GRID_W - 1 - i
      s.bodyY[i] = 15
    }
    s.bodyLen = 3
    s.dir = 1
    s.foodX = 0
    s.foodY = 0
    const sink = createSink()
    step(s, sink)
    expect(s.phase).toBe('gameover')
    const died = findDied(sink)
    expect(died).toBeTruthy()
    expect(died!.cause).toBe('wall')
  })

  it('dies on a self-bite with cause "self"', () => {
    const s = init('s')
    // a compact 5-cell snake where moving down runs into the body
    const cells: Array<[number, number]> = [
      [10, 10],
      [9, 10],
      [9, 11],
      [10, 11],
      [11, 11],
    ]
    for (let i = 0; i < cells.length; i++) {
      s.bodyX[i] = cells[i]![0]
      s.bodyY[i] = cells[i]![1]
    }
    s.bodyLen = cells.length
    s.dir = 2 // down: (10,10) -> (10,11), a body cell
    s.foodX = 0
    s.foodY = 0
    const sink = createSink()
    step(s, sink)
    expect(s.phase).toBe('gameover')
    const died = findDied(sink)
    expect(died).toBeTruthy()
    expect(died!.cause).toBe('self')
  })

  it('a gameover simulation advances nothing and emits nothing', () => {
    const s = init('g')
    s.phase = 'gameover'
    const before = hash(s)
    const sink = createSink()
    step(s, sink)
    expect(sink.len).toBe(0)
    expect(hash(s)).toBe(before)
    expect(s.phase).toBe('gameover')
  })

  it('restart re-inits from the same seed reproducibly', () => {
    const s = init('r')
    for (let i = 0; i < 5; i++) step(s, createSink())
    const fresh = init('r')
    expect(fresh.tick).toBe(0)
    expect(fresh.score).toBe(0)
    const fresh2 = init('r')
    expect(hash(fresh)).toBe(hash(fresh2))
  })
})
