import type { State } from "../../domain/types";
import { MAX_LEVEL } from "../../domain/levels";
import { t, onLocaleChange } from "../i18n";
import type { Fit } from "../render/framebuffer";

/**
 * Score / best / level HUD plus transient `+N` popups and the level-up
 * banner. Reads state, never writes it. DOM nodes are created once; popups
 * come from a fixed pool so an eat never allocates.
 */
export interface Hud {
  root: HTMLElement;
  update(s: State, best: number): void;
  /** Shows `+N` at a grid cell (converted through the display fit). */
  popup(points: number, cellX: number, cellY: number, fit: Fit, dpr: number): void;
  banner(level: number): void;
  setAccent(colour: string): void;
}

const POPUP_POOL = 8;

export function createHud(root: HTMLElement, doc: Document = document): Hud {
  root.classList.add("hud");
  const mk = (cls: string, parent: HTMLElement = root): HTMLElement => {
    const el = doc.createElement("div");
    el.className = cls;
    parent.appendChild(el);
    return el;
  };
  const scoreBox = mk("hud-item hud-score");
  const scoreLabel = mk("hud-label", scoreBox);
  const scoreValue = mk("hud-value", scoreBox);
  scoreValue.id = "hud-score";
  const comboValue = mk("hud-combo", scoreBox);
  comboValue.id = "hud-combo";
  const levelBox = mk("hud-item hud-level");
  const levelValue = mk("hud-value", levelBox);
  levelValue.id = "hud-level";
  const bestBox = mk("hud-item hud-best");
  const bestLabel = mk("hud-label", bestBox);
  const bestValue = mk("hud-value", bestBox);
  bestValue.id = "hud-best";

  const popupLayer = mk("popups");
  popupLayer.id = "popups";
  const popups: HTMLElement[] = [];
  for (let i = 0; i < POPUP_POOL; i++) {
    const p = mk("popup", popupLayer);
    p.hidden = true;
    popups.push(p);
  }
  let popupCursor = 0;

  const bannerEl = mk("banner");
  bannerEl.id = "banner";
  bannerEl.hidden = true;
  let bannerTimer = 0;

  let lastScore = -1;
  let lastBest = -1;
  let lastLevel = -1;
  let lastCombo = -1;

  const labels = (): void => {
    scoreLabel.textContent = t("score");
    bestLabel.textContent = t("high_score");
    lastLevel = -1;
    lastCombo = -1;
  };
  labels();
  onLocaleChange(() => {
    labels();
  });

  return {
    root,
    update(s, best) {
      if (s.score !== lastScore) {
        lastScore = s.score;
        scoreValue.textContent = String(s.score);
      }
      if (best !== lastBest) {
        lastBest = best;
        bestValue.textContent = String(best);
      }
      if (s.level !== lastLevel) {
        lastLevel = s.level;
        levelValue.textContent = s.level >= MAX_LEVEL ? t("level_max") : t("level", { n: s.level });
        levelBox.classList.toggle("max", s.level >= MAX_LEVEL);
      }
      const combo = s.combo > 1 ? s.combo : 0;
      if (combo !== lastCombo) {
        lastCombo = combo;
        comboValue.textContent = combo > 0 ? t("combo", { n: combo }) : "";
        comboValue.hidden = combo === 0;
      }
    },
    popup(points, cellX, cellY, fit, dpr) {
      const el = popups[popupCursor]!;
      popupCursor = (popupCursor + 1) % POPUP_POOL;
      const x = (fit.dx + (cellX + 0.5) * 8 * fit.scale) / dpr;
      const y = (fit.dy + cellY * 8 * fit.scale) / dpr;
      el.textContent = "+" + points;
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.hidden = false;
      // Restart the CSS animation.
      el.classList.remove("live");
      void el.offsetWidth;
      el.classList.add("live");
    },
    banner(level) {
      bannerEl.textContent = level >= MAX_LEVEL ? t("level_max") : t("level_up", { n: level });
      bannerEl.hidden = false;
      bannerEl.classList.remove("live");
      void bannerEl.offsetWidth;
      bannerEl.classList.add("live");
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => {
        bannerEl.hidden = true;
        bannerTimer = 0;
      }, 1600);
    },
    setAccent(colour) {
      root.style.setProperty("--accent", colour);
    }
  };
}
