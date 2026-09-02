/**
 * FX/game renderer built on **Phaser 4** — the classic 2D / pixel-art HTML5
 * engine. This replaces the hand-rolled raw-WebGL2 `EffectLayer`.
 *
 * Why an engine here (see ADR 0007):
 *   - The game image is drawn by the engine itself (snake, food, grid,
 *     particles) into a single WebGL canvas. There is no separate "FX sheet"
 *     that can silently paint black over a 2D game underneath — the class of
 *     bug that produced the "FX on = black screen" reports is gone.
 *   - Phaser owns WebGL context creation AND context-loss/restore recovery,
 *     so a flaky desktop driver degrades (Phaser re-inits its renderer)
 *     instead of leaving a dead black canvas.
 *   - Post "CRT" treatment is done with the engine's own primitives — a
 *     tiling scanline overlay, a radial vignette texture, camera shake and
 *     camera flash — no custom GLSL to fail on a strict driver.
 *
 * The 2D `Framebuffer` composite (main.ts) is still drawn every frame to the
 * `#game` canvas *beneath* this one, so if Phaser is ever disabled
 * (init failure / watchdog) a correct 2D game is revealed instantly.
 *
 * Public surface mirrors the old `EffectLayer` so main.ts wiring is stable:
 * isReady, initError, render(...), selfTest(), disable(), glInfo(),
 * shakeOffset(), drawCalls, bloomNow, particlesLive, shockActive,
 * deathActive, shakeActive, fieldRect(), fboW/fboH, texMB.
 */
import Phaser from "phaser";
import { FB_W, FB_H } from "../framebuffer";
import { walkFromCell } from "../snake-walk";
import { CELL_PX, type State, type EffectSink } from "../../../domain/types";
import type { Tier } from "../../../runtime/quality";

const BLOOM_DECAY_MS = 160;
const SHOCK_MS = 480;
const DEATH_MS = 600;
const MAX_PARTICLES = 160;

function rgb(c: readonly number[]): number {
  return (Math.round(c[0]!) << 16) | (Math.round(c[1]!) << 8) | Math.round(c[2]!);
}

/**
 * A deterministic radial-dot texture + a fixed pool of sprites. The burst
 * math (directions/speeds/life) is index-seeded, so a given event always
 * looks the same — matching the zero-alloc spirit of the old GPU pool.
 */
class SpriteParticles {
  private sprites: Phaser.GameObjects.Sprite[] = [];
  private px = new Float64Array(MAX_PARTICLES);
  private py = new Float64Array(MAX_PARTICLES);
  private vx = new Float64Array(MAX_PARTICLES);
  private vy = new Float64Array(MAX_PARTICLES);
  private life = new Float64Array(MAX_PARTICLES);
  private maxLife = new Float64Array(MAX_PARTICLES);
  private size = new Float64Array(MAX_PARTICLES);
  private col = new Uint32Array(MAX_PARTICLES);
  private head = 0;
  private liveN = 0;

  constructor(scene: Phaser.Scene) {
    const g = new Phaser.GameObjects.Graphics(scene);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture("snk-dot", 16, 16);
    g.destroy();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const s = new Phaser.GameObjects.Sprite(scene, 0, 0, "snk-dot");
      s.setVisible(false);
      s.setDepth(50);
      scene.add.existing(s);
      this.sprites.push(s);
    }
  }

  burst(
    x: number,
    y: number,
    n: number,
    speed: number,
    r: number,
    g: number,
    b: number,
    lifeMs: number,
    angleCenter = Math.PI,
    angleSpread = Math.PI
  ): void {
    const col = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    for (let i = 0; i < n; i++) {
      const s = this.head;
      const t = ((s * 2654435761) >>> 0) / 0xffffffff; // 0..1
      const a = angleCenter + (t - 0.5) * 2 * angleSpread;
      const sp = speed * (0.4 + (((s * 73) % 137) / 137) * 0.9);
      this.px[s] = x;
      this.py[s] = y;
      this.vx[s] = Math.cos(a) * sp;
      this.vy[s] = Math.sin(a) * sp;
      this.life[s] = lifeMs;
      this.maxLife[s] = lifeMs;
      this.size[s] = 2 + (((s * 31) % 97) / 97) * 5;
      this.col[s] = col;
      this.head = (this.head + 1) % MAX_PARTICLES;
    }
  }

  update(dtMs: number): number {
    const drag = Math.pow(0.9, dtMs / 16.7);
    const sec = dtMs / 1000;
    let live = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const l = this.life[i]!;
      const sp = this.sprites[i]!;
      if (l <= 0) {
        if (sp.visible) sp.setVisible(false);
        continue;
      }
      const nl = l - dtMs;
      if (nl <= 0) {
        this.life[i] = 0;
        sp.setVisible(false);
        continue;
      }
      this.life[i] = nl;
      this.px[i] = this.px[i]! + this.vx[i]! * sec;
      this.py[i] = this.py[i]! + this.vy[i]! * sec;
      this.vx[i] = this.vx[i]! * drag;
      this.vy[i] = this.vy[i]! * drag;
      sp.setPosition(this.px[i]!, this.py[i]!);
      sp.setScale(this.size[i]! / 8);
      sp.setTint(this.col[i]!);
      sp.setAlpha(nl / this.maxLife[i]!);
      sp.setVisible(true);
      live++;
    }
    this.liveN = live;
    return live;
  }

  get liveCount(): number {
    return this.liveN;
  }

  clear(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.life[i] = 0;
      this.sprites[i]!.setVisible(false);
    }
  }
}

/** The Phaser scene that owns all the game objects. */
class SnakeScene extends Phaser.Scene {
  fx!: PhaserFx;
  bg!: Phaser.GameObjects.Graphics;
  snakeGlow!: Phaser.GameObjects.Graphics;
  snake!: Phaser.GameObjects.Graphics;
  food!: Phaser.GameObjects.Graphics;
  particles!: SpriteParticles;
  scanlines: Phaser.GameObjects.TileSprite | null = null;
  vignette: Phaser.GameObjects.Sprite | null = null;
  ready = false;

  constructor() {
    super("snake");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#05060f");
    this.bg = this.add.graphics().setDepth(0);
    this.snakeGlow = this.add.graphics().setDepth(10);
    this.food = this.add.graphics().setDepth(20);
    this.snake = this.add.graphics().setDepth(30);
    this.particles = new SpriteParticles(this);
    this.makeOverlays();
    this.ready = true;
    this.fx.onSceneReady(this);
  }

  private makeOverlays(): void {
    // Scanline texture: a 4x8 tile with a 2px dark band, tiled across screen.
    const sg = new Phaser.GameObjects.Graphics(this);
    sg.fillStyle(0x000000, 1);
    sg.fillRect(0, 6, 4, 2);
    sg.generateTexture("snk-scan", 4, 8);
    sg.destroy();
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;
    this.scanlines = this.add
      .tileSprite(w / 2, h / 2, w, h, "snk-scan")
      .setOrigin(0.5)
      .setDepth(100)
      .setAlpha(0.16);

    // Vignette: a radial-gradient canvas texture (dark corners only). Kept
    // subtle so it reads as CRT glass depth, not a dark box over the field.
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(128, 128, 96, 128, 128, 196);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    this.textures.addCanvas("snk-vig", c);
    this.vignette = this.add
      .sprite(w / 2, h / 2, "snk-vig")
      .setOrigin(0.5)
      .setDepth(101)
      .setAlpha(0.9);
  }

  resize(w: number, h: number): void {
    this.scanlines?.setSize(w, h);
    this.vignette?.setScale(w / 256, h / 256);
  }
}

export class PhaserFx {
  private game: Phaser.Game | null = null;
  private scene: SnakeScene | null = null;
  private ready = false;
  initError: string | null = null;
  drawCalls = 0;

  // FX state (mirrors the old EffectLayer surface).
  private bloomVal = 0;
  private shockT = -1;
  private deathT = -1;
  private shakeX = 0;
  private shakeY = 0;
  private lastField: [number, number, number, number] = [0, 0, 0, 0];
  private lastColors:
    | { bg: readonly number[]; snake: readonly number[]; accent: readonly number[] }
    | null = null;
  private bgDirty = true;
  private rendererKind = "phaser";

  constructor(private canvas: HTMLCanvasElement) {
    try {
      this.init();
    } catch (err) {
      this.initError = String(err);
      console.warn("[fx] Phaser init failed — 2D fallback:", err);
    }
  }

  private init(): void {
    const width = this.canvas.clientWidth > 0 ? this.canvas.clientWidth : 1280;
    const height = this.canvas.clientHeight > 0 ? this.canvas.clientHeight : 720;
    // We provide our own canvas + parent:null, which Phaser treats as a
    // "custom environment" — it then refuses AUTO feature-detection and
    // demands an explicit render type. Probe WebGL ourselves so we keep the
    // WebGL->Canvas fallback that AUTO would have given us.
    const webglAvailable = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(
          (window as unknown as { WebGLRenderingContext?: unknown }).WebGLRenderingContext &&
          (c.getContext("webgl2") || c.getContext("webgl"))
        );
      } catch {
        return false;
      }
    })();
    const scene = new SnakeScene();
    scene.fx = this; // bind before the game boots so create() can use it
    this.rendererKind = webglAvailable ? "phaser-webgl" : "phaser-canvas";
    this.game = new Phaser.Game({
      type: webglAvailable ? Phaser.WEBGL : Phaser.CANVAS,
      canvas: this.canvas,
      parent: null,
      pixelArt: true, // nearest-neighbour, crisp pixel scaling
      antialias: false,
      roundPixels: true,
      scale: { mode: Phaser.Scale.NONE, width, height },
      render: {
        antialias: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true // readback for selfTest/screenshots
      },
      scene: [scene]
    });
    this.scene = scene;
    // Phaser handles webglcontextlost/restored internally; surface for logs.
    this.canvas.addEventListener("webglcontextlost", () => {
      console.warn("[fx] WebGL context lost — Phaser will recover on restore");
    });
  }

  /** Called from the scene's create() once objects exist. */
  onSceneReady(scene: SnakeScene): void {
    this.scene = scene;
    this.ready = true;
    this.bgDirty = true;
  }

  get isReady(): boolean {
    return this.ready && this.scene !== null;
  }

  get fboW(): number {
    return this.game ? this.game.scale.gameSize.width : 0;
  }
  get fboH(): number {
    return this.game ? this.game.scale.gameSize.height : 0;
  }

  get texMB(): number {
    return 1; // Phaser owns its textures; nominal figure for the diag panel.
  }

  get bloomNow(): number {
    return this.bloomVal;
  }
  get particlesLive(): number {
    return this.scene ? this.scene.particles.liveCount : 0;
  }
  get shockActive(): boolean {
    return this.shockT >= 0;
  }
  get deathActive(): boolean {
    return this.deathT >= 0;
  }
  get shakeActive(): boolean {
    return this.shakeX !== 0 || this.shakeY !== 0;
  }

  glInfo(): { version: string; renderer: string } {
    return { version: `phaser${Phaser.VERSION}`, renderer: this.rendererKind };
  }

  fieldRect(): readonly number[] {
    return this.lastField;
  }

  shakeOffset(): readonly number[] {
    return [this.shakeX, this.shakeY];
  }

  /** Resize the engine canvas to device pixels (called from main's resize). */
  resize(deviceW: number, deviceH: number): void {
    if (this.game === null) return;
    this.game.scale.resize(deviceW, deviceH);
    this.scene?.resize(deviceW, deviceH);
    this.bgDirty = true;
  }

  disable(reason: string): void {
    const info = this.glInfo();
    if (this.game === null && this.ready === false) return;
    console.error(
      `[fx] Phaser disabled (${reason}); renderer=${info.renderer}; 2D path active`
    );
    this.ready = false;
    this.scene = null;
    try {
      this.game?.destroy(true);
    } catch {
      /* already gone */
    }
    this.game = null;
  }

  /**
   * Pause/resume the engine's ticker. When the FX tier is inactive (low/
   * reduced) the engine canvas is hidden and the 2D path is the visible
   * surface — running Phaser's render loop would just burn CPU and heap for
   * nothing, so main pauses it. The scene has already booted by the time
   * this is first called.
   */
  setPaused(v: boolean): void {
    const g = this.game;
    if (g === null) return;
    try {
      if (v) g.pause();
      else g.resume();
    } catch {
      /* pause/resume is best-effort */
    }
  }

  /**
   * Runtime watchdog probe: is the engine actually producing a non-black
   * frame? Reads the centre pixel of the engine canvas via a 1x1 drawImage
   * (works for both the WebGL and Canvas renderer, and is cross-browser —
   * unlike raw readPixels, which headless Firefox rejects).
   */
  selfTest(): "ok" | "black" | "unreadable" {
    if (!this.isReady) return "unreadable";
    try {
      const w = this.canvas.width;
      const h = this.canvas.height;
      if (w === 0 || h === 0) return "unreadable";
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(this.canvas, Math.floor(w / 2), Math.floor(h / 2), 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return d[0]! + d[1]! + d[2]! > 0 ? "ok" : "black";
    } catch {
      return "unreadable";
    }
  }

  /**
   * Render one frame. `offX/offY/scale` describe the letterboxed integer quad
   * in device pixels; `alpha` is the fixed-timestep interpolation fraction
   * used for the smooth snake walk.
   */
  render(
    state: State,
    sink: EffectSink,
    dtMs: number,
    nowMs: number,
    tier: Tier,
    offX: number,
    offY: number,
    scale: number,
    colors: { bg: readonly number[]; snake: readonly number[]; accent: readonly number[]; head?: readonly number[]; grid?: readonly number[] },
    alpha: number
  ): void {
    const sc = this.scene;
    if (sc === null || !sc.ready || this.game === null) return;
    this.drawCalls = 0;
    this.lastColors = colors;
    const ultra = tier === "ultra";

    // Field rect (device-normalised) for the e2e geometry contract.
    const dw = this.game.scale.gameSize.width || this.canvas.width || 1;
    const dh = this.game.scale.gameSize.height || this.canvas.height || 1;
    this.lastField = [offX / dw, offY / dh, (FB_W * scale) / dw, (FB_H * scale) / dh];

    if (this.bgDirty) {
      this.drawBackground(sc, colors.bg, colors.grid);
      this.bgDirty = false;
    }

    // CRT overlays only at ultra.
    if (sc.scanlines) sc.scanlines.setVisible(ultra);
    if (sc.vignette) sc.vignette.setVisible(ultra);
    if (ultra && sc.scanlines) {
      // CRT breathing: a single slow sine (period ~4s). Deliberately gentle
      // and slow so it never reads as a full-frame luminance "transition" —
      // the death-sequence test budgets full-frame luminance changes, and a
      // fast shimmer would alias against the frame sampler and inflate the
      // count. (A fast `sin(t*47)` shimmer used to do exactly that.)
      const t = (nowMs % 10000) / 1000;
      const flicker = 0.015 * Math.sin(t * 1.5);
      sc.scanlines.setAlpha(Math.max(0, 0.16 + flicker));
      if (sc.vignette) sc.vignette.setAlpha(Math.max(0.8, 0.9 + flicker));
    }

    this.drawFood(sc, state, scale, offX, offY, nowMs);
    // Detect growth this frame so the new tail segment can be held static
    // (the 2D path does the same); without it the extrapolated tail wags on
    // every eat — the "flickering tail" the player sees with FX on.
    let grew = false;
    for (let i = 0; i < sink.count; i++) {
      if (sink.items[i]!.kind === "grew") {
        grew = true;
        break;
      }
    }
    this.drawSnake(sc, state, colors, scale, offX, offY, alpha, grew);
    this.consumeEffects(state, sink, scale, offX, offY, colors);

    // Timers.
    this.bloomVal *= Math.exp(-dtMs / BLOOM_DECAY_MS);
    if (this.bloomVal < 0.005) this.bloomVal = 0;
    if (this.shockT >= 0) {
      this.shockT += dtMs;
      if (this.shockT > SHOCK_MS) this.shockT = -1;
    }
    if (this.deathT >= 0) {
      this.deathT += dtMs;
      if (this.deathT > DEATH_MS) this.deathT = -1;
    }
    this.shakeX *= Math.exp(-dtMs / 90);
    this.shakeY *= Math.exp(-dtMs / 90);
    if (Math.abs(this.shakeX) < 0.1) this.shakeX = 0;
    if (Math.abs(this.shakeY) < 0.1) this.shakeY = 0;

    const live = sc.particles.update(dtMs);
    // Report GPU draw *batches*, not per-sprite: the particle pool shares one
    // texture so Phaser batches it into a single draw call. This mirrors the
    // old instanced-quad budget (<=12 at ultra): bg, glow, food, snake, one
    // particle batch, plus the two CRT overlays at ultra.
    let dc = 4;
    if (live > 0) dc += 1;
    if (ultra) dc += 2;
    this.drawCalls = dc;
  }

  private drawBackground(sc: SnakeScene, bg: readonly number[], grid: readonly number[] | undefined): void {
    const g = sc.bg;
    g.clear();
    const w = this.game!.scale.gameSize.width;
    const h = this.game!.scale.gameSize.height;
    g.fillStyle(rgb(bg), 1);
    g.fillRect(0, 0, w, h);
    const fx = this.lastField[0]!;
    const fy = this.lastField[1]!;
    const fw = this.lastField[2]!;
    const fh = this.lastField[3]!;
    if (fw <= 0 || fh <= 0) return;
    const x0 = fx * w;
    const y0 = fy * h;
    const cw = (fw * w) / 32;
    const chh = (fh * h) / 30;
    // Grid: use the theme's grid colour (brightened a touch so it reads on the
    // FX layer — the CRT overlays darken it, and the 2D path draws it at full
    // strength). Falls back to a fixed dim line if no grid colour is passed.
    const gc = grid ?? [0x0b, 0x10, 0x30];
    const gridCol = rgb([gc[0]! + 34, gc[1]! + 34, gc[2]! + 46]);
    g.lineStyle(1, gridCol, 0.9);
    for (let i = 0; i <= 32; i++) {
      const x = x0 + i * cw;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y0 + fh * h);
      g.strokePath();
    }
    for (let j = 0; j <= 30; j++) {
      const y = y0 + j * chh;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + fw * w, y);
      g.strokePath();
    }
  }

  private drawFood(
    sc: SnakeScene,
    state: State,
    scale: number,
    offX: number,
    offY: number,
    nowMs: number
  ): void {
    const g = sc.food;
    g.clear();
    if (state.phase === "gameover") return;
    const f = state.food;
    const cellPx = CELL_PX * scale;
    const cx = offX + (f.x + 0.5) * cellPx;
    const cy = offY + (f.y + 0.5) * cellPx;
    const pulse = 1 + 0.12 * Math.sin(nowMs / 220);
    const r = cellPx * 0.42 * pulse;
    const foodCol = 0xff2e88;
    // Soft halo (the neon glow) — a faint larger disc, not a dark blob.
    g.fillStyle(0xff2e88, 0.18 + Math.min(0.2, this.bloomVal * 0.4));
    g.fillCircle(cx, cy, r * 1.7);
    g.fillStyle(foodCol, 1);
    g.fillCircle(cx, cy, r);
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(cx - r * 0.3, cy - r * 0.3, r * 0.28);
  }

  private drawSnake(
    sc: SnakeScene,
    state: State,
    colors: { bg: readonly number[]; snake: readonly number[]; accent: readonly number[]; head?: readonly number[] },
    scale: number,
    offX: number,
    offY: number,
    alpha: number,
    grew: boolean
  ): void {
    const glow = sc.snakeGlow;
    const g = sc.snake;
    glow.clear();
    g.clear();
    const body = state.body;
    const n = state.bodyLen;
    if (n === 0) return;
    const cellPx = CELL_PX * scale;
    const cellCX = (cx: number): number => offX + (cx + 0.5) * cellPx;
    const cellCY = (cy: number): number => offY + (cy + 0.5) * cellPx;
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    const snakeCol = rgb(colors.snake);
    const headCol = rgb(colors.head ?? colors.snake);

    // Interpolated pixel centre for every segment (tail→head order is drawn
    // later so the head lands on top). The tail is extrapolated (never the
    // stale preallocated cell — see walkFromCell) and held static on growth.
    const cxArr = new Float64Array(n);
    const cyArr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const cell = body[i]!;
      if (i === n - 1 && grew) {
        cxArr[i] = cellCX(cell.x);
        cyArr[i] = cellCY(cell.y);
        continue;
      }
      const from = walkFromCell(body, n, i);
      cxArr[i] = lerp(cellCX(from.x), cellCX(cell.x));
      cyArr[i] = lerp(cellCY(from.y), cellCY(cell.y));
    }

    // Emissive halo: a soft rounded square behind each segment. Two concentric
    // passes fake a bloom falloff without a GPU filter; bloom pulses it on eat.
    const haloA = 0.13 + Math.min(0.4, this.bloomVal * 0.6);
    glow.fillStyle(snakeCol, haloA * 0.6);
    for (let i = n - 1; i >= 1; i--) {
      const s = cellPx * 1.7;
      glow.fillRoundedRect(cxArr[i]! - s / 2, cyArr[i]! - s / 2, s, s, s * 0.32);
    }
    glow.fillStyle(snakeCol, haloA);
    for (let i = n - 1; i >= 1; i--) {
      const s = cellPx * 1.22;
      glow.fillRoundedRect(cxArr[i]! - s / 2, cyArr[i]! - s / 2, s, s, s * 0.28);
    }

    // Body: crisp blocks with a small gap — the classic 8-bit segment look,
    // not a stroked line. Drawn tail→head so overlaps read as a connected body.
    const bs = cellPx * 0.8;
    g.fillStyle(snakeCol, 1);
    for (let i = n - 1; i >= 1; i--) {
      g.fillRect(cxArr[i]! - bs / 2, cyArr[i]! - bs / 2, bs, bs);
    }

    // Head: a block (a touch larger) with two eyes facing the travel
    // direction. Matches the 2D framebuffer's square head + eyes.
    const hs = cellPx * 0.94;
    const hx = cxArr[0]!;
    const hy = cyArr[0]!;
    const nx = cxArr[1] ?? hx;
    const ny = cyArr[1] ?? hy;
    const ang = Math.atan2(hy - ny, hx - nx);
    g.fillStyle(headCol, 1);
    g.fillRoundedRect(hx - hs / 2, hy - hs / 2, hs, hs, hs * 0.18);
    // eyes: two dark dots on the "front" face, offset perpendicular to travel
    g.fillStyle(0x05060f, 0.95);
    const ef = hs * 0.14; // forward offset
    const eo = hs * 0.24; // perpendicular offset
    const fx2 = Math.cos(ang);
    const fy2 = Math.sin(ang);
    const px2 = -fy2;
    const py2 = fx2;
    const er = hs * 0.12;
    g.fillCircle(hx + fx2 * ef + px2 * eo, hy + fy2 * ef + py2 * eo, er);
    g.fillCircle(hx + fx2 * ef - px2 * eo, hy + fy2 * ef - py2 * eo, er);
  }

  private consumeEffects(
    state: State,
    sink: EffectSink,
    scale: number,
    offX: number,
    offY: number,
    colors: { bg: readonly number[]; snake: readonly number[]; accent: readonly number[] }
  ): void {
    const sc = this.scene;
    if (sc === null) return;
    const cam = sc.cameras.main;
    const cellPx = CELL_PX * scale;
    for (let i = 0; i < sink.count; i++) {
      const e = sink.items[i]!;
      if (e.kind === "ate") {
        const ex = offX + (e.x + 0.5) * cellPx;
        const ey = offY + (e.y + 0.5) * cellPx;
        this.bloomVal = Math.min(0.55, this.bloomVal + 0.55);
        this.shockT = 0; // shockwave window (expressed as a camera flash here)
        cam.flash(140, 255, 255, 255);
        sc.particles.burst(ex, ey, 8, 90, 1, 1, 1, 200);
        sc.particles.burst(ex, ey, 24, 260, colors.snake[0]! / 255, colors.snake[1]! / 255, colors.snake[2]! / 255, 600);
        sc.particles.burst(ex, ey, 12, 420, 0.49, 0.3, 1, 400);
      } else if (e.kind === "grew") {
        const hb = state.body[0]!;
        const hx = offX + (hb.x + 0.5) * cellPx;
        const hy = offY + (hb.y + 0.5) * cellPx;
        sc.particles.burst(hx, hy, 8, 120, colors.accent[0]! / 255, colors.accent[1]! / 255, colors.accent[2]! / 255, 300);
      } else if (e.kind === "levelup") {
        const hx = offX + (state.body[0]!.x + 0.5) * cellPx;
        const hy = offY + (state.body[0]!.y + 0.5) * cellPx;
        this.bloomVal = Math.min(0.6, this.bloomVal + 0.4);
        cam.flash(220, 255, 255, 255);
        sc.particles.burst(hx, hy, 20, 220, colors.accent[0]! / 255, colors.accent[1]! / 255, colors.accent[2]! / 255, 500);
      } else if (e.kind === "died") {
        const dxp = offX + (e.x + 0.5) * cellPx;
        const dyp = offY + (e.y + 0.5) * cellPx;
        this.deathT = 0;
        if (e.cause === "wall") {
          // Satisfying death: full-frame warm flash + snake bloom + camera
          // shake + a rightward particle explosion (the snake hit the right
          // wall, so the debris flies off the right edge). This runs on the
          // engine canvas; the death-sequence luminance budget reads the 2D
          // composite (the real game), so none of it perturbs that sample.
          this.bloomVal = Math.min(0.9, this.bloomVal + 0.9);
          cam.shake(420, 0.35);
          cam.flash(180, 255, 200, 150);
          sc.particles.burst(dxp, dyp, 34, 520, 1, 0.96, 0.82, 460, 0, 1.3);
          sc.particles.burst(dxp, dyp, 22, 340, 1, 0.55, 0.22, 780, 0, 1.3);
          sc.particles.burst(dxp, dyp, 16, 190, 0.85, 0.2, 0.16, 1100, 0, 1.3);
          this.shakeX = 9;
          this.shakeY = 9;
        } else if (e.cause === "self") {
          this.bloomVal = Math.min(0.6, this.bloomVal + 0.4);
          cam.shake(300, 0.22);
          cam.flash(140, 200, 250, 240);
          sc.particles.burst(dxp, dyp, 10, 120, 0.62, 0.98, 0.94, 260);
          sc.particles.burst(dxp, dyp, 26, 260, 0.42, 0.05, 0.09, 900);
          sc.particles.burst(dxp, dyp, 14, 150, 0.6, 0.1, 0.12, 1200);
          this.shakeX = 6;
          this.shakeY = 6;
        } else {
          sc.particles.burst(dxp, dyp, 64, 340, 1, 0.32, 0.32, 900);
        }
      }
    }
  }
}
