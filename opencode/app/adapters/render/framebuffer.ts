// The 2D content renderer: the guaranteed-fallback ground truth.
//
// A 256x240 offscreen canvas is the virtual framebuffer. Everything is drawn
// into it with Canvas2D at 1x (8px per cell), nearest-neighbour, integer
// coordinates, sprites drawn from code (no image assets). It is then
// composited onto the full-viewport display canvas at an integer scale with
// the remainder letterboxed/pillarboxed in the background colour.
//
// This composite is always drawn *beneath* the engine (FX) canvas, so even if
// the WebGL path fails or is disabled the player always sees a real, moving
// game — never a black screen. The engine (phase 3) layers on top of it.
//
// The renderer only reads state and alpha; it never mutates the simulation.
// The whole body glides: each segment interpolates from the cell of the
// segment behind it to its own cell by alpha (the simulation advances in
// whole cells only). The "from" cell comes from `walkFromCell` (the tail is
// detected by index and extrapolated, never a stale preallocated cell).

import {
  CELL_PX,
  FIELD_H,
  FIELD_W,
  GRID_H,
  GRID_W
} from "../../domain/types";
import type { State } from "../../domain/types";
import { walkFromCell } from "./snake-walk";

/**
 * The 12-colour base palette (Tokyo Night Neon lo-fi). Indexed for sprite
 * work; the whole 2D scene (background, grid, snake, UI chrome) is drawn from
 * these twelve values.
 */
export const BASE_PALETTE: readonly string[] = [
  "#12121c", // 0  bg
  "#1a1b26", // 1  bg-alt
  "#24283b", // 2  grid
  "#2a2e42", // 3  grid-hi
  "#414868", // 4  dim
  "#565f89", // 5  muted
  "#737aa2", // 6  slate
  "#9aa5ce", // 7  lavender
  "#c0caf5", // 8  fg
  "#00e5ff", // 9  neon-cyan
  "#ff2e88", // 10 neon-magenta
  "#ffd166"  // 11 neon-gold
];

/** A scene palette. The presentation layer owns colours; the domain is
 *  theme-agnostic. */
export interface Palette {
  bg: string;
  grid: string;
  body: string;
  head: string;
  accent: string;
}

/** The base (level-1, midnight-cyan) scene, sampled from BASE_PALETTE. */
export const BASE_SCENE: Palette = {
  bg: BASE_PALETTE[0]!,
  grid: BASE_PALETTE[2]!,
  body: BASE_PALETTE[9]!,
  head: BASE_PALETTE[8]!,
  accent: BASE_PALETTE[9]!
};

// Dedicated fruit sprite colours (drawn procedurally).
const FOOD_COLORS: Record<string, string> = {
  apple: "#ff5f56",
  orange: "#ffb86b",
  golden: "#ffd166"
};

export interface Layout {
  /** Display backing-store size in device pixels. */
  W: number;
  H: number;
  /** Integer scale factor (field device px per field unit). */
  scale: number;
  /** Letterbox offsets in device pixels. */
  ox: number;
  oy: number;
  /** Field rectangle in device pixels. */
  fw: number;
  fh: number;
}

/**
 * Integer composite layout for a viewport. Pure (no DOM) so the math is
 * unit-testable: backing store is cssPx * dpr, the field is scaled by the
 * largest integer that fits, and the remainder is centred (letterbox /
 * pillarbox).
 */
export function computeLayout(cssW: number, cssH: number, dpr: number): Layout {
  const W = Math.max(1, Math.floor(cssW * dpr));
  const H = Math.max(1, Math.floor(cssH * dpr));
  const scale = Math.max(1, Math.floor(Math.min(W / FIELD_W, H / FIELD_H)));
  const fw = FIELD_W * scale;
  const fh = FIELD_H * scale;
  const ox = Math.floor((W - fw) / 2);
  const oy = Math.floor((H - fh) / 2);
  return { W, H, scale, ox, oy, fw, fh };
}

export class Framebuffer {
  private off: HTMLCanvasElement;
  private og: CanvasRenderingContext2D;
  private display: HTMLCanvasElement;
  private dg: CanvasRenderingContext2D;
  private palette: Palette;

  setPalette(p: Palette): void {
    this.palette = p;
  }

  get paletteValue(): Palette {
    return this.palette;
  }

  /** The 256x240 offscreen canvas (the virtual framebuffer) — the FX layer
   * uploads it as its NEAREST texture. */
  get source(): HTMLCanvasElement {
    return this.off;
  }

  /** Cached layout: recomputed only on resize so the steady-state frame path
   * allocates nothing. */
  private layout: Layout;

  constructor(display: HTMLCanvasElement, palette: Palette = BASE_SCENE) {
    this.display = display;
    const dg = display.getContext("2d");
    if (dg === null) throw new Error("no 2d context on display canvas");
    this.dg = dg;
    this.palette = palette;

    this.off = document.createElement("canvas");
    this.off.width = FIELD_W;
    this.off.height = FIELD_H;
    const og = this.off.getContext("2d");
    if (og === null) throw new Error("no 2d context on offscreen canvas");
    this.og = og;
    this.og.imageSmoothingEnabled = false;

    this.layout = computeLayout(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio ?? 1
    );
    this.syncDisplaySize();
  }

  private syncDisplaySize(): void {
    if (this.display.width !== this.layout.W) this.display.width = this.layout.W;
    if (this.display.height !== this.layout.H) this.display.height = this.layout.H;
  }

  /** Recompute the display backing store + integer layout for the viewport. */
  resize(): void {
    this.layout = computeLayout(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio ?? 1
    );
    this.syncDisplaySize();
  }

  /** The current integer layout (for assertions / the FX layer). */
  getLayout(): Layout {
    return this.layout;
  }

  /** Render the field into the offscreen framebuffer (no display blit). */
  render(state: State, alpha: number): void {
    this.renderField(state, alpha);
  }

  private renderField(state: State, alpha: number): void {
    const g = this.og;
    const p = this.palette;

    // background
    g.fillStyle = p.bg;
    g.fillRect(0, 0, FIELD_W, FIELD_H);

    // grid
    g.strokeStyle = p.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= GRID_W; x++) {
      g.moveTo(x * CELL_PX + 0.5, 0);
      g.lineTo(x * CELL_PX + 0.5, FIELD_H);
    }
    for (let y = 0; y <= GRID_H; y++) {
      g.moveTo(0, y * CELL_PX + 0.5);
      g.lineTo(FIELD_W, y * CELL_PX + 0.5);
    }
    g.stroke();

    // food
    this.drawFood(g, state.food.x, state.food.y, state.food.kind);

    // Full-body smooth walk: each segment glides from the cell of the segment
    // behind it to its own cell by alpha. When not playing the walk is
    // settled (alpha=1) so the body rests on integer cells. The tail is held
    // static while the body is growing (the new segment has just appeared).
    const a = state.phase === "playing" ? alpha : 1;
    const n = state.bodyLen;
    const growing = state.pendingLen > 0;
    g.fillStyle = p.body;
    for (let i = n - 1; i >= 1; i--) {
      const c = state.body[i]!;
      if (i === n - 1 && growing) {
        // growth point: the tail is held static while the body extends.
        g.fillRect(c.x * CELL_PX, c.y * CELL_PX, CELL_PX, CELL_PX);
        continue;
      }
      const from = walkFromCell(state.body, n, i);
      const px = Math.round((from.x + (c.x - from.x) * a) * CELL_PX);
      const py = Math.round((from.y + (c.y - from.y) * a) * CELL_PX);
      g.fillRect(px, py, CELL_PX, CELL_PX);
    }

    // head (may be a fractional cell during a glide); glides from its neck.
    const head = state.body[0]!;
    const neck = walkFromCell(state.body, n, 0);
    const hpx = Math.round((neck.x + (head.x - neck.x) * a) * CELL_PX);
    const hpy = Math.round((neck.y + (head.y - neck.y) * a) * CELL_PX);
    this.drawHead(g, hpx, hpy, p.head);
  }

  private drawFood(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    kind: string
  ): void {
    const px = cx * CELL_PX;
    const py = cy * CELL_PX;
    const color = FOOD_COLORS[kind] ?? FOOD_COLORS["apple"]!;
    // a small pixel fruit: 6x5 body + 4x1 top + 1px stem
    g.fillStyle = color;
    g.fillRect(px + 1, py + 3, 6, 4);
    g.fillRect(px + 2, py + 2, 4, 1);
    g.fillStyle = "#7ee787";
    g.fillRect(px + 4, py + 1, 1, 1);
  }

  private drawHead(
    g: CanvasRenderingContext2D,
    px: number,
    py: number,
    color: string
  ): void {
    g.fillStyle = color;
    g.fillRect(px, py, CELL_PX, CELL_PX);
    // two 2x2 eyes toward the front (direction-agnostic for the 2D pass)
    g.fillStyle = this.palette.bg;
    g.fillRect(px + 1, py + 1, 2, 2);
    g.fillRect(px + 5, py + 1, 2, 2);
  }

  /** Blit the offscreen framebuffer onto the display canvas (#game) at
   *  integer scale, letterboxed in the background colour. Optional shake
   *  offsets rattle the field (the low-tier death shake) without moving the
   *  letterbox. This composite is always drawn beneath the engine canvas. */
  composite(shX = 0, shY = 0): void {
    const { W, H, ox, oy, fw, fh } = this.getLayout();
    const d = this.dg;
    d.imageSmoothingEnabled = false;
    // letterbox/pillarbox
    d.fillStyle = this.palette.bg;
    d.fillRect(0, 0, W, H);
    // Source is the whole offscreen field (FIELD_W×FIELD_H); dest is the
    // letterboxed, integer-scaled quad (optionally shaken).
    d.drawImage(this.off, 0, 0, FIELD_W, FIELD_H, ox + shX, oy + shY, fw, fh);
  }
}
