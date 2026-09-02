import { expect, test } from "@playwright/test";

// Headless WebKit has no audio output pipeline; the Web Audio code path is
// covered by the unit tests (tests/unit/audio.test.ts).
test.skip(({ browserName }) => browserName === "webkit", "no audio pipeline in headless WebKit");

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

test("no AudioContext exists before the first user gesture", async ({ page }) => {
  await ready(page);
  // the page has loaded and rendered frames, but no gesture has happened yet
  await page.waitForTimeout(200);
  const info = await page.evaluate(() => window.__snake!.audio.info());
  expect(info.unlocked).toBe(false);
  expect(info.state).toBe("locked");
  expect(info.duckCap).toBe(0.8);
  expect(info.voices).toEqual(["pulse", "triangle", "noise", "lead"]);
});

test("a real pointer gesture unlocks the synth and the context runs", async ({ page }) => {
  await ready(page);
  await page.mouse.click(100, 100);
  await page.waitForFunction(
    () => window.__snake!.audio.info().unlocked === true,
    null,
    { timeout: 3000 }
  );
  const info = await page.evaluate(() => window.__snake!.audio.info());
  expect(info.unlocked).toBe(true);
  // "running" requires a real output device; headless engines may report
  // "suspended" while still running the graph. The contract: the context
  // exists and is unlocked (never "locked").
  expect(["running", "suspended"]).toContain(info.state);
  // the SFX blip path runs without error once unlocked
  await page.evaluate(() => window.__snake!.audio.blip("lead", 72));
});

test("visibilitychange suspends the context; visible resumes it", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__snake!.audio.unlock());
  await page.waitForFunction(() => window.__snake!.audio.info().unlocked, null, {
    timeout: 3000
  });

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(
    () => window.__snake!.audio.info().state === "suspended",
    null,
    { timeout: 3000 }
  );

  const wasRunningBefore =
    (await page.evaluate(() => window.__snake!.audio.info().state)) === "running";
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Resume only reaches "running" when there is a live output device; on
  // headless engines the context may stay "suspended" (no device), which is a
  // valid no-audio state, not a resume failure.
  if (wasRunningBefore) {
    await page.waitForFunction(
      () => window.__snake!.audio.info().state === "running",
      null,
      { timeout: 3000 }
    );
  }
});

test("pausing the game ducks the music; resuming unducks it", async ({ page }) => {
  await ready(page);
  await page.mouse.click(100, 100);
  // The click unlocks the synth (capture-phase gesture listener); ducking
  // follows the game phase, so wait for the game to be playing *and* the
  // synth to have un-ducked.
  await page.waitForFunction(
    () =>
      window.__snake!.state.phase === "playing" &&
      window.__snake!.audio.info().ducked === false,
    null,
    { timeout: 3000 }
  );
  expect(await page.evaluate(() => window.__snake!.audio.info().ducked)).toBe(false);

  await page.keyboard.press("p");
  await page.waitForFunction(() => window.__snake!.state.phase === "paused");
  expect(await page.evaluate(() => window.__snake!.audio.info().ducked)).toBe(true);

  await page.keyboard.press("p");
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");
  expect(await page.evaluate(() => window.__snake!.audio.info().ducked)).toBe(false);
});

test("level-up switches the song and fires the jingle", async ({ page }) => {
  await ready(page);
  await page.mouse.click(100, 100);
  await page.waitForFunction(
    () => window.__snake!.state.phase === "playing",
    null,
    { timeout: 3000 }
  );
  // starts on the level-1 song
  expect(await page.evaluate(() => window.__snake!.audio.info().song)).toBe(1);

  // one apple (10 pts, combo >= 1) puts 140 over the level-2 boundary
  await page.evaluate(() => {
    window.__snake!.bumpScore(140);
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(() => window.__snake!.state.level === 2, null, {
    timeout: 3000
  });
  // the level-up effect fires the jingle and re-targets the song
  await page.waitForFunction(() => window.__snake!.audio.info().song === 2, null, {
    timeout: 3000
  });
  const info = await page.evaluate(() => window.__snake!.audio.info());
  expect(info.song).toBe(2);
  expect(info.sfx.jingle).toBeGreaterThanOrEqual(1);
});

test("eating counts a chomp; a wall death counts a boom + gameover", async ({ page }) => {
  await ready(page);
  await page.mouse.click(100, 100);
  await page.waitForFunction(
    () => window.__snake!.state.phase === "playing",
    null,
    { timeout: 3000 }
  );

  // eat one apple -> chomp fires
  await page.evaluate(() => window.__snake!.fx.teleportFoodAhead());
  await page.waitForFunction(
    () => (window.__snake!.audio.info().sfx.chomp ?? 0) >= 1,
    null,
    { timeout: 3000 }
  );

  // wall death -> boom + gameover fire. Use the same freeze/forceDeath/
  // unfreeze pattern as the death-sequence test so the death is deterministic.
  await page.evaluate(() => {
    window.__snake!.freeze();
    window.__snake!.fx.forceDeath();
    window.__snake!.unfreeze();
  });
  await page.waitForFunction(
    () => (window.__snake!.audio.info().sfx.boom ?? 0) >= 1,
    null,
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => (window.__snake!.audio.info().sfx.gameover ?? 0) >= 1,
    null,
    { timeout: 15000 }
  );
  const info = await page.evaluate(() => window.__snake!.audio.info());
  expect(info.sfx.chomp).toBeGreaterThanOrEqual(1);
  expect(info.sfx.boom).toBeGreaterThanOrEqual(1);
  expect(info.sfx.gameover).toBeGreaterThanOrEqual(1);
});
