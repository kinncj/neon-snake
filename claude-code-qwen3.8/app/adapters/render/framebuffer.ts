// The 2D content renderer. A 256x240 offscreen canvas is the virtual
// framebuffer (the deterministic ground truth), drawn with Canvas2D at integer
// coordinates from a procedural palette. It composites to the display canvas at
// an integer scale, letterbox/pillarboxing the remainder with the bg colour,
// backing store = cssPx * devicePixelRatio. The head (and every segment) is
// interpolated by `alpha`; the simulation is not. This composite is always drawn
// beneath the engine canvas as the guaranteed fallback — never a black screen.
import { CELL_PX, FRAME_H, FRAME_W, type SnakeState } from '../../domain/types'
import { ParticleSystem } from './particles'
import type { Palette } from './theme'

export interface Layout {
  w: number
  h: number
  scale: number
  offX: number
  offY: number
}

/** Pure layout math: integer scale + centred letterbox, backing store in device px. */
export function computeLayout(cssW: number, cssH: number, dpr: number): Layout {
  const w = Math.max(1, Math.floor(cssW * dpr))
  const h = Math.max(1, Math.floor(cssH * dpr))
  const scale = Math.max(1, Math.floor(Math.min(w / FRAME_W, h / FRAME_H)))
  const offX = Math.floor((w - FRAME_W * scale) / 2)
  const offY = Math.floor((h - FRAME_H * scale) / 2)
  return { w, h, scale, offX, offY }
}

const DX: readonly number[] = [0, 1, 0, -1]
const DY: readonly number[] = [-1, 0, 1, 0]

export class Framebuffer {
  readonly display: HTMLCanvasElement
  private off: HTMLCanvasElement
  private octx: CanvasRenderingContext2D
  private dctx: CanvasRenderingContext2D
  private layout: Layout

  // Previous-tick body snapshot for interpolation (head glides prev -> current).
  private prevBodyX = new Int32Array(FRAME_W * FRAME_H)
  private prevBodyY = new Int32Array(FRAME_W * FRAME_H)
  private prevBodyLen = 0

  constructor(display: HTMLCanvasElement) {
    this.display = display
    this.off = document.createElement('canvas')
    this.off.width = FRAME_W
    this.off.height = FRAME_H
    this.octx = this.off.getContext('2d')!
    this.dctx = display.getContext('2d', { alpha: false })!
    this.layout = computeLayout(1, 1, 1)
  }

  getLayout(): Layout {
    return this.layout
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.layout = computeLayout(cssW, cssH, dpr)
    this.display.width = this.layout.w
    this.display.height = this.layout.h
    this.display.style.width = cssW + 'px'
    this.display.style.height = cssH + 'px'
    this.dctx.imageSmoothingEnabled = false
  }

  /** Snapshot the body before a step so the render can interpolate prev -> current. */
  capturePrev(s: SnakeState): void {
    this.prevBodyLen = s.bodyLen
    for (let i = 0; i < s.bodyLen; i++) {
      this.prevBodyX[i] = s.bodyX[i] ?? 0
      this.prevBodyY[i] = s.bodyY[i] ?? 0
    }
  }

  draw(s: SnakeState, alpha: number, p: Palette, particles?: ParticleSystem): void {
    const o = this.octx
    o.fillStyle = p.bg
    o.fillRect(0, 0, FRAME_W, FRAME_H)
    this.drawGrid(o, p.grid)
    if (s.foodX !== -1) this.drawFood(o, s.foodX, s.foodY, p)
    this.drawSnake(o, s, alpha, p)
    // Particles are presentation-only and transient: in steady state (no burst)
    // `active` is 0 and this is a no-op, so the zero-allocation budget holds.
    if (particles && particles.active > 0) this.drawParticles(o, particles)

    const d = this.dctx
    d.fillStyle = p.bg
    d.fillRect(0, 0, this.layout.w, this.layout.h)
    d.imageSmoothingEnabled = false
    d.drawImage(this.off, this.layout.offX, this.layout.offY, FRAME_W * this.layout.scale, FRAME_H * this.layout.scale)
  }

  private drawParticles(o: CanvasRenderingContext2D, ps: ParticleSystem): void {
    const c: [number, number, number] = [255, 255, 255]
    ps.forEachLive((i) => {
      ps.colorAt(i, c)
      const a = ps.alphaAt(i)
      const x = ParticleSystem.clampX(ps.xAt(i))
      const y = ParticleSystem.clampY(ps.yAt(i))
      const r = Math.max(0.5, ps.sizeAt(i) * a)
      o.globalAlpha = a
      o.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
      o.beginPath()
      o.arc(x, y, r, 0, Math.PI * 2)
      o.fill()
    })
    o.globalAlpha = 1
  }

  private drawGrid(o: CanvasRenderingContext2D, color: string): void {
    o.fillStyle = color
    for (let x = 0; x <= FRAME_W; x += CELL_PX) o.fillRect(x, 0, 1, FRAME_H)
    for (let y = 0; y <= FRAME_H; y += CELL_PX) o.fillRect(0, y, FRAME_W, 1)
  }

  private drawFood(o: CanvasRenderingContext2D, cx: number, cy: number, p: Palette): void {
    const px = cx * CELL_PX + CELL_PX / 2
    const py = cy * CELL_PX + CELL_PX / 2
    o.save()
    o.globalAlpha = 0.35
    o.fillStyle = p.food
    o.beginPath()
    o.arc(px, py, 4, 0, Math.PI * 2)
    o.fill()
    o.globalAlpha = 1
    o.beginPath()
    o.arc(px, py, 2.5, 0, Math.PI * 2)
    o.fill()
    o.restore()
  }

  private drawSnake(o: CanvasRenderingContext2D, s: SnakeState, alpha: number, p: Palette): void {
    // Draw tail-to-head so the head sits on top.
    for (let i = s.bodyLen - 1; i >= 0; i--) {
      let fx: number
      let fy: number
      if (i < this.prevBodyLen) {
        // glide this segment from its previous cell to its current cell by alpha
        const pcx = this.prevBodyX[i] ?? s.bodyX[i] ?? 0
        const pcy = this.prevBodyY[i] ?? s.bodyY[i] ?? 0
        const ccx = s.bodyX[i] ?? 0
        const ccy = s.bodyY[i] ?? 0
        fx = (pcx + (ccx - pcx) * alpha) * CELL_PX
        fy = (pcy + (ccy - pcy) * alpha) * CELL_PX
      } else {
        // a freshly-grown tail holds static this tick (see snake-walk / P4.1)
        fx = (s.bodyX[i] ?? 0) * CELL_PX
        fy = (s.bodyY[i] ?? 0) * CELL_PX
      }
      const rx = Math.round(fx)
      const ry = Math.round(fy)
      o.fillStyle = i === 0 ? p.head : p.body
      o.fillRect(rx + 1, ry + 1, CELL_PX - 2, CELL_PX - 2)
      if (i === 0) this.drawEyes(o, rx, ry, s.dir, p.accent)
    }
  }

  private drawEyes(o: CanvasRenderingContext2D, rx: number, ry: number, dir: number, color: string): void {
    const dx = DX[dir] ?? 0
    const dy = DY[dir] ?? 0
    o.fillStyle = color
    o.fillRect(Math.round(rx + 3) + dx, Math.round(ry + 3) + dy, 2, 2)
    o.fillRect(Math.round(rx + 5) + dx, Math.round(ry + 5) + dy, 2, 2)
  }
}
