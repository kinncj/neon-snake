/**
 * The string catalog. English is complete and is the fallback; every other
 * locale may omit keys and falls back per key. Placeholders use `{name}`.
 */
export type Locale = "en" | "ja" | "es";
export const LOCALES: readonly Locale[] = ["en", "ja", "es"];
export const FALLBACK: Locale = "en";

export type StringKey =
  | "title"
  | "subtitle"
  | "press_start"
  | "press_start_touch"
  | "score"
  | "high_score"
  | "level"
  | "level_max"
  | "combo"
  | "paused"
  | "resume_hint"
  | "game_over"
  | "final_score"
  | "new_high_score"
  | "restart_hint"
  | "level_up"
  | "sound"
  | "sound_on"
  | "sound_off"
  | "settings"
  | "settings_title"
  | "effects"
  | "dpad"
  | "fps"
  | "close"
  | "on"
  | "off"
  | "dpad_up"
  | "dpad_down"
  | "dpad_left"
  | "dpad_right"
  | "cause_wall"
  | "cause_self"
  | "controls";

export const STRINGS: Record<Locale, Partial<Record<StringKey, string>>> & { en: Record<StringKey, string> } = {
  en: {
    title: "NEON SNAKE",
    subtitle: "Tokyo Night lo-fi",
    press_start: "Press any arrow key to start",
    press_start_touch: "Swipe to start",
    score: "Score",
    high_score: "Best",
    level: "Level {n}",
    level_max: "MAX",
    combo: "×{n} combo",
    paused: "Paused",
    resume_hint: "P or Esc to resume",
    game_over: "Game over",
    final_score: "Score {n}",
    new_high_score: "New best!",
    restart_hint: "R to restart",
    level_up: "Level {n}",
    sound: "Sound on/off (M)",
    sound_on: "Sound on",
    sound_off: "Sound off",
    settings: "Settings",
    settings_title: "Settings",
    effects: "Effects",
    dpad: "On-screen d-pad",
    fps: "FPS meter",
    close: "Close",
    on: "On",
    off: "Off",
    dpad_up: "Up",
    dpad_down: "Down",
    dpad_left: "Left",
    dpad_right: "Right",
    cause_wall: "Hit the wall",
    cause_self: "Bit yourself",
    controls: "Arrows / WASD move · P pause · R restart · M sound"
  },
  ja: {
    title: "ネオンスネーク",
    subtitle: "トーキョーナイト・ローファイ",
    press_start: "矢印キーでスタート",
    press_start_touch: "スワイプでスタート",
    score: "スコア",
    high_score: "ベスト",
    level: "レベル {n}",
    level_max: "MAX",
    combo: "×{n} コンボ",
    paused: "ポーズ",
    resume_hint: "P か Esc で再開",
    game_over: "ゲームオーバー",
    final_score: "スコア {n}",
    new_high_score: "新記録！",
    restart_hint: "R でリスタート",
    level_up: "レベル {n}",
    sound: "サウンド オン/オフ (M)",
    sound_on: "サウンド オン",
    sound_off: "サウンド オフ",
    settings: "設定",
    settings_title: "設定",
    effects: "エフェクト",
    dpad: "画面上の十字キー",
    fps: "FPS メーター",
    close: "閉じる",
    on: "オン",
    off: "オフ",
    dpad_up: "上",
    dpad_down: "下",
    dpad_left: "左",
    dpad_right: "右",
    cause_wall: "壁に激突",
    cause_self: "自分を噛んだ",
    controls: "矢印 / WASD 移動 · P ポーズ · R リスタート · M サウンド"
  },
  es: {
    title: "SERPIENTE NEÓN",
    subtitle: "Tokyo Night lo-fi",
    press_start: "Pulsa una flecha para empezar",
    press_start_touch: "Desliza para empezar",
    score: "Puntos",
    high_score: "Récord",
    level: "Nivel {n}",
    level_max: "MÁX",
    combo: "combo ×{n}",
    paused: "Pausa",
    resume_hint: "P o Esc para seguir",
    game_over: "Fin del juego",
    final_score: "Puntos {n}",
    new_high_score: "¡Nuevo récord!",
    restart_hint: "R para reiniciar",
    level_up: "Nivel {n}",
    sound: "Sonido sí/no (M)",
    sound_on: "Sonido activado",
    sound_off: "Sonido desactivado",
    settings: "Ajustes",
    settings_title: "Ajustes",
    effects: "Efectos",
    dpad: "Cruceta en pantalla",
    fps: "Medidor de FPS",
    close: "Cerrar",
    on: "Sí",
    off: "No",
    dpad_up: "Arriba",
    dpad_down: "Abajo",
    dpad_left: "Izquierda",
    dpad_right: "Derecha",
    cause_wall: "Chocaste con la pared",
    cause_self: "Te mordiste",
    controls: "Flechas / WASD mover · P pausa · R reiniciar · M sonido"
  }
};
