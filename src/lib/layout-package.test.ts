import { describe, expect, it } from "vitest";
import type { ViewportState } from "@/lib/persistence";
import {
  buildImportedKorumLayout,
  buildImportedLayout,
  buildLayoutPackageFileName,
  createKorumLayoutPackage,
  createLayoutPackage,
  parseLayoutPackageText,
} from "@/lib/layout-package";
import type { CodeWindow, NoteWindow, TerminalWindow, WindowState, Workspace } from "@/types";

const workspace: Workspace = {
  id: "ws-source",
  name: "Release Desk",
  color: "blue",
  icon: "rocket",
  rootPath: "/projects/korum",
};

const viewport: ViewportState = { panX: -120, panY: -64, zoom: 0.9 };

const terminal: TerminalWindow = {
  id: "term-source",
  type: "terminal",
  title: "Claude reviewer",
  workspaceId: "ws-source",
  x: 280,
  y: 40,
  width: 820,
  height: 600,
  zIndex: 4,
  initialCwd: "/projects/korum/packages/app",
  ptyId: "session-only",
  demoContent: ["$ claude --continue"],
  demoStartLabel: "Start Claude",
  demoStartCommand: "claude",
  createdAt: 1,
  updatedAt: 2,
};

const codeWindow: CodeWindow = {
  id: "code-source",
  type: "code",
  title: "App.tsx",
  workspaceId: "ws-source",
  x: 1120,
  y: 40,
  width: 820,
  height: 600,
  zIndex: 5,
  sourcePath: "/projects/korum/src/App.tsx",
  viewMode: "changes",
  originTerminalId: "term-source",
  targetLine: 42,
  targetColumn: 7,
  targetNonce: 3,
  createdAt: 3,
  updatedAt: 4,
};

const noteWindow: NoteWindow = {
  id: "note-source",
  type: "note",
  title: "Checklist",
  workspaceId: "ws-source",
  x: 280,
  y: 680,
  width: 420,
  height: 320,
  zIndex: 6,
  content: "- ship",
  sourcePath: "/projects/korum/docs/release.md",
  createdAt: 5,
  updatedAt: 6,
};

const windows: WindowState[] = [terminal, codeWindow, noteWindow];

const opsWorkspace: Workspace = {
  id: "ws-ops",
  name: "Ops",
  color: "green",
  icon: "terminal",
  rootPath: "/projects/ops",
};

const opsViewport: ViewportState = { panX: 80, panY: -40, zoom: 1.2 };

const opsTerminal: TerminalWindow = {
  id: "term-ops",
  type: "terminal",
  title: "Deploy",
  workspaceId: "ws-ops",
  x: -120,
  y: 180,
  width: 720,
  height: 460,
  zIndex: 3,
  initialCwd: "/projects/ops",
  ptyId: "ops-session-only",
  createdAt: 7,
  updatedAt: 8,
};

function idFactory() {
  const ids = ["ws-imported", "term-imported", "code-imported", "note-imported"];
  let index = 0;
  return () => ids[index++] ?? `extra-${index}`;
}

describe("layout packages", () => {
  it("exports a workspace layout without session-only fields", () => {
    const pkg = createLayoutPackage({
      workspace,
      windows,
      viewport,
      pathMode: "keep",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });

    expect(pkg.schema).toBe("dev.quzr.korum.layout");
    expect(pkg.version).toBe(1);
    expect(pkg.scope).toBe("workspace");
    expect(pkg.exportedAt).toBe("2026-07-03T10:00:00.000Z");
    expect(pkg.layout.workspace).toEqual(workspace);
    expect(pkg.layout.windows).toHaveLength(3);
    expect(pkg.layout.windows[0]).not.toHaveProperty("ptyId");
    expect(pkg.layout.windows[1]).not.toHaveProperty("targetLine");
    expect(pkg.layout.windows[1]).not.toHaveProperty("targetColumn");
    expect(pkg.layout.windows[1]).not.toHaveProperty("targetNonce");
  });

  it("exports a whole Korum layout with all workspaces, windows, and viewports", () => {
    const pkg = createKorumLayoutPackage({
      workspaces: [workspace, opsWorkspace],
      windows: [...windows, opsTerminal],
      viewports: {
        [workspace.id]: viewport,
        [opsWorkspace.id]: opsViewport,
      },
      activeWorkspaceId: opsWorkspace.id,
      pathMode: "keep",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });

    expect(pkg.scope).toBe("korum");
    expect(pkg.appLayout.workspaces).toEqual([workspace, opsWorkspace]);
    expect(pkg.appLayout.activeWorkspaceId).toBe(opsWorkspace.id);
    expect(pkg.appLayout.viewports).toEqual({
      [workspace.id]: viewport,
      [opsWorkspace.id]: opsViewport,
    });
    expect(pkg.appLayout.windows).toHaveLength(4);
    expect(pkg.appLayout.windows.find((win) => win.id === terminal.id)).not.toHaveProperty("ptyId");
    expect(pkg.appLayout.windows.find((win) => win.id === codeWindow.id)).not.toHaveProperty("targetNonce");
    expect(pkg.appLayout.windows.find((win) => win.id === opsTerminal.id)).not.toHaveProperty("ptyId");
  });

  it("imports a whole Korum layout with remapped workspace ids, window ids, and viewports", () => {
    const pkg = createKorumLayoutPackage({
      workspaces: [workspace, opsWorkspace],
      windows: [terminal, codeWindow, opsTerminal],
      viewports: {
        [workspace.id]: viewport,
        [opsWorkspace.id]: opsViewport,
      },
      activeWorkspaceId: opsWorkspace.id,
      pathMode: "keep",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });
    const ids = ["ws-imported-a", "ws-imported-b", "term-imported", "code-imported", "ops-term-imported"];
    let index = 0;

    const imported = buildImportedKorumLayout(pkg, {
      idFactory: () => ids[index++] ?? `extra-${index}`,
      now: 1_781_000_000_000,
    });

    expect(imported.workspaces.map((candidate) => candidate.id)).toEqual(["ws-imported-a", "ws-imported-b"]);
    expect(imported.activeWorkspaceId).toBe("ws-imported-b");
    expect(imported.viewports).toEqual({
      "ws-imported-a": viewport,
      "ws-imported-b": opsViewport,
    });
    expect(imported.windows).toEqual([
      expect.objectContaining({
        id: "term-imported",
        workspaceId: "ws-imported-a",
        type: "terminal",
        createdAt: 1_781_000_000_000,
        updatedAt: 1_781_000_000_000,
      }),
      expect.objectContaining({
        id: "code-imported",
        workspaceId: "ws-imported-a",
        type: "code",
        originTerminalId: "term-imported",
      }),
      expect.objectContaining({
        id: "ops-term-imported",
        workspaceId: "ws-imported-b",
        type: "terminal",
      }),
    ]);
    expect(imported.nextZ).toBe(6);
  });

  it("exports project-relative paths and rebases them on import", () => {
    const pkg = createLayoutPackage({
      workspace,
      windows,
      viewport,
      pathMode: "relative",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });

    expect(pkg.layout.workspace).not.toHaveProperty("rootPath");
    expect(pkg.layout.windows.find((win) => win.type === "terminal")).toEqual(
      expect.objectContaining({ initialCwd: "packages/app" }),
    );
    expect(pkg.layout.windows.find((win) => win.type === "code")).toEqual(
      expect.objectContaining({ sourcePath: "src/App.tsx" }),
    );
    expect(pkg.layout.windows.find((win) => win.type === "note")).toEqual(
      expect.objectContaining({ sourcePath: "docs/release.md" }),
    );

    const imported = buildImportedLayout(pkg, {
      idFactory: idFactory(),
      now: 1_781_000_000_000,
      workspaceRootPath: "/Users/demo/Korum",
    });

    expect(imported.workspace).toEqual({
      ...workspace,
      id: "ws-imported",
      name: "Release Desk",
      rootPath: "/Users/demo/Korum",
    });
    expect(imported.viewport).toEqual(viewport);
    expect(imported.windows.find((win) => win.type === "terminal")).toEqual(
      expect.objectContaining({
        id: "term-imported",
        workspaceId: "ws-imported",
        initialCwd: "/Users/demo/Korum/packages/app",
      }),
    );
    expect(imported.windows.find((win) => win.type === "code")).toEqual(
      expect.objectContaining({
        id: "code-imported",
        workspaceId: "ws-imported",
        sourcePath: "/Users/demo/Korum/src/App.tsx",
        originTerminalId: "term-imported",
      }),
    );
    expect(imported.windows.find((win) => win.type === "note")).toEqual(
      expect.objectContaining({
        id: "note-imported",
        workspaceId: "ws-imported",
        sourcePath: "/Users/demo/Korum/docs/release.md",
      }),
    );
  });

  it("rebases root-relative terminal cwd back to the selected project root", () => {
    const pkg = createLayoutPackage({
      workspace,
      windows: [{ ...terminal, initialCwd: "/projects/korum" }],
      viewport,
      pathMode: "relative",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });

    expect(pkg.layout.windows[0]).toEqual(expect.objectContaining({ initialCwd: "" }));

    const imported = buildImportedLayout(pkg, {
      idFactory: idFactory(),
      now: 1_781_000_000_000,
      workspaceRootPath: "/Users/demo/Korum",
    });

    expect(imported.windows[0]).toEqual(expect.objectContaining({
      type: "terminal",
      initialCwd: "/Users/demo/Korum",
    }));
  });

  it("sanitizes path-backed fields and drops code windows that cannot open without paths", () => {
    const pkg = createLayoutPackage({
      workspace,
      windows,
      viewport,
      pathMode: "sanitize",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });

    expect(pkg.layout.workspace).not.toHaveProperty("rootPath");
    expect(pkg.layout.windows).toHaveLength(2);
    expect(pkg.layout.windows.some((win) => win.type === "code")).toBe(false);
    expect(pkg.layout.windows.find((win) => win.type === "terminal")).not.toHaveProperty("initialCwd");
    expect(pkg.layout.windows.find((win) => win.type === "note")).not.toHaveProperty("sourcePath");
  });

  it("regenerates ids and drops origin terminal links when the terminal is absent", () => {
    const pkg = createLayoutPackage({
      workspace,
      windows: [codeWindow],
      viewport,
      pathMode: "keep",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });

    const imported = buildImportedLayout(pkg, {
      idFactory: idFactory(),
      now: 1_781_000_000_000,
    });

    expect(imported.workspace.id).toBe("ws-imported");
    expect(imported.windows).toEqual([
      expect.objectContaining({
        id: "term-imported",
        workspaceId: "ws-imported",
        type: "code",
      }),
    ]);
    expect(imported.windows[0]).not.toHaveProperty("originTerminalId");
    expect(imported.windows[0]).not.toHaveProperty("ptyId");
  });

  it("rejects non-Korum layout JSON", () => {
    expect(() => parseLayoutPackageText(JSON.stringify({ schema: "elsewhere", version: 1 })))
      .toThrow("Korum layout");
  });

  it("rejects whole Korum packages without any workspace", () => {
    expect(() => parseLayoutPackageText(JSON.stringify({
      schema: "dev.quzr.korum.layout",
      version: 1,
      exportedAt: "2026-07-03T10:00:00.000Z",
      pathMode: "keep",
      scope: "korum",
      appLayout: {
        workspaces: [],
        windows: [],
        viewports: {},
        activeWorkspaceId: null,
      },
    }))).toThrow("at least one workspace");
  });

  it("drops malformed windows before importing a workspace layout", () => {
    const parsed = parseLayoutPackageText(JSON.stringify({
      schema: "dev.quzr.korum.layout",
      version: 1,
      exportedAt: "2026-07-03T10:00:00.000Z",
      pathMode: "keep",
      scope: "workspace",
      layout: {
        workspace,
        windows: [{ ...terminal, zIndex: "front" }],
        viewport,
      },
    }));

    expect(parsed.scope).toBe("workspace");
    if (parsed.scope !== "workspace") throw new Error("Expected workspace package");
    expect(parsed.layout.windows).toEqual([]);

    const imported = buildImportedLayout(parsed, {
      idFactory: idFactory(),
      now: 1_781_000_000_000,
    });
    expect(imported.windows).toEqual([]);
    expect(imported.nextZ).toBe(2);
  });

  it("rejects packages with invalid workspace metadata", () => {
    expect(() => parseLayoutPackageText(JSON.stringify({
      schema: "dev.quzr.korum.layout",
      version: 1,
      exportedAt: "2026-07-03T10:00:00.000Z",
      pathMode: "keep",
      scope: "workspace",
      layout: {
        workspace: { ...workspace, color: "neon" },
        windows: [],
        viewport,
      },
    }))).toThrow("invalid workspace");
  });

  it("builds stable json file names", () => {
    expect(buildLayoutPackageFileName("Release Desk / PR #42")).toBe("release-desk-pr-42.korum-layout.json");
    expect(buildLayoutPackageFileName("")).toBe("korum-layout.korum-layout.json");
  });
});
