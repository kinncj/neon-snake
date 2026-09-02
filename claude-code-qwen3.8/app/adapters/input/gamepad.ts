// Gamepad input. Polls the first pad each frame (rAF). D-pad buttons, the stick
// past a 0.5 deadzone, and face buttons map to the same Intents as the keyboard.
// Turn actions are edge-triggered (on press) so holding doesn't re-emit.
import type { Dir, Intent } from '../../domain/types'

const DEADZONE = 0.5

export function createGamepad(push: (i: Intent) => void): () => void {
  const prev: Record<number, boolean> = {}
  let prevStick: Dir | null = null
  let raf = 0

  function stickDir(ax: number, ay: number): Dir | null {
    if (Math.abs(ay) > DEADZONE && Math.abs(ay) >= Math.abs(ax)) return ay < 0 ? 0 : 2
    if (Math.abs(ax) > DEADZONE) return ax < 0 ? 3 : 1
    return null
  }

  function poll(): void {
    const pads = navigator.getGamepads?.()
    const gp = pads && pads[0]
    if (gp) {
      const pressed = (i: number): boolean => gp.buttons[i]?.pressed ?? false
      const was = (i: number): boolean => prev[i] ?? false
      const edge = (i: number): boolean => pressed(i) && !was(i)
      // d-pad: standard mapping (12 up, 13 right, 14 down, 15 left)
      if (edge(12)) push({ kind: 'turn', dir: 0 })
      if (edge(13)) push({ kind: 'turn', dir: 1 })
      if (edge(14)) push({ kind: 'turn', dir: 2 })
      if (edge(15)) push({ kind: 'turn', dir: 3 })
      // face buttons: A (0) pause, B (1) restart
      if (edge(0)) push({ kind: 'pause' })
      if (edge(1)) push({ kind: 'restart' })
      // stick, edge-triggered on a change of dominant direction
      const sd = stickDir(gp.axes[0] ?? 0, gp.axes[1] ?? 0)
      if (sd !== null && sd !== prevStick) push({ kind: 'turn', dir: sd })
      prevStick = sd
      for (let i = 0; i < gp.buttons.length; i++) prev[i] = gp.buttons[i]?.pressed ?? false
    }
    raf = requestAnimationFrame(poll)
  }

  raf = requestAnimationFrame(poll)
  return () => cancelAnimationFrame(raf)
}
