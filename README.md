# neon-snake

Two independent builds of the same game spec — [`PROMPT.md`](PROMPT.md): a
neo-retro **2D 8-bit neon snake** (Tokyo Night lo-fi skin, Phaser 4 screen-space
FX, procedural Tone.js lo-fi music, CRT-TV shell, zero image assets). Each
package was generated end-to-end from the same prompt by a different AI coding
agent:

| Package | Built by | Play it live | Docs |
|---|---|---|---|
| [`opencode/`](opencode/README.md) | **opencode** | [kinncj.github.io/neon-snake/opencode/](https://kinncj.github.io/neon-snake/opencode/) | [`opencode/docs/`](opencode/docs/) |
| [`pi-agent/`](pi-agent/README.md) | **pi-agent** | [kinncj.github.io/neon-snake/pi-agent/](https://kinncj.github.io/neon-snake/pi-agent/) | [`pi-agent/docs/`](pi-agent/docs/) |

**Model:** both packages were created with **Qwen3.8 27B (NVFP4)** — the
Unsloth `Qwen3.8-27B-NVFP4` quantization — running on an **NVIDIA RTX PRO
6000** GPU, one generation session per agent.

## The game

Pure-integer deterministic simulation (lint-enforced pure domain), engine-
rendered neon effects, per-level progression (5 levels, combo ×1–×4, five neon
palettes, five lo-fi tracks 70→86 bpm), i18n (en/ja/es), quality-tier governor
(low/high/ultra/reduced), replayable input logs. Full spec and as-built record:
[`PROMPT.md`](PROMPT.md).

Each package is self-contained with its own `docs/` folder:

- **`opencode/docs/`** — ADRs 0001–0007, final build report, per-step build log
  (`build-log.tsv` → `build-log.md`), playtest screenshots.
- **`pi-agent/docs/`** — ADRs 0001–0007, final build report, per-step build
  log, playtest screenshots, plus `game/` design notes and `i18n.md`.

## Run from source

```bash
cd opencode      # or pi-agent/
make bootstrap   # npm ci
make build       # production build -> dist/ (relative base: runs from any sub-path)
make preview     # serve the production build
make ci          # lint, typecheck, unit, build, e2e (Playwright)
```

## GitHub Pages deploy

The live builds are deployed from the **`gh-pages`** branch, which holds the
production `dist/` of each package plus a landing page:

```
gh-pages/
  index.html          # landing page (this is kinncj.github.io/neon-snake/)
  opencode/           # built game  -> /neon-snake/opencode/
  pi-agent/           # built game  -> /neon-snake/pi-agent/
```

To redeploy after a change:

```bash
SNAKE_BUILD="pages-$(date +%Y%m%d)" npm run build   # in opencode/ and pi-agent/
# then copy each dist/ into the gh-pages worktree at opencode/ and pi-agent/
# and push gh-pages (Pages source: gh-pages branch, / root)
```
