import { describe, expect, it } from "vitest";
import { buildTetherRenderIndex, getTetherEndpoints, getTetherVisualAttrs } from "@/lib/window-tethers";

describe("getTetherEndpoints", () => {
  it("connects horizontal center edges when the target is beside the origin", () => {
    expect(getTetherEndpoints(
      { x: 100, y: 80, width: 400, height: 300 },
      { x: 524, y: 120, width: 820, height: 600 },
    )).toEqual({
      x1: 500,
      y1: 230,
      x2: 524,
      y2: 420,
    });
  });

  it("connects vertical center edges when the target is below the origin", () => {
    expect(getTetherEndpoints(
      { x: 100, y: 80, width: 400, height: 300 },
      { x: 120, y: 420, width: 820, height: 600 },
    )).toEqual({
      x1: 300,
      y1: 380,
      x2: 530,
      y2: 420,
    });
  });

  it("connects from the nearest left edge when the target is left of the origin", () => {
    expect(getTetherEndpoints(
      { x: 1000, y: 80, width: 400, height: 300 },
      { x: 156, y: 80, width: 820, height: 600 },
    )).toEqual({
      x1: 1000,
      y1: 230,
      x2: 976,
      y2: 380,
    });
  });
});

describe("getTetherVisualAttrs", () => {
  it("returns the arrow marker and theme accent for animated tethers", () => {
    expect(getTetherVisualAttrs("#58a6ff")).toEqual({
      accent: "#58a6ff",
      markerEnd: "url(#canvas-tether-arrow)",
    });
  });

  it("falls back to the primary token when no workspace accent is available", () => {
    expect(getTetherVisualAttrs()).toEqual({
      accent: "var(--primary)",
      markerEnd: "url(#canvas-tether-arrow)",
    });
  });
});

describe("buildTetherRenderIndex", () => {
  it("precomputes valid terminal-to-changes tether pairs", () => {
    const index = buildTetherRenderIndex(
      [
        { id: "terminal-1", type: "terminal", workspaceId: "ws-1", x: 0, y: 0, width: 400, height: 300 },
        {
          id: "code-1",
          type: "code",
          workspaceId: "ws-1",
          x: 500,
          y: 0,
          width: 820,
          height: 600,
          viewMode: "changes",
          originTerminalId: "terminal-1",
        },
        {
          id: "code-file",
          type: "code",
          workspaceId: "ws-1",
          x: 500,
          y: 700,
          width: 820,
          height: 600,
          viewMode: "file",
          originTerminalId: "terminal-1",
        },
        {
          id: "code-orphan",
          type: "code",
          workspaceId: "ws-1",
          x: 500,
          y: 1400,
          width: 820,
          height: 600,
          viewMode: "changes",
          originTerminalId: "missing",
        },
      ],
      (workspaceId) => workspaceId === "ws-1" ? "#58a6ff" : undefined,
    );

    expect(index.pairs).toEqual([
      {
        key: "terminal-1->code-1",
        originId: "terminal-1",
        targetId: "code-1",
        accent: "#58a6ff",
        markerEnd: "url(#canvas-tether-arrow)",
      },
    ]);
    expect([...index.pairKeys]).toEqual(["terminal-1->code-1"]);
    expect([...index.windowIds]).toEqual(["terminal-1", "code-1"]);
    expect(index.windowsById.get("terminal-1")?.type).toBe("terminal");
  });
});
