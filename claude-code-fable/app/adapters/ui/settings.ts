import { t, onLocaleChange } from "../i18n";

/**
 * The settings panel: one gear button opens a modal with four persisted
 * toggles. Opening reports `onOpen` so the runtime can pause; Escape, the
 * backdrop and the close button all close it. All text comes from the
 * catalog and re-renders on locale change.
 */
export interface Settings {
  effects: boolean;
  sound: boolean;
  dpad: boolean;
  fps: boolean;
}

export const SETTINGS_KEY = "snake.settings";
export const DEFAULT_SETTINGS: Settings = { effects: true, sound: true, dpad: false, fps: false };

export function loadSettings(storage: Storage | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!storage) return out;
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (typeof parsed[k] === "boolean") out[k] = parsed[k] as boolean;
    }
  } catch {
    /* malformed: defaults */
  }
  return out;
}

export function saveSettings(storage: Storage | null, s: Settings): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* quota or privacy mode */
  }
}

export interface SettingsPanel {
  root: HTMLElement;
  gear: HTMLButtonElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  get(): Settings;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export interface SettingsHooks {
  storage: Storage | null;
  onChange(key: keyof Settings, value: boolean, all: Settings): void;
  onOpen(): void;
  onClose(): void;
}

const ORDER: ReadonlyArray<keyof Settings> = ["effects", "sound", "dpad", "fps"];

export function createSettingsPanel(host: HTMLElement, hooks: SettingsHooks, doc: Document = document): SettingsPanel {
  const settings = loadSettings(hooks.storage);

  const gear = doc.createElement("button");
  gear.type = "button";
  gear.id = "gear";
  gear.textContent = "⚙";
  gear.setAttribute("aria-haspopup", "dialog");
  gear.setAttribute("aria-expanded", "false");

  const root = doc.createElement("div");
  root.id = "settings";
  root.hidden = true;
  const backdrop = doc.createElement("div");
  backdrop.className = "settings-backdrop";
  const panel = doc.createElement("div");
  panel.className = "settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.id = "settings-panel";
  const title = doc.createElement("h2");
  title.id = "settings-title";
  panel.setAttribute("aria-labelledby", "settings-title");
  const list = doc.createElement("div");
  list.className = "settings-list";
  const close = doc.createElement("button");
  close.type = "button";
  close.id = "settings-close";
  close.className = "settings-close";
  panel.append(title, list, close);
  root.append(backdrop, panel);
  host.append(gear, root);

  const rows = new Map<keyof Settings, { label: HTMLElement; button: HTMLButtonElement; state: HTMLElement }>();
  for (const key of ORDER) {
    const row = doc.createElement("div");
    row.className = "settings-row";
    const label = doc.createElement("span");
    label.className = "settings-label";
    label.id = "settings-label-" + key;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "settings-toggle";
    button.id = "toggle-" + key;
    button.setAttribute("role", "switch");
    button.setAttribute("aria-labelledby", label.id);
    const state = doc.createElement("span");
    state.className = "settings-state";
    button.appendChild(state);
    button.addEventListener("click", () => api.set(key, !settings[key]));
    row.append(label, button);
    list.appendChild(row);
    rows.set(key, { label, button, state });
  }

  let open = false;
  const render = (): void => {
    gear.setAttribute("aria-label", t("settings"));
    gear.title = t("settings");
    title.textContent = t("settings_title");
    close.textContent = t("close");
    close.setAttribute("aria-label", t("close"));
    for (const key of ORDER) {
      const r = rows.get(key)!;
      r.label.textContent = t(key);
      r.button.setAttribute("aria-checked", settings[key] ? "true" : "false");
      r.button.classList.toggle("on", settings[key]);
      r.state.textContent = settings[key] ? t("on") : t("off");
    }
  };
  render();
  onLocaleChange(render);

  const api: SettingsPanel = {
    root,
    gear,
    open() {
      if (open) return;
      open = true;
      root.hidden = false;
      gear.setAttribute("aria-expanded", "true");
      hooks.onOpen();
      close.focus();
    },
    close() {
      if (!open) return;
      open = false;
      root.hidden = true;
      gear.setAttribute("aria-expanded", "false");
      hooks.onClose();
      gear.blur();
    },
    isOpen: () => open,
    get: () => ({ ...settings }),
    set(key, value) {
      if (settings[key] === value) return;
      settings[key] = value;
      saveSettings(hooks.storage, settings);
      render();
      hooks.onChange(key, value, { ...settings });
    }
  };

  gear.addEventListener("click", () => (open ? api.close() : api.open()));
  close.addEventListener("click", () => api.close());
  backdrop.addEventListener("click", () => api.close());
  // Escape closes; the listener runs in the capture phase so the game's
  // keyboard adapter never sees it while the panel is open.
  doc.addEventListener(
    "keydown",
    (e) => {
      if (!open) return;
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        api.close();
      }
    },
    { capture: true }
  );
  return api;
}
