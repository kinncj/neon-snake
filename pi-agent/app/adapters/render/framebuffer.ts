import { CELL_PX, GRID_H, GRID_W } from "../../domain/types";
import type { State } from "../../domain/types";
import type { ThemeMixer } from "./theme";

/** Virtual framebuffer is fixed: 32*8 = 256, 30*8 = 240. */
export const FB_W = GRID_W * CELL_PX; // 256
export const FB_H = GRID_H * CELL_PX; // 240

/** The full palette, exactly 12 entries. */
export const PALETTE = {
  bg: "#05060f",
  grid: "#0b1030",
  snakeBody: "#1de9b6",
  snakeHead: "#5ffbf1",
  food: "#ff2e88",
  score: "#ffd166",
  accent: "#7c4dff",
  danger: "#ff5252",
  hi: "#ffffff",
  dim: "#2b2f52",
  trail: "#00e5ff",
  black: "#000000"
} as const;

export interface CompositeInfo {
  readonly deviceW: number;
  readonly deviceH: number;
  readonly scale: number;
  readonly offX: number;
  readonly offY: number;
  readonly drawW: number;
  readonly drawH: number;
}

/**
 * Integer scale only: scale = max(1, floor(min(devW/256, devH/240))). The
 * composite quad is axis-aligned and centred; the remainder is letterboxed.
 */
export function computeComposite(deviceW: number, deviceH: number): CompositeInfo {
  const scale = Math.max(1, Math.floor(Math.min(deviceW / FB_W, deviceH / FB_H)));
  const drawW = FB_W * scale;
  const drawH = FB_H * scale;
  const offX = Math.floor((deviceW - drawW) / 2);
  const offY = Math.floor((deviceH - drawH) / 2);
  return { deviceW, deviceH, scale, offX, offY, drawW, drawH };
}

/** Mutable form of the composite rect, for the per-frame preallocated copy. */
export interface MutableComposite {
  deviceW: number;
  deviceH: number;
  scale: number;
  offX: number;
  offY: number;
  drawW: number;
  drawH: number;
}

/** Same math as computeComposite, but into a preallocated object (no alloc). */
export function fillComposite(deviceW: number, deviceH: number, out: MutableComposite): void {
  out.scale = Math.max(1, Math.floor(Math.min(deviceW / FB_W, deviceH / FB_H)));
  out.drawW = FB_W * out.scale;
  out.drawH = FB_H * out.scale;
  out.offX = Math.floor((deviceW - out.drawW) / 2);
  out.offY = Math.floor((deviceH - out.drawH) / 2);
  out.deviceW = deviceW;
  out.deviceH = deviceH;
}

/** Blit the 256x240 framebuffer onto the display at integer scale. */
/**
 * Interpolated segment position for the smooth-walk render. Each segment's
 * previous cell is exactly the cell of the segment ahead of it (segments
 * shift one slot per tick), so the walk needs no history tracking:
 * lerp(body[i-1] -> body[i], alpha). The head uses its own neck pair. Pure
 * and rounded so sprites stay on integer pixels.
 */
export function interpCell(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  alpha: number
): { x: number; y: number } {
  // Returns framebuffer pixels (cell units scaled), rounded so sprites
  // stay on integer pixels.
  return {
    x: Math.round((fromX + (toX - fromX) * alpha) * CELL_PX),
    y: Math.round((fromY + (toY - fromY) * alpha) * CELL_PX)
  };
}

/** Blit the 256x240 framebuffer onto the display at integer scale. The
 * optional bgCss overrides the letterbox fill (per-level themes); the
 * optional shake offsets rattle the field without moving the letterbox. */
export function composite(ctx: CanvasRenderingContext2D, fb: HTMLCanvasElement, info: CompositeInfo, bgCss?: string, shX = 0, shY = 0): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = bgCss ?? PALETTE.bg;
  ctx.fillRect(0, 0, info.deviceW, info.deviceH);
  ctx.drawImage(fb, 0, 0, FB_W, FB_H, info.offX + shX, info.offY + shY, info.drawW, info.drawH);
}

/**
 * Offscreen 256x240 virtual framebuffer. Renders the game state with
 * Canvas2D, nearest-neighbour, integer coordinates, sprites from code.
 */
export class Framebuffer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private theme: ThemeMixer | null = null;
  private lastAlpha = 1;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = FB_W;
    this.canvas.height = FB_H;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Present-layer hook: swap the live colour story (per-level themes). */
  setTheme(theme: ThemeMixer): void {
    this.theme = theme;
  }

  /**
   * fillStyle for a colour role. Uses the live theme when set (cached css
   * strings — zero steady-state alloc); falls back to the base palette so
   * unit contexts without a theme keep working.
   */
  private col(kind: "bg" | "grid" | "food" | "hi" | "snake" | "head" | "black"): string {
    const t = this.theme;
    if (t === null) {
      return PALETTE[kind === "snake" ? "snakeBody" : kind === "head" ? "snakeHead" : kind];
    }
    switch (kind) {
      case "bg":
        return t.bgCss;
      case "grid":
        return t.gridCss;
      case "food":
        return t.foodCss;
      case "hi":
        return t.hiCss;
      case "snake":
        return t.snakeCss;
      case "head":
        return t.headCss;
      case "black":
        return t.blackCss;
    }
  }

  render(state: State, alpha: number): void {
    const c = this.ctx;
    // When the simulation is not advancing (paused/gameover) the head is
    // drawn at its settled cell; no drift while the accumulator keeps cycling.
    const a = state.phase === "playing" ? alpha : 1;
    this.lastAlpha = a;
    // Background
    c.fillStyle = this.col("bg");
    c.fillRect(0, 0, FB_W, FB_H);
    this.drawGrid(c);
    this.drawFood(c, state);
    this.drawBody(c, state);
    this.drawHead(c, state, a);
  }

  private drawGrid(c: CanvasRenderingContext2D): void {
    c.fillStyle = this.col("grid");
    for (let gx = 0; gx <= GRID_W; gx++) {
      c.fillRect(gx * CELL_PX, 0, 1, FB_H);
    }
    for (let gy = 0; gy <= GRID_H; gy++) {
      c.fillRect(0, gy * CELL_PX, FB_W, 1);
    }
  }

  private drawFood(c: CanvasRenderingContext2D, state: State): void {
    const px = state.food.x * CELL_PX;
    const py = state.food.y * CELL_PX;
    c.fillStyle = this.col("food");
    c.fillRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
    c.fillStyle = this.col("hi");
    c.fillRect(px + 2, py + 2, 1, 1);
  }

  private drawBody(c: CanvasRenderingContext2D, state: State): void {
    c.fillStyle = this.col("snake");
    const a = state.phase === "playing" ? this.lastAlpha : 1;
    const n = state.bodyLen;
    const growing = state.pendingLen > 0;
    for (let i = 1; i < n; i++) {
      const cell = state.body[i]!;
      if (i === n - 1 && growing) {
        // growth point: the tail is held static while the body extends
        c.fillRect(cell.x * CELL_PX + 1, cell.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
        continue;
      }
      // The segment's previous cell is the one behind it (the chain shifts
      // by one each tick), matching the head's neck->head convention. For
      // the tail that cell has left the array, so extrapolate one step
      // beyond along the tail's own direction.
      let fromX: number;
      let fromY: number;
      if (i + 1 < n) {
        const behind = state.body[i + 1]!;
        fromX = behind.x;
        fromY = behind.y;
      } else {
        const prev = state.body[i - 1]!;
        fromX = 2 * cell.x - prev.x;
        fromY = 2 * cell.y - prev.y;
      }
      const p = interpCell(fromX, fromY, cell.x, cell.y, a);
      c.fillRect(p.x + 1, p.y + 1, CELL_PX - 2, CELL_PX - 2);
    }
  }

  /**
   * Head interpolates between the neck cell (previous tick) and the current
   * head cell by alpha; the simulation itself never interpolates. The final
   * pixel position is rounded so the sprite stays on integer pixels.
   */
  private drawHead(c: CanvasRenderingContext2D, state: State, alpha: number): void {
    const head = state.body[0]!;
    const neck = state.body[1]!;
    const p = interpCell(neck.x, neck.y, head.x, head.y, alpha);
    c.fillStyle = this.col("head");
    c.fillRect(p.x + 1, p.y + 1, CELL_PX - 2, CELL_PX - 2);
    c.fillStyle = this.col("black");
    c.fillRect(p.x + 2, p.y + 3, 1, 1);
    c.fillRect(p.x + 5, p.y + 3, 1, 1);
  }
}
