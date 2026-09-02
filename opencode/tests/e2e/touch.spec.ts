import { expect, test } from "@playwright/test";

// Headless desktop Firefox exposes no Touch API (Touch is not defined), so
// the synthetic-touch tests cannot run there; the swipe/d-pad code paths use
// standard touch events and are covered by the Chromium runs.
test.skip(({ browserName }) => browserName === "firefox", "no Touch API in headless desktop Firefox");

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

/** Pause from a fresh restart: the loop keeps draining the input queue, so
 * buffered turns are observable via pendingLen without the sim moving. */
async function freeze(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__snake!.restart();
    window.__snake!.pause();
  });
}

async function settle(page: import("@playwright/test").Page, expr: string): Promise<void> {
  await page.waitForFunction(expr, null, { timeout: 2000 });
}

/** Dispatch a synthetic swipe over #screen with the given CSS-px endpoints. */
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
      const el = document.getElementById("screen")!;
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
  await freeze(page);

  // 80px up over 8 move events -> exactly one queued turn
  await swipe(page, 400, 500, 400, 420, 8);
  await settle(page, "window.__snake.pendingLen() === 1");

  // 80px left over 16 move events -> exactly one more queued turn (left is
  // legal after up). Proves one intent per gesture, not one per move event.
  await swipe(page, 400, 450, 320, 450, 16);
  await settle(page, "window.__snake.pendingLen() === 2");

  // below the 24px minimum: nothing
  await swipe(page, 400, 450, 410, 444); // 10px right, 6px up
  await page.waitForTimeout(250);
  await settle(page, "window.__snake.pendingLen() === 2");
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
    const screen = document.getElementById("screen")!;
    const canvas = document.getElementById("game") as HTMLCanvasElement;
    return {
      screen: getComputedStyle(screen).touchAction,
      canvas: getComputedStyle(canvas).touchAction,
      html: getComputedStyle(document.documentElement).overscrollBehavior,
      body: getComputedStyle(document.body).overscrollBehavior
    };
  });
  expect(css.screen).toBe("none");
  expect(css.canvas).toBe("none");
  expect(css.html).toBe("none");
  expect(css.body).toBe("none");
});

test("d-pad exists, is hidden by default, and exposes four labelled buttons", async ({ page }) => {
  await ready(page);
  const dpad = await page.evaluate(() => {
    const d = document.getElementById("dpad");
    if (d === null) return null;
    return {
      visible: d.classList.contains("visible"),
      display: getComputedStyle(d).display,
      buttons: Array.from(d.querySelectorAll("button")).map((b) => ({
        dir: b.dataset.dir,
        label: b.getAttribute("aria-label")
      }))
    };
  });
  expect(dpad).not.toBeNull();
  expect(dpad!.visible).toBe(false);
  expect(dpad!.display).toBe("none");
  expect(dpad!.buttons).toEqual([
    { dir: "0", label: "up" },
    { dir: "3", label: "left" },
    { dir: "1", label: "right" },
    { dir: "2", label: "down" }
  ]);
});

test("d-pad press queues a turn and vibrates 10ms", async ({ page }) => {
  await ready(page);
  await freeze(page);
  await page.evaluate(() => {
    (window as unknown as { __vib: number | null }).__vib = null;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (ms: number) => {
        (window as unknown as { __vib: number | null }).__vib = ms;
      }
    });
    document
      .querySelector('#dpad button[data-dir="0"]')!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await settle(page, "window.__snake.pendingLen() === 1");
  const vib = await page.evaluate(
    () => (window as unknown as { __vib: number | null }).__vib
  );
  expect(vib).toBe(10);
});
