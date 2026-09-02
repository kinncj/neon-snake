import { describe, it, expect } from "vitest";
import { createParticles, burst, update, clear, PARTICLE_CAP } from "../../app/adapters/render/phaser/particles";

describe("particle ring", () => {
  it("has a fixed 512 capacity and recycles the oldest on overflow", () => {
    const p = createParticles();
    expect(p.cap).toBe(PARTICLE_CAP);
    burst(p, 0, 0, { count: 500, speed: 10, life: 1000, size: 2, colour: 0xff0000 });
    expect(update(p, 1)).toBe(500);
    burst(p, 100, 100, { count: 100, speed: 10, life: 1000, size: 2, colour: 0x00ff00 });
    expect(update(p, 1)).toBe(512);
    // Slots 0..87 were the oldest and got recycled with the green burst.
    expect(p.colour[0]).toBe(0x00ff00);
    expect(p.colour[87]).toBe(0x00ff00);
    expect(p.colour[88]).toBe(0xff0000);
    expect(p.x.length).toBe(512);
  });

  it("directional bursts stay inside the cone", () => {
    const p = createParticles();
    burst(p, 0, 0, { count: 200, speed: 100, speedJitter: 0, life: 500, angleCenter: 0, angleSpread: 1.3, size: 1, colour: 1 });
    for (let i = 0; i < 200; i++) {
      const a = Math.atan2(p.vy[i]!, p.vx[i]!);
      expect(Math.abs(a)).toBeLessThanOrEqual(1.3 + 1e-6);
      expect(p.vx[i]).toBeGreaterThan(0); // all fly rightward
    }
  });

  it("integrates, applies gravity and drag, and expires", () => {
    const p = createParticles();
    burst(p, 10, 10, { count: 1, speed: 100, speedJitter: 0, life: 100, lifeJitter: 0, angleCenter: 0, angleSpread: 0, size: 1, colour: 1, gravity: 1000 });
    update(p, 50);
    expect(p.x[0]).toBeGreaterThan(10);
    expect(p.y[0]).toBeGreaterThan(10); // gravity pulls down
    expect(p.vx[0]).toBeLessThan(100); // drag
    expect(update(p, 60)).toBe(0);
    expect(p.life[0]).toBeLessThanOrEqual(0);
  });

  it("is deterministic for the same seed", () => {
    const a = createParticles(64, 7);
    const b = createParticles(64, 7);
    burst(a, 0, 0, { count: 32, speed: 50, life: 300, size: 2, colour: 3 });
    burst(b, 0, 0, { count: 32, speed: 50, life: 300, size: 2, colour: 3 });
    expect(Array.from(a.vx)).toEqual(Array.from(b.vx));
  });

  it("clear kills everything without reallocating", () => {
    const p = createParticles(8);
    const life = p.life;
    burst(p, 0, 0, { count: 8, speed: 1, life: 100, size: 1, colour: 1 });
    clear(p);
    expect(update(p, 1)).toBe(0);
    expect(p.life).toBe(life);
  });
});
