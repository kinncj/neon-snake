// Keyboard input. Arrows + WASD -> turn, P/Esc -> pause, R -> restart. Emits
// Intents into the shared queue. `preventDefault` on the game keys so the page
// doesn't scroll. Returns a cleanup that detaches the listener.
import type { Dir, Intent } from '../../domain/types'

const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: 0,
  KeyW: 0,
  ArrowRight: 1,
  KeyD: 1,
  ArrowDown: 2,
  KeyS: 2,
  ArrowLeft: 3,
  KeyA: 3,
}

export function createKeyboard(push: (i: Intent) => void): () => void {
  function onKey(e: KeyboardEvent): void {
    const code = e.code
    const dir = KEY_TO_DIR[code]
    if (dir !== undefined) {
      e.preventDefault()
      push({ kind: 'turn', dir })
      return
    }
    if (code === 'KeyP' || code === 'Escape') {
      e.preventDefault()
      push({ kind: 'pause' })
      return
    }
    if (code === 'KeyR') {
      push({ kind: 'restart' })
      return
    }
    if (code === 'Space') e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
