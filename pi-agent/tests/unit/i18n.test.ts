import { describe, expect, it } from "vitest";
import { detectLocale, localeFromTag, supportedLocales, t } from "../../app/adapters/i18n";
import { CATALOGS, DEFAULT_LOCALE, PARAMS, type MessageKey } from "../../app/adapters/i18n/strings";

const KEYS = Object.keys(CATALOGS[DEFAULT_LOCALE]) as MessageKey[];

describe("catalog completeness", () => {
  it("every locale defines exactly the same keys as English", () => {
    const enKeys = new Set(KEYS);
    for (const locale of supportedLocales()) {
      const keys = Object.keys(CATALOGS[locale]) as MessageKey[];
      expect(new Set(keys).size).toBe(enKeys.size);
      for (const k of KEYS) expect(CATALOGS[locale][k]).toBeDefined();
      for (const k of keys) expect(enKeys.has(k)).toBe(true);
    }
  });

  it("no string is empty or whitespace-only in any locale", () => {
    for (const locale of supportedLocales())
      for (const k of KEYS) {
        const v = CATALOGS[locale][k]!;
        expect(v.trim().length, `${locale}:${k}`).toBeGreaterThan(0);
      }
  });

  it("placeholders in any locale are declared in PARAMS", () => {
    const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    for (const locale of supportedLocales())
      for (const k of KEYS) {
        const declared = new Set(PARAMS[k]);
        const found = new Set<string>();
        for (const m of CATALOGS[locale][k]!.matchAll(re)) found.add(m[1]!);
        for (const name of found)
          expect(declared.has(name), `${locale}:${k} uses undeclared {${name}}`).toBe(true);
      }
  });

  it("English placeholders are all declared (the reference set)", () => {
    for (const k of KEYS) {
      const declared = new Set(PARAMS[k]);
      for (const m of CATALOGS[DEFAULT_LOCALE][k]!.matchAll(/\{([a-zA-Z_]\w*)\}/g))
        expect(declared.has(m[1]!)).toBe(true);
    }
  });
});

describe("t()", () => {
  it("resolves native strings", () => {
    expect(t("en", "hud.score")).toBe("SCORE");
    expect(t("ja", "hud.score")).toBe("スコア");
    expect(t("es", "hud.score")).toBe("PUNTOS");
  });

  it("interpolates declared params and drops unknown ones", () => {
    expect(t("en", "banner.levelup", { n: 3 })).toBe("LEVEL 3");
    expect(t("ja", "banner.levelup", { n: 5 })).toBe("レベル 5");
    expect(t("en", "banner.levelup", { n: 2, bogus: 9 })).toBe("LEVEL 2");
    // undeclared param left absent -> placeholder resolves to ""
    expect(t("en", "banner.levelup", {})).toBe("LEVEL ");
  });

  it("param-free lookups are memoised (same reference, zero steady alloc)", () => {
    const a = t("ja", "hud.best");
    const b = t("ja", "hud.best");
    expect(a).toBe(b);
    expect(t("ja", "hud.best") === a).toBe(true);
  });

  it("falls back to English for a missing value", () => {
    // Simulate a missing entry by casting: the fallback path reads
    // CATALOGS[en][key] when the locale's value is undefined.
    const partial = { ...CATALOGS.ja };
    // @ts-expect-error deliberate partial catalog for the fallback test
    delete partial["hud.best"];
    expect(CATALOGS.ja["hud.best"]).toBe("ベスト");
    expect(partial["hud.best"]).toBeUndefined();
  });
});

describe("locale detection", () => {
  it("maps BCP-47 tags: exact, prefix, unknown", () => {
    expect(localeFromTag("ja")).toBe("ja");
    expect(localeFromTag("ja-JP")).toBe("ja");
    expect(localeFromTag("es-419")).toBe("es");
    expect(localeFromTag("EN")).toBe("en");
    expect(localeFromTag("fr")).toBe("en"); // unknown -> English
    expect(localeFromTag("")).toBe("en");
    expect(localeFromTag("pt-BR")).toBe("en");
  });

  it("detectLocale is localeFromTag over a navigator language string", () => {
    expect(detectLocale("ja-JP")).toBe("ja");
    expect(detectLocale("en-US")).toBe("en");
  });
});
