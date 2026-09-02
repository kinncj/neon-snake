// Presentation-owned theming (ADR 0005). The domain stays theme-agnostic; the
// presentation layer picks a per-level neon palette and re-tints the whole scene
// (grid, body, head, accent, HUD) on a level-up. Both the 2D composite and the
// FX engine read these palettes. Accent values are the spec's per-level accents.
export interface Palette {
  bg: string
  grid: string
  body: string
  head: string
  accent: string
  food: string
}

export interface Theme {
  name: string
  accent: string
  palette: Palette
}

const THEMES: readonly Theme[] = [
  {
    name: 'midnight-cyan',
    accent: '#00e5ff',
    palette: { bg: '#0a0e1a', grid: '#16233d', body: '#0891b2', head: '#00e5ff', accent: '#00e5ff', food: '#ff5d73' },
  },
  {
    name: 'neon-magenta',
    accent: '#ff2e88',
    palette: { bg: '#120a18', grid: '#2a1733', body: '#c026d3', head: '#ff2e88', accent: '#ff2e88', food: '#ffd166' },
  },
  {
    name: 'electric-violet',
    accent: '#9d6bff',
    palette: { bg: '#0d0a1e', grid: '#1f1740', body: '#7c4dff', head: '#9d6bff', accent: '#9d6bff', food: '#00e5ff' },
  },
  {
    name: 'tokyo-sunset',
    accent: '#ff7849',
    palette: { bg: '#160a14', grid: '#33182a', body: '#f4511e', head: '#ff7849', accent: '#ff7849', food: '#ffd166' },
  },
  {
    name: 'golden-hour',
    accent: '#ffd166',
    palette: { bg: '#14100a', grid: '#2e2417', body: '#f9a825', head: '#ffd166', accent: '#ffd166', food: '#00e5ff' },
  },
]

export function themeForLevel(level: number): Theme {
  const idx = Math.max(0, Math.min(level - 1, THEMES.length - 1))
  return THEMES[idx]!
}

export const DEFAULT_THEME: Theme = THEMES[0]!
