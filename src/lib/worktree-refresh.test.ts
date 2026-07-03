import { describe, expect, it } from "vitest";
import {
  getWindowWorktreeLookupPath,
  shouldRefreshWorktreeInfo,
} from "@/lib/worktree-refresh";
import type { WindowState, Workspace } from "@/types";

const workspace: Workspace = {
  id: "ws",
  name: "Repo",
  color: "default",
  icon: "code",
  rootPath: "/repo",
};

const terminalWindow: WindowState = {
  id: "terminal-1",
  type: "terminal",
  title: "Terminal",
  workspaceId: "ws",
  x: 0,
  y: 0,
  width: 800,
  height: 480,
  zIndex: 1,
  initialCwd: "/repo",
};

describe("worktree refresh helpers", () => {
  it("uses a terminal live cwd before its persisted initial cwd", () => {
    expect(getWindowWorktreeLookupPath(
      terminalWindow,
      workspace,
      { "terminal-1": "/repo-feature" },
    )).toBe("/repo-feature");
  });

  it("falls back to source path or workspace root when no live terminal cwd exists", () => {
    expect(getWindowWorktreeLookupPath(terminalWindow, workspace, {})).toBe("/repo");
    expect(getWindowWorktreeLookupPath({
      ...terminalWindow,
      id: "code-1",
      type: "code",
      sourcePath: "/repo/src/App.tsx",
      viewMode: "file",
    }, workspace, {})).toBe("/repo/src/App.tsx");
  });

  it("refreshes unknown or stale worktree metadata while skipping fresh and in-flight paths", () => {
    expect(shouldRefreshWorktreeInfo("/repo", 5_000, {}, new Set(), 2_500)).toBe(true);
    expect(shouldRefreshWorktreeInfo("/repo", 5_000, { "/repo": 2_000 }, new Set(), 2_500)).toBe(true);
    expect(shouldRefreshWorktreeInfo("/repo", 5_000, { "/repo": 3_000 }, new Set(), 2_500)).toBe(false);
    expect(shouldRefreshWorktreeInfo("/repo", 5_000, { "/repo": 2_000 }, new Set(["/repo"]), 2_500)).toBe(false);
  });
});
