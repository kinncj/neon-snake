import type PhaserNS from "phaser";
import { type State, CELL_PX, GRID_W, GRID_H, cellX, cellY, CAUSE_WALL, DIR_DX, DIR_DY } from "../../../domain/types";
import type { Fit, Palette, FruitKind } from "../framebuffer";
import type { Tier } from "../../../runtime/quality";
import { type Particles, createParticles, burst, update as updateParticles, clear as clearParticles } from "./particles";
import { walkFromCell, createWalkTracker, trackGrowth } from "../snake-walk";

type Phaser = typeof PhaserNS;

/**
 * The neon FX layer on Phaser 4. One transparent WebGL canvas sits over the
 * 2D composite and redraws the field as blocky neon: background + brightened
 * grid, gliding snake blocks with an emissive glow, food with a halo, a
 * 512-slot particle ring, shockwaves, local death flashes, and (at ultra) a
 * scanline overlay with a slow luminance flicker plus a radial vignette.
 * It only reads state; the domain never knows it exists.
 */
export interface FxLayer {
  readonly canvas: HTMLCanvasElement;
  /** Adopt the display fit (backing-store size, field offset, scale). */
  resize(fit: Fit): void;
  /** Update the frame inputs; the engine draws on its own ticker. */
  render(s: State, alpha: number, palette: Palette, fruit: FruitKind): void;
  /** Apply a tier: low/reduced sleeps the engine ticker and hides the canvas. */
  setTier(t: Tier): void;
  /** React to a domain effect this tick. */
  onEffect(kind: number, x: number, y: number, arg: number, s: State): void;
  /** Game objects rendered last frame (the draw-batch budget metric). */
  drawCount(): number;
  /** Frames rendered by the engine so far. */
  frames(): number;
  /** True once the scene has drawn at least one frame and the context is live. */
  alive(): boolean;
  /** RGBA at a backing-store pixel of the engine canvas (a 1x1 2D readback). */
  sample(x: number, y: number): number[];
  /** Current glow strength (bloom amount), for tests. */
  bloom(): number;
  /** FX bookkeeping for tests: live particles, live shockwaves, flash side, dissolve progress. */
  stats(): { particles: number; waves: number; flashDir: number; dissolve: number; particleDrift: { vx: number; vy: number; gravity: number } };
  /** Simulate a WebGL context loss (tests). */
  loseContext(): void;
  destroy(): void;
}

export const FX_EFFECT_ATE = 0;
export const FX_EFFECT_DIED = 3;
export const FX_EFFECT_LEVELUP = 5;

const MAX_SHOCKWAVES = 8;
const GLOW_BASE = 1.6;
const GLOW_PULSE = 5.5;
const GLOW_DECAY_MS = 400;
const SCANLINE_ALPHA = 0.16;
// Softened in P4.2: a strong vignette darkened the playfield; now it only
// touches the corners so every cell stays readable.
const VIGNETTE_STRENGTH = 0.35;
const VIGNETTE_RADIUS = 0.95;
const FLICKER_PERIOD_MS = 4200;

function hex(colour: string): number {
  return parseInt(colour.replace("#", ""), 16) >>> 0;
}

function brighten(colour: string, dr: number, dg: number, db: number): number {
  const v = hex(colour);
  const r = Math.min(255, ((v >> 16) & 255) + dr);
  const g = Math.min(255, ((v >> 8) & 255) + dg);
  const b = Math.min(255, (v & 255) + db);
  return ((r << 16) | (g << 8) | b) >>> 0;
}

/** 8x8 fruit bitmaps, shared with the 2D path's look (kept blocky). */
const FRUIT_BITS: Record<FruitKind, readonly string[]> = {
  apple: ["...s....", "..sl....", ".ffffff.", "fhffffff", "fhffffff", "ffffffff", ".ffffff.", "..ffff.."],
  orange: ["....l...", "...sl...", ".ffffff.", "fhfhffff", "fhffffff", "ffffffff", ".ffffff.", "..ffff.."],
  golden: ["...h....", "..hhh...", ".hfffh..", "hffhfffh", ".ffffff.", "hffffffh", "..hfff..", "...h...."]
};

export interface FxOptions {
  /** Injected loader so tests can stub the engine; defaults to `import("phaser")`. */
  loadPhaser?: () => Promise<Phaser>;
}

async function defaultLoader(): Promise<Phaser> {
  const mod = (await import("phaser")) as unknown as { default?: Phaser } & Phaser;
  return mod.default ?? mod;
}

export async function createPhaserFx(canvas: HTMLCanvasElement, initialFit: Fit, opts: FxOptions = {}): Promise<FxLayer> {
  const P = await (opts.loadPhaser ?? defaultLoader)();

  // Frame inputs, written by render() and read by the scene's update().
  let state: State | null = null;
  let alpha = 0;
  let palette: Palette | null = null;
  let fruit: FruitKind = "apple";
  const fit: Fit = { ...initialFit };
  let tier: Tier = "high";
  let frames = 0;
  let contextLost = false;
  let sleeping = false;
  // GL draw-call accounting: calls are counted on the raw context and the
  // per-frame total is latched at the start of every scene update.
  let drawCalls = 0;
  let drawCallsLastFrame = 0;

  // FX state.
  const particles: Particles = createParticles();
  const waveX = new Float32Array(MAX_SHOCKWAVES);
  const waveY = new Float32Array(MAX_SHOCKWAVES);
  const waveAge = new Float32Array(MAX_SHOCKWAVES).fill(1e9);
  const waveLife = new Float32Array(MAX_SHOCKWAVES);
  const waveColour = new Uint32Array(MAX_SHOCKWAVES);
  let waveCursor = 0;
  let glowPulse = 0; // ms remaining of the eat pulse
  let flashDir = -1; // wall side for the local death flash
  let flashAge = 1e9;
  let dissolveAge = 1e9;
  let dead = false;
  let lastTick = -1;
  let lastTime = -1;
  const walker = createWalkTracker();
  const walk = { x: 0, y: 0 };

  const px = (cx: number) => fit.dx + cx * CELL_PX * fit.scale;
  const py = (cy: number) => fit.dy + cy * CELL_PX * fit.scale;

  function startWave(x: number, y: number, colour: number, life: number): void {
    const i = waveCursor;
    waveCursor = (waveCursor + 1) % MAX_SHOCKWAVES;
    waveX[i] = x;
    waveY[i] = y;
    waveAge[i] = 0;
    waveLife[i] = life;
    waveColour[i] = colour;
  }

  class FxScene extends P.Scene {
    bg!: PhaserNS.GameObjects.Graphics;
    snake!: PhaserNS.GameObjects.Graphics;
    food!: PhaserNS.GameObjects.Graphics;
    parts!: PhaserNS.GameObjects.Graphics;
    fx!: PhaserNS.GameObjects.Graphics;
    scan!: PhaserNS.GameObjects.Graphics;
    glow: PhaserNS.Filters.Glow | null = null;
    foodGlow: PhaserNS.Filters.Glow | null = null;
    vignette: PhaserNS.Filters.Vignette | null = null;
    scanW = 0;
    scanH = 0;

    constructor() {
      super("fx");
    }

    create(): void {
      this.bg = this.add.graphics();
      this.snake = this.add.graphics();
      this.food = this.add.graphics();
      this.parts = this.add.graphics();
      this.fx = this.add.graphics();
      this.scan = this.add.graphics();
      try {
        this.snake.enableFilters();
        this.glow = this.snake.filters!.internal.addGlow(0x00e5ff, GLOW_BASE, 0, 1, false, 0.1, 10);
        this.food.enableFilters();
        this.foodGlow = this.food.filters!.internal.addGlow(0xff2e88, 2.5, 0, 1, false, 0.1, 8);
        this.vignette = this.cameras.main.filters.internal.addVignette(0.5, 0.5, VIGNETTE_RADIUS, VIGNETTE_STRENGTH);
      } catch {
        this.glow = null;
        this.foodGlow = null;
        this.vignette = null;
      }
      this.applyTier();
    }

    applyTier(): void {
      const ultra = tier === "ultra";
      this.scan.setVisible(ultra);
      if (this.vignette) this.vignette.active = ultra;
    }

    rebuildScanlines(): void {
      const w = fit.backingW;
      const h = fit.backingH;
      if (w === this.scanW && h === this.scanH) return;
      this.scanW = w;
      this.scanH = h;
      this.scan.clear();
      const stepPx = Math.max(2, fit.scale);
      this.scan.fillStyle(0x000000, 1);
      for (let y = fit.dy; y < fit.dy + fit.h; y += stepPx) {
        this.scan.fillRect(fit.dx, y, fit.w, Math.max(1, Math.floor(stepPx / 2)));
      }
    }

    override update(time: number): void {
      frames++;
      drawCallsLastFrame = drawCalls;
      drawCalls = 0;
      const s = state;
      const p = palette;
      if (!s || !p) return;
      // Wall-clock dt (clamped): FX timing must not depend on the engine's
      // frame pacing, which varies between hosts.
      const dt = lastTime < 0 ? 16 : Math.min(100, Math.max(0, time - lastTime));
      lastTime = time;

      // Tick-edge bookkeeping: the death sequence starts on the died effect.
      if (s.tick !== lastTick) lastTick = s.tick;

      this.drawBackground(p);
      this.drawFood(s, p);
      this.drawSnake(s, p);
      this.drawParticles(dt);
      this.drawFx(dt, p);

      if (this.glow) {
        const pulse = glowPulse > 0 ? glowPulse / GLOW_DECAY_MS : 0;
        this.glow.outerStrength = GLOW_BASE + GLOW_PULSE * pulse;
        this.glow.color = hex(p.accent);
      }
      if (this.foodGlow) this.foodGlow.color = hex(p.fruit);
      glowPulse = Math.max(0, glowPulse - dt);

      if (tier === "ultra") {
        this.rebuildScanlines();
        const flicker = 1 + 0.12 * Math.sin((time / FLICKER_PERIOD_MS) * Math.PI * 2);
        this.scan.setAlpha(SCANLINE_ALPHA * flicker);
      }
    }

    drawBackground(p: Palette): void {
      const g = this.bg;
      g.clear();
      g.fillStyle(hex(p.bg), 1);
      g.fillRect(fit.dx, fit.dy, fit.w, fit.h);
      // The CRT overlays darken the field, so the FX grid runs brighter.
      g.fillStyle(brighten(p.grid, 34, 34, 46), 0.9);
      const sc = fit.scale;
      for (let y = 0; y <= GRID_H; y++) {
        for (let x = 0; x <= GRID_W; x++) {
          g.fillRect(Math.min(px(x), fit.dx + fit.w - sc), Math.min(py(y), fit.dy + fit.h - sc), sc, sc);
        }
      }
    }

    drawFood(s: State, p: Palette): void {
      const g = this.food;
      g.clear();
      const sc = fit.scale;
      const x0 = px(s.foodX);
      const y0 = py(s.foodY);
      const cell = CELL_PX * sc;
      g.fillStyle(hex(p.fruit), 0.12);
      g.fillCircle(x0 + cell / 2, y0 + cell / 2, cell * 0.8);
      const rows = FRUIT_BITS[fruit];
      for (let y = 0; y < CELL_PX; y++) {
        const row = rows[y]!;
        for (let x = 0; x < CELL_PX; x++) {
          const ch = row.charAt(x);
          if (ch === ".") continue;
          const c = ch === "f" ? p.fruit : ch === "h" ? p.fruitHi : ch === "s" ? p.stem : p.leaf;
          g.fillStyle(hex(c), 1);
          g.fillRect(x0 + x * sc, y0 + y * sc, sc, sc);
        }
      }
    }

    drawSnake(s: State, p: Palette): void {
      const g = this.snake;
      g.clear();
      const sc = fit.scale;
      const cell = CELL_PX * sc;
      const body = hex(p.body);
      const shade = hex(p.bodyShade);
      const head = hex(p.head);
      const accent = hex(p.accent);
      // Body blocks glide (smooth walk), tail first so the head lands on top.
      const grew = trackGrowth(walker, s);
      const a = s.phase === "gameover" ? 1 : alpha;
      for (let i = s.bodyLen - 1; i >= 1; i--) {
        walkFromCell(s.body, s.bodyLen, i, a, grew, walk);
        const x = Math.round(px(walk.x));
        const y = Math.round(py(walk.y));
        const fade = 1 - (i / s.bodyLen) * 0.35;
        g.fillStyle(accent, 0.10 * fade);
        g.fillRoundedRect(x - sc, y - sc, cell + sc * 2, cell + sc * 2, sc * 2);
        g.fillStyle(body, fade);
        g.fillRect(x, y, cell - sc, cell - sc);
        g.fillStyle(shade, fade);
        g.fillRect(x, y + cell - sc, cell, sc);
        g.fillRect(x + cell - sc, y, sc, cell);
      }
      // Head glides from the neck by alpha (the simulation never does).
      const h = s.body[0]!;
      let hx = cellX(h);
      let hy = cellY(h);
      if (s.bodyLen > 1 && s.phase !== "gameover") {
        const n = s.body[1]!;
        const nx = cellX(n);
        const ny = cellY(n);
        if (Math.abs(hx - nx) + Math.abs(hy - ny) === 1) {
          hx = nx + (hx - nx) * alpha;
          hy = ny + (hy - ny) * alpha;
        }
      }
      const x = Math.round(px(hx));
      const y = Math.round(py(hy));
      g.fillStyle(accent, 0.22);
      g.fillRoundedRect(x - sc * 2, y - sc * 2, cell + sc * 4, cell + sc * 4, sc * 3);
      g.fillStyle(head, 1);
      g.fillRect(x, y, cell - sc, cell - sc);
      g.fillStyle(shade, 1);
      g.fillRect(x, y + cell - sc, cell, sc);
      g.fillRect(x + cell - sc, y, sc, cell);
      g.fillStyle(hex(p.eye), 1);
      const e = (ex: number, ey: number) => g.fillRect(x + ex * sc, y + ey * sc, sc, sc);
      switch (s.dir) {
        case 0: e(5, 1); e(5, 5); break;
        case 1: e(1, 5); e(5, 5); break;
        case 2: e(1, 1); e(1, 5); break;
        default: e(1, 1); e(5, 1); break;
      }
    }

    drawParticles(dt: number): void {
      const g = this.parts;
      g.clear();
      const n = updateParticles(particles, dt);
      if (n === 0) return;
      for (let i = 0; i < particles.cap; i++) {
        const l = particles.life[i]!;
        if (l <= 0) continue;
        const a = Math.min(1, l / particles.maxLife[i]!);
        const sz = particles.size[i]! * fit.scale;
        g.fillStyle(particles.colour[i]!, a);
        g.fillRect(particles.x[i]! - sz / 2, particles.y[i]! - sz / 2, sz, sz);
      }
    }

    drawFx(dt: number, p: Palette): void {
      const g = this.fx;
      g.clear();
      const sc = fit.scale;
      // Shockwaves: expanding rings that thin out.
      for (let i = 0; i < MAX_SHOCKWAVES; i++) {
        waveAge[i] = waveAge[i]! + dt;
        const t = waveAge[i]! / waveLife[i]!;
        if (t >= 1) continue;
        const r = (0.5 + t * 4.5) * CELL_PX * sc;
        g.lineStyle(Math.max(1, sc * (1.5 - t)), waveColour[i]!, (1 - t) * 0.8);
        g.strokeCircle(waveX[i]!, waveY[i]!, r);
      }
      // Local wall flash: a bright band on the wall that was hit, fading fast.
      flashAge += dt;
      if (flashDir >= 0 && flashAge < 220) {
        const a = (1 - flashAge / 220) * 0.9;
        g.fillStyle(0xffffff, a);
        const band = CELL_PX * sc * 3;
        switch (flashDir) {
          case 0: g.fillRect(fit.dx + fit.w - band, fit.dy, band, fit.h); break;
          case 1: g.fillRect(fit.dx, fit.dy + fit.h - band, fit.w, band); break;
          case 2: g.fillRect(fit.dx, fit.dy, band, fit.h); break;
          default: g.fillRect(fit.dx, fit.dy, fit.w, band); break;
        }
      }
      // Dissolve into the gameover panel: a slow darkening, never a flash.
      dissolveAge += dt;
      if (dead) {
        const t = Math.min(1, dissolveAge / 900);
        g.fillStyle(hex(p.bg), t * 0.55);
        g.fillRect(fit.dx, fit.dy, fit.w, fit.h);
      }
    }
  }

  const game = new P.Game({
    type: P.WEBGL,
    canvas,
    width: fit.backingW,
    height: fit.backingH,
    transparent: true,
    pixelArt: true,
    antialias: false,
    preserveDrawingBuffer: true,
    autoFocus: false,
    banner: false,
    disableContextMenu: false,
    input: false,
    audio: { noAudio: true },
    fps: { target: 60, forceSetTimeOut: false },
    scale: { mode: P.Scale.NONE, autoCenter: P.Scale.NO_CENTER },
    scene: FxScene
  });

  // Count real GPU draw batches: every drawArrays/drawElements on the context.
  {
    const gl = (game.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    if (gl) {
      const de = gl.drawElements.bind(gl);
      const da = gl.drawArrays.bind(gl);
      gl.drawElements = ((mode: number, count: number, type: number, offset: number) => {
        drawCalls++;
        de(mode, count, type, offset);
      }) as typeof gl.drawElements;
      gl.drawArrays = ((mode: number, first: number, count: number) => {
        drawCalls++;
        da(mode, first, count);
      }) as typeof gl.drawArrays;
    }
  }

  const cssSize = (): void => {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  };
  cssSize();

  game.events.on(P.Core.Events.CONTEXT_LOST, () => {
    contextLost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
  });

  const scene = (): FxScene | null => {
    const sc = game.scene.getScene("fx") as FxScene | null;
    return sc && sc.sys && sc.sys.settings.status >= P.Scenes.RUNNING ? sc : null;
  };

  const readback = document.createElement("canvas");
  readback.width = 1;
  readback.height = 1;

  const fxLayer: FxLayer = {
    canvas,
    resize(f) {
      Object.assign(fit, f);
      game.scale.resize(f.backingW, f.backingH);
      cssSize();
      const sc = scene();
      if (sc) {
        sc.scanW = -1;
        sc.cameras.main.setSize(f.backingW, f.backingH);
      }
    },
    render(s, a, p, fr) {
      state = s;
      alpha = a;
      palette = p;
      fruit = fr;
      if (s.phase === "playing" && dead) {
        // A restart: clear the death sequence.
        dead = false;
        flashDir = -1;
        clearParticles(particles);
        waveAge.fill(1e9);
      }
    },
    setTier(t) {
      tier = t;
      const off = t === "low" || t === "reduced";
      if (off && !sleeping) {
        game.loop.sleep();
        sleeping = true;
        canvas.style.visibility = "hidden";
      } else if (!off && sleeping) {
        game.loop.wake();
        sleeping = false;
        canvas.style.visibility = "visible";
      } else if (!off) {
        canvas.style.visibility = "visible";
      }
      const sc = scene();
      if (sc) sc.applyTier();
    },
    onEffect(kind, x, y, arg, s) {
      if (!palette) return;
      const sc = fit.scale;
      const cx = px(x) + (CELL_PX * sc) / 2;
      const cy = py(y) + (CELL_PX * sc) / 2;
      if (kind === FX_EFFECT_ATE) {
        startWave(cx, cy, hex(palette.accent), 420);
        burst(particles, cx, cy, { count: 28, speed: 90 * sc, life: 420, size: 1.4, colour: hex(palette.fruit), gravity: 60 * sc });
        glowPulse = GLOW_DECAY_MS;
      } else if (kind === FX_EFFECT_DIED) {
        dead = true;
        dissolveAge = 0;
        if (tier === "reduced") return;
        if (arg === CAUSE_WALL) {
          // Sparks fly off the wall in the direction of travel; the flash is local to that wall.
          const dir = s.dir;
          const ang = Math.atan2(DIR_DY[dir]!, DIR_DX[dir]!);
          burst(particles, cx, cy, { count: 90, speed: 220 * sc, life: 700, angleCenter: ang, angleSpread: 1.3, size: 1.6, colour: 0xffe680, gravity: 240 * sc });
          burst(particles, cx, cy, { count: 40, speed: 120 * sc, life: 500, angleCenter: ang, angleSpread: 1.3, size: 1.2, colour: hex(palette.accent) });
          startWave(cx, cy, 0xffffff, 520);
          flashDir = dir;
          flashAge = 0;
          const cam = scene()?.cameras.main;
          if (cam) cam.shake(320, 0.012);
        } else {
          // Self-bite: a chomp and a spray of "blood", no wall flash.
          burst(particles, cx, cy, { count: 70, speed: 140 * sc, life: 650, size: 1.6, colour: 0xff2e5c, gravity: 380 * sc });
          burst(particles, cx, cy, { count: 20, speed: 60 * sc, life: 400, size: 2.2, colour: 0x9b0f2e, gravity: 300 * sc });
          startWave(cx, cy, 0xff2e5c, 380);
          const cam = scene()?.cameras.main;
          if (cam) cam.shake(180, 0.006);
        }
      } else if (kind === FX_EFFECT_LEVELUP) {
        const mx = fit.dx + fit.w / 2;
        const my = fit.dy + fit.h / 2;
        startWave(mx, my, hex(palette.accent), 900);
        burst(particles, cx, cy, { count: 60, speed: 150 * sc, life: 800, size: 1.8, colour: hex(palette.accent), gravity: 40 * sc });
      }
    },
    drawCount: () => drawCallsLastFrame,
    frames: () => frames,
    alive: () => frames > 0 && !contextLost && !sleeping,
    sample(x, y) {
      const ctx = readback.getContext("2d", { willReadFrequently: true });
      if (!ctx) return [0, 0, 0, 0];
      ctx.clearRect(0, 0, 1, 1);
      try {
        ctx.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
      } catch {
        return [0, 0, 0, 0];
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!];
    },
    bloom() {
      const sc = scene();
      return sc && sc.glow ? sc.glow.outerStrength : 0;
    },
    stats() {
      let waves = 0;
      for (let i = 0; i < MAX_SHOCKWAVES; i++) if (waveAge[i]! < waveLife[i]!) waves++;
      let vx = 0;
      let vy = 0;
      let g = 0;
      let n = 0;
      for (let i = 0; i < particles.cap; i++) {
        if (particles.life[i]! <= 0) continue;
        vx += particles.vx[i]!;
        vy += particles.vy[i]!;
        g += particles.gravity[i]!;
        n++;
      }
      return {
        particles: particles.alive,
        waves,
        flashDir: flashAge < 220 ? flashDir : -1,
        dissolve: dead ? Math.min(1, dissolveAge / 900) : 0,
        particleDrift: n > 0 ? { vx: vx / n, vy: vy / n, gravity: g / n } : { vx: 0, vy: 0, gravity: 0 }
      };
    },
    loseContext() {
      const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
      const ext = gl?.getExtension("WEBGL_lose_context");
      if (ext) {
        ext.loseContext();
        setTimeout(() => ext.restoreContext(), 300);
      }
    },
    destroy() {
      game.destroy(false);
    }
  };
  return fxLayer;
}
