#!/usr/bin/env node
// Build-log recorder. The shell (via `make log-start/end`) stamps the time; this
// never invents a timestamp. The TSV is the source of truth; `timeline` renders
// it to docs/build-log.md. Columns: step, started_at, ended_at, duration_s.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const LOG = resolve(root, 'docs' + String.fromCharCode(47) + 'build-log.tsv')
const MD = resolve(root, 'docs' + String.fromCharCode(47) + 'build-log.md')
const HDR = 'step\tstarted_at\tended_at\tduration_s\n'

function read() {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').slice(1)
}
function write(rows) {
  mkdirSync(resolve(root, 'docs'), { recursive: true })
  writeFileSync(LOG, HDR + rows.join('\n') + '\n')
}
const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'start') {
  const step = rest[0]
  if (!step) {
    console.error('usage: buildlog.mjs start <step>')
    process.exit(1)
  }
  const rows = read()
  rows.push(`${step}\t${isoNow()}\t\t`)
  write(rows)
} else if (cmd === 'end') {
  const step = rest[0]
  if (!step) {
    console.error('usage: buildlog.mjs end <step>')
    process.exit(1)
  }
  const rows = read()
  for (let i = rows.length - 1; i >= 0; i--) {
    const cells = rows[i].split('\t')
    if (cells[0] === step && !cells[2]) {
      const endIso = isoNow()
      const secs = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(cells[1])) / 1000))
      rows[i] = `${step}\t${cells[1]}\t${endIso}\t${secs}`
      break
    }
  }
  write(rows)
} else if (cmd === 'timeline') {
  const rows = read()
  const lines = ['# Build log', '', 'One row per build step. Durations are recorded by the shell,', 'never hand-typed.', '', '| Step | Started (UTC) | Ended (UTC) | Duration (s) |', '|---|---|---|---|']
  let total = 0
  for (const r of rows) {
    const [step, start, end, dur] = r.split('\t')
    lines.push(`| ${step} | ${start ?? ''} | ${end ?? ''} | ${dur ?? ''} |`)
    if (dur) total += Number(dur)
  }
  lines.push('', `**Total (logged steps): ${total}s**`, '')
  writeFileSync(MD, lines.join('\n'))
  console.log(`[buildlog] wrote ${MD} (${rows.length} rows, ${total}s total)`)
} else {
  console.error('usage: buildlog.mjs start|end|timeline [step]')
  process.exit(1)
}
