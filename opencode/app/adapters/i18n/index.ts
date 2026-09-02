/**
 * Tiny zero-dependency i18n.
 *
 * Design:
 * - `t(locale, key, params?)` resolves a message: locale first, English
 *   fallback for any missing value. Interpolation replaces `{name}` with the
 *   given param (unknown params are dropped to "" rather than leaking).
 * - Parameter-free lookups are memoised per locale so steady-state HUD
 *   refreshes allocate nothing (the zero-alloc budget applies to i18n too:
 *   `resolve` is only called when a displayed value changes, and the static
 *   labels hit the cache after first use).
 * - Locale detection prefers an explicit choice (user toggle, step 19) over
 *   `navigator.language`; unknown BCP-47 prefixes fall back to English.
 *
 * The domain never imports this module (it has no strings; replay logs are
 * locale-agnostic).
 */
import {
  CATALOGS,
  DEFAULT_LOCALE,
  PARAMS,
  SUPPORTED,
  type Locale,
  type MessageKey
} from "./strings";

export type { Locale, MessageKey };

/** Memoised parameter-free resolutions: steady-state zero allocation. */
const cache = new Map<string, string>(); // `${locale}\u0000${key}` -> string

function interpolate(template: string, params: Record<string, number>): string {
  // Placeholder names are declared in PARAMS, so the set is tiny and known;
  // a single pass over `{name}` tokens is enough and avoids regex alloc on
  // the common param-free path (this function is not called for those).
  let out = "";
  let i = 0;
  for (;;) {
    const open = template.indexOf("{", i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    const close = template.indexOf("}", open + 1);
    if (close < 0) {
      out += template.slice(i);
      break;
    }
    const name = template.slice(open + 1, close);
    out += template.slice(i, open);
    const v = params[name];
    out += v === undefined ? "" : String(v);
    i = close + 1;
  }
  return out;
}

/**
 * Resolve a message. `params` must only be passed for keys that declare
 * placeholders in PARAMS (a mismatch is a test failure, not a runtime
 * error).
 */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, number>
): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const raw = catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key];
  if (params === undefined) {
    const cacheKey = locale + "\u0000" + key;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;
    cache.set(cacheKey, raw);
    return raw;
  }
  // Declared params only (defensive; PARAMS is the source of truth).
  const allowed = new Set(PARAMS[key]);
  const clean: Record<string, number> = {};
  for (const k of Object.keys(params)) {
    if (allowed.has(k)) clean[k] = params[k]!;
  }
  return interpolate(raw, clean);
}

/**
 * Pick a locale from a BCP-47 string (e.g. "ja-JP", "es-419"): exact locale
 * first, then language prefix, then English. Unknown input -> English.
 */
export function localeFromTag(tag: string): Locale {
  if (SUPPORTED.includes(tag as Locale)) return tag as Locale;
  const prefix = tag.slice(0, 2).toLowerCase();
  if (SUPPORTED.includes(prefix as Locale)) return prefix as Locale;
  return DEFAULT_LOCALE;
}

/**
 * Detect the browser locale without touching `navigator` directly at module
 * scope (keeps the module testable in node): pass the tag in.
 */
export function detectLocale(navLanguage: string): Locale {
  return localeFromTag(navLanguage);
}

/** All known locales (for the future locale-picker UI). */
export function supportedLocales(): readonly Locale[] {
  return SUPPORTED;
}
