/**
 * DOM HUD: score / best / level / combo / length, an event banner, and the
 * footer hint.
 *
 * Budget and SOLID notes:
 * - All nodes are created exactly once in buildHud; per-frame work is a
 *   handful of number comparisons and (only on change) a textContent write.
 *   No layout thrash: reads come from JS state, never from the DOM.
 * - Strings resolve through the i18n adapter; static labels are memoised
 *   there, so a locale change is the only thing that forces re-resolution.
 * - The HUD never mutates game state and never reads it for layout — it is
 *   a pure viewer (same contract as the renderer: read state + events).
 *
 * Banners are event-driven (level-up, game over, new best, pause). A banner
 * replaces any previous one; the hide timer is a single shared handle.
 */
import { t, type Locale } from "../i18n";
import type { MessageKey } from "../i18n/strings";
import type { EffectSink, State } from "../../domain/types";

export interface Hud {
  /** Per-frame sync of the counters (writes only on change). */
  sync(s: State): void;
  /**
   * Per-frame effect scan for banners. `storedBest` is the best score as it
   * stood before this run (from storage) so "new best" is judged against
   * what the player actually beat, not the run's own high point.
   */
  onEffects(sink: EffectSink, s: State, storedBest: number): void;
  /** Show a translated banner (auto-hides). */
  banner(key: MessageKey, params?: Record<string, number>): void;
  /** Swap the locale; re-resolves static labels and the footer. */
  setLocale(locale: Locale): void;
  /** Footer: start hint until the first input, control hints after. */
  markFirstInput(): void;
  /** Remove all nodes (used by tests). */
  dispose(): void;
}

interface Cached {
  score: number;
  best: number;
  level: number;
  combo: number;
  length: number;
}

const BANNER_MS = 1500;
const BANNER_LONG_MS = 2600;

export function buildHud(root: HTMLElement, locale: Locale): Hud {
  // --- one-time DOM construction -----------------------------------------
  const hud = document.createElement("div");
  hud.id = "hud";

  const el = (id: string, labelId: string, labelText: string, parent: HTMLElement): HTMLElement => {
    const box = document.createElement("div");
    box.className = "hud-item";
    box.id = id;
    const label = document.createElement("span");
    label.className = "hud-label";
    label.id = labelId;
    label.textContent = labelText;
    const value = document.createElement("span");
    value.className = "hud-value";
    value.id = id + "-value";
    value.textContent = "0";
    box.append(label, value);
    parent.append(box);
    return box;
  };

  const scoreBox = el("hud-score", "hud-score-label", t(locale, "hud.score"), hud);
  const levelBox = el("hud-level", "hud-level-label", t(locale, "hud.level"), hud);
  const comboBox = el("hud-combo", "hud-combo-label", t(locale, "hud.combo"), hud);
  const lengthBox = el("hud-length", "hud-length-label", t(locale, "hud.length"), hud);
  const bestBox = el("hud-best", "hud-best-label", t(locale, "hud.best"), hud);

  const banner = document.createElement("div");
  banner.id = "banner";
  const footer = document.createElement("div");
  footer.id = "footer";
  footer.textContent = t(locale, "banner.start");

  root.append(hud, banner, footer);

  // --- state ----------------------------------------------------------------
  const cached: Cached = { score: -1, best: -1, level: -1, combo: -1, length: -1 };
  let currentLocale = locale;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  let firstInput = false;

  function showBanner(key: MessageKey, params: Record<string, number> | undefined, ms: number): void {
    if (bannerTimer !== undefined) {
      clearTimeout(bannerTimer);
      bannerTimer = undefined;
    }
    banner.textContent = t(currentLocale, key, params);
    // Restart the CSS animation by toggling the class with a frame gap.
    banner.classList.remove("show");
    void banner.offsetWidth; // reflow to reset the animation
    banner.classList.add("show");
    bannerTimer = setTimeout(() => {
      banner.classList.remove("show");
      bannerTimer = undefined;
    }, ms);
  }

  const api: Hud = {
    sync(s: State): void {
      if (s.score !== cached.score) {
        cached.score = s.score;
        (scoreBox.lastElementChild as HTMLElement).textContent = String(s.score);
      }
      if (s.best !== cached.best) {
        cached.best = s.best;
        (bestBox.lastElementChild as HTMLElement).textContent = String(s.best);
      }
      if (s.level !== cached.level) {
        cached.level = s.level;
        (levelBox.lastElementChild as HTMLElement).textContent = String(s.level);
      }
      if (s.combo !== cached.combo) {
        cached.combo = s.combo;
        // combo x1 is "not a combo": hidden until x2
        comboBox.classList.toggle("hidden", s.combo < 2);
        (comboBox.lastElementChild as HTMLElement).textContent =
          "×" + String(s.combo);
      }
      if (s.bodyLen !== cached.length) {
        cached.length = s.bodyLen;
        (lengthBox.lastElementChild as HTMLElement).textContent = String(s.bodyLen);
      }
    },
    onEffects(sink: EffectSink, s: State, storedBest: number): void {
      for (let i = 0; i < sink.count; i++) {
        const e = sink.items[i]!;
        if (e.kind === "levelup") {
          showBanner(
            s.level >= 5 ? "banner.maxlevel" : "banner.levelup",
            s.level >= 5 ? undefined : { n: s.level },
            BANNER_MS
          );
        } else if (e.kind === "died") {
          const newBest = s.score > 0 && s.score >= s.best && s.best > storedBest;
          showBanner("banner.gameover", undefined, BANNER_LONG_MS);
          if (newBest) {
            // Let the game-over banner finish first, then the new-best one.
            if (bannerTimer !== undefined) {
              clearTimeout(bannerTimer);
              bannerTimer = undefined;
            }
            bannerTimer = setTimeout(
              () => showBanner("banner.newbest", undefined, BANNER_LONG_MS),
              BANNER_MS
            );
          }
        }
      }
    },
    banner(key, params): void {
      showBanner(key, params, BANNER_MS);
    },
    setLocale(locale: Locale): void {
      currentLocale = locale;
      const labels: Array<[HTMLElement, MessageKey]> = [
        [document.getElementById("hud-score-label")!, "hud.score"],
        [document.getElementById("hud-level-label")!, "hud.level"],
        [document.getElementById("hud-combo-label")!, "hud.combo"],
        [document.getElementById("hud-length-label")!, "hud.length"],
        [document.getElementById("hud-best-label")!, "hud.best"]
      ];
      for (const [node, key] of labels) node.textContent = t(locale, key);
      footer.textContent = t(locale, firstInput ? "footer.hint" : "banner.start");
    },
    markFirstInput(): void {
      if (firstInput) return;
      firstInput = true;
      footer.textContent = t(currentLocale, "footer.hint");
    },
    dispose(): void {
      if (bannerTimer !== undefined) clearTimeout(bannerTimer);
      if (root.contains(hud)) root.removeChild(hud);
      if (root.contains(banner)) root.removeChild(banner);
      if (root.contains(footer)) root.removeChild(footer);
    }
  };
  return api;
}
