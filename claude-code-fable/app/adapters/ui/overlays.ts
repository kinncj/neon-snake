import { t, onLocaleChange } from "../i18n";

/**
 * Title / pause / gameover overlays. One root element, one mode at a time;
 * the runtime decides the mode from the simulation phase and its own
 * "started" flag, and this module only renders it.
 */
export type UiMode = "title" | "playing" | "paused" | "gameover";

export interface GameoverInfo {
  score: number;
  best: number;
  newBest: boolean;
  cause: "wall" | "self" | null;
}

export interface Overlays {
  root: HTMLElement;
  setMode(mode: UiMode, info?: GameoverInfo): void;
  mode(): UiMode;
  setTouch(isTouch: boolean): void;
}

export function createOverlays(root: HTMLElement, doc: Document = document): Overlays {
  root.classList.add("overlay");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-live", "polite");
  const title = doc.createElement("div");
  title.className = "ov-title";
  title.id = "ov-title";
  const sub = doc.createElement("div");
  sub.className = "ov-sub";
  sub.id = "ov-sub";
  const body = doc.createElement("div");
  body.className = "ov-body";
  body.id = "ov-body";
  const hint = doc.createElement("div");
  hint.className = "ov-hint";
  hint.id = "ov-hint";
  root.append(title, sub, body, hint);

  let current: UiMode = "title";
  let info: GameoverInfo = { score: 0, best: 0, newBest: false, cause: null };
  let touch = false;

  const render = (): void => {
    root.dataset["mode"] = current;
    root.hidden = current === "playing";
    switch (current) {
      case "title":
        title.textContent = t("title");
        sub.textContent = t("subtitle");
        body.textContent = touch ? t("press_start_touch") : t("press_start");
        hint.textContent = t("controls");
        break;
      case "paused":
        title.textContent = t("paused");
        sub.textContent = "";
        body.textContent = "";
        hint.textContent = t("resume_hint");
        break;
      case "gameover":
        title.textContent = t("game_over");
        sub.textContent = info.cause === "wall" ? t("cause_wall") : info.cause === "self" ? t("cause_self") : "";
        body.textContent = t("final_score", { n: info.score }) + (info.newBest ? " · " + t("new_high_score") : "");
        hint.textContent = t("restart_hint");
        break;
      default:
        break;
    }
  };
  render();
  onLocaleChange(render);

  return {
    root,
    setMode(mode, i) {
      if (i) info = i;
      if (mode === current && !i) return;
      current = mode;
      render();
    },
    mode: () => current,
    setTouch(v) {
      touch = v;
      if (current === "title") render();
    }
  };
}
