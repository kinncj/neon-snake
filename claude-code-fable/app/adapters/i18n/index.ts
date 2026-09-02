import { type Locale, type StringKey, STRINGS, LOCALES, FALLBACK } from "./strings";

export type { Locale, StringKey };
export { LOCALES, FALLBACK };

/**
 * Locale lookup with per-key English fallback and `{name}` interpolation.
 * `setLocale` notifies subscribers so every bound surface re-renders.
 */
let current: Locale = FALLBACK;
const listeners = new Set<(l: Locale) => void>();

export function isLocale(v: string | null | undefined): v is Locale {
  return v !== null && v !== undefined && (LOCALES as readonly string[]).includes(v);
}

/** Picks a locale from an explicit override (e.g. `?lang=ja`) or the browser languages. */
export function detectLocale(override: string | null, languages: readonly string[]): Locale {
  if (isLocale(override)) return override;
  for (const lang of languages) {
    const base = lang.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return FALLBACK;
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  for (const fn of listeners) fn(l);
}

export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translates `key`, falling back to English, then to the key itself. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  const text = STRINGS[current][key] ?? STRINGS[FALLBACK][key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Translates for an explicit locale without switching the global one. */
export function tIn(locale: Locale, key: StringKey, params?: Record<string, string | number>): string {
  const text = STRINGS[locale][key] ?? STRINGS[FALLBACK][key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/**
 * Binds static DOM text: every element with `data-i18n="key"` gets its
 * textContent from the catalog, and `data-i18n-attr="aria-label,title"`
 * routes the same string into attributes instead. Re-applied on change.
 */
export function bindDom(root: ParentNode): () => void {
  const apply = (): void => {
    const nodes = root.querySelectorAll<HTMLElement>("[data-i18n]");
    for (const el of nodes) {
      const key = el.dataset["i18n"] as StringKey;
      const text = t(key);
      const attrs = el.dataset["i18nAttr"];
      if (attrs) {
        for (const a of attrs.split(",")) el.setAttribute(a.trim(), text);
      } else {
        el.textContent = text;
      }
    }
    if (root instanceof Document) root.documentElement.lang = current;
  };
  apply();
  return onLocaleChange(apply);
}
