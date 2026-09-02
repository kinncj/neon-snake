#!/usr/bin/env node
// Enforces the app/domain purity boundary. Every import in app/domain must be a
// relative path that resolves back inside app/domain — the domain imports nothing
// outside app/domain (no adapters, no runtime, no node builtins, no packages).
// This is the structural half of the lint gate; the semantic half (no DOM, no
// timers, no Math.random, no Date, no audio) lives in eslint.config.js.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const domainDir = resolve(root, 'app' + sep + 'domain')
const domainPrefix = domainDir + sep

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

const importFromRe = /\bfrom\s+['"]([^'"]+)['"]/g
const importBareRe = /\bimport\s+['"]([^'"]+)['"]/g

let failures = 0
for (const file of walk(domainDir)) {
  const src = readFileSync(file, 'utf8')
  const dir = dirname(file)
  const specs = [...src.matchAll(importFromRe), ...src.matchAll(importBareRe)].map((m) => m[1])
  for (const spec of specs) {
    if (!spec.startsWith('.')) {
      console.error(`[domain-boundary] ${file}\n  imports "${spec}" — domain must import only within app/domain`)
      failures++
      continue
    }
    const resolved = resolve(dir, spec)
    if (!resolved.startsWith(domainPrefix)) {
      console.error(`[domain-boundary] ${file}\n  imports "${spec}" → escapes app/domain (${resolved})`)
      failures++
    }
  }
}

if (failures > 0) {
  console.error(`[domain-boundary] FAILED: ${failures} violation(s)`)
  process.exit(1)
}
console.log('[domain-boundary] ok — app/domain imports only within app/domain')
