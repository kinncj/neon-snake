import { beforeEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale, subscribe, t } from '../../app/adapters/i18n'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  STRINGS,
  type Locale,
  type StringKey,
} from '../../app/adapters/i18n/strings'

// i18n service (step 18, ADR 0004): the locale is app-wide state; `t` resolves a
// key in the active locale with an English fallback; `setLocale` notifies
// subscribers (the re-render contract) and rejects unsupported locales.

beforeEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe('i18n lookup', () => {
  it('defaults to English', () => {
    expect(getLocale()).toBe('en')
    expect(t('sound.toggle')).toBe('Toggle sound (M)')
    expect(t('hud.score')).toBe('Score')
  })

  it('switches to Japanese and back', () => {
    setLocale('ja')
    expect(getLocale()).toBe('ja')
    expect(t('hud.score')).toBe('スコア')
    expect(t('gameover.title')).toBe('ゲームオーバー')
    setLocale('en')
    expect(t('hud.score')).toBe('Score')
  })

  it('switches to Spanish', () => {
    setLocale('es')
    expect(getLocale()).toBe('es')
    expect(t('hud.score')).toBe('Puntos')
    expect(t('gameover.title')).toBe('Fin del juego')
  })

  it('substitutes placeholders (the level banner)', () => {
    expect(t('levelup.banner', { n: 3 })).toBe('Level 3')
    setLocale('ja')
    expect(t('levelup.banner', { n: 5 })).toBe('レベル 5')
    setLocale('es')
    expect(t('levelup.banner', { n: 2 })).toBe('Nivel 2')
  })

  it('ignores an unsupported locale (the locale never becomes invalid)', () => {
    setLocale('ja')
    setLocale('fr' as Locale)
    expect(getLocale()).toBe('ja') // unchanged — 'fr' is not a shipped locale
  })

  it('is a no-op when set to the current locale', () => {
    let calls = 0
    const unsub = subscribe(() => {
      calls++
    })
    setLocale('en') // already en
    expect(calls).toBe(0)
    unsub()
  })
})

describe('i18n re-render contract (setLocale notifies subscribers)', () => {
  it('notifies subscribers on change and honours unsubscribe', () => {
    const seen: Locale[] = []
    const unsub = subscribe((l) => seen.push(l))
    setLocale('ja')
    setLocale('es')
    expect(seen).toEqual(['ja', 'es'])
    unsub()
    setLocale('ja')
    expect(seen).toEqual(['ja', 'es']) // unsubscribed — not called again
  })
})

describe('i18n catalog completeness', () => {
  it('ships exactly the supported locales, with English first/default', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'ja', 'es'])
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('has a non-trivial key set and every locale carries every key, non-empty', () => {
    const keys = Object.keys(STRINGS.en) as StringKey[]
    expect(keys.length).toBeGreaterThanOrEqual(15)
    for (const k of keys) {
      expect(STRINGS.en[k], `en:${k}`).toBeTruthy()
      for (const loc of SUPPORTED_LOCALES) {
        const v = STRINGS[loc][k]
        expect(v, `${loc}:${k}`).toBeTruthy()
        expect(v!.trim().length, `${loc}:${k} is blank`).toBeGreaterThan(0)
      }
    }
  })

  it('the brand name is identical across locales', () => {
    expect(STRINGS.ja['title.name']).toBe(STRINGS.en['title.name'])
    expect(STRINGS.es['title.name']).toBe(STRINGS.en['title.name'])
  })
})
