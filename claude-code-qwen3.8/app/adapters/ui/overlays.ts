// Title / pause / gameover overlays + transient score popups and the level-up
// banner (step 19). Pure presentation: it reads the UI mode and a read-only
// snapshot of domain state and renders DOM; it never mutates state. Every label
// comes from the i18n catalog, so the whole screen re-renders on a locale change.
// The container is `pointer-events:none` so swipes/taps reach the game; all
// overlays are hidden while the mode is `playing`, so nothing covers the field.
import { subscribe, t } from '../i18n'
import type { SnakeState } from '../../domain/types'

/** The UI mode. `title` is a presentation-only state the domain does not model. */
export type UiMode = 'title' | 'playing' | 'paused' | 'gameover'

export interface Overlays {
  root: HTMLElement
  /** Show/hide the overlay for the current mode and refresh its dynamic text. */
  update(mode: UiMode, s: SnakeState): void
  /** A transient "+N" that floats up from the eat point (CSS px on screen). */
  showScorePop(n: number, x: number, y: number): void
  /** A transient centred "Level N" banner. */
  showLevelUp(level: number): void
  detach(): void
}

function overlay(id: string): HTMLElement {
  const el = document.createElement('div')
  el.id = id
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:none',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:10px',
    'z-index:40',
    'pointer-events:none',
    'text-align:center',
    'color:#fff',
    'font-family:ui-monospace,monospace',
    'text-shadow:0 0 12px rgba(0,229,255,.55)',
  ].join(';')
  return el
}

function label(cls: string): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  el.style.cssText = 'font-size:14px;letter-spacing:.08em;opacity:.85'
  return el
}

function big(cls: string): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  el.style.cssText = 'font-size:40px;font-weight:800;letter-spacing:.14em'
  return el
}

/** A "Label: value" pair used on the gameover screen. Returns the row plus the
 *  label/value spans so the caller can keep handles for locale + state updates. */
function statPair(): { row: HTMLElement; label: HTMLElement; value: HTMLElement } {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:8px;align-items:baseline;font-size:18px'
  const lab = document.createElement('span')
  lab.style.cssText = 'opacity:.7;letter-spacing:.08em;text-transform:uppercase;font-size:12px'
  const val = document.createElement('span')
  val.style.cssText = 'font-size:24px;font-weight:700;font-variant-numeric:tabular-nums'
  row.append(lab, val)
  return { row, label: lab, value: val }
}

export function createOverlays(): Overlays {
  const root = document.createElement('div')
  root.id = 'ui'
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40'

  // Title screen.
  const title = overlay('ui-title')
  const titleName = big('ui-title-name')
  const titleStart = label('ui-title-start')
  const titleMove = label('ui-title-move')
  const titleHints = label('ui-title-hints')
  titleHints.style.cssText = 'font-size:12px;opacity:.6;letter-spacing:.06em'
  title.append(titleName, titleStart, titleMove, titleHints)

  // Pause screen.
  const pause = overlay('ui-pause')
  const pauseTitle = big('ui-pause-title')
  const pauseResume = label('ui-pause-resume')
  pause.append(pauseTitle, pauseResume)

  // Gameover screen.
  const gameover = overlay('ui-gameover')
  const gameoverTitle = big('ui-gameover-title')
  const score = statPair()
  const best = statPair()
  // Stable hooks for the e2e suite (#ui-gameover [data-stat=...]).
  score.value.dataset.stat = 'score'
  best.value.dataset.stat = 'best'
  const gameoverRestart = label('ui-gameover-restart')
  gameoverRestart.style.cssText = 'font-size:12px;opacity:.6;letter-spacing:.06em'
  gameover.append(gameoverTitle, score.row, best.row, gameoverRestart)

  root.append(title, pause, gameover)

  // Localized static labels; re-read on a locale change so the active screen
  // repaints. Dynamic values (score/best) are refreshed in `update` each frame.
  const syncLabels = (): void => {
    titleName.textContent = t('title.name')
    titleStart.textContent = t('title.start')
    titleMove.textContent = t('title.move')
    titleHints.textContent = t('title.hints')
    pauseTitle.textContent = t('pause.title')
    pauseResume.textContent = t('pause.resume')
    gameoverTitle.textContent = t('gameover.title')
    score.label.textContent = t('gameover.score')
    best.label.textContent = t('gameover.best')
    gameoverRestart.textContent = t('gameover.restart')
  }
  syncLabels()
  const unsubscribe = subscribe(syncLabels)

  let lastMode: UiMode = 'title'
  function update(mode: UiMode, s: SnakeState): void {
    const enteringGameover = mode === 'gameover' && lastMode !== 'gameover'
    title.style.display = mode === 'title' ? 'flex' : 'none'
    pause.style.display = mode === 'paused' ? 'flex' : 'none'
    gameover.style.display = mode === 'gameover' ? 'flex' : 'none'
    if (enteringGameover) {
      // The collision-FX "dissolve" into the gameover panel: the death burst has
      // scattered the snake into particles, and the panel dissolves in over it.
      gameover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' })
    }
    if (mode === 'gameover') {
      score.value.textContent = String(s.score)
      best.value.textContent = String(s.highScore)
    }
    lastMode = mode
  }

  function showScorePop(n: number, x: number, y: number): void {
    const el = document.createElement('div')
    el.textContent = `+${n}`
    el.style.cssText = [
      'position:fixed',
      `left:${x}px`,
      `top:${y}px`,
      'transform:translate(-50%,-50%)',
      'z-index:45',
      'pointer-events:none',
      'font-family:ui-monospace,monospace',
      'font-size:18px',
      'font-weight:800',
      'color:#fff',
      'text-shadow:0 0 8px rgba(0,229,255,.9)',
    ].join(';')
    root.appendChild(el)
    const anim = el.animate(
      [
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
        { opacity: 0, transform: 'translate(-50%,-140%) scale(1.25)' },
      ],
      { duration: 650, easing: 'ease-out' },
    )
    anim.onfinish = () => el.remove()
  }

  function showLevelUp(level: number): void {
    const el = document.createElement('div')
    el.textContent = t('levelup.banner', { n: level })
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:28%',
      'transform:translate(-50%,-50%)',
      'z-index:45',
      'pointer-events:none',
      'font-family:ui-monospace,monospace',
      'font-size:34px',
      'font-weight:800',
      'letter-spacing:.14em',
      'color:#fff',
      'text-shadow:0 0 16px rgba(157,107,255,.9)',
    ].join(';')
    root.appendChild(el)
    const anim = el.animate(
      [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.25 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.7 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05)' },
      ],
      { duration: 1200, easing: 'ease-out' },
    )
    anim.onfinish = () => el.remove()
  }

  return {
    root,
    update,
    showScorePop,
    showLevelUp,
    detach(): void {
      unsubscribe()
      root.remove()
    },
  }
}
