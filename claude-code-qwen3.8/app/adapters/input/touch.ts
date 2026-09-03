// Touch input. A swipe (>= 24 CSS px, dominant axis wins, one intent per gesture)
// steers the snake. The on-screen d-pad is created here but its visibility is
// owned by the settings panel (default hidden); it uses pointer events so it
// works for both touch and mouse. `navigator.vibrate(10)` fires on a d-pad press
// where available.
import type { Dir, Intent } from '../../domain/types'
import { subscribe, t } from '../i18n'
import type { StringKey } from '../i18n/strings'

const SWIPE_PX = 24

function vibrate(): void {
  try {
    navigator.vibrate?.(10)
  } catch {
    // no-op
  }
}

export interface TouchInput {
  detach: () => void
}

export function createSwipe(push: (i: Intent) => void, root: HTMLElement): TouchInput {
  let sx = 0
  let sy = 0
  let active = false

  function onStart(e: TouchEvent): void {
    e.preventDefault()
    const t = e.touches[0]
    if (!t) return
    sx = t.clientX
    sy = t.clientY
    active = true
  }
  function onMove(e: TouchEvent): void {
    e.preventDefault()
  }
  function onEnd(e: TouchEvent): void {
    e.preventDefault()
    if (!active) return
    active = false
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - sx
    const dy = t.clientY - sy
    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0
    push({ kind: 'turn', dir })
  }

  root.addEventListener('touchstart', onStart, { passive: false })
  root.addEventListener('touchmove', onMove, { passive: false })
  root.addEventListener('touchend', onEnd, { passive: false })
  return {
    detach() {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
    },
  }
}

export interface Dpad {
  root: HTMLElement
  setVisible: (v: boolean) => void
  isVisible: () => boolean
}

const DIRS: Array<{ label: string; dir: Dir; grid: string }> = [
  { label: '↑', dir: 0, grid: '1 / 2' },
  { label: '←', dir: 3, grid: '2 / 1' },
  { label: '↓', dir: 2, grid: '3 / 2' },
  { label: '→', dir: 1, grid: '2 / 3' },
]

/** Accessible label key per direction (0=up, 1=right, 2=down, 3=left). */
const DIR_ARIA: Record<Dir, StringKey> = {
  0: 'dpad.up',
  1: 'dpad.right',
  2: 'dpad.down',
  3: 'dpad.left',
}

export function createDpad(push: (i: Intent) => void): Dpad {
  const root = document.createElement('div')
  root.id = 'dpad'
  root.style.cssText = [
    'position:fixed',
    'left:calc(var(--bezel) + 16px)',
    'bottom:calc(var(--bezel) + 16px)',
    'display:none',
    'grid-template-areas:"_ u _" "l _ r" "_ d _"',
    'gap:8px',
    'z-index:50',
    'touch-action:none',
    'user-select:none',
  ].join(';')

  const buttons: Array<{ el: HTMLButtonElement; key: StringKey }> = []
  for (const d of DIRS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = d.label
    buttons.push({ el: b, key: DIR_ARIA[d.dir] })
    b.style.cssText = [
      'width:52px',
      'height:52px',
      'font-size:24px',
      'grid-area:' + d.grid,
      'border:1px solid rgba(255,255,255,.25)',
      'border-radius:10px',
      'background:rgba(255,255,255,.06)',
      'color:#fff',
      'cursor:pointer',
    ].join(';')
    const emit = (): void => {
      vibrate()
      push({ kind: 'turn', dir: d.dir })
    }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      emit()
    })
    root.appendChild(b)
  }

  // Localized accessible labels, re-read on a locale change (i18n).
  const syncAria = (): void => {
    for (const { el, key } of buttons) el.setAttribute('aria-label', t(key))
  }
  syncAria()
  subscribe(syncAria)

  let visible = false
  return {
    root,
    setVisible(v: boolean): void {
      visible = v
      root.style.display = v ? 'grid' : 'none'
    },
    isVisible(): boolean {
      return visible
    },
  }
}
