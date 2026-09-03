// i18n string catalog (step 18, ADR 0004). Every user-facing string lives here,
// in en/ja/es, and English is the fallback. The EN object is the single source
// of truth for the *set of keys*: `StringKey` is derived from it, and JA/ES are
// typed against it, so a missing or misspelled key is a compile error, not a
// runtime blank. Presentation adapters (HUD, overlays, settings, the sound
// control) read strings through `t()`; none of them hard-code a display string.

export type Locale = 'en' | 'ja' | 'es'

/** Locates that ship. Order here drives any language picker's listing. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ja', 'es']

/** The default locale and the fallback for any key absent from the current one. */
export const DEFAULT_LOCALE: Locale = 'en'

const EN = {
  // Brand — kept identical across locales (it is a name, not a sentence).
  'title.name': 'NEON SNAKE',
  'title.start': 'Press any key to start',
  'title.move': 'Steer with the arrows or WASD',
  'title.hints': 'P pauses · R restarts · M sound',

  'hud.score': 'Score',
  'hud.best': 'Best',
  'hud.level': 'Level',
  'hud.max': 'MAX',

  'pause.title': 'Paused',
  'pause.resume': 'Press P to resume',

  'gameover.title': 'Game over',
  'gameover.score': 'Score',
  'gameover.best': 'Best',
  'gameover.restart': 'Press R to restart',

  'levelup.banner': 'Level {n}',

  'sound.toggle': 'Toggle sound (M)',

  'dpad.up': 'Move up',
  'dpad.down': 'Move down',
  'dpad.left': 'Move left',
  'dpad.right': 'Move right',

  'settings.title': 'Settings',
  'settings.effects': 'Effects',
  'settings.sound': 'Sound',
  'settings.dpad': 'D-pad',
  'settings.fps': 'FPS',
  'settings.language': 'Language',
  'settings.close': 'Close',

  'common.on': 'On',
  'common.off': 'Off',

  'lang.en': 'English',
  'lang.ja': 'Japanese',
  'lang.es': 'Spanish',
} as const

export type StringKey = keyof typeof EN

/**
 * The three shipped catalogs. Typed as `Record<StringKey, string>` so TypeScript
 * proves at compile time that every locale carries every key (completeness).
 */
export const STRINGS: Record<Locale, Record<StringKey, string>> = {
  en: EN,
  ja: {
    'title.name': 'NEON SNAKE',
    'title.start': '任意のキーでスタート',
    'title.move': '矢印キー / WASD で操作',
    'title.hints': 'P ポーズ / R リセット / M サウンド',

    'hud.score': 'スコア',
    'hud.best': 'ベスト',
    'hud.level': 'レベル',
    'hud.max': 'MAX',

    'pause.title': 'ポーズ中',
    'pause.resume': 'P で再開',

    'gameover.title': 'ゲームオーバー',
    'gameover.score': 'スコア',
    'gameover.best': 'ベスト',
    'gameover.restart': 'R でリスタート',

    'levelup.banner': 'レベル {n}',

    'sound.toggle': 'サウンド切替 (M)',

    'dpad.up': '上へ移動',
    'dpad.down': '下へ移動',
    'dpad.left': '左へ移動',
    'dpad.right': '右へ移動',

    'settings.title': '設定',
    'settings.effects': 'エフェクト',
    'settings.sound': 'サウンド',
    'settings.dpad': '十字キー',
    'settings.fps': 'FPS',
    'settings.language': '言語',
    'settings.close': '閉じる',

    'common.on': 'オン',
    'common.off': 'オフ',

    'lang.en': '英語',
    'lang.ja': '日本語',
    'lang.es': 'スペイン語',
  },
  es: {
    'title.name': 'NEON SNAKE',
    'title.start': 'Pulsa una tecla para empezar',
    'title.move': 'Mueve con las flechas o WASD',
    'title.hints': 'P pausa · R reinicia · M sonido',

    'hud.score': 'Puntos',
    'hud.best': 'Récord',
    'hud.level': 'Nivel',
    'hud.max': 'MÁX',

    'pause.title': 'Pausa',
    'pause.resume': 'Pulsa P para continuar',

    'gameover.title': 'Fin del juego',
    'gameover.score': 'Puntos',
    'gameover.best': 'Récord',
    'gameover.restart': 'Pulsa R para reiniciar',

    'levelup.banner': 'Nivel {n}',

    'sound.toggle': 'Alternar sonido (M)',

    'dpad.up': 'Mover arriba',
    'dpad.down': 'Mover abajo',
    'dpad.left': 'Mover a la izquierda',
    'dpad.right': 'Mover a la derecha',

    'settings.title': 'Ajustes',
    'settings.effects': 'Efectos',
    'settings.sound': 'Sonido',
    'settings.dpad': 'Cruceta',
    'settings.fps': 'FPS',
    'settings.language': 'Idioma',
    'settings.close': 'Cerrar',

    'common.on': 'Activado',
    'common.off': 'Desactivado',

    'lang.en': 'Inglés',
    'lang.ja': 'Japonés',
    'lang.es': 'Español',
  },
}
