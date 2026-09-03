// i18n service (step 18, ADR 0004). A single app-wide locale with a `t()` lookup
// helper and a `setLocale` that re-renders any UI that has subscribed. The locale
// is in-memory state (default English); a language picker (settings panel) drives
// `setLocale` and the whole UI re-renders through the subscribers. English is the
// fallback: a key missing from the active locale resolves from the English
// catalog rather than rendering blank.
import {
  DEFAULT_LOCALE,
  STRINGS,
  SUPPORTED_LOCALES,
  type Locale,
  type StringKey,
} from './strings'

/** Subscribers are called with the new locale after a change, so they re-read
 *  their strings via `t()` and repaint. `setLocale` is the re-render trigger. */
export type LocaleListener = (locale: Locale) => void

let locale: Locale = DEFAULT_LOCALE
const listeners = new Set<LocaleListener>()

/** The active locale (always one of `SUPPORTED_LOCALES`; defaults to English). */
export function getLocale(): Locale {
  return locale
}

/**
 * Look up a string in the active locale, falling back to English for any key the
 * active locale lacks, then substituting `{name}` placeholders from `vars`.
 * Returns '' only for a key that is missing even from English (a catalog bug —
 * caught by the completeness unit test).
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const raw = STRINGS[locale][key] ?? STRINGS[DEFAULT_LOCALE][key] ?? ''
  if (!vars) return raw
  let out = raw
  for (const name in vars) out = out.split(`{${name}}`).join(String(vars[name]))
  return out
}

/**
 * Switch the active locale and notify subscribers so the UI re-renders. An
 * unsupported locale is ignored (the locale never becomes invalid); switching to
 * the current locale is a no-op (no redundant repaints).
 */
export function setLocale(next: Locale): void {
  if (!SUPPORTED_LOCALES.includes(next)) return
  if (next === locale) return
  locale = next
  for (const l of listeners) l(locale)
}

/**
 * Register a re-render callback, called on the next (and every future)
 * `setLocale`. Returns an unsubscribe; adapters should call it on teardown.
 */
export function subscribe(fn: LocaleListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
