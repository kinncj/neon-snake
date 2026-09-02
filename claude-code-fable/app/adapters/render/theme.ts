import { type Palette, BASE_PALETTE } from "./framebuffer";
import { MAX_LEVEL } from "../../domain/levels";

/**
 * Per-level neon palettes. The presentation layer owns colour: the domain
 * only reports a level and this module decides what it looks like.
 */
export type ThemeName = "midnight-cyan" | "neon-magenta" | "electric-violet" | "tokyo-sunset" | "golden-hour";

export interface Theme {
  name: ThemeName;
  bg: string;
  grid: string;
  body: string;
  bodyShade: string;
  head: string;
  accent: string;
}

export const THEMES: readonly Theme[] = [
  { name: "midnight-cyan", bg: "#12131f", grid: "#1c1f33", body: "#00b8d4", bodyShade: "#0083a3", head: "#7ff7ff", accent: "#00e5ff" },
  { name: "neon-magenta", bg: "#1a1020", grid: "#2a1a36", body: "#e0207a", bodyShade: "#9a1252", head: "#ff8ac2", accent: "#ff2e88" },
  { name: "electric-violet", bg: "#13112a", grid: "#221e44", body: "#8a5cf5", bodyShade: "#5b3bb0", head: "#d2c0ff", accent: "#9d6bff" },
  { name: "tokyo-sunset", bg: "#1d1316", grid: "#33201f", body: "#ff6a3d", bodyShade: "#b7411f", head: "#ffc6a8", accent: "#ff7849" },
  { name: "golden-hour", bg: "#1a1710", grid: "#2f2a16", body: "#f2b83a", bodyShade: "#b0801c", head: "#fff0b8", accent: "#ffd166" }
];

/** Theme for a 1-based level; levels past MAX keep the last theme. */
export function themeForLevel(level: number): Theme {
  const i = Math.min(Math.max(level, 1), MAX_LEVEL) - 1;
  return THEMES[i]!;
}

/** Applies a theme's colours onto a palette (in place, no allocation). */
export function applyTheme(theme: Theme, out: Palette): Palette {
  out.bg = theme.bg;
  out.grid = theme.grid;
  out.body = theme.body;
  out.bodyShade = theme.bodyShade;
  out.head = theme.head;
  out.accent = theme.accent;
  return out;
}

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const v = ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255);
  return "#" + v.toString(16).padStart(6, "0");
}

/** Linear colour mix in sRGB, t in [0,1]. */
export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Writes the mix of two themes into `out` (used during a re-tint). */
export function mixTheme(from: Theme, to: Theme, t: number, out: Palette): Palette {
  out.bg = mixHex(from.bg, to.bg, t);
  out.grid = mixHex(from.grid, to.grid, t);
  out.body = mixHex(from.body, to.body, t);
  out.bodyShade = mixHex(from.bodyShade, to.bodyShade, t);
  out.head = mixHex(from.head, to.head, t);
  out.accent = mixHex(from.accent, to.accent, t);
  return out;
}

export const RETINT_MS = 650;

/** A palette that re-tints toward the current level's theme over RETINT_MS. */
export interface ThemeState {
  palette: Palette;
  current: Theme;
  from: Theme;
  /** ms into the transition; >= RETINT_MS means settled. */
  elapsed: number;
}

export function createThemeState(level: number): ThemeState {
  const theme = themeForLevel(level);
  const palette: Palette = { ...BASE_PALETTE };
  applyTheme(theme, palette);
  return { palette, current: theme, from: theme, elapsed: RETINT_MS };
}

/** Call once per frame; returns the live palette. */
export function updateTheme(ts: ThemeState, level: number, dtMs: number): Palette {
  const target = themeForLevel(level);
  if (target !== ts.current) {
    // Start a re-tint from wherever we are (mid-transition starts from the current mix).
    ts.from = ts.elapsed >= RETINT_MS ? ts.current : { ...ts.current, ...paletteAsTheme(ts.palette, ts.current.name) };
    ts.current = target;
    ts.elapsed = 0;
  }
  if (ts.elapsed < RETINT_MS) {
    ts.elapsed = Math.min(RETINT_MS, ts.elapsed + dtMs);
    const t = ts.elapsed / RETINT_MS;
    mixTheme(ts.from, ts.current, t * t * (3 - 2 * t), ts.palette);
  }
  return ts.palette;
}

function paletteAsTheme(p: Palette, name: ThemeName): Theme {
  return { name, bg: p.bg, grid: p.grid, body: p.body, bodyShade: p.bodyShade, head: p.head, accent: p.accent };
}

export function settled(ts: ThemeState): boolean {
  return ts.elapsed >= RETINT_MS;
}
