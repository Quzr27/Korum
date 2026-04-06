import { describe, it, expect } from "vitest";
import { isWindowInViewport } from "./viewport";

// Default viewport: 1920×1080, zoom 1, pan (0,0), buffer 200
const VP_W = 1920;
const VP_H = 1080;
const DEFAULT_WIN = { x: 100, y: 100, width: 400, height: 300 };

describe("isWindowInViewport", () => {
  it("returns true for window fully inside viewport", () => {
    expect(isWindowInViewport(DEFAULT_WIN, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(true);
  });

  it("returns false for window far to the right", () => {
    const win = { x: 3000, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("returns false for window far to the left", () => {
    const win = { x: -1000, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("returns false for window far below", () => {
    const win = { x: 100, y: 2000, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("returns false for window far above", () => {
    const win = { x: 100, y: -800, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("returns true for window partially visible at right edge", () => {
    // Window at x=1800 with width 400 → right edge at 2200, left edge at 1800 < VP_W + buffer
    const win = { x: 1800, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(true);
  });

  it("returns true for window inside buffer zone (just outside viewport)", () => {
    // Window just past right edge at x=1930 → screen left = 1930, < VP_W + 200 = 2120
    const win = { x: 1930, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(true);
  });

  it("returns false for window just outside buffer zone", () => {
    // Window at x=2200 → left edge at 2200 > VP_W + 200 = 2120
    const win = { x: 2200, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("respects custom buffer size", () => {
    // Window at x=2000, buffer 0 → left edge at 2000 > VP_W (1920)
    const win = { x: 2000, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H, 0)).toBe(false);
    // Same window with buffer 100 → 2000 < 1920 + 100
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H, 100)).toBe(true);
  });

  it("accounts for zoom when computing screen coords", () => {
    // Window at world x=2000 with zoom 0.5 → screen x = 1000, inside viewport
    const win = { x: 2000, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 0.5, VP_W, VP_H)).toBe(true);
    // Same window at zoom 1 → screen x = 2000, outside viewport (barely in buffer)
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(true);
    // At zoom 2 → screen x = 4000, way outside
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 2, VP_W, VP_H)).toBe(false);
  });

  it("accounts for pan offset", () => {
    // Window at world x=2000, panned left by -1000 → screen x = 1000
    const win = { x: 2000, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: -1000, y: 0 }, 1, VP_W, VP_H)).toBe(true);
    // Panned left by -3000 → screen x = -1000, right edge at -600 < -200 (buffer)
    expect(isWindowInViewport(win, { x: -3000, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("handles window at origin with no pan", () => {
    const win = { x: 0, y: 0, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(true);
  });

  it("handles negative window positions within buffer", () => {
    // Window at x=-300 with width 400 → right edge at 100 > -200 (buffer)
    const win = { x: -300, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(true);
  });

  it("handles negative window positions outside buffer", () => {
    // Window at x=-700 with width 400 → right edge at -300 < -200 (buffer)
    const win = { x: -700, y: 100, width: 400, height: 300 };
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, VP_W, VP_H)).toBe(false);
  });

  it("handles very small viewport", () => {
    const win = { x: 100, y: 100, width: 400, height: 300 };
    // 50×50 viewport with 200 buffer → effective range: -200 to 250 on each axis
    expect(isWindowInViewport(win, { x: 0, y: 0 }, 1, 50, 50)).toBe(true);
  });
});
