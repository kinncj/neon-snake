import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enqueue } from '../../app/domain/intents'
import { hash } from '../../app/domain/hash'
import { init, step } from '../../app/domain/step'
import { createSink, type Intent, type SnakeState } from '../../app/domain/types'

const SEED = 'snake-0001'
const TOTAL_TICKS = 5000
const fixturesDir = resolve(fileURLToPath(new URL('..', import.meta.url)), 'fixtures')
const FIXTURE = resolve(fixturesDir, 'run-a.log')
const HASH = resolve(fixturesDir, 'run-a.hash')

/** Parse the fixture into tick -> intents (intents at the same tick keep log order). */
function parseIntents(log: string): Map<number, Intent[]> {
  const byTick = new Map<number, Intent[]>()
  for (const raw of log.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const tick = Number(parts[0])
    const kind = parts[1]
    const intent: Intent =
      kind === 'turn'
        ? { kind: 'turn', dir: Number(parts[2]) as 0 | 1 | 2 | 3 }
        : { kind: kind as 'pause' | 'restart' }
    const arr = byTick.get(tick) ?? []
    arr.push(intent)
    byTick.set(tick, arr)
  }
  return byTick
}

/** Replay the intents from a fresh state; return the final canonical hash. */
function replay(seed: string, byTick: Map<number, Intent[]>): string {
  let s: SnakeState = init(seed)
  const sink = createSink()
  for (let t = 1; t <= TOTAL_TICKS; t++) {
    const intents = byTick.get(t)
    if (intents) {
      for (const intent of intents) {
        // restart re-inits from the same seed (the loop's contract)
        if (intent.kind === 'restart') s = init(s.seed)
        else s = enqueue(s, intent)
      }
    }
    step(s, sink)
  }
  return hash(s)
}

describe('replay', () => {
  it('reproduces the committed hash (deterministic, tier-independent)', () => {
    const byTick = parseIntents(readFileSync(FIXTURE, 'utf8'))
    const first = replay(SEED, byTick)
    // On the very first run capture the hash as a committed fixture; afterwards
    // assert against it. Either way this proves the replay is reproducible.
    if (!existsSync(HASH)) writeFileSync(HASH, first + '\n')
    const expected = readFileSync(HASH, 'utf8').trim()
    const second = replay(SEED, byTick) // an independent second run
    expect(first).toMatch(/^[0-9a-f]{8}$/)
    expect(first).toBe(second)
    expect(second).toBe(expected)
  })
})
