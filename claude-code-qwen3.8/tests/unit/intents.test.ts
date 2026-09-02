import { describe, expect, it } from 'vitest'
import { enqueueTurn, togglePause } from '../../app/domain/intents'
import { init } from '../../app/domain/step'
import { MAX_PENDING } from '../../app/domain/types'

describe('intents', () => {
  it('queues a valid 90° turn', () => {
    const s = init('t') // dir = 1 (right)
    enqueueTurn(s, 0) // up
    expect(s.pendingLen).toBe(1)
    expect(s.pendingDir[0]).toBe(0)
  })

  it('rejects a 180° reversal of the current heading (empty buffer)', () => {
    const s = init('t') // dir = 1 (right)
    enqueueTurn(s, 3) // left
    expect(s.pendingLen).toBe(0)
  })

  it('rejects a no-op turn equal to the current heading', () => {
    const s = init('t') // dir = 1 (right)
    enqueueTurn(s, 1)
    expect(s.pendingLen).toBe(0)
  })

  it('rejects a 180° reversal against the last buffered turn', () => {
    const s = init('t') // dir = 1
    enqueueTurn(s, 0) // buffer [up]
    enqueueTurn(s, 2) // down = opposite of buffered up -> rejected
    expect(s.pendingLen).toBe(1)
    expect(s.pendingDir[0]).toBe(0)
  })

  it('fills the buffer then drops further turns', () => {
    const s = init('t') // dir = 1
    enqueueTurn(s, 0) // up
    enqueueTurn(s, 3) // left
    expect(s.pendingLen).toBe(2)
    enqueueTurn(s, 2) // down -> full
    expect(s.pendingLen).toBe(MAX_PENDING)
    enqueueTurn(s, 1) // dropped (full)
    expect(s.pendingLen).toBe(MAX_PENDING)
  })

  it('pause toggles playing<->paused and is inert in gameover', () => {
    const s = init('t')
    expect(s.phase).toBe('playing')
    togglePause(s)
    expect(s.phase).toBe('paused')
    togglePause(s)
    expect(s.phase).toBe('playing')
    s.phase = 'gameover'
    togglePause(s)
    expect(s.phase).toBe('gameover')
  })
})
