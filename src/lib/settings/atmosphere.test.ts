import { describe, expect, it } from "vitest";
import { CANVAS_ATMOSPHERE_VARS } from "./atmosphere";
import { CANVAS_ATMOSPHERE_LABELS } from "./types";
import type { CanvasAtmosphere } from "./types";

const SURFACES_WITH_MESH: CanvasAtmosphere[] = ["blueprint", "draft", "signal"];

function colorMixStrengths(value: string): number[] {
  return Array.from(
    value.matchAll(/var\(--(?:foreground|sidebar-primary)\)\s+(\d+(?:\.\d+)?)%/g),
    (match) => Number(match[1]),
  );
}

describe("canvas atmosphere presets", () => {
  it("keeps the quiet workbench dot grid visible", () => {
    const vars = CANVAS_ATMOSPHERE_VARS.workbench;
    const strengths = colorMixStrengths(vars["canvas-grid-color"]);

    expect(vars["canvas-mesh"]).toBe("none");
    expect(Number(vars["canvas-grid-opacity"])).toBeGreaterThanOrEqual(0.095);
    expect(Number(vars["canvas-grid-opacity"])).toBeLessThanOrEqual(0.12);
    expect(Math.min(...strengths)).toBeGreaterThanOrEqual(24);
    expect(Math.max(...strengths)).toBeLessThanOrEqual(28);
  });

  it("names the replacement surfaces after quiet canvas reference patterns", () => {
    expect(CANVAS_ATMOSPHERE_LABELS.draft).toBe("Lattice");
    expect(CANVAS_ATMOSPHERE_LABELS.signal).toBe("Field");
  });

  it("replaces draft and signal with quieter non-scanline meshes", () => {
    expect(CANVAS_ATMOSPHERE_VARS.draft["canvas-mesh"]).toContain("radial-gradient");
    expect(CANVAS_ATMOSPHERE_VARS.signal["canvas-mesh"]).toContain("radial-gradient");
    expect(CANVAS_ATMOSPHERE_VARS.draft["canvas-mesh"]).not.toContain("112deg");
    expect(CANVAS_ATMOSPHERE_VARS.signal["canvas-mesh"]).not.toContain(
      "repeating-linear-gradient(0deg",
    );
  });

  it("keeps mesh-based surfaces visible enough to distinguish", () => {
    for (const atmosphere of SURFACES_WITH_MESH) {
      const vars = CANVAS_ATMOSPHERE_VARS[atmosphere];
      const strengths = colorMixStrengths(vars["canvas-mesh"]);

      expect(vars["canvas-mesh"]).not.toBe("none");
      expect(Number(vars["canvas-mesh-opacity"])).toBeGreaterThanOrEqual(0.28);
      expect(Number(vars["canvas-mesh-opacity"])).toBeLessThanOrEqual(0.42);
      expect(Math.min(...strengths)).toBeGreaterThanOrEqual(9);
      expect(Math.max(...strengths)).toBeLessThanOrEqual(16);
    }
  });
});
