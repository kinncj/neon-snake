/**
 * Message catalogs. Pure data — no logic, no DOM.
 *
 * Rules (enforced by tests/unit/i18n.test.ts):
 * - Every locale defines every key in `en` (completeness is a test, not a
 *   convention).
 * - `{param}` placeholders in any locale must be declared in PARAMS for that
 *   key, so a typo'd placeholder fails the build.
 * - English is the fallback locale: a missing value in any other locale
 *   resolves to English at runtime, but completeness tests catch that in CI
 *   instead.
 *
 * Add a string: add the key to MessageKey, the en value, PARAMS (if it has
 * placeholders), and every other locale. Add a locale: add it to `Locale`,
 * `SUPPORTED`, and CATALOGS. That is the whole surface (OCP).
 */

export type Locale = "en" | "ja" | "es";

export const DEFAULT_LOCALE: Locale = "en";

export const SUPPORTED: readonly Locale[] = ["en", "ja", "es"];

export type MessageKey =
  | "title"
  | "hud.score"
  | "hud.best"
  | "hud.level"
  | "hud.combo"
  | "hud.length"
  | "banner.levelup"
  | "banner.maxlevel"
  | "banner.gameover"
  | "banner.newbest"
  | "banner.paused"
  | "banner.start"
  | "btn.fxOn"
  | "btn.fxOff"
  | "settings.title"
  | "settings.fx"
  | "settings.audio"
  | "settings.dpad"
  | "settings.fps"
  | "settings.on"
  | "settings.off"
  | "settings.close"
  | "footer.hint";

export type Catalog = {
  readonly [K in MessageKey]: string;
};

/** Declared placeholder names per key ("" = no placeholders). */
export const PARAMS: Record<MessageKey, readonly string[]> = {
  title: [],
  "hud.score": [],
  "hud.best": [],
  "hud.level": [],
  "hud.combo": [],
  "hud.length": [],
  "banner.levelup": ["n"],
  "banner.maxlevel": [],
  "banner.gameover": [],
  "banner.newbest": [],
  "banner.paused": [],
  "banner.start": [],
  "btn.fxOn": [],
  "btn.fxOff": [],
  "settings.title": [],
  "settings.fx": [],
  "settings.audio": [],
  "settings.dpad": [],
  "settings.fps": [],
  "settings.on": [],
  "settings.off": [],
  "settings.close": [],
  "footer.hint": []
};

export const CATALOGS: Record<Locale, Catalog> = {
  en: {
    title: "NEON SNAKE",
    "hud.score": "SCORE",
    "hud.best": "BEST",
    "hud.level": "LEVEL",
    "hud.combo": "COMBO",
    "hud.length": "LENGTH",
    "banner.levelup": "LEVEL {n}",
    "banner.maxlevel": "MAX LEVEL",
    "banner.gameover": "GAME OVER",
    "banner.newbest": "NEW BEST!",
    "banner.paused": "PAUSED",
    "banner.start": "PRESS ANY KEY OR TAP TO START",
    "btn.fxOn": "FX: ON",
    "btn.fxOff": "FX: OFF",
    "settings.title": "SETTINGS",
    "settings.fx": "Effects",
    "settings.audio": "Sound",
    "settings.dpad": "On-screen pad",
    "settings.fps": "FPS counter",
    "settings.on": "ON",
    "settings.off": "OFF",
    "settings.close": "CLOSE",
    "footer.hint": "ARROWS / WASD MOVE - P PAUSE - R RESTART"
  },
  ja: {
    title: "ネオン スネーク",
    "hud.score": "スコア",
    "hud.best": "ベスト",
    "hud.level": "レベル",
    "hud.combo": "コンボ",
    "hud.length": "長さ",
    "banner.levelup": "レベル {n}",
    "banner.maxlevel": "MAX LEVEL",
    "banner.gameover": "ゲームオーバー",
    "banner.newbest": "新記録!",
    "banner.paused": "一時停止",
    "banner.start": "キー入力 or タップでスタート",
    "btn.fxOn": "エフェクト: オン",
    "btn.fxOff": "エフェクト: オフ",
    "settings.title": "設定",
    "settings.fx": "エフェクト",
    "settings.audio": "サウンド",
    "settings.dpad": "画面パッド",
    "settings.fps": "FPS 表示",
    "settings.on": "オン",
    "settings.off": "オフ",
    "settings.close": "閉じる",
    "footer.hint": "矢印 / WASD 移動 - P 停止 - R リスタート"
  },
  es: {
    title: "SNAKE NEÓN",
    "hud.score": "PUNTOS",
    "hud.best": "RÉCORD",
    "hud.level": "NIVEL",
    "hud.combo": "COMBO",
    "hud.length": "LONGITUD",
    "banner.levelup": "NIVEL {n}",
    "banner.maxlevel": "NIVEL MÁXIMO",
    "banner.gameover": "FIN DEL JUEGO",
    "banner.newbest": "¡NUEVO RÉCORD!",
    "banner.paused": "PAUSA",
    "banner.start": "PRESIONA UNA TECLA O TOCA PARA EMPEZAR",
    "btn.fxOn": "EFECTOS: SÍ",
    "btn.fxOff": "EFECTOS: NO",
    "settings.title": "AJUSTES",
    "settings.fx": "Efectos",
    "settings.audio": "Sonido",
    "settings.dpad": "Pad en pantalla",
    "settings.fps": "Contador FPS",
    "settings.on": "SÍ",
    "settings.off": "NO",
    "settings.close": "CERRAR",
    "footer.hint": "FLECHAS / WASD MOVER - P PAUSA - R REINICIAR"
  }
};
