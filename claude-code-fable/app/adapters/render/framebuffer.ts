import {
  type State, CELL_PX, FB_W, FB_H, GRID_W, GRID_H, cellX, cellY
} from "../../domain/types";
import { walkFromCell } from "./snake-walk";

/**
 * The 2D content renderer: a 256x240 offscreen canvas drawn with integer
 * coordinates and nearest-neighbour sampling, composited to the display
 * canvas at an integer scale. Every sprite is drawn from code; the only
 * state it touches is read-only.
 */

/** The 12-colour base palette (Tokyo Night, level 1 tint). */
export interface Palette {
  bg: string;
  grid: string;
  body: string;
  bodyShade: string;
  head: string;
  eye: string;
  fruit: string;
  fruitHi: string;
  stem: string;
  leaf: string;
  text: string;
  accent: string;
}

export const BASE_PALETTE: Palette = {
  bg: "#12131f",
  grid: "#1c1f33",
  body: "#00b8d4",
  bodyShade: "#0083a3",
  head: "#7ff7ff",
  eye: "#0b0c14",
  fruit: "#ff5c8a",
  fruitHi: "#ffc2d4",
  stem: "#8a5a2b",
  leaf: "#7ee787",
  text: "#e6e6f0",
  accent: "#00e5ff"
};

/** The subset of CanvasRenderingContext2D the scene drawing needs. */
export interface PixelCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** 8x8 fruit sprites: each char indexes a palette colour, '.' is transparent. */
const FRUIT_ROWS: Record<FruitKind, readonly string[]> = {
  apple: [
    "...s....",
    "..sl....",
    ".ffffff.",
    "fhffffff",
    "fhffffff",
    "ffffffff",
    ".ffffff.",
    "..ffff.."
  ],
  orange: [
    "....l...",
    "...sl...",
    ".ffffff.",
    "fhfhffff",
    "fhffffff",
    "ffffffff",
    ".ffffff.",
    "..ffff.."
  ],
  golden: [
    "...h....",
    "..hhh...",
    ".hfffh..",
    "hffhfffh",
    ".ffffff.",
    "hffffffh",
    "..hfff..",
    "...h...."
  ]
};
export type FruitKind = "apple" | "orange" | "golden";

function fruitColour(ch: string, p: Palette): string | null {
  switch (ch) {
    case "f": return p.fruit;
    case "h": return p.fruitHi;
    case "s": return p.stem;
    case "l": return p.leaf;
    default: return null;
  }
}

export interface SceneOptions {
  /** Which fruit sprite to draw (level-driven from step 17). */
  fruit: FruitKind;
  /** Draw the background grid dots. */
  grid: boolean;
  /** The last tick grew the body (the tail holds still while gliding). */
  grew?: boolean;
}

const DEFAULT_OPTS: SceneOptions = { fruit: "apple", grid: true };

/** Draws a fruit sprite with its top-left at (px, py). */
export function drawFruit(ctx: PixelCtx, px: number, py: number, kind: FruitKind, p: Palette): void {
  const rows = FRUIT_ROWS[kind];
  for (let y = 0; y < CELL_PX; y++) {
    const row = rows[y]!;
    for (let x = 0; x < CELL_PX; x++) {
      const c = fruitColour(row.charAt(x), p);
      if (c === null) continue;
      ctx.fillStyle = c;
      ctx.fillRect(px + x, py + y, 1, 1);
    }
  }
}

/** A body block: 8x8 fill with a 1px shaded bottom/right edge. */
export function drawBlock(ctx: PixelCtx, px: number, py: number, fill: string, shade: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(px, py, CELL_PX - 1, CELL_PX - 1);
  ctx.fillStyle = shade;
  ctx.fillRect(px, py + CELL_PX - 1, CELL_PX, 1);
  ctx.fillRect(px + CELL_PX - 1, py, 1, CELL_PX);
}

/** The head: a block plus two eye pixels on the leading edge. */
export function drawHead(ctx: PixelCtx, px: number, py: number, dir: number, p: Palette): void {
  drawBlock(ctx, px, py, p.head, p.bodyShade);
  ctx.fillStyle = p.eye;
  // Eye offsets per direction: right, down, left, up.
  switch (dir) {
    case 0: ctx.fillRect(px + 5, py + 1, 1, 1); ctx.fillRect(px + 5, py + 5, 1, 1); break;
    case 1: ctx.fillRect(px + 1, py + 5, 1, 1); ctx.fillRect(px + 5, py + 5, 1, 1); break;
    case 2: ctx.fillRect(px + 1, py + 1, 1, 1); ctx.fillRect(px + 1, py + 5, 1, 1); break;
    default: ctx.fillRect(px + 1, py + 1, 1, 1); ctx.fillRect(px + 5, py + 1, 1, 1); break;
  }
}

/**
 * Interpolated head pixel position: the head glides from the neck cell
 * toward its current cell by `alpha`. Integer pixels, so cells stay crisp.
 */
export function headPixel(s: State, alpha: number, out: { x: number; y: number }): void {
  const head = s.body[0]!;
  const hx = cellX(head);
  const hy = cellY(head);
  if (s.bodyLen < 2 || s.phase === "gameover") {
    out.x = hx * CELL_PX;
    out.y = hy * CELL_PX;
    return;
  }
  const neck = s.body[1]!;
  const nx = cellX(neck);
  const ny = cellY(neck);
  // Only interpolate along a one-cell step (a restart snaps).
  if (Math.abs(hx - nx) + Math.abs(hy - ny) !== 1) {
    out.x = hx * CELL_PX;
    out.y = hy * CELL_PX;
    return;
  }
  out.x = Math.round((nx + (hx - nx) * alpha) * CELL_PX);
  out.y = Math.round((ny + (hy - ny) * alpha) * CELL_PX);
}

/** Draws the whole field into a 256x240 pixel context. */
export function drawScene(ctx: PixelCtx, s: State, alpha: number, p: Palette, opts: SceneOptions = DEFAULT_OPTS): void {
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, FB_W, FB_H);

  if (opts.grid) {
    ctx.fillStyle = p.grid;
    for (let y = 0; y <= GRID_H; y++) {
      for (let x = 0; x <= GRID_W; x++) {
        ctx.fillRect(Math.min(x * CELL_PX, FB_W - 1), Math.min(y * CELL_PX, FB_H - 1), 1, 1);
      }
    }
  }

  drawFruit(ctx, s.foodX * CELL_PX, s.foodY * CELL_PX, opts.fruit, p);

  // Smooth walk: every segment glides by alpha; a dead snake snaps to cells.
  const a = s.phase === "gameover" ? 1 : alpha;
  const grew = opts.grew === true;
  for (let i = s.bodyLen - 1; i >= 1; i--) {
    walkFromCell(s.body, s.bodyLen, i, a, grew, walk);
    drawBlock(ctx, Math.round(walk.x * CELL_PX), Math.round(walk.y * CELL_PX), p.body, p.bodyShade);
  }
  headPixel(s, alpha, scratch);
  drawHead(ctx, scratch.x, scratch.y, s.dir, p);
}
const scratch = { x: 0, y: 0 };
const walk = { x: 0, y: 0 };

/** Integer-scale fit of the framebuffer into a css-pixel viewport. */
export interface Fit {
  scale: number;
  backingW: number;
  backingH: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export function computeFit(cssW: number, cssH: number, dpr: number, out: Fit): Fit {
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  const scale = Math.max(1, Math.floor(Math.min(bw / FB_W, bh / FB_H)));
  out.scale = scale;
  out.backingW = bw;
  out.backingH = bh;
  out.w = FB_W * scale;
  out.h = FB_H * scale;
  out.dx = Math.floor((bw - out.w) / 2);
  out.dy = Math.floor((bh - out.h) / 2);
  return out;
}

export interface Framebuffer {
  readonly canvas: HTMLCanvasElement;
  readonly fit: Fit;
  draw(s: State, alpha: number, p: Palette, opts?: SceneOptions): void;
  /** Recomputes the fit for the display canvas' css size and resizes its backing store. */
  resize(display: HTMLCanvasElement, dpr: number): void;
  /** Blits the framebuffer onto the display canvas, letterboxed in `bg`. */
  composite(display: HTMLCanvasElement, bg: string): void;
  /** RGBA of one framebuffer pixel (256x240 space); cheap to read every frame. */
  pixel(x: number, y: number): number[];
}

export function createFramebuffer(): Framebuffer {
  const canvas = document.createElement("canvas");
  canvas.width = FB_W;
  canvas.height = FB_H;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = false;
  const fit: Fit = { scale: 1, backingW: FB_W, backingH: FB_H, dx: 0, dy: 0, w: FB_W, h: FB_H };
  let displayCtx: CanvasRenderingContext2D | null = null;
  return {
    canvas,
    fit,
    draw(s, alpha, p, opts) {
      drawScene(ctx, s, alpha, p, opts);
    },
    resize(display, dpr) {
      computeFit(display.clientWidth, display.clientHeight, dpr, fit);
      if (display.width !== fit.backingW) display.width = fit.backingW;
      if (display.height !== fit.backingH) display.height = fit.backingH;
      displayCtx = null;
    },
    composite(display, bg) {
      if (!displayCtx) {
        displayCtx = display.getContext("2d", { alpha: false });
        if (!displayCtx) return;
      }
      const d = displayCtx;
      d.imageSmoothingEnabled = false;
      d.fillStyle = bg;
      d.fillRect(0, 0, fit.backingW, fit.backingH);
      d.drawImage(canvas, fit.dx, fit.dy, fit.w, fit.h);
    },
    pixel(x, y) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!];
    }
  };
}
