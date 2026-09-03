// Score / best / level HUD (step 19). A read-only presentation of the domain's
// score, session best, and level — it never mutates state. Labels come from the
// i18n catalog and re-render on a locale change. Past the top threshold the
// level reads as MAX (the ceiling, not a sixth level). Positioned at the top
// edge, out of the way of the playfield and non-interactive.
import { subscribe, t } from '../i18n'
import { MAX_LEVEL } from '../../domain/levels'
import type { SnakeState } from '../../domain/types'

export interface Hud {
  root: HTMLElement
  /** Re-render score/best/level from the current state (called each frame). */
  update(s: SnakeState): void
  detach(): void
}

function chip(field: string, label: HTMLElement, value: HTMLElement): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:1px',
    'min-width:64px',
    'padding:4px 8px',
    'border:1px solid rgba(255,255,255,.18)',
    'border-radius:8px',
    'background:rgba(0,0,0,.35)',
    'color:#fff',
    'font-variant-numeric:tabular-nums',
  ].join(';')
  // Stable hooks for the e2e suite: [data-hud-label] / [data-hud-value] per field.
  label.dataset.hudLabel = field
  value.dataset.hudValue = field
  label.style.cssText = 'font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.7'
  value.style.cssText = 'font-size:18px;font-weight:700;line-height:1'
  el.append(label, value)
  return el
}

export function createHud(): Hud {
  const root = document.createElement('div')
  root.id = 'hud'
  root.style.cssText = [
    'position:fixed',
    'top:calc(var(--bezel) + 10px)',
    'left:calc(var(--bezel) + 10px)',
    'z-index:30',
    'pointer-events:none',
    'display:flex',
    'gap:8px',
    'font-family:ui-monospace,monospace',
  ].join(';')

  const scoreLabel = document.createElement('span')
  const scoreValue = document.createElement('span')
  const bestLabel = document.createElement('span')
  const bestValue = document.createElement('span')
  const levelLabel = document.createElement('span')
  const levelValue = document.createElement('span')
  root.append(chip('score', scoreLabel, scoreValue), chip('best', bestLabel, bestValue), chip('level', levelLabel, levelValue))

  // Localized labels (i18n); re-read on a locale change.
  const syncLabels = (): void => {
    scoreLabel.textContent = t('hud.score')
    bestLabel.textContent = t('hud.best')
    levelLabel.textContent = t('hud.level')
  }
  syncLabels()
  const unsubscribe = subscribe(syncLabels)

  function update(s: SnakeState): void {
    scoreValue.textContent = String(s.score)
    bestValue.textContent = String(s.highScore)
    // Past the top threshold the level reads MAX (the ceiling).
    levelValue.textContent = s.level >= MAX_LEVEL ? t('hud.max') : String(s.level)
  }

  return {
    root,
    update,
    detach(): void {
      unsubscribe()
      root.remove()
    },
  }
}
