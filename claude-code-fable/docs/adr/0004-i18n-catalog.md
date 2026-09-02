# ADR 0004 — i18n catalog

## Status

Accepted.

## Context

The HUD, overlays, settings panel and accessibility labels all carry
user-facing text. The brief asks for every string to be translatable with
English, Japanese and Spanish shipped, English as the fallback, and a
locale switch that re-renders the UI in place. The domain must stay
text-free: strings are presentation.

## Decision

- **One typed catalog** (`app/adapters/i18n/strings.ts`): a `StringKey`
  union and a `Record<Locale, Partial<Record<StringKey, string>>>` where
  `en` is required to be complete at the type level. A unit test also
  requires `ja` and `es` to cover every English key and to use the same
  `{placeholder}` set per key, so a shipped locale never silently falls
  back.
- **Lookup helper** (`app/adapters/i18n/index.ts`): `t(key, params)`
  resolves in the current locale, then English, then returns the key
  itself; `tIn(locale, key)` resolves without switching; `{name}`
  placeholders are interpolated from `params`.
- **Locale selection**: `detectLocale(override, languages)` prefers an
  explicit `?lang=` query override, then the first `navigator.languages`
  entry whose base tag is shipped, then English.
- **Re-render on change**: `setLocale` notifies subscribers; `bindDom(root)`
  rewrites every `[data-i18n]` element (text, or the attributes listed in
  `data-i18n-attr`) and updates `<html lang>`. Dynamic surfaces (HUD,
  overlays, settings) subscribe with `onLocaleChange` and re-render
  themselves.
- **No runtime loading**: the catalog is tiny (three locales, ~35 keys) and
  bundled; there is no fetch, which also keeps `connect-src 'none'` true.

## Consequences

- Adding a locale is a type-checked edit to one file plus the `LOCALES`
  list; the unit test enforces completeness.
- The domain and the renderers never see a string; the HUD reads state and
  formats it through `t()`.
- Number formatting is plain digits (scores), which is correct for all three
  shipped locales.
