# ADR 0004 — i18n catalog (en/ja/es, English fallback)

- **Status:** accepted
- **Date:** 2026-09-03
- **Area:** presentation / `app/adapters/i18n/`

## Context

The game's UI — HUD, title/pause/gameover overlays, the settings panel, the
score and level-up popups, and the sound control's accessible label — all speak.
The spec ships three languages (**en/ja/es**) and makes **English the fallback**,
and requires that the HUD, overlays, and settings all read from a single catalog
and that `setLocale` **re-renders** them.

Two properties have to hold:

- **No hard-coded display strings.** If a UI element owns its own English text, it
  can't be localized. Every user-facing string must live in one place.
- **Completeness is enforceable.** A missing or misspelled key must be caught at
  build time (or, failing that, at unit-test time), not surface as a blank label
  in a shipped language.

## Decision

**A single app-wide locale, a pure string catalog, and a lookup service.**

- **The catalog** (`app/adapters/i18n/strings.ts`) holds every string in en/ja/es.
  The English object is the single source of truth for the *set of keys*: `StringKey`
  is `keyof` the English object, and the Japanese and Spanish catalogs are typed
  `Record<StringKey, string>`. TypeScript therefore **proves at compile time** that
  every locale carries every key — a dropped or misspelled key is a type error, not
  a runtime blank.
- **The service** (`app/adapters/i18n/index.ts`) is a small app-wide singleton:
  - `t(key, vars?)` resolves `key` in the active locale, **falling back to English**
    for any key the active locale lacks, and then substitutes `{name}` placeholders
    from `vars` (used by templated strings like the level banner, `Level {n}`).
  - `getLocale()` / `setLocale(locale)` — the locale is in-memory state, defaulting
    to English. `setLocale` **rejects any locale not in `SUPPORTED_LOCALES`** (the
    active locale can never become invalid) and is a no-op when the locale is
    unchanged.
  - `subscribe(fn)` registers a re-render callback and returns an unsubscribe.
- **Re-render via subscribers.** `setLocale` fires every subscriber after changing
  the locale. Any UI that renders text registers a subscriber that re-reads its
  strings through `t()` and repaints. That is the whole of "`setLocale` re-renders":
  the adapter owns *what* to repaint; the service owns *when* (a locale change).
  The sound control already uses this — its `aria-label` is `t('sound.toggle')` and
  it subscribes so the label re-renders on a language switch.

The service has **no DOM of its own** (it holds strings and a locale); it is a
foundational adapter that the presentation adapters depend on, and it depends on
nothing else. It lives under `app/adapters/` (not the domain), so it is exempt from
the domain purity rules but imports no other adapter.

**English as the fallback** is satisfied two ways: English is the *default* locale
(the app starts in English), and `t()` resolves any key missing from the active
locale from the English catalog before giving up (a key missing even from English
is a catalog bug the completeness unit test would flag). Because the catalogs are
compile-checked to be complete, the fallback is a defensive net rather than a
common path.

## Consequences

**Positive**

- No UI element hard-codes a display string; every label flows from one catalog.
- Completeness is enforced at compile time (types) and re-checked at unit-test
  time (every key present and non-empty in every locale).
- The re-render is a clean observer pattern: the service knows the locale changed
  and tells interested adapters to repaint, without the service reaching into any
  specific UI.
- Adding a language later is one new object in `STRINGS` plus a `Locale` union
  member — no other code changes.

**Negative / accepted costs**

- The locale is in-memory (it resets to English on reload). That is correct for
  this step — the language *picker* lives in the settings panel (Phase 4), which is
  the natural place to persist the choice. The service does not own persistence, so
  a persistence layer can be added there without touching the catalog or service.
- `t()` does a `split/join` per placeholder; negligible for the handful of templated
  strings, and it avoids pulling in a full ICU/MessageFormat dependency.

## Alternatives considered

- **`Intl` / ICU MessageFormat.** Rejected: a full message-format runtime is
  overkill for a small, fixed, manually-reviewed set of short UI strings, and it
  adds parsing, pluralization grammar, and a larger dependency surface for little
  benefit here.
- **Per-string message *functions* (`msg(key, vars) => ...`) instead of a data
  catalog.** Rejected: functions scatter the translations and make completeness
  hard to prove; a data catalog keyed by a shared `StringKey` union is what lets
  TypeScript enforce that every locale has every string.
- **No i18n (hard-coded English).** Rejected: the spec explicitly ships en/ja/es
  with an English fallback.
