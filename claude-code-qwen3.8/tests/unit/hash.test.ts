import { describe, expect, it } from 'vitest'
import { hash } from '../../app/domain/hash'
import { init, step } from '../../app/domain/step'
import { createSink } from '../../app/domain/types'

describe('hash', () => {
  it('is deterministic across independent instances', () => {
    const a = init('h')
    const b = init('h')
    expect(hash(a)).toBe(hash(b))
  })

  it('changes as the simulation advances', () => {
    const s = init('h2')
    const h0 = hash(s)
    step(s, createSink())
    expect(hash(s)).not.toBe(h0)
  })

  it('excludes auxiliary (derived) fields from the canonical form', () => {
    const a = init('h3')
    const b = init('h3')
    const h0 = hash(a)
    b.highScore = 12345 // not hashed
    b.combo = 4 // not hashed
    b.lastEatTick = 7 // not hashed
    expect(hash(b)).toBe(h0)
  })

  it('is 8 lowercase hex chars', () => {
    const s = init('h4')
    expect(hash(s)).toMatch(/^[0-9a-f]{8}$/)
  })
})
