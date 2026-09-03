import { describe, expect, it } from 'vitest'
import { init, step } from '../../app/domain/step'
import { createSink, type SnakeState } from '../../app/domain/types'

// Levels / combo / death-cause progression (step 17). These drive the *real*
// `step()` (not just the `levels.ts` helpers) to lock in the integration
// behaviour: the level is re-derived from score every tick (tier-independent),
// a threshold cross emits exactly one `levelup`, and the combo multiplies the
// per-level food value and is capped at MAX_COMBO.

/** Put food directly in front of the head so the next step eats it. */
function aimAtHead(s: SnakeState): void {
  const dx = [0, 1, 0, -1][s.dir]!
  const dy = [-1, 0, 1, 0][s.dir]!
  s.foodX = (s.bodyX[0] ?? 0) + dx
  s.foodY = (s.bodyY[0] ?? 0) + dy
}

/** Count effects of a kind in the sink. */
function countKind(sink: ReturnType<typeof createSink>, kind: string): number {
  let n = 0
  for (let i = 0; i < sink.len; i++) if (sink.buf[i]!.kind === kind) n++
  return n
}

describe('score-driven progression (step 17)', () => {
  it('a threshold cross emits exactly one levelup carrying the new level', () => {
    const s = init('p-cross')
    s.score = 145 // one short of the level-2 threshold (150)
    const sink = createSink()
    aimAtHead(s)
    step(s, sink) // +10 (level-1 apple, combo 1) -> 155, crosses 150
    expect(s.score).toBe(155)
    expect(s.level).toBe(2)
    expect(countKind(sink, 'levelup')).toBe(1)
    const lu = sink.buf.find((e) => e.kind === 'levelup')!
    expect(lu.value).toBe(2) // the new 1-based level
  })

  it('does not emit a levelup when no threshold is crossed', () => {
    const s = init('p-no')
    s.score = 100
    const sink = createSink()
    aimAtHead(s)
    step(s, sink) // +10 -> 110, still below 150
    expect(s.score).toBe(110)
    expect(s.level).toBe(1)
    expect(countKind(sink, 'levelup')).toBe(0)
  })

  it('re-derives the level from the score each tick (tier-independent)', () => {
    const s = init('p-derive')
    s.score = 900 // level-4 range
    s.foodX = 0
    s.foodY = 0 // park food so this step does not eat
    step(s, createSink())
    expect(s.level).toBe(4) // not the stale init value of 1
  })

  it('scores a level-3 eat at the level-3 food value (combo 1)', () => {
    const s = init('p-l3')
    s.score = 400 // exactly the level-3 threshold
    const before = s.score
    aimAtHead(s)
    step(s, createSink())
    expect(s.level).toBe(3)
    expect(s.score - before).toBe(20) // level-3 orange is +20 at combo 1
  })

  it('caps the combo at MAX_COMBO after a rapid eating streak', () => {
    const s = init('p-cap')
    const sink = createSink()
    for (let i = 0; i < 5; i++) {
      aimAtHead(s)
      step(s, sink) // five eats one tick apart, all inside the 6-tick window
    }
    expect(s.combo).toBe(4) // 1 -> 2 -> 3 -> 4 -> 4 (capped)
    // the streak is real: the snake grew once per eat
    expect(s.bodyLen).toBe(3 + 5)
  })
})
