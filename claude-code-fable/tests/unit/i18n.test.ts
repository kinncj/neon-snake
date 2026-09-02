import { describe, it, expect, afterEach } from "vitest";
import { t, tIn, setLocale, getLocale, detectLocale, onLocaleChange, isLocale, LOCALES } from "../../app/adapters/i18n";
import { STRINGS, type StringKey } from "../../app/adapters/i18n/strings";

afterEach(() => setLocale("en"));

describe("catalog", () => {
  it("ships en, ja and es with English complete", () => {
    expect(LOCALES).toEqual(["en", "ja", "es"]);
    const keys = Object.keys(STRINGS.en) as StringKey[];
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(STRINGS.en[k].length).toBeGreaterThan(0);
  });
  it("ja and es translate every English key (no silent fallbacks in shipped locales)", () => {
    const keys = Object.keys(STRINGS.en) as StringKey[];
    for (const l of ["ja", "es"] as const) {
      for (const k of keys) expect(STRINGS[l][k], `${l}.${k}`).toBeDefined();
    }
  });
  it("placeholders match across locales", () => {
    const keys = Object.keys(STRINGS.en) as StringKey[];
    for (const k of keys) {
      const en = (STRINGS.en[k].match(/\{\w+\}/g) ?? []).sort();
      for (const l of ["ja", "es"] as const) {
        const other = (STRINGS[l][k]!.match(/\{\w+\}/g) ?? []).sort();
        expect(other, `${l}.${k}`).toEqual(en);
      }
    }
  });
});

describe("lookup", () => {
  it("translates, interpolates and falls back to English then the key", () => {
    expect(t("score")).toBe("Score");
    expect(t("level", { n: 3 })).toBe("Level 3");
    setLocale("ja");
    expect(t("score")).toBe("スコア");
    expect(t("level", { n: 5 })).toBe("レベル 5");
    expect(tIn("es", "game_over")).toBe("Fin del juego");
    expect(t("nope" as StringKey)).toBe("nope");
  });
  it("leaves unknown placeholders alone", () => {
    expect(t("level", { x: 1 })).toBe("Level {n}");
  });
  it("notifies subscribers once per change", () => {
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    setLocale("es");
    setLocale("es");
    setLocale("ja");
    off();
    setLocale("en");
    expect(seen).toEqual(["es", "ja"]);
    expect(getLocale()).toBe("en");
  });
});

describe("detection", () => {
  it("prefers an explicit override, then browser languages, then English", () => {
    expect(detectLocale("ja", ["en-US"])).toBe("ja");
    expect(detectLocale("xx", ["es-MX", "en"])).toBe("es");
    expect(detectLocale(null, ["fr-FR", "ja-JP"])).toBe("ja");
    expect(detectLocale(null, ["fr-FR"])).toBe("en");
    expect(detectLocale(null, [])).toBe("en");
    expect(isLocale("EN")).toBe(false);
  });
});
