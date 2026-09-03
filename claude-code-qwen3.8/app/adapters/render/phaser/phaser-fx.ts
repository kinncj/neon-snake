// The Phaser (v3.60, packaged as "phaser" 4.x) screen-space FX layer. It
// composites the game into one WebGL canvas that sits ON TOP of the 2D
// framebuffer (the guaranteed fallback, always drawn beneath). This is a 2D
// renderer used in screen-space: it draws the field, the blocky neon snake,
// the food halo, GPU-style particles, and a subtle CRT post. It is NOT a 3D
// scene — there is no scene graph, no perspective, no mesh geometry.
//
// Design goals (see ADR 0001 / 0007):
//   - Defensive: any failure (no WebGL, context loss, an exception) degrades to
//     the 2D fallback. `init()` returns false and the canvas is hidden; the 2D
//     framebuffer (drawn beneath) is always visible. Never a black screen.
//   - The darkening CRT post (vignette) is confined to the letterbox so it never
//     obscures the playfield (user requirement). Scanlines/flicker are kept at a
//     subtle intensity that adds texture without reducing legibility.
//   - Zero steady-state JS allocation in our code: when FX is off the engine
//     ticker is paused and we do nothing per frame.
//   - Draw batches stay low (a handful of Graphics objects), well under 12.
import Phaser from 'phaser'
import { CELL_PX, GRID_H, GRID_W, type SnakeState } from '../../../domain/types'
import type { Layout } from '../framebuffer'
import { ParticleSystem } from '../particles'
import { walkSegment, type WalkBody } from '../snake-walk'
import type { Palette } from '../theme'

export type FxTier = 'low' | 'high' | 'ultra'

/** FX is only active for high/ultra; low and reduced fall back to the 2D path. */
export function fxActive(tier: string): boolean {
  return tier === 'high' || tier === 'ultra'
}

export interface FxCallbacks {
  onContextLoss?: () => void
  onContextRestored?: () => void
}

interface FxFrame {
  state: SnakeState
  alpha: number
  palette: Palette
  particles: ParticleSystem | null
  /** Previous-tick body snapshot (grid coords) for the smooth-walk glide. */
  prev: { x: Int32Array; y: Int32Array; len: number }
}

const TAU = Math.PI * 2

// ---- colour helpers --------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---- the scene (thin adapter; all logic lives in PhaserFx) -----------------
class FxScene extends Phaser.Scene {
  private readonly fx: PhaserFx
  ready = false
  g!: Phaser.GameObjects.Graphics
  gPost!: Phaser.GameObjects.Graphics

  constructor(fx: PhaserFx) {
    super({ key: 'fx' })
    this.fx = fx
  }
  create(): void {
    this.cameras.main.setBackgroundColor('#000000')
    this.g = this.add.graphics()
    this.gPost = this.add.graphics()
    this.gPost.setDepth(10)
    this.ready = true
  }
  override update(_t: number, delta: number): void {
    if (this.ready) this.fx.sceneUpdate(this, this.g, this.gPost, delta)
  }
}

export class PhaserFx {
  private readonly host: HTMLElement
  private readonly cb: FxCallbacks
  private game: Phaser.Game | null = null
  private scene: FxScene | null = null
  private canvas: HTMLCanvasElement | null = null
  private layout: Layout = { w: 1, h: 1, scale: 1, offX: 0, offY: 0 }
  // CSS-px geometry for the FX canvas. Phaser's coordinate system is in CSS px;
  // the engine scales the backing store by devicePixelRatio internally. All FX
  // drawing uses these CSS-px values so the FX field aligns with the 2D field.
  private dpr = 1
  private cssW = 1
  private cssH = 1
  private fieldOx = 0
  private fieldOy = 0
  private cellCss = CELL_PX
  private frame: FxFrame | null = null
  private lost = false

  // Per-frame effect state (decayed in sceneUpdate; set by the trigger methods).
  private flashAmt = 0
  /** 0 = full-frame, 1 = right-local (wall), -1 = left-local (wall). */
  private flashDir: number = 0
  private shakeAmt = 0
  private shockX = -1
  private shockY = -1
  private shockT = 0
  private levelUpT = 0

  /** True once WebGL booted and the scene is usable. */
  webgl = false
  enabled = false

  constructor(host: HTMLElement, cb: FxCallbacks = {}) {
    this.host = host
    this.cb = cb
  }

  /**
   * Boot the engine. Returns true if WebGL booted and the FX layer is usable.
   * On any failure the engine is torn down and the 2D fallback remains (the
   * canvas is never shown, so the user always sees the 2D framebuffer).
   */
  init(): boolean {
    if (this.game) return this.webgl
    try {
      const scene = new FxScene(this)
      this.scene = scene
      const game = new Phaser.Game({
        type: Phaser.WEBGL,
        parent: this.host,
        width: this.cssW,
        height: this.cssH,
        backgroundColor: '#000000',
        scene,
        disableContextMenu: true,
        banner: false,
      })
      this.game = game
      this.canvas = game.canvas as HTMLCanvasElement
      // Keep the FX canvas from stealing input; it sits above the 2D canvas.
      this.canvas.style.position = 'absolute'
      this.canvas.style.inset = '0'
      this.canvas.style.pointerEvents = 'none'
      this.canvas.style.display = 'none'
      this.canvas.addEventListener('webglcontextlost', this.onLost)
      this.canvas.addEventListener('webglcontextrestored', this.onRestored)
      this.webgl = true
      this.hide()
      return true
    } catch {
      this.destroyEngine()
      return false
    }
  }

  private onLost = (e: Event): void => {
    e.preventDefault()
    this.lost = true
    this.hide()
    this.cb.onContextLoss?.()
  }
  private onRestored = (): void => {
    this.lost = false
    this.cb.onContextRestored?.()
    // Re-show only if the caller re-enables FX (the governor decides).
  }

  /**
   * Size the FX canvas to match the 2D display layout. The 2D layout is in
   * device px; the FX canvas (Phaser) works in CSS px, so divide by dpr. The
   * field origin and per-cell size are converted to CSS px so the FX field
   * aligns exactly with the 2D field.
   */
  resize(layout: Layout): void {
    this.layout = layout
    const dpr = window.devicePixelRatio || 1
    this.dpr = dpr
    this.cssW = Math.max(1, Math.round(layout.w / dpr))
    this.cssH = Math.max(1, Math.round(layout.h / dpr))
    this.fieldOx = layout.offX / dpr
    this.fieldOy = layout.offY / dpr
    this.cellCss = (CELL_PX * layout.scale) / dpr
    if (this.game) {
      try {
        this.game.scale.resize(this.cssW, this.cssH)
      } catch {
        // ignore — the 2D fallback still renders
      }
    }
  }

  /** Set the per-frame input (state, alpha, palette, particles, prev body). */
  setFrame(
    s: SnakeState,
    alpha: number,
    palette: Palette,
    particles: ParticleSystem | null,
    prev: { x: Int32Array; y: Int32Array; len: number },
  ): void {
    this.frame = { state: s, alpha, palette, particles, prev }
  }

  /** True while the WebGL context is alive (not lost). The watchdog degrades to
   *  the 2D path if the FX is enabled but unhealthy. */
  healthy(): boolean {
    return this.webgl && !this.lost
  }

  /**
   * Enable or disable the FX layer. Enabling shows the canvas and resumes the
   * engine ticker; disabling hides the canvas and pauses the ticker (zero
   * steady-state work — the 2D framebuffer beneath is the visible render).
   */
  setEnabled(v: boolean, tier: FxTier): void {
    this.enabled = v && this.webgl && !this.lost
    if (!this.canvas) return
    if (this.enabled) {
      this.canvas.style.display = ''
      this.game?.loop.resume()
      // store the tier for the post pass (ultra adds the heavier overlays)
      ;(this as unknown as { _tier: FxTier })._tier = tier
    } else {
      this.hide()
    }
  }

  private hide(): void {
    if (this.canvas) this.canvas.style.display = 'none'
    this.game?.loop.pause()
  }

  // ---- effect triggers (called by main on domain effects) ------------------
  /** A full-frame or directional flash (0..1). `dir` 0=full, 1=right, -1=left. */
  flash(power: number, dir: number): void {
    this.flashAmt = Math.max(this.flashAmt, Math.min(1, power))
    this.flashDir = dir
  }
  /** Camera shake in device px (decays). */
  shake(px: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, px)
  }
  /** A radial shockwave from a framebuffer-pixel position. */
  shockwave(x: number, y: number): void {
    this.shockX = x
    this.shockY = y
    this.shockT = 1
  }
  /** A short level-up re-tint pulse (0..1). */
  levelUpPulse(): void {
    this.levelUpT = 1
  }

  /** Tear down the engine (e.g. on page hide / unmount). */
  destroy(): void {
    this.destroyEngine()
    this.webgl = false
    this.enabled = false
  }

  private destroyEngine(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onLost)
      this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    }
    try {
      this.game?.destroy(true)
    } catch {
      // ignore
    }
    this.game = null
    this.scene = null
    this.canvas = null
  }

  /**
   * The per-frame render. Called by the scene's update(). Reads the shared
   * frame, draws the field/snake/food/particles, decays and draws the CRT post
   * and one-shot effects. All drawing is screen-space on the FX canvas.
   */
  sceneUpdate(scene: FxScene, g: Phaser.GameObjects.Graphics, gPost: Phaser.GameObjects.Graphics, delta: number): void {
    const f = this.frame
    if (!f) return
    const { state: s, alpha, palette: p, particles } = f
    const cs = this.cellCss // CSS px per cell
    const ox0 = this.fieldOx
    const oy0 = this.fieldOy
    const fieldW = GRID_W * cs
    const fieldH = GRID_H * cs
    const pxPerFb = cs / CELL_PX // CSS px per framebuffer px (for particles/shock)
    const tier = (this as unknown as { _tier?: FxTier })._tier ?? 'high'

    // Decay effect timers (per-frame, allocation-free).
    const dt = Math.min(delta, 100) / 1000
    this.flashAmt = Math.max(0, this.flashAmt - dt * 3.2)
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 60)
    this.shockT = Math.max(0, this.shockT - dt * 2.6)
    this.levelUpT = Math.max(0, this.levelUpT - dt * 1.4)

    g.clear()
    gPost.clear()

    // Camera shake: offset the field draw by a decaying jitter.
    let shx = 0
    let shy = 0
    if (this.shakeAmt > 0.2) {
      const m = this.shakeAmt
      shx = Math.round((Math.random() * 2 - 1) * m)
      shy = Math.round((Math.random() * 2 - 1) * m)
    }
    const ox = ox0 + shx
    const oy = oy0 + shy

    // 1) background + grid (brightened on the FX path so it reads under CRT).
    const bg = hexToRgb(p.bg)
    g.fillStyle(Phaser.Display.Color.GetColor(bg[0], bg[1], bg[2]), 1)
    g.fillRect(0, 0, this.cssW, this.cssH)
    const grid = hexToRgb(p.grid)
    const gridR = Math.min(255, grid[0] + 34)
    const gridG = Math.min(255, grid[1] + 34)
    const gridB = Math.min(255, grid[2] + 46)
    g.lineStyle(1, Phaser.Display.Color.GetColor(gridR, gridG, gridB), tier === 'ultra' ? 0.9 : 0.7)
    for (let x = 0; x <= GRID_W; x++) g.lineBetween(ox + x * cs, oy, ox + x * cs, oy + fieldH)
    for (let y = 0; y <= GRID_H; y++) g.lineBetween(ox, oy + y * cs, ox + fieldW, oy + y * cs)

    // 2) food with an emissive halo.
    if (s.foodX !== -1) {
      const fx = ox + (s.foodX + 0.5) * cs
      const fy = oy + (s.foodY + 0.5) * cs
      const fc = hexToRgb(p.food)
      const halo = Math.max(2, 4 * (cs / CELL_PX))
      // P4.2: a softer emissive halo (gentler glow radii + alpha) — the bright
      // core is unchanged so the food still reads clearly.
      g.fillStyle(Phaser.Display.Color.GetColor(fc[0], fc[1], fc[2]), 0.16)
      g.fillCircle(fx, fy, halo * 1.9)
      g.fillStyle(Phaser.Display.Color.GetColor(fc[0], fc[1], fc[2]), 0.4)
      g.fillCircle(fx, fy, halo * 1.2)
      g.fillStyle(Phaser.Display.Color.GetColor(255, 255, 255), 0.9)
      g.fillCircle(fx, fy, halo * 0.7)
    }

    // 3) the blocky neon snake, gliding prev -> current by `alpha` (smooth walk)
    //    with an emissive afterglow trail (matches the 2D ground-truth composite).
    this.drawSnake(g, s, p, ox, oy, cs, alpha, f.prev)

    // 4) particles (shared with the 2D framebuffer; positions in framebuffer px).
    if (particles && particles.active > 0) this.drawParticles(g, particles, ox, oy, pxPerFb)

    // 5) CRT post + one-shot effects (see the class doc for the playfield rule).
    this.drawPost(gPost, p, ox, oy, fieldW, fieldH, pxPerFb, tier)
  }

  private drawSnake(
    g: Phaser.GameObjects.Graphics,
    s: SnakeState,
    p: Palette,
    ox: number,
    oy: number,
    cs: number,
    alpha: number,
    prev: { x: Int32Array; y: Int32Array; len: number },
  ): void {
    const bodyC = hexToRgb(p.body)
    const headC = hexToRgb(p.head)
    const accC = hexToRgb(p.accent)
    const bodyG = Math.min(255, bodyC[1] * 0.9 + 20)

    // Emissive afterglow trail: a fading glow at the head's previous cell (the
    // one it just left) that dies out as the head glides forward — a discrete
    // glow trail, not a smeared motion-blur/ghost. Drawn behind the body.
    if (alpha < 1) {
      const phx = (prev.x[0] ?? (s.bodyX[0] ?? 0)) + 0.5
      const phy = (prev.y[0] ?? (s.bodyY[0] ?? 0)) + 0.5
      g.fillStyle(Phaser.Display.Color.GetColor(headC[0], headC[1], headC[2]), (1 - alpha) * 0.26)
      g.fillCircle(ox + phx * cs, oy + phy * cs, cs * 0.6)
    }

    // The glide is the pure smooth-walk from `snake-walk` (P4.1): the tail is
    // detected by index and holds static on a growth tick, never reading a stale
    // preallocated body cell. It mirrors the 2D ground-truth composite.
    const body: WalkBody = { x: s.bodyX, y: s.bodyY, len: s.bodyLen }
    for (let i = s.bodyLen - 1; i >= 0; i--) {
      const seg = walkSegment(body, i, prev.len, alpha)
      const px = ox + seg.x * cs
      const py = oy + seg.y * cs
      const inset = Math.max(1, cs * 0.12)
      if (i === 0) {
        // halo + block + direction-facing eyes
        g.fillStyle(Phaser.Display.Color.GetColor(headC[0], headC[1], headC[2]), 0.35)
        g.fillRoundedRect(px - inset * 0.5, py - inset * 0.5, cs + inset, cs + inset, cs * 0.35)
        g.fillStyle(Phaser.Display.Color.GetColor(headC[0], headC[1], headC[2]), 1)
        g.fillRoundedRect(px + inset, py + inset, cs - inset * 2, cs - inset * 2, cs * 0.22)
        this.drawEyes(g, px, py, cs, s.dir, accC)
      } else {
        g.fillStyle(Phaser.Display.Color.GetColor(bodyC[0], bodyG, bodyC[2]), 0.95)
        g.fillRoundedRect(px + inset, py + inset, cs - inset * 2, cs - inset * 2, cs * 0.2)
      }
    }
  }

  private drawEyes(
    g: Phaser.GameObjects.Graphics,
    px: number,
    py: number,
    cs: number,
    dir: number,
    c: [number, number, number],
  ): void {
    // 0=up,1=right,2=down,3=left. Two eyes offset along the travel axis.
    const e = cs * 0.22
    const off = cs * 0.18
    let ax = 0
    let ay = 0
    let bx = 0
    let by = 0
    if (dir === 0) {
      ax = -off; ay = -off; bx = off; by = -off
    } else if (dir === 2) {
      ax = -off; ay = off; bx = off; by = off
    } else if (dir === 1) {
      ax = off; ay = -off; bx = off; by = off
    } else {
      ax = -off; ay = -off; bx = -off; by = off
    }
    g.fillStyle(Phaser.Display.Color.GetColor(c[0], c[1], c[2]), 1)
    g.fillCircle(px + cs / 2 + ax, py + cs / 2 + ay, e)
    g.fillCircle(px + cs / 2 + bx, py + cs / 2 + by, e)
  }

  private drawParticles(
    g: Phaser.GameObjects.Graphics,
    ps: ParticleSystem,
    ox: number,
    oy: number,
    pxPerFb: number,
  ): void {
    const c: [number, number, number] = [255, 255, 255]
    ps.forEachLive((i) => {
      ps.colorAt(i, c)
      const a = ps.alphaAt(i)
      const x = ox + ParticleSystem.clampX(ps.xAt(i)) * pxPerFb
      const y = oy + ParticleSystem.clampY(ps.yAt(i)) * pxPerFb
      const r = Math.max(0.5, ps.sizeAt(i) * a) * pxPerFb
      g.fillStyle(Phaser.Display.Color.GetColor(c[0], c[1], c[2]), a)
      g.fillCircle(x, y, r)
    })
  }

  private drawPost(
    gPost: Phaser.GameObjects.Graphics,
    p: Palette,
    ox: number,
    oy: number,
    fieldW: number,
    fieldH: number,
    pxPerFb: number,
    tier: FxTier,
  ): void {
    const now = performance.now() / 1000
    const W = this.cssW
    const H = this.cssH

    // --- shockwave (expanding ring from the framebuffer position) ----------
    if (this.shockT > 0 && this.shockX >= 0) {
      const sx = ox + this.shockX * pxPerFb
      const sy = oy + this.shockY * pxPerFb
      const r = (1 - this.shockT) * fieldW * 0.6
      const c = hexToRgb(p.accent)
      gPost.lineStyle(Math.max(2, 6 * pxPerFb * this.shockT), Phaser.Display.Color.GetColor(c[0], c[1], c[2]), this.shockT * 0.8)
      gPost.strokeCircle(sx, sy, r)
    }

    // --- flash (full-frame or wall-local) ----------------------------------
    if (this.flashAmt > 0.01) {
      const fc = hexToRgb(p.accent)
      const a = this.flashAmt * 0.5
      if (this.flashDir === 0) {
        gPost.fillStyle(Phaser.Display.Color.GetColor(fc[0], fc[1], fc[2]), a)
        gPost.fillRect(0, 0, W, H)
      } else {
        // Wall death: the flash is LOCAL to the wall (right or left half),
        // never sweeping across the centre of the play.
        const halfW = W / 2
        if (this.flashDir > 0) {
          gPost.fillStyle(Phaser.Display.Color.GetColor(fc[0], fc[1], fc[2]), a)
          gPost.fillRect(W - halfW, 0, halfW, H)
        } else {
          gPost.fillStyle(Phaser.Display.Color.GetColor(fc[0], fc[1], fc[2]), a)
          gPost.fillRect(0, 0, halfW, H)
        }
      }
    }

    // --- level-up re-tint pulse -------------------------------------------
    if (this.levelUpT > 0.01) {
      const c = hexToRgb(p.accent)
      gPost.fillStyle(Phaser.Display.Color.GetColor(c[0], c[1], c[2]), this.levelUpT * 0.18)
      gPost.fillRect(ox, oy, fieldW, fieldH)
    }

    if (tier !== 'ultra') return // high = snake/food/particles/shake; no CRT overlays

    // --- CRT post (ultra) --------------------------------------------------
    // Scanlines: the CRT mask at the spec's base intensity (0.16). A 1px line
    // every 4px at this alpha adds scanline texture without reducing legibility.
    const scanY = Math.floor(now * 8) % 4
    gPost.fillStyle(0x000000, 0.16)
    for (let y = scanY; y < H; y += 4) gPost.fillRect(0, y, W, 1)

    // Slow single-sine luminance flicker (~4.2s period), very low amplitude.
    const flick = 0.5 + 0.5 * Math.sin(now * (TAU / 4.2))
    gPost.fillStyle(0xffffff, 0.02 * flick)
    gPost.fillRect(0, 0, W, H)

    // Vignette: confined to the LETTERBOX (outside the playfield) so it never
    // darkens the area the player is looking at. Drawn as four border gradients.
    this.drawLetterboxVignette(gPost, ox, oy, fieldW, fieldH)
  }

  private drawLetterboxVignette(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    fw: number,
    fh: number,
  ): void {
    // The field is centred; the letterbox margins are the top/bottom/left/right
    // strips. Darken ONLY those strips (the vignette peak is 0.9 at the outer
    // edge, fading toward the field) so it never darkens the playfield — the
    // user requirement that post-FX stay off the playable area.
    const W = this.cssW
    const H = this.cssH
    const steps = 6
    // P4.2: softer vignette (the user flagged the dark edge). Peak is 0.55 (was
    // 0.9) and — as before — confined to the letterbox so it never darkens play.
    const fade = 0.55
    // top strip
    if (oy > 0) {
      const sh = oy / steps
      for (let i = 0; i < steps; i++) {
        g.fillStyle(0x000000, fade * (1 - i / steps))
        g.fillRect(0, oy - (i + 1) * sh, W, sh)
      }
    }
    // bottom strip
    const by = oy + fh
    if (by < H) {
      const sh = (H - by) / steps
      for (let i = 0; i < steps; i++) {
        g.fillStyle(0x000000, fade * (1 - i / steps))
        g.fillRect(0, by + i * sh, W, sh)
      }
    }
    // left strip
    if (ox > 0) {
      const sw = ox / steps
      for (let i = 0; i < steps; i++) {
        g.fillStyle(0x000000, fade * (1 - i / steps))
        g.fillRect(ox - (i + 1) * sw, 0, sw, H)
      }
    }
    // right strip
    const rx = ox + fw
    if (rx < W) {
      const sw = (W - rx) / steps
      for (let i = 0; i < steps; i++) {
        g.fillStyle(0x000000, fade * (1 - i / steps))
        g.fillRect(rx + i * sw, 0, sw, H)
      }
    }
  }
}
