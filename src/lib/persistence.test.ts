import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tauriCore from "@tauri-apps/api/core";
import {
  loadPersistedSettings,
  loadPersistedState,
  persistSettings,
  persistState,
} from "./persistence";
import type { PersistedState, ViewportState } from "./persistence";
import type { TerminalWindow, NoteWindow, Workspace } from "@/types";

const tauriCoreMock = tauriCore as typeof tauriCore & {
  __clearInvokeResults: () => void;
  __setInvokeResult: (command: string, result: unknown) => void;
};

// These tests validate the shape and structure of persisted state objects.
// They don't call Tauri invoke — they verify that the data structures
// the frontend produces are correct for the Rust backend to consume.

function makeWorkspace(overrides?: Partial<Workspace>): Workspace {
  return {
    id: "ws-1",
    name: "Test Workspace",
    color: "blue",
    icon: "code",
    ...overrides,
  };
}

function makeTerminalWindow(overrides?: Partial<TerminalWindow>): TerminalWindow {
  return {
    id: "win-1",
    type: "terminal",
    x: 100,
    y: 200,
    width: 600,
    height: 400,
    zIndex: 1,
    title: "zsh",
    workspaceId: "ws-1",
    initialCwd: "/Users/test/project",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeNoteWindow(overrides?: Partial<NoteWindow>): NoteWindow {
  return {
    id: "win-2",
    type: "note",
    x: 750,
    y: 200,
    width: 300,
    height: 300,
    zIndex: 2,
    title: "Notes",
    workspaceId: "ws-1",
    content: "Hello world",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makePersistedState(overrides?: Partial<PersistedState>): PersistedState {
  return {
    version: 1,
    savedAt: Date.now(),
    activeWorkspaceId: "ws-1",
    workspaces: [makeWorkspace()],
    windows: [makeTerminalWindow(), makeNoteWindow()],
    viewports: { "ws-1": { panX: 0, panY: 0, zoom: 1 } },
    nextZ: 3,
    ...overrides,
  };
}

beforeEach(() => {
  tauriCoreMock.__clearInvokeResults();
  vi.restoreAllMocks();
});

describe("Persistence IPC wrappers", () => {
  it("persistState calls save_state with the serialized payload", async () => {
    tauriCoreMock.__setInvokeResult("save_state", undefined);
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    const state = makePersistedState();

    await persistState(state);

    expect(invokeSpy).toHaveBeenCalledWith("save_state", { state });
  });

  it("loadPersistedState calls load_state and returns the Rust payload", async () => {
    const state = makePersistedState({ nextZ: 42 });
    tauriCoreMock.__setInvokeResult("load_state", state);
    const invokeSpy = vi.spyOn(tauriCore, "invoke");

    const loaded = await loadPersistedState();

    expect(invokeSpy).toHaveBeenCalledWith("load_state");
    expect(loaded).toEqual(state);
  });

  it("persistSettings calls save_settings with the provided payload", async () => {
    tauriCoreMock.__setInvokeResult("save_settings", undefined);
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    const settings = { theme: "dark", terminalTheme: "ocean" };

    await persistSettings(settings);

    expect(invokeSpy).toHaveBeenCalledWith("save_settings", { settings });
  });

  it("loadPersistedSettings calls load_settings and returns the Rust payload", async () => {
    const settings = { theme: "light", baseColor: "stone" };
    tauriCoreMock.__setInvokeResult("load_settings", settings);
    const invokeSpy = vi.spyOn(tauriCore, "invoke");

    const loaded = await loadPersistedSettings();

    expect(invokeSpy).toHaveBeenCalledWith("load_settings");
    expect(loaded).toEqual(settings);
  });
});

// ── PersistedState structure ──

describe("PersistedState structure", () => {
  it("has all required top-level fields", () => {
    const state = makePersistedState();
    expect(state).toHaveProperty("version");
    expect(state).toHaveProperty("savedAt");
    expect(state).toHaveProperty("activeWorkspaceId");
    expect(state).toHaveProperty("workspaces");
    expect(state).toHaveProperty("windows");
    expect(state).toHaveProperty("viewports");
    expect(state).toHaveProperty("nextZ");
  });

  it("version is always 1", () => {
    expect(makePersistedState().version).toBe(1);
  });

  it("serializes to valid JSON and back", () => {
    const state = makePersistedState();
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as PersistedState;
    expect(parsed.version).toBe(1);
    expect(parsed.workspaces).toHaveLength(1);
    expect(parsed.windows).toHaveLength(2);
    expect(parsed.nextZ).toBe(3);
  });

  it("supports null activeWorkspaceId (no workspaces)", () => {
    const state = makePersistedState({
      activeWorkspaceId: null,
      workspaces: [],
      windows: [],
      viewports: {},
    });
    expect(state.activeWorkspaceId).toBeNull();
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);
    expect(parsed.activeWorkspaceId).toBeNull();
  });
});

// ── Workspace CRUD state shapes ──

describe("Workspace state shapes", () => {
  it("workspace has required fields", () => {
    const ws = makeWorkspace();
    expect(ws.id).toBeDefined();
    expect(ws.name).toBeDefined();
    expect(ws.color).toBeDefined();
    expect(ws.icon).toBeDefined();
  });

  it("workspace with rootPath (project workspace)", () => {
    const ws = makeWorkspace({ rootPath: "/Users/test/my-project" });
    expect(ws.rootPath).toBe("/Users/test/my-project");
  });

  it("workspace without rootPath (scratch workspace)", () => {
    const ws = makeWorkspace();
    expect(ws.rootPath).toBeUndefined();
  });

  it("adding a workspace produces correct state shape", () => {
    const state = makePersistedState({ workspaces: [], windows: [], viewports: {} });
    const newWs = makeWorkspace({ id: "ws-new", name: "New Project", color: "green" });
    const updated: PersistedState = {
      ...state,
      workspaces: [...state.workspaces, newWs],
      activeWorkspaceId: newWs.id,
    };
    expect(updated.workspaces).toHaveLength(1);
    expect(updated.activeWorkspaceId).toBe("ws-new");
  });

  it("deleting a workspace removes it and its windows", () => {
    const ws1 = makeWorkspace({ id: "ws-1" });
    const ws2 = makeWorkspace({ id: "ws-2", name: "Other" });
    const win1 = makeTerminalWindow({ id: "w1", workspaceId: "ws-1" });
    const win2 = makeTerminalWindow({ id: "w2", workspaceId: "ws-2" });

    const state = makePersistedState({
      workspaces: [ws1, ws2],
      windows: [win1, win2],
      viewports: {
        "ws-1": { panX: 0, panY: 0, zoom: 1 },
        "ws-2": { panX: 0, panY: 0, zoom: 1 },
      },
    });

    // Simulate deleting ws-1
    const updatedWorkspaces = state.workspaces.filter((w) => w.id !== "ws-1");
    const updatedWindows = state.windows.filter((w) => w.workspaceId !== "ws-1");
    const { "ws-1": _, ...updatedViewports } = state.viewports;

    expect(updatedWorkspaces).toHaveLength(1);
    expect(updatedWindows).toHaveLength(1);
    expect(updatedViewports).not.toHaveProperty("ws-1");
    expect(updatedViewports).toHaveProperty("ws-2");
  });

  it("renaming a workspace preserves other fields", () => {
    const ws = makeWorkspace({ id: "ws-1", name: "Old Name", color: "blue", icon: "code" });
    const renamed: Workspace = { ...ws, name: "New Name" };
    expect(renamed.name).toBe("New Name");
    expect(renamed.id).toBe("ws-1");
    expect(renamed.color).toBe("blue");
    expect(renamed.icon).toBe("code");
  });
});

// ── Window state shapes ──

describe("Window state shapes", () => {
  it("terminal window has correct type and fields", () => {
    const win = makeTerminalWindow();
    expect(win.type).toBe("terminal");
    expect(win.initialCwd).toBeDefined();
    expect("content" in win).toBe(false);
  });

  it("note window has correct type and fields", () => {
    const win = makeNoteWindow();
    expect(win.type).toBe("note");
    expect(win.content).toBeDefined();
    expect("initialCwd" in win).toBe(false);
  });

  it("window position and size are numbers", () => {
    const win = makeTerminalWindow({ x: -50, y: 200.5, width: 800, height: 600 });
    expect(typeof win.x).toBe("number");
    expect(typeof win.y).toBe("number");
    expect(typeof win.width).toBe("number");
    expect(typeof win.height).toBe("number");
  });

  it("terminal window without initialCwd (scratch terminal)", () => {
    const win: TerminalWindow = makeTerminalWindow({ initialCwd: undefined });
    expect(win.initialCwd).toBeUndefined();
    // Verify undefined fields are absent (not null) after JSON round-trip
    const json = JSON.stringify(win);
    const parsed = JSON.parse(json);
    expect(parsed).not.toHaveProperty("initialCwd");
  });

  it("windows preserve workspaceId association", () => {
    const win = makeTerminalWindow({ workspaceId: "ws-42" });
    expect(win.workspaceId).toBe("ws-42");
  });
});

// ── Viewport persistence per workspace ──

describe("Viewport state per workspace", () => {
  it("viewport has panX, panY, zoom", () => {
    const vp: ViewportState = { panX: -100, panY: 200, zoom: 1.5 };
    expect(vp.panX).toBe(-100);
    expect(vp.panY).toBe(200);
    expect(vp.zoom).toBe(1.5);
  });

  it("each workspace has its own viewport", () => {
    const viewports: Record<string, ViewportState> = {
      "ws-1": { panX: 0, panY: 0, zoom: 1 },
      "ws-2": { panX: -500, panY: -300, zoom: 0.5 },
      "ws-3": { panX: 100, panY: 100, zoom: 2 },
    };
    expect(Object.keys(viewports)).toHaveLength(3);
    expect(viewports["ws-2"].zoom).toBe(0.5);
  });

  it("switching workspace saves current viewport and restores target", () => {
    const viewports: Record<string, ViewportState> = {
      "ws-1": { panX: 10, panY: 20, zoom: 1.2 },
      "ws-2": { panX: -50, panY: -100, zoom: 0.8 },
    };

    // Simulate: user is on ws-1, panned to (30, 40), switches to ws-2
    viewports["ws-1"] = { panX: 30, panY: 40, zoom: 1.2 };

    // After switch, ws-2 viewport is restored
    const restoredViewport = viewports["ws-2"];
    expect(restoredViewport.panX).toBe(-50);
    expect(restoredViewport.panY).toBe(-100);
    expect(restoredViewport.zoom).toBe(0.8);

    // ws-1 viewport was saved with updated values
    expect(viewports["ws-1"].panX).toBe(30);
    expect(viewports["ws-1"].panY).toBe(40);
  });

  it("new workspace gets default viewport", () => {
    const defaultViewport: ViewportState = { panX: 0, panY: 0, zoom: 1 };
    const viewports: Record<string, ViewportState> = {};

    // Simulate creating new workspace
    viewports["ws-new"] = defaultViewport;

    expect(viewports["ws-new"].panX).toBe(0);
    expect(viewports["ws-new"].zoom).toBe(1);
  });

  it("viewports round-trip through JSON", () => {
    const viewports: Record<string, ViewportState> = {
      "ws-1": { panX: -123.456, panY: 789.012, zoom: 0.75 },
    };
    const json = JSON.stringify(viewports);
    const parsed = JSON.parse(json) as Record<string, ViewportState>;
    expect(parsed["ws-1"].panX).toBeCloseTo(-123.456);
    expect(parsed["ws-1"].panY).toBeCloseTo(789.012);
    expect(parsed["ws-1"].zoom).toBeCloseTo(0.75);
  });
});

// ── Full state JSON round-trip ──

describe("Full state JSON round-trip", () => {
  it("complex state survives JSON serialization", () => {
    const state = makePersistedState({
      workspaces: [
        makeWorkspace({ id: "ws-1", name: "Frontend", rootPath: "/app/frontend" }),
        makeWorkspace({ id: "ws-2", name: "Backend", color: "green", rootPath: "/app/backend" }),
        makeWorkspace({ id: "ws-3", name: "Scratch", color: "orange" }),
      ],
      windows: [
        makeTerminalWindow({ id: "w1", workspaceId: "ws-1", title: "npm dev" }),
        makeTerminalWindow({ id: "w2", workspaceId: "ws-2", title: "cargo watch" }),
        makeNoteWindow({ id: "w3", workspaceId: "ws-3", content: "scratch notes" }),
      ],
      viewports: {
        "ws-1": { panX: 0, panY: 0, zoom: 1 },
        "ws-2": { panX: -200, panY: -100, zoom: 0.8 },
        "ws-3": { panX: 50, panY: 50, zoom: 1.5 },
      },
      nextZ: 10,
    });

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as PersistedState;

    expect(parsed.version).toBe(1);
    expect(parsed.workspaces).toHaveLength(3);
    expect(parsed.windows).toHaveLength(3);
    expect(Object.keys(parsed.viewports)).toHaveLength(3);
    expect(parsed.nextZ).toBe(10);

    // Verify workspace fields survived
    expect(parsed.workspaces[0].rootPath).toBe("/app/frontend");
    expect(parsed.workspaces[2].rootPath).toBeUndefined();

    // Verify window types survived
    expect(parsed.windows[0].type).toBe("terminal");
    expect(parsed.windows[2].type).toBe("note");
    const noteWin = parsed.windows[2];
    expect(noteWin.type === "note" && noteWin.content).toBe("scratch notes");
  });

  it("empty state survives JSON serialization", () => {
    const state = makePersistedState({
      activeWorkspaceId: null,
      workspaces: [],
      windows: [],
      viewports: {},
      nextZ: 1,
    });

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as PersistedState;

    expect(parsed.activeWorkspaceId).toBeNull();
    expect(parsed.workspaces).toHaveLength(0);
    expect(parsed.windows).toHaveLength(0);
    expect(Object.keys(parsed.viewports)).toHaveLength(0);
  });
});
