import { describe, expect, it } from "vitest";
import type { PersistedState } from "./persistence";
import { DEFAULT_VIEWPORT, hydratePersistedState } from "./persisted-state";

function makeState(overrides?: Partial<PersistedState>): PersistedState {
  return {
    version: 1,
    savedAt: 1712000000000,
    activeWorkspaceId: "ws-1",
    workspaces: [
      { id: "ws-1", name: "Workspace 1", color: "blue", icon: "code", rootPath: "/project/one" },
      { id: "ws-2", name: "Workspace 2", color: "green", icon: "server" },
    ],
    windows: [
      {
        id: "term-1",
        type: "terminal",
        x: 100,
        y: 200,
        width: 600,
        height: 400,
        zIndex: 3,
        title: "npm dev",
        workspaceId: "ws-1",
        initialCwd: "/project/one",
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: "note-1",
        type: "note",
        x: 750,
        y: 100,
        width: 280,
        height: 220,
        zIndex: 4,
        title: "Notes",
        workspaceId: "ws-2",
        content: "todo",
        createdAt: 3,
        updatedAt: 4,
      },
    ],
    viewports: {
      "ws-1": { panX: -50, panY: -100, zoom: 1.2 },
      "ws-2": { panX: 20, panY: 40, zoom: 0.8 },
    },
    nextZ: 5,
    ...overrides,
  };
}

describe("hydratePersistedState", () => {
  it("restores the active workspace viewport and counts", () => {
    const hydrated = hydratePersistedState(makeState());

    expect(hydrated.activeWorkspaceId).toBe("ws-1");
    expect(hydrated.pan).toEqual({ x: -50, y: -100 });
    expect(hydrated.zoom).toBe(1.2);
    expect(hydrated.counts).toEqual({ terminal: 1, note: 1 });
    expect(hydrated.nextZ).toBe(3); // 2 windows → renormalized to 1,2 → nextZ=3
  });

  it("filters orphan windows and invalid viewport entries", () => {
    const hydrated = hydratePersistedState(
      makeState({
        windows: [
          ...makeState().windows,
          {
            id: "orphan",
            type: "terminal",
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            zIndex: 1,
            title: "orphan",
            workspaceId: "missing-workspace",
          },
        ],
        viewports: {
          "ws-1": { panX: -50, panY: -100, zoom: 1.2 },
          "ws-2": { panX: 20, panY: 40, zoom: 0.8 },
          "missing-workspace": { panX: 0, panY: 0, zoom: 1 },
          "ws-bad": { panX: 0, panY: "nope", zoom: 1 } as unknown as PersistedState["viewports"][string],
        },
      }),
    );

    expect(hydrated.windows).toHaveLength(2);
    expect(hydrated.viewports).toEqual({
      "ws-1": { panX: -50, panY: -100, zoom: 1.2 },
      "ws-2": { panX: 20, panY: 40, zoom: 0.8 },
    });
  });

  it("clamps an invalid active workspace to the first available workspace", () => {
    const hydrated = hydratePersistedState(
      makeState({
        activeWorkspaceId: "missing-workspace",
      }),
    );

    expect(hydrated.activeWorkspaceId).toBe("ws-1");
    expect(hydrated.pan).toEqual({ x: -50, y: -100 });
    expect(hydrated.zoom).toBe(1.2);
  });

  it("sanitizes corrupted window fields to safe defaults", () => {
    const hydrated = hydratePersistedState(
      makeState({
        windows: [
          {
            id: "note-1",
            type: "note",
            x: "bad" as unknown as number,
            y: null as unknown as number,
            width: 0,
            height: -10,
            zIndex: "bad" as unknown as number,
            title: "",
            workspaceId: "ws-2",
            content: null as unknown as string,
          },
        ],
      }),
      { x: 320, y: 48, width: 560, height: 348 },
    );

    expect(hydrated.windows).toEqual([
      expect.objectContaining({
        id: "note-1",
        type: "note",
        x: 320,
        y: 48,
        width: 560,
        height: 348,
        zIndex: 1,
        title: "Note",
        content: "",
      }),
    ]);
  });

  it("guards against NaN, Infinity, and -Infinity in window fields", () => {
    const hydrated = hydratePersistedState(
      makeState({
        windows: [
          {
            id: "term-nan",
            type: "terminal",
            x: NaN,
            y: Infinity,
            width: -Infinity,
            height: NaN,
            zIndex: NaN,
            title: "bad numbers",
            workspaceId: "ws-1",
            createdAt: NaN,
            updatedAt: Infinity,
          },
        ],
      }),
    );

    const win = hydrated.windows[0];
    expect(win.x).toBe(284); // default
    expect(win.y).toBe(24); // default
    expect(win.width).toBe(560); // default (non-finite → 0 → fallback)
    expect(win.height).toBe(348); // default
    expect(win.zIndex).toBe(1); // default
    expect(win.createdAt).toBeUndefined();
    expect(win.updatedAt).toBeUndefined();
  });

  it("clamps window width/height to 8192 maximum", () => {
    const hydrated = hydratePersistedState(
      makeState({
        windows: [
          {
            id: "term-big",
            type: "terminal",
            x: 0,
            y: 0,
            width: 99999,
            height: 10000,
            zIndex: 1,
            title: "huge",
            workspaceId: "ws-1",
          },
        ],
      }),
    );

    const win = hydrated.windows[0];
    expect(win.width).toBe(8192);
    expect(win.height).toBe(8192);
  });

  it("guards against NaN/Infinity in viewport and clamps zoom", () => {
    const hydrated = hydratePersistedState(
      makeState({
        activeWorkspaceId: "ws-1",
        viewports: {
          "ws-1": {
            panX: NaN,
            panY: Infinity,
            zoom: -Infinity,
          },
          "ws-2": { panX: 0, panY: 0, zoom: 0 },
        },
      }),
    );

    // ws-1 is active, so its viewport feeds pan/zoom
    expect(hydrated.pan).toEqual({ x: 0, y: 0 });
    expect(hydrated.zoom).toBe(1); // -Infinity is not finite → fallback to default

    // ws-2 zoom 0 gets clamped to 0.1
    expect(hydrated.viewports["ws-2"]?.zoom).toBe(0.1);
  });

  it("clamps zoom to [0.1, 5] range", () => {
    const hydrated = hydratePersistedState(
      makeState({
        activeWorkspaceId: "ws-1",
        viewports: {
          "ws-1": { panX: 0, panY: 0, zoom: 0.01 },
          "ws-2": { panX: 0, panY: 0, zoom: 99 },
        },
      }),
    );

    expect(hydrated.viewports["ws-1"]?.zoom).toBe(0.1);
    expect(hydrated.viewports["ws-2"]?.zoom).toBe(5);
  });

  it("guards against NaN in nextZ", () => {
    const hydrated = hydratePersistedState(
      makeState({ nextZ: NaN as unknown as number }),
    );
    // 2 windows → renormalized to 1,2 → nextZ=3
    expect(hydrated.nextZ).toBe(3);
  });

  it("renormalizes inflated zIndex values preserving relative order", () => {
    const hydrated = hydratePersistedState(
      makeState({
        windows: [
          {
            id: "term-top",
            type: "terminal",
            x: 200,
            y: 300,
            width: 600,
            height: 400,
            zIndex: 900000, // higher z but first in array
            title: "top",
            workspaceId: "ws-1",
          },
          {
            id: "term-bottom",
            type: "terminal",
            x: 100,
            y: 200,
            width: 600,
            height: 400,
            zIndex: 500000, // lower z but second in array
            title: "bottom",
            workspaceId: "ws-1",
          },
        ],
        nextZ: 1000000,
      }),
    );

    // Relative order preserved: 500000→1, 900000→2 (not array order)
    const top = hydrated.windows.find((w) => w.id === "term-top")!;
    const bottom = hydrated.windows.find((w) => w.id === "term-bottom")!;
    expect(top.zIndex).toBe(2);
    expect(bottom.zIndex).toBe(1);
    expect(hydrated.nextZ).toBe(3);
  });

  it("returns a safe empty restore result when no valid workspaces remain", () => {
    const hydrated = hydratePersistedState(
      makeState({
        activeWorkspaceId: null,
        workspaces: [],
        windows: [],
        viewports: {
          stray: { panX: 100, panY: 200, zoom: 3 },
        },
      }),
    );

    expect(hydrated.workspaces).toEqual([]);
    expect(hydrated.windows).toEqual([]);
    expect(hydrated.viewports).toEqual({});
    expect(hydrated.activeWorkspaceId).toBeNull();
    expect(hydrated.pan).toEqual({ x: DEFAULT_VIEWPORT.panX, y: DEFAULT_VIEWPORT.panY });
    expect(hydrated.zoom).toBe(DEFAULT_VIEWPORT.zoom);
    expect(hydrated.counts).toEqual({ terminal: 0, note: 0 });
  });
});
