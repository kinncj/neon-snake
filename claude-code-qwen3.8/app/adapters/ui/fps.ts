// The FPS performance meter (P4.3): a small fixed readout (bottom-right, inside
// the glass) that shows the smoothed frame rate. It is hidden by default; the
// settings panel's FPS toggle shows it. It is fed each frame by main.ts (the
// frame's elapsed ms) and renders a light exponential-moving-average so the
// number does not jitter. Presentation-only — it never touches game state.
export interface FpsMeter {
  root: HTMLElement
  setVisible: (v: boolean) => void
  isVisible: () => boolean
  /** Feed the frame's elapsed ms; updates the smoothed FPS display. */
  frame: (ms: number) => void
  /** The current smoothed FPS, rounded (0 until the first valid frame). */
  fps: () => number
}

export function createFpsMeter(): FpsMeter {
  const root = document.createElement('div')
  root.id = 'fps'
  root.style.cssText = [
    'position:absolute',
    'right:12px',
    'bottom:12px',
    'font:600 11px/1 ui-monospace,"Courier New",monospace',
    'letter-spacing:1px',
    'color:#7fdcff',
    'background:rgba(8,10,18,0.7)',
    'border:1px solid rgba(127,220,255,0.32)',
    'border-radius:6px',
    'padding:5px 8px',
    'pointer-events:none',
    'text-shadow:0 0 6px rgba(127,220,255,0.55)',
    'display:none',
    'z-index:30',
  ].join(';')

  let visible = false
  let smooth = 0

  function apply(): void {
    root.style.display = visible ? 'block' : 'none'
    if (!visible) root.textContent = ''
  }

  function frame(ms: number): void {
    if (!visible || !(ms > 0)) return
    const inst = 1000 / ms
    // A light EMA keeps the readout steady without lagging far behind.
    smooth = smooth === 0 ? inst : smooth * 0.9 + inst * 0.1
    root.textContent = String(Math.round(smooth)) + ' FPS'
  }

  return {
    root,
    setVisible(v: boolean): void {
      visible = v
      apply()
    },
    isVisible(): boolean {
      return visible
    },
    frame,
    fps(): number {
      return Math.round(smooth)
    },
  }
}
