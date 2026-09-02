# neon-snake

Three independent builds of the same game spec — [`PROMPT.md`](PROMPT.md): a
neo-retro **2D 8-bit neon snake** (Tokyo Night lo-fi skin, Phaser 4 screen-space
FX, procedural Tone.js lo-fi music, CRT-TV shell, zero image assets). Each
package was generated end-to-end from the same prompt by a different AI coding
agent:

| Package | Built by | Play it live | Docs |
|---|---|---|---|
| [`opencode/`](opencode/README.md) | **opencode** | [kinncj.github.io/neon-snake/opencode/](https://kinncj.github.io/neon-snake/opencode/) | [`opencode/docs/`](opencode/docs/) |
| [`pi-agent/`](pi-agent/README.md) | **pi-agent** | [kinncj.github.io/neon-snake/pi-agent/](https://kinncj.github.io/neon-snake/pi-agent/) | [`pi-agent/docs/`](pi-agent/docs/) |
| [`claude-code-fable/`](claude-code-fable/README.md) | **Claude Code with Fable 5.1** — the baseline | [kinncj.github.io/neon-snake/claude-code-fable/](https://kinncj.github.io/neon-snake/claude-code-fable/) | [`claude-code-fable/docs/`](claude-code-fable/docs/) |

**Models:** `opencode/` and `pi-agent/` were created with **Qwen3.8 27B
(NVFP4)** — the Unsloth `Qwen3.8-27B-NVFP4` quantization — running on an
**NVIDIA RTX PRO 6000** GPU, one generation session per agent.
`claude-code-fable/` is the **baseline**: the same prompt run through
**Claude Code with Claude Fable 5.1** (Anthropic's hosted model), one
session, every step gated and logged the same way.

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
- **`claude-code-fable/docs/`** — ADRs 0001–0007, final build report with
  every gate's measured number vs. budget, per-step build log, playtest
  screenshots, `game/` design notes and `i18n.md`.

## Run from source

```bash
cd opencode      # or pi-agent/ or claude-code-fable/
make bootstrap   # npm ci
make build       # production build -> dist/ (relative base: runs from any sub-path)
make preview     # serve the production build
make ci          # lint, typecheck, unit, build, e2e (Playwright)
```

## GitHub Pages deploy

The live site is built and deployed by **GitHub Actions**
(`.github/workflows/deploy-pages.yml`): every push to `main` (or a manual
"Run workflow") builds all three packages, composes the site — the
[`site/index.html`](site/index.html) landing page plus each package's
`dist/` — and publishes it. The `gh-pages` branch is managed by the workflow;
don't push to it by hand.

One-time repo setting: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

| URL | Serves |
|---|---|
| https://kinncj.github.io/neon-snake/ | landing page |
| https://kinncj.github.io/neon-snake/opencode/ | the opencode build |
| https://kinncj.github.io/neon-snake/pi-agent/ | the pi-agent build |
| https://kinncj.github.io/neon-snake/claude-code-fable/ | the Claude Code + Fable 5.1 baseline build |
