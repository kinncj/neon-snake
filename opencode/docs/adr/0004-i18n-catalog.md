# ADR 0004 — Zero-dependency catalog i18n with English fallback

Date: 2026-09-02 (UTC, phase 2, step 18)

## Status

Accepted.

## Context

Phase 2 introduces user-facing strings at scale (HUD labels, banners, hints,
buttons). The project manifest is fixed (no runtime dependencies) and the
zero-alloc steady-state budget applies to everything that runs per frame or
per event. Pulling in an i18n framework would (a) break the manifest rule,
(b) allocate on every lookup, and (c) pull in a loader/runtime the game
doesn't need — the string surface is small and known.

## Decision

- i18n is a **presentation adapter** (`app/adapters/i18n/`), not a domain
  concern: `app/domain/**` has no strings (replay logs and the engine are
  locale-agnostic, so replays are valid in every locale).
- **Data/logic split** (SRP): `strings.ts` is pure data (key union, catalogs,
  declared placeholder params); `index.ts` holds the resolver, interpolation,
  and locale detection. Adding a locale or a string touches data files, never
  logic (OCP).
- **English is the fallback locale.** `t()` reads the requested catalog first
  and English on any miss, so a partial translation can never crash the UI.
  A unit test goes further and asserts *completeness*: every locale defines
  every key, so the fallback is a safety net, not a workflow.
- **Placeholder contract**: `{name}` tokens must be declared in `PARAMS[key]`
  or the completeness test fails. Unknown params are dropped; undeclared
  placeholders resolve to `""` (no leaking `{n}` into the UI).
- **Budget**: parameter-free lookups are memoised per locale (one-time
  allocation, then same reference). HUD labels resolve once and the
  steady-state refresh path allocates nothing; only rare events (level-up
  banner) interpolate.
- **Detection**: `navigator.language` → exact locale, then language prefix,
  then English. The function takes the tag as a parameter so node tests never
  touch `navigator`. A user-selectable locale (persisted) will override
  detection — the resolver is agnostic to where the locale comes from
  (ISP: callers pass a locale, never re-detect).

## Consequences

- Three locales ship on day one (`en`, `ja`, `es`); adding `fr` is one
  catalog object plus a `Locale` union member.
- The key union is a compile-time contract: a HUD that references an
  undeclared key fails typecheck.
- Translators work in `strings.ts` only; the completeness tests are their
  CI safety net.
- Cost: a hand-rolled resolver (~120 lines) instead of a battle-tested
  library — accepted, because the requirements (3 locales, <20 keys, no
  pluralization yet) make the failure modes trivially testable. If the
  surface grows (plural rules, RTL), this ADR gets superseded.
