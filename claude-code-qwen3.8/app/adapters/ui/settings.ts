// The settings panel (P4.3). A single gear (top-right) opens a pause-on-open
// modal with four toggles — Effects, Sound, D-pad, FPS — plus a language picker
// and a Close button. Opening the panel pauses the game so a player can't steer
// into a wall while reading options; Escape, a backdrop click, or the Close
// button all dismiss it (and resume the game).
//
// Persistence: the Effects / D-pad / FPS toggles persist to localStorage
// `snake.settings` (defaults Effects + Sound on, D-pad + FPS off). Sound is a
// live view of the sound handle (which owns its own `snake.sound` persistence),
// so the `M` shortcut and the toggle never drift. Every display string is read
// through `t()` from a StringKey — nothing is hard-coded — and a locale change
// repaints the labels through the i18n subscription.
import { getLocale, setLocale, subscribe, t } from '../i18n'
import { SUPPORTED_LOCALES, type StringKey } from '../i18n/strings'
import type { FpsMeter } from './fps'

export interface SettingsState {
  effects: boolean
  sound: boolean
  dpad: boolean
  fps: boolean
}

const STORAGE_KEY = 'snake.settings'
const DEFAULTS: SettingsState = { effects: true, sound: true, dpad: false, fps: false }

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<SettingsState>
    return {
      effects: p.effects ?? DEFAULTS.effects,
      sound: p.sound ?? DEFAULTS.sound,
      dpad: p.dpad ?? DEFAULTS.dpad,
      fps: p.fps ?? DEFAULTS.fps,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(s: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // no-op (private mode / quota)
  }
}

export interface SettingsOptions {
  /** The FPS meter (created by main.ts; the FPS toggle shows it and it is fed each frame). */
  fps: FpsMeter
  /** Read the current sound state so the Sound toggle seeds from it on open. */
  getSound: () => boolean
  /** Apply a toggle to the game (the governor / sound / d-pad / fps meter). */
  apply: {
    effects: (v: boolean) => void
    sound: (v: boolean) => void
    dpad: (v: boolean) => void
    fps: (v: boolean) => void
  }
  /** Pause the game when the panel opens; resume when it closes. */
  onOpen: () => void
  onClose: () => void
}

export interface SettingsHandle {
  root: HTMLElement
  /** The FPS meter (main.ts feeds it each frame; the FPS toggle shows it). */
  fps: FpsMeter
  isOpen: () => boolean
  open: () => void
  close: () => void
  toggle: () => void
  /** The current state (main.ts reads this once to seed the game on load). */
  state: () => SettingsState
}

const NEON = '127,220,255'

interface Toggle {
  el: HTMLElement
  key: StringKey
  set: (v: boolean) => void
  get: () => boolean
  repaint: () => void
}

export function createSettings(opts: SettingsOptions): SettingsHandle {
  const state: SettingsState = load()
  const fpsMeter = opts.fps
  let panelOpen = false

  // ---- gear button (top-right) -------------------------------------------
  const root = document.createElement('div')
  root.id = 'settings'
  root.style.cssText = ['position:fixed', 'top:12px', 'right:12px', 'z-index:60'].join(';')

  const gear = document.createElement('button')
  gear.type = 'button'
  gear.id = 'settings-gear'
  gear.textContent = '⚙'
  gear.style.cssText = [
    'width:40px',
    'height:40px',
    'font-size:20px',
    'line-height:1',
    'border:1.5px solid rgba(' + NEON + ',0.5)',
    'border-radius:12px',
    'background:rgba(10,14,24,0.72)',
    'color:#eafcff',
    'cursor:pointer',
    'box-shadow:0 0 10px rgba(' + NEON + ',0.28), inset 0 0 8px rgba(' + NEON + ',0.14)',
    'text-shadow:0 0 8px rgba(' + NEON + ',0.8)',
  ].join(';')

  // ---- the modal -----------------------------------------------------------
  const modal = document.createElement('div')
  modal.id = 'settings-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.style.cssText = ['position:fixed', 'inset:0', 'z-index:70', 'display:none'].join(';')

  // Backdrop: click to close.
  const backdrop = document.createElement('div')
  backdrop.id = 'settings-backdrop'
  backdrop.style.cssText = ['position:absolute', 'inset:0', 'background:rgba(4,6,12,0.66)'].join(';')
  backdrop.addEventListener('click', () => close())

  // Dialog.
  const dialog = document.createElement('div')
  dialog.id = 'settings-dialog'
  dialog.style.cssText = [
    'position:relative',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%)',
    'width:min(340px,90vw)',
    'border:1.5px solid rgba(' + NEON + ',0.5)',
    'border-radius:16px',
    'background:rgba(10,14,24,0.94)',
    'box-shadow:0 0 28px rgba(' + NEON + ',0.3), inset 0 0 20px rgba(' + NEON + ',0.08)',
    'padding:18px 20px 20px',
    'color:#eafcff',
  ].join(';')

  const title = document.createElement('h2')
  title.id = 'settings-title'
  title.style.cssText = [
    'margin:0 0 14px',
    'font:700 16px/1.2 ui-monospace,"Courier New",monospace',
    'letter-spacing:3px',
    'text-transform:uppercase',
    'color:#7fdcff',
    'text-shadow:0 0 10px rgba(' + NEON + ',0.7)',
    'text-align:center',
  ].join(';')

  // A toggle row: a localized label + a switch. The label is a StringKey so the
  // accessible name can be re-read through t() on a locale change.
  function makeToggle(key: StringKey, initial: boolean, onFlip: (v: boolean) => void): Toggle {
    const el = document.createElement('div')
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:12px',
      'padding:9px 0',
      'border-bottom:1px solid rgba(' + NEON + ',0.14)',
    ].join(';')

    const labelEl = document.createElement('span')
    labelEl.style.cssText = [
      'font:600 13px/1 ui-monospace,"Courier New",monospace',
      'letter-spacing:1px',
      'color:#dfeeff',
    ].join(';')

    const sw = document.createElement('button')
    sw.type = 'button'
    sw.setAttribute('role', 'switch')
    const knob = document.createElement('span')
    knob.style.cssText = [
      'position:absolute',
      'top:3px',
      'left:3px',
      'width:16px',
      'height:16px',
      'border-radius:50%',
      'transition:left .15s, background .15s',
      'box-shadow:0 0 6px rgba(' + NEON + ',0.7)',
    ].join(';')
    sw.appendChild(knob)

    let value = initial
    function paint(): void {
      labelEl.textContent = t(key)
      sw.setAttribute('aria-checked', String(value))
      sw.setAttribute('aria-label', t(key) + ' ' + t(value ? 'common.on' : 'common.off'))
      sw.style.cssText = [
        'width:46px',
        'height:24px',
        'flex:0 0 auto',
        'border-radius:14px',
        'border:1.5px solid rgba(' + NEON + ',' + (value ? '0.7' : '0.3') + ')',
        'background:rgba(' + NEON + ',' + (value ? '0.28' : '0.05') + ')',
        'position:relative',
        'cursor:pointer',
        'transition:background .15s, border-color .15s',
      ].join(';')
      knob.style.left = value ? '24px' : '3px'
      knob.style.background = value ? '#7fdcff' : 'rgba(160,180,220,0.5)'
    }
    function set(v: boolean): void {
      value = v
      paint()
      onFlip(v)
    }
    sw.addEventListener('click', () => set(!value))
    paint()
    el.appendChild(labelEl)
    el.appendChild(sw)
    return { el, key, set, get: () => value, repaint: paint }
  }

  const togl = (
    key: StringKey,
    field: 'effects' | 'sound' | 'dpad' | 'fps',
    onApply: (v: boolean) => void,
  ): Toggle => makeToggle(key, state[field], (v) => {
    state[field] = v
    save(state)
    onApply(v)
  })

  const rows: Toggle[] = [
    togl('settings.effects', 'effects', (v) => opts.apply.effects(v)),
    togl('settings.sound', 'sound', (v) => opts.apply.sound(v)),
    togl('settings.dpad', 'dpad', (v) => opts.apply.dpad(v)),
    togl('settings.fps', 'fps', (v) => opts.apply.fps(v)),
  ]
  for (const r of rows) dialog.appendChild(r.el)

  // ---- language picker ----------------------------------------------------
  const langRow = document.createElement('div')
  langRow.style.cssText = ['display:flex', 'align-items:center', 'justify-content:space-between', 'gap:12px', 'padding:11px 0 9px'].join(';')
  const langLabel = document.createElement('span')
  langLabel.style.cssText = ['font:600 13px/1 ui-monospace,"Courier New",monospace', 'letter-spacing:1px', 'color:#dfeeff'].join(';')
  const langSel = document.createElement('select')
  langSel.id = 'settings-lang'
  langSel.style.cssText = [
    'font:600 12px/1 ui-monospace,"Courier New",monospace',
    'color:#eafcff',
    'background:rgba(8,10,18,0.9)',
    'border:1.5px solid rgba(' + NEON + ',0.4)',
    'border-radius:8px',
    'padding:6px 8px',
    'cursor:pointer',
  ].join(';')
  for (const loc of SUPPORTED_LOCALES) {
    const o = document.createElement('option')
    o.value = loc
    o.textContent = t(('lang.' + loc) as StringKey)
    langSel.appendChild(o)
  }
  langSel.value = getLocale()
  langSel.addEventListener('change', () => {
    const v = langSel.value
    if (v === 'en' || v === 'ja' || v === 'es') setLocale(v)
  })
  langRow.appendChild(langLabel)
  langRow.appendChild(langSel)
  dialog.appendChild(langRow)

  // ---- close button -------------------------------------------------------
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.id = 'settings-close'
  closeBtn.style.cssText = [
    'margin-top:14px',
    'width:100%',
    'padding:10px 0',
    'font:700 13px/1 ui-monospace,"Courier New",monospace',
    'letter-spacing:2px',
    'text-transform:uppercase',
    'color:#0a0e18',
    'background:#7fdcff',
    'border:none',
    'border-radius:10px',
    'cursor:pointer',
    'box-shadow:0 0 14px rgba(' + NEON + ',0.6)',
  ].join(';')
  closeBtn.addEventListener('click', () => close())
  dialog.appendChild(closeBtn)

  modal.appendChild(backdrop)
  modal.appendChild(dialog)
  root.appendChild(gear)
  root.appendChild(fpsMeter.root) // the FPS meter lives with the settings cluster

  gear.addEventListener('click', () => togglePanel())

  // ---- open / close -------------------------------------------------------
  function openPanel(): void {
    if (panelOpen) return
    panelOpen = true
    // Seed the Sound toggle from the live handle (so it matches the `M` shortcut).
    rows[1]?.set(opts.getSound())
    langSel.value = getLocale()
    modal.style.display = 'block'
    opts.onOpen()
  }
  function closePanel(): void {
    if (!panelOpen) return
    panelOpen = false
    modal.style.display = 'none'
    opts.onClose()
  }
  function togglePanel(): void {
    if (panelOpen) closePanel()
    else openPanel()
  }

  // Escape closes (and resumes the game).
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && panelOpen) {
      e.stopPropagation()
      closePanel()
    }
  }
  document.addEventListener('keydown', onKey, true)

  // Re-read the localized labels on a locale change.
  subscribe(() => {
    title.textContent = t('settings.title')
    langLabel.textContent = t('settings.language')
    closeBtn.textContent = t('settings.close')
    for (const r of rows) r.repaint()
    for (const loc of SUPPORTED_LOCALES) {
      const o = langSel.querySelector('option[value="' + loc + '"]')
      if (o) o.textContent = t(('lang.' + loc) as StringKey)
    }
  })
  title.textContent = t('settings.title')
  langLabel.textContent = t('settings.language')
  closeBtn.textContent = t('settings.close')

  return {
    root,
    fps: fpsMeter,
    isOpen: () => panelOpen,
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    state: () => ({ ...state }),
  }
}
