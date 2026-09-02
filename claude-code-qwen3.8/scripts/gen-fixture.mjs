#!/usr/bin/env node
// Deterministic input fixture generator. Uses its own fixed LCG (NOT the domain
// PRNG) so the committed run-a.log is stable independent of any engine. Emits
// ~400 intents over 5000 ticks, including two pause/resume pairs and a restart.
// Run once to (re)generate tests/fixtures/run-a.log.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const TICKS = 5000

let s = 0x1a2b3c4d
function lcg() {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0
  return s
}

const lines = []
for (let i = 0; i < 396; i++) {
  const t = 1 + (lcg() % TICKS)
  const dir = lcg() % 4
  lines.push(`${t} turn ${dir}`)
}
// two pause/resume pairs + one restart
lines.push('1000 pause')
lines.push('1050 pause')
lines.push('3000 pause')
lines.push('3100 pause')
lines.push('4800 restart')

lines.sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]))

const out =
  `# run-a.log — committed replay fixture\n` +
  `# format: <tick> <kind> [dir]; kind in {turn, pause, restart}\n` +
  `# seed: snake-0001; replay over ${TICKS} ticks (see tests/unit/replay.test.ts)\n` +
  lines.join('\n') +
  '\n'

const fixtures = resolve(here, '..', 'tests', 'fixtures')
mkdirSync(fixtures, { recursive: true })
writeFileSync(resolve(fixtures, 'run-a.log'), out)
console.log(`[gen-fixture] wrote ${lines.length} intents over ${TICKS} ticks`)
