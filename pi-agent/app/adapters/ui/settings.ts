/**
 * Settings: a single gear button opens a modal (which pauses the game) with
 * four toggles — Effects (FX), Sound (mute), On-screen pad, and the FPS
 * counter. State persists to localStorage; each toggle calls back into the
 * composition root (main.ts), which owns the actual subsystems (the quality
 * governor, the audio synth, the d-pad, the fps meter).
 *
 * Defaults (per the design brief): FX on, Sound on, pad off, FPS off.
 */
import { t, type Locale } from "../i18n";

export interface SettingsState {
  fx: boolean;
  audio: boolean;
  dpad: boolean;
  fps: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  fx: true,
  audio: true,
  dpad: false,
  fps: false
};

const STORAGE_KEY = "snake.settings";

/** Load persisted settings, merged over the defaults (corrupt/absent -> defaults). */
export function loadSettings(): SettingsState {
  let saved: Partial<SettingsState> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) saved = JSON.parse(raw) as Partial<SettingsState>;
  } catch {
    saved = null;
  }
  return {
    fx: typeof saved?.fx === "boolean" ? saved.fx : DEFAULT_SETTINGS.fx,
    audio: typeof saved?.audio === "boolean" ? saved.audio : DEFAULT_SETTINGS.audio,
    dpad: typeof saved?.dpad === "boolean" ? saved.dpad : DEFAULT_SETTINGS.dpad,
    fps: typeof saved?.fps === "boolean" ? saved.fps : DEFAULT_SETTINGS.fps
  };
}

function saveSettings(s: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable; the in-memory state still applies */
  }
}

export interface SettingsCallbacks {
  setFx(v: boolean): void;
  setAudio(v: boolean): void;
  setDpad(v: boolean): void;
  setFps(v: boolean): void;
  /** Called once when the modal opens (the composition root pauses the game). */
  onOpen(): void;
  /** Called once when the modal closes (the composition root resumes the game). */
  onClose(): void;
}

export interface SettingsApi {
  readonly state: SettingsState;
  open(): void;
  close(): void;
  isOpen(): boolean;
  setLocale(locale: Locale): void;
  dispose(): void;
}

type RowKey = "fx" | "audio" | "dpad" | "fps";

export function buildSettings(
  root: HTMLElement,
  locale: Locale,
  initial: SettingsState,
  cb: SettingsCallbacks
): SettingsApi {
  const state: SettingsState = { ...initial };

  // ---- injected styles ----------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    #settings-gear {
      position: fixed;
      top: calc(8% + var(--safe-top, env(safe-area-inset-top, 0px)) + 4px);
      right: calc(5% + var(--safe-right, env(safe-area-inset-right, 0px)) + 4px);
      z-index: 15;
      width: 38px; height: 38px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(5,6,15,0.85);
      color: var(--neon, #00e5ff);
      border: 1px solid var(--neon-glow, rgba(0,229,255,0.45));
      border-radius: 50%;
      cursor: pointer; font-size: 20px; line-height: 1;
      box-shadow: 0 0 10px var(--neon-glow, rgba(0,229,255,0.3));
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    #settings-gear:hover { color: #fff; }
    #settings {
      position: absolute; inset: 0; z-index: 15;
      display: none; align-items: center; justify-content: center;
      background: rgba(3,4,12,0.78);
      font-family: "Courier New", monospace;
    }
    #settings.open { display: flex; }
    #settings-panel {
      width: min(400px, 88%);
      background: rgba(8,10,24,0.97);
      border: 1px solid var(--neon-glow, rgba(0,229,255,0.45));
      border-radius: 12px;
      box-shadow: 0 0 34px var(--neon-glow, rgba(0,229,255,0.28));
      padding: 22px 26px;
      display: flex; flex-direction: column; gap: 12px;
    }
    #settings-title {
      text-align: center; font-size: 24px; letter-spacing: 7px; padding-left: 7px;
      color: var(--neon, #00e5ff);
      text-shadow: 0 0 12px var(--neon-glow, rgba(0,229,255,0.6));
    }
    .settings-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: rgba(11,14,34,0.6);
      border: 1px solid rgba(124,77,255,0.3);
      border-radius: 8px; padding: 12px 16px; cursor: pointer;
      color: #cdd1ee; font-family: inherit; font-size: 15px; letter-spacing: 1px;
      touch-action: manipulation;
    }
    .settings-row:hover { border-color: var(--neon, #00e5ff); }
    .settings-state { font-weight: 700; font-size: 13px; letter-spacing: 2px; min-width: 42px; text-align: right; }
    .settings-state.on { color: #22ffb0; text-shadow: 0 0 8px rgba(34,255,176,0.7); }
    .settings-state.off { color: #555a80; }
    #settings-close {
      margin-top: 4px; padding: 10px; cursor: pointer;
      background: rgba(5,6,15,0.8); color: var(--neon, #00e5ff);
      border: 1px solid var(--neon-glow, rgba(0,229,255,0.45));
      border-radius: 8px; font-family: inherit; font-size: 14px; letter-spacing: 3px;
    }
    #settings-close:hover { color: #fff; }
  `;
  root.appendChild(style);

  // ---- gear button --------------------------------------------------------
  const gear = document.createElement("button");
  gear.id = "settings-gear";
  gear.type = "button";
  gear.setAttribute("aria-label", "settings");
  gear.textContent = "⚙";
  root.append(gear);

  // ---- modal --------------------------------------------------------------
  const modal = document.createElement("div");
  modal.id = "settings";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const panel = document.createElement("div");
  panel.id = "settings-panel";
  const title = document.createElement("div");
  title.id = "settings-title";
  title.textContent = t(locale, "settings.title");
  panel.append(title);

  const rows: Record<RowKey, HTMLElement> = {} as Record<RowKey, HTMLElement>;
  const states: Record<RowKey, HTMLElement> = {} as Record<RowKey, HTMLElement>;
  const keys: readonly RowKey[] = ["fx", "audio", "dpad", "fps"];

  function paintRow(k: RowKey): void {
    const el = states[k]!;
    const on = state[k]!;
    el.textContent = t(locale, on ? "settings.on" : "settings.off");
    el.className = "settings-state " + (on ? "on" : "off");
  }

  const applyKey = {
    fx: cb.setFx,
    audio: cb.setAudio,
    dpad: cb.setDpad,
    fps: cb.setFps
  } as const;

  for (const k of keys) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "settings-row";
    row.dataset.key = k;
    const label = document.createElement("span");
    label.textContent = t(locale, k === "fx" ? "settings.fx" : k === "audio" ? "settings.audio" : k === "dpad" ? "settings.dpad" : "settings.fps");
    const st = document.createElement("span");
    row.append(label, st);
    row.addEventListener("click", () => {
      state[k] = !state[k]!;
      saveSettings(state);
      applyKey[k](state[k]!);
      paintRow(k);
    });
    panel.append(row);
    rows[k] = row;
    states[k] = st;
    paintRow(k);
  }

  const closeBtn = document.createElement("button");
  closeBtn.id = "settings-close";
  closeBtn.type = "button";
  closeBtn.textContent = t(locale, "settings.close");
  closeBtn.addEventListener("click", doClose);
  panel.append(closeBtn);
  modal.append(panel);
  root.append(modal);

  // ---- open / close -------------------------------------------------------
  let open = false;
  function applyOpen(): void {
    modal.classList.toggle("open", open);
    if (open) window.addEventListener("keydown", onEsc, true);
    else window.removeEventListener("keydown", onEsc, true);
  }
  function doOpen(): void {
    if (open) return;
    open = true;
    applyOpen();
    cb.onOpen();
  }
  function doClose(): void {
    if (!open) return;
    open = false;
    applyOpen();
    cb.onClose();
  }
  function onEsc(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.stopPropagation(); // swallow the game's Escape-pause too
      doClose();
    }
  }

  const api: SettingsApi = {
    state,
    open: doOpen,
    close: doClose,
    isOpen: () => open,
    setLocale(l: Locale): void {
      title.textContent = t(l, "settings.title");
      (Object.keys(rows) as RowKey[]).forEach((k) => {
        (rows[k]!.firstElementChild as HTMLElement).textContent = t(
          l,
          k === "fx" ? "settings.fx" : k === "audio" ? "settings.audio" : k === "dpad" ? "settings.dpad" : "settings.fps"
        );
        const on = state[k]!;
        states[k]!.textContent = t(l, on ? "settings.on" : "settings.off");
      });
      closeBtn.textContent = t(l, "settings.close");
    },
    dispose(): void {
      if (open) doClose();
      window.removeEventListener("keydown", onEsc, true);
      for (const el of [style, gear, modal]) if (root.contains(el)) root.removeChild(el);
    }
  };

  // backdrop click (outside the panel) closes
  modal.addEventListener("pointerdown", (ev) => {
    if (ev.target === modal) doClose();
  });
  gear.addEventListener("click", () => (open ? doClose() : doOpen()));

  return api;
}
