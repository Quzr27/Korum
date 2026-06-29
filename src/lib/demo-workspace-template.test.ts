import { describe, expect, it } from "vitest";
import { createDemoWorkspaceTemplate } from "./demo-workspace-template";

describe("createDemoWorkspaceTemplate", () => {
  it("creates a static multi-agent PR review workspace", () => {
    const demo = createDemoWorkspaceTemplate();

    expect(demo.workspace).toEqual(expect.objectContaining({
      name: "Multi-agent PR Review",
      color: "cyan",
      icon: "terminal",
    }));
    expect(demo.windows).toHaveLength(5);
    expect(demo.viewport).toEqual({ panX: 20, panY: 20, zoom: 1 });
    expect(demo.nextZ).toBe(6);
  });

  it("uses the app grid gap and starts just outside the sidebar at 100% zoom", () => {
    const demo = createDemoWorkspaceTemplate();
    const byIdSuffix = new Map(demo.windows.map((window) => {
      const parts = window.id.split("-");
      return [parts[parts.length - 1], window] as const;
    }));
    const claude = byIdSuffix.get("claude")!;
    const codex = byIdSuffix.get("codex")!;
    const brief = byIdSuffix.get("brief")!;
    const review = byIdSuffix.get("review")!;
    const queue = byIdSuffix.get("queue")!;

    expect(claude.x).toBe(312);
    expect(claude.y).toBe(44);
    expect(codex.x - (claude.x + claude.width)).toBe(24);
    expect(brief.y - (claude.y + claude.height)).toBe(24);
    expect(review.x - (brief.x + brief.width)).toBe(24);
    expect(queue.x - (review.x + review.width)).toBe(24);
  });

  it("keeps demo terminals static and workspace-scoped", () => {
    const demo = createDemoWorkspaceTemplate();
    const terminals = demo.windows.filter((window) => window.type === "terminal");

    expect(terminals).toHaveLength(3);
    expect(terminals.map((window) => window.workspaceId)).toEqual([
      demo.workspace.id,
      demo.workspace.id,
      demo.workspace.id,
    ]);
    for (const terminal of terminals) {
      expect(terminal).toHaveProperty("demoContent");
      expect(terminal).toHaveProperty("demoStartLabel");
      expect(terminal).not.toHaveProperty("ptyId");
      expect(terminal).not.toHaveProperty("initialCwd");
    }
  });

  it("adds one-click launch commands for agent demo terminals", () => {
    const demo = createDemoWorkspaceTemplate();
    const terminals = demo.windows.filter((window) => window.type === "terminal");

    expect(terminals.map((terminal) => terminal.demoStartLabel)).toEqual([
      "Start Claude",
      "Start Codex",
      "Start terminal",
    ]);
    expect(terminals.map((terminal) => terminal.demoStartCommand)).toEqual([
      "claude",
      "codex",
      undefined,
    ]);
  });
});
