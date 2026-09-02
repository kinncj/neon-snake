/**
 * Full-screen UI panels: title (attract), pause, and game over.
 *
 * These are pure presentation state: the module receives a `UiMode` from
 * the composition root (main.ts), which is the only place that translates
 * domain phase + the title flag into a mode. Panels are built once (like
 * the HUD) and toggled by class; the game-over panel gets its stats written
 * only when the mode flips into it.
 *
 * A11y: panels are role="dialog" with aria-live so screen readers hear the
 * state change; buttons keep real <button> semantics.
 */
import { t, type Locale } from "../i18n";
import type { State } from "../../domain/types";
import { MAX_LEVEL } from "../../domain/levels";

export type UiMode = "title" | "playing" | "paused" | "gameover";

export interface OverlayApi {
  /** Show/hide panels for the current mode. */
  setMode(mode: UiMode, s: State, storedBest: number): void;
  /** Locale swap: re-resolve all panel text. */
  setLocale(locale: Locale): void;
  dispose(): void;
}

function panel(
  id: string,
  root: HTMLElement
): HTMLElement {
  const p = document.createElement("div");
  p.id = id;
  p.className = "overlay";
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-live", "polite");
  p.style.display = "none";
  root.append(p);
  return p;
}

/** Build the logo: "NEON" (cyan) + "SNAKE" (magenta), stacked, glowing. */
function logo(): HTMLElement {
  const box = document.createElement("div");
  box.className = "logo";
  const l1 = document.createElement("div");
  l1.className = "logo-line logo-neon";
  l1.textContent = "NEON";
  const l2 = document.createElement("div");
  l2.className = "logo-line logo-snake";
  l2.textContent = "SNAKE";
  box.append(l1, l2);
  return box;
}

/** A stat row: label + value slots (value written by setMode). */
function statRow(id: string, labelText: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.id = id;
  const label = document.createElement("span");
  label.className = "stat-label";
  label.textContent = labelText;
  const value = document.createElement("span");
  value.className = "stat-value";
  value.textContent = "—";
  row.append(label, value);
  return row;
}

export function buildOverlays(
  root: HTMLElement,
  locale: Locale,
  onAction: () => void
): OverlayApi {
  // --- title -------------------------------------------------------------
  const titleP = panel("ov-title", root);
  titleP.append(logo());
  const prompt = document.createElement("div");
  prompt.className = "prompt";
  prompt.textContent = t(locale, "banner.start");
  titleP.append(prompt);

  // --- pause ---------------------------------------------------------------
  const pauseP = panel("ov-pause", root);
  const pauseTitle = document.createElement("div");
  pauseTitle.className = "panel-title";
  pauseTitle.textContent = t(locale, "banner.paused");
  const pauseHint = document.createElement("div");
  pauseHint.className = "prompt";
  pauseHint.textContent = t(locale, "footer.hint");
  pauseP.append(pauseTitle, pauseHint);

  // --- game over -----------------------------------------------------------
  const overP = panel("ov-over", root);
  const overTitle = document.createElement("div");
  overTitle.className = "panel-title danger";
  overTitle.textContent = t(locale, "banner.gameover");
  overP.append(overTitle);

  const scoreRow = statRow("ov-stat-score", t(locale, "hud.score"));
  const bestRow = statRow("ov-stat-best", t(locale, "hud.best"));
  const levelRow = statRow("ov-stat-level", t(locale, "hud.level"));
  const lengthRow = statRow("ov-stat-length", t(locale, "hud.length"));
  overP.append(scoreRow, bestRow, levelRow, lengthRow);

  const newBestChip = document.createElement("div");
  newBestChip.className = "newbest-chip";
  newBestChip.textContent = t(locale, "banner.newbest");
  newBestChip.style.display = "none";
  overP.append(newBestChip);

  const restartHint = document.createElement("div");
  restartHint.className = "prompt";
  restartHint.textContent = t(locale, "footer.hint");
  overP.append(restartHint);

  // All panels take the same action (start / resume / restart) — the root
  // decides what the action means from the current mode.
  const wire = (p: HTMLElement): void => {
    p.style.cursor = "pointer";
    p.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      onAction();
    });
  };
  wire(titleP);
  wire(pauseP);
  wire(overP);

  let currentLocale = locale;
  // "" so the very first setMode call always applies: panels are built
  // hidden, and the initial mode must clear the display:none on one of them.
  let currentMode: UiMode | "" = "";

  function applyText(): void {
    prompt.textContent = t(currentLocale, "banner.start");
    pauseTitle.textContent = t(currentLocale, "banner.paused");
    pauseHint.textContent = t(currentLocale, "footer.hint");
    overTitle.textContent = t(currentLocale, "banner.gameover");
    newBestChip.textContent = t(currentLocale, "banner.newbest");
    restartHint.textContent = t(currentLocale, "footer.hint");
    const labelFor = (rowId: string, key: "hud.score" | "hud.best" | "hud.level" | "hud.length"): void => {
      const row = document.getElementById(rowId);
      if (row !== null)
        (row.firstElementChild as HTMLElement).textContent = t(currentLocale, key);
    };
    labelFor("ov-stat-score", "hud.score");
    labelFor("ov-stat-best", "hud.best");
    labelFor("ov-stat-level", "hud.level");
    labelFor("ov-stat-length", "hud.length");
  }

  const api: OverlayApi = {
    setMode(mode: UiMode, s: State, storedBest: number): void {
      if (mode === currentMode) return;
      currentMode = mode;
      titleP.style.display = mode === "title" ? "flex" : "none";
      pauseP.style.display = mode === "paused" ? "flex" : "none";
      overP.style.display = mode === "gameover" ? "flex" : "none";
      if (mode === "gameover") {
        // stats reflect the run that just ended
        const sv = scoreRow.lastElementChild as HTMLElement;
        const bv = bestRow.lastElementChild as HTMLElement;
        const lv = levelRow.lastElementChild as HTMLElement;
        const lvv = lengthRow.lastElementChild as HTMLElement;
        sv.textContent = String(s.score);
        bv.textContent = String(s.best);
        lv.textContent = s.level >= MAX_LEVEL ? "MAX" : String(s.level);
        lvv.textContent = String(s.bodyLen);
        newBestChip.style.display =
          s.score > 0 && s.score > storedBest ? "flex" : "none";
      }
    },
    setLocale(locale: Locale): void {
      currentLocale = locale;
      applyText();
    },
    dispose(): void {
      for (const p of [titleP, pauseP, overP])
        if (root.contains(p)) root.removeChild(p);
    }
  };
  return api;
}
