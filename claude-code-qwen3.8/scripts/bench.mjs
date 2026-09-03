#!/usr/bin/env node
// Perf-budget gate (step 16). Builds, then runs the chromium perf suite
// (steady-state frame-time p95 + steady-state allocation at the low tier under a
// 4x CPU throttle) and asserts the budgets. The budgets are asserted inside
// tests/perf/frame-budget.spec.ts; this wrapper builds fresh, runs the suite,
// surfaces the measured numbers, and exits non-zero on any budget miss.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function run(label, cmd, args) {
  console.log(`[bench] ${label}…`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`[bench] FAILED: ${label} (exit ${r.status ?? 1})`)
    process.exit(r.status ?? 1)
  }
}

run('build', 'npm', ['run', 'build'])
run(
  'perf budget suite (chromium, --expose-gc, 4x throttle)',
  'npx',
  ['playwright', 'test', '-c', 'playwright.perf.config.ts'],
)
console.log('[bench] perf budgets met (frame p95 < 16.7ms; steady-state allocation bounded)')
