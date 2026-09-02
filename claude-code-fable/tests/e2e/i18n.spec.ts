import { test, expect } from "@playwright/test";
import { ready } from "./snake-debug";

test("?lang=ja renders the UI in Japanese", async ({ page }) => {
  await page.goto("/?lang=ja");
  await page.waitForFunction(() => typeof window.__snake !== "undefined");
  expect(await page.evaluate(() => window.__snake.locale())).toBe("ja");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("ja");
  await expect(page.locator("#ov-title")).toHaveText("ネオンスネーク");
  await expect(page.locator("#mute")).toHaveAttribute("aria-label", "サウンド オン/オフ (M)");
  await expect(page.locator(".hud-score .hud-label")).toHaveText("スコア");
});

test("the browser language is honoured and English is the fallback", async ({ browser }) => {
  const es = await browser.newContext({ locale: "es-MX" });
  const p1 = await es.newPage();
  await p1.goto("/");
  await p1.waitForFunction(() => typeof window.__snake !== "undefined");
  await expect(p1.locator("#ov-title")).toHaveText("SERPIENTE NEÓN");
  await es.close();
  const fr = await browser.newContext({ locale: "fr-FR" });
  const p2 = await fr.newPage();
  await p2.goto("/");
  await p2.waitForFunction(() => typeof window.__snake !== "undefined");
  await expect(p2.locator("#ov-title")).toHaveText("NEON SNAKE");
  await fr.close();
});

test("switching locale re-renders the HUD and overlays in place", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.keyboard.press("KeyP");
  await expect(page.locator("#ov-title")).toHaveText("Paused");
  await page.evaluate(() => window.__snake.setLocale("es"));
  await expect(page.locator("#ov-title")).toHaveText("Pausa");
  await expect(page.locator("#hud-level")).toHaveText("Nivel 1");
  await expect(page.locator(".hud-best .hud-label")).toHaveText("Récord");
  await page.evaluate(() => window.__snake.setLocale("en"));
  await expect(page.locator("#ov-title")).toHaveText("Paused");
});
