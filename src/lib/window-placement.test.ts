import { describe, expect, it } from "vitest";
import { placeAdjacentWindow } from "@/lib/window-placement";

describe("placeAdjacentWindow", () => {
  const origin = { id: "terminal-1", x: 100, y: 80, width: 400, height: 300 };
  const viewport = { x: 0, y: 0, width: 1600, height: 1000 };
  const size = { width: 820, height: 600 };

  it("places the new window to the right of the origin with the canvas gap", () => {
    expect(placeAdjacentWindow({
      origin,
      existing: [origin],
      viewport,
      size,
    })).toEqual({ x: 524, y: 80, width: 820, height: 600 });
  });

  it("avoids overlapping an existing window at the default right-side slot", () => {
    const blocking = { id: "code-1", x: 524, y: 80, width: 820, height: 600 };

    const placed = placeAdjacentWindow({
      origin,
      existing: [origin, blocking],
      viewport: { x: 0, y: 0, width: 1800, height: 1600 },
      size,
    });

    expect(placed).toEqual({ x: 524, y: 704, width: 820, height: 600 });
  });

  it("uses the left side when the right side would leave the viewport", () => {
    expect(placeAdjacentWindow({
      origin: { ...origin, x: 1000 },
      existing: [{ ...origin, x: 1000 }],
      viewport,
      size,
    })).toEqual({ x: 156, y: 80, width: 820, height: 600 });
  });
});
