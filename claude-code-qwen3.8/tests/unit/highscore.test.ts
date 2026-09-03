import { describe, expect, it } from 'vitest'
import { HS_KEY, createHighscore, type StorageLike } from '../../app/adapters/storage/highscore'

function memStorage(initial: Record<string, string> = {}): StorageLike {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

describe('highscore persistence', () => {
  it('returns 0 when nothing is stored', () => {
    expect(createHighscore(memStorage()).load()).toBe(0)
  })

  it('round-trips a saved score', () => {
    const st = memStorage()
    const hs = createHighscore(st)
    hs.save(42)
    expect(createHighscore(st).load()).toBe(42)
  })

  it('discards a tampered score (score changed, checksum stale)', () => {
    const st = memStorage()
    const hs = createHighscore(st)
    hs.save(100)
    // A casual edit: inflate the score but leave the (now-wrong) checksum.
    const raw = JSON.parse(st.getItem(HS_KEY) as string) as { s: number; c: string }
    raw.s = 999_999
    st.setItem(HS_KEY, JSON.stringify(raw))
    expect(createHighscore(st).load()).toBe(0)
  })

  it('discards a tampered checksum (score kept, checksum forged)', () => {
    const st = memStorage()
    const hs = createHighscore(st)
    hs.save(500)
    const raw = JSON.parse(st.getItem(HS_KEY) as string) as { s: number; c: string }
    raw.c = '00000000'
    st.setItem(HS_KEY, JSON.stringify(raw))
    expect(createHighscore(st).load()).toBe(0)
  })

  it('discards malformed or non-numeric payloads', () => {
    expect(createHighscore(memStorage({ [HS_KEY]: 'not json' })).load()).toBe(0)
    expect(createHighscore(memStorage({ [HS_KEY]: '{"s":-5,"c":"00000000"}' })).load()).toBe(0)
    expect(createHighscore(memStorage({ [HS_KEY]: '{"c":"00000000"}' })).load()).toBe(0)
  })

  it('truncates a fractional stored score to an integer', () => {
    const st = memStorage()
    createHighscore(st).save(77.9)
    expect(createHighscore(st).load()).toBe(77)
  })

  it('never throws when storage is unavailable', () => {
    const boom: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    const hs = createHighscore(boom)
    expect(hs.load()).toBe(0)
    expect(() => hs.save(10)).not.toThrow()
    expect(() => hs.clear()).not.toThrow()
  })

  it('clear removes the stored value', () => {
    const st = memStorage()
    const hs = createHighscore(st)
    hs.save(120)
    hs.clear()
    expect(st.getItem(HS_KEY)).toBeNull()
    expect(hs.load()).toBe(0)
  })
})
