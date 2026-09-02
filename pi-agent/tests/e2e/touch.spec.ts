import { expect, test } from "@playwright/test";
import { play } from "./snake-debug";

// Headless desktop Firefox exposes no Touch API (Touch is not defined), so
// the synthetic-touch tests cannot run there; the swipe/d-pad code paths use
// standard touch events and are covered by the Chromium runs.
test.skip(({ browserName }) => browserName === "firefox", "no Touch API in headless desktop Firefox");

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

async function settle(page: import("@playwright/test").Page, expr: string): Promise<void> {
  await page.waitForFunction(expr, null, { timeout: 2000 });
}

/** Dispatch a synthetic swipe over #stage with the given CSS-px endpoints. */
async function swipe(
  page: import("@playwright/test").Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps = 8
): Promise<void> {
  await page.evaluate(
    ([sx, sy, ex, ey, n]) => {
      const el = document.getElementById("stage")!;
      const mkTouch = (x: number, y: number) =>
        new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      const fire = (type: "touchstart" | "touchmove" | "touchend", x: number, y: number) => {
        const touches = type === "touchend" ? [] : [mkTouch(x, y)];
        el.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            targetTouches: touches,
            changedTouches: [mkTouch(x, y)]
          })
        );
      };
      fire("touchstart", sx, sy);
      for (let i = 1; i <= n; i++) {
        fire("touchmove", sx + ((ex - sx) * i) / n, sy + ((ey - sy) * i) / n);
      }
      fire("touchend", ex, ey);
    },
    [x0, y0, x1, y1, steps] as [number, number, number, number, number]
  );
}

test("swipe up emits exactly one up; short drags emit nothing", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__snake!.freeze());

  // 80px up over 8 move events -> exactly one queued turn
  await swipe(page, 400, 500, 400, 420, 8);
  await settle(page, "window.__snake.state.pendingLen === 1");

  // 80px left over 16 move events -> exactly one more queued turn (left is
  // legal after up). Proves one intent per gesture, not one per move event.
  await swipe(page, 400, 450, 320, 450, 16);
  await settle(page, "window.__snake.state.pendingLen === 2");

  // below the 24px minimum: nothing
  await swipe(page, 400, 450, 410, 444); // 10px right, 6px up
  await page.waitForTimeout(200);
  await settle(page, "window.__snake.state.pendingLen === 2");
});

test("touch is preventDefaulted and the page does not scroll", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    (window as unknown as { __tpd: Record<string, boolean> }).__tpd = {};
    window.addEventListener("touchstart", (e) => {
      (window as unknown as { __tpd: Record<string, boolean> }).__tpd.start = e.defaultPrevented;
    });
    window.addEventListener("touchmove", (e) => {
      (window as unknown as { __tpd: Record<string, boolean> }).__tpd.move = e.defaultPrevented;
    });
  });
  await swipe(page, 400, 500, 400, 420);
  const tpd = await page.evaluate(
    () => (window as unknown as { __tpd: Record<string, boolean> }).__tpd
  );
  expect(tpd.start).toBe(true);
  expect(tpd.move).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("touch-action and overscroll-behavior are set", async ({ page }) => {
  await ready(page);
  const css = await page.evaluate(() => {
    const stage = document.getElementById("stage")!;
    const canvas = document.getElementById("game") as HTMLCanvasElement;
    return {
      stage: getComputedStyle(stage).touchAction,
      canvas: getComputedStyle(canvas).touchAction,
      html: getComputedStyle(document.documentElement).overscrollBehavior,
      body: getComputedStyle(document.body).overscrollBehavior
    };
  });
  expect(css.stage).toBe("none");
  expect(css.canvas).toBe("none");
  expect(css.html).toBe("none");
  expect(css.body).toBe("none");
});

test("d-pad toggle persists and controls stay out of the safe-area insets", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  // Start past the title screen: the overlay would intercept the gear click.
  await play(page);

  // enable the pad via the settings modal
  await page.click("#settings-gear");
  await page.click('.settings-row[data-key="dpad"]');
  expect(await page.evaluate(() => document.getElementById("dpad")!.classList.contains("visible"))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("snake.settings")!).dpad)).toBe(true);

  // survive a reload
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => document.getElementById("dpad")!.classList.contains("visible"))).toBe(true);

  // simulate 34px bottom and 20px left insets
  await page.evaluate(() => {
    const r = document.documentElement;
    r.style.setProperty("--safe-bottom", "34px");
    r.style.setProperty("--safe-left", "20px");
  });
  const boxes = await page.evaluate(() => {
    const dpad = document.getElementById("dpad")!;
    const gear = document.getElementById("settings-gear")!;
    const all = [...Array.from(dpad.querySelectorAll("button")), gear];
    return all.map((el) => el.getBoundingClientRect());
  });
  const innerH = 800;
  const innerW = 420;
  for (const b of boxes) {
    // no control intersects the simulated 34px bottom band
    expect(b.bottom).toBeLessThanOrEqual(innerH - 34);
    // no control intersects the simulated 20px left band
    expect(b.left).toBeGreaterThanOrEqual(20);
    // right inset is 0: nothing may extend past the viewport
    expect(b.right).toBeLessThanOrEqual(innerW);
  }
});

test("d-pad press queues a turn and vibrates", async ({ page }) => {
  await play(page);
  await page.evaluate(() => window.__snake!.freeze());
  await page.evaluate(() => {
    (window as unknown as { __vib: number | null }).__vib = null;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (ms: number) => {
        (window as unknown as { __vib: number | null }).__vib = ms;
      }
    });
  });
  await page.click("#settings-gear");
  await page.click('.settings-row[data-key="dpad"]');
  await page.click("#settings-close"); // close the modal so the pad is clickable
  await page.click('#dpad button[data-dir="0"]'); // up
  await settle(page, "window.__snake.state.pendingLen === 1");
  const vib = await page.evaluate(() => (window as unknown as { __vib: number | null }).__vib);
  expect(vib).toBe(10);
});
