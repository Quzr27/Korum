import { describe, expect, it } from "vitest";
import { snapDraggedWindow } from "./window-snapping";

const DRAGGED = {
  id: "dragged",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
};

const TARGET = {
  id: "target",
  x: 420,
  y: 240,
  width: 360,
  height: 260,
};

describe("snapDraggedWindow", () => {
  it("aligns a dragged left edge to a nearby target right edge", () => {
    const result = snapDraggedWindow(
      { ...DRAGGED, x: 787, y: 242 },
      [TARGET],
    );

    expect(result.x).toBe(780);
    expect(result.y).toBe(240);
    expect(result.guides).toEqual([
      { axis: "x", position: 780, start: 228, end: 512 },
      { axis: "y", position: 240, start: 408, end: 1092 },
    ]);
  });

  it("snaps beside another window using the canvas grid gap", () => {
    const result = snapDraggedWindow(
      { ...DRAGGED, x: 801, y: 240 },
      [TARGET],
    );

    expect(result.x).toBe(804);
    expect(result.y).toBe(240);
  });

  it("keeps the proposed position when outside the threshold", () => {
    const result = snapDraggedWindow(
      { ...DRAGGED, x: 817, y: 226 },
      [TARGET],
    );

    expect(result.x).toBe(817);
    expect(result.y).toBe(226);
    expect(result.guides).toEqual([]);
  });

  it("honors a caller-provided threshold", () => {
    const result = snapDraggedWindow(
      { ...DRAGGED, x: 794, y: 240 },
      [TARGET],
      11,
    );

    expect(result.x).toBe(804);
    expect(result.y).toBe(240);
  });

  it("does not snap to a target that is far away on the perpendicular axis", () => {
    const result = snapDraggedWindow(
      { ...DRAGGED, x: 787, y: 2000 },
      [TARGET],
    );

    expect(result.x).toBe(787);
    expect(result.y).toBe(2000);
    expect(result.guides).toEqual([]);
  });

  it("ignores the dragged window when it appears in the target list", () => {
    const result = snapDraggedWindow(
      { ...DRAGGED, x: 12, y: 9 },
      [DRAGGED],
    );

    expect(result.x).toBe(12);
    expect(result.y).toBe(9);
    expect(result.guides).toEqual([]);
  });
});
