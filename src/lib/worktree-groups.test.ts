import { describe, expect, it } from "vitest";
import {
  buildWorktreeWindowGroups,
  getWorktreeDisplayName,
  matchesWorktreeWindowQuery,
  type WorktreeGroupWindow,
} from "@/lib/worktree-groups";
import type { WorktreeInfo } from "@/types";

const mainWorktree: WorktreeInfo = {
  repoRoot: "/repo",
  worktreeRoot: "/repo",
  branch: "main",
  headSha: "abc1234",
  isDetached: false,
  displayName: "main",
};

const featureWorktree: WorktreeInfo = {
  repoRoot: "/repo",
  worktreeRoot: "/repo-feature",
  branch: "feature/worktree-ui",
  headSha: "def5678",
  isDetached: false,
  displayName: "feature/worktree-ui",
};

function window(overrides: Partial<WorktreeGroupWindow>): WorktreeGroupWindow {
  return {
    id: "w",
    type: "terminal",
    title: "Terminal",
    workspaceId: "ws",
    ...overrides,
  };
}

describe("worktree grouping", () => {
  it("groups branch-aware windows before ungrouped windows", () => {
    const groups = buildWorktreeWindowGroups([
      window({ id: "a", title: "Agent A", worktree: mainWorktree }),
      window({ id: "b", title: "Scratch" }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["main", "No worktree"]);
    expect(groups[0].windows.map((item) => item.id)).toEqual(["a"]);
    expect(groups[1].windows.map((item) => item.id)).toEqual(["b"]);
  });

  it("sorts named worktree groups while preserving window order inside each group", () => {
    const groups = buildWorktreeWindowGroups([
      window({ id: "z1", title: "Feature A", worktree: featureWorktree }),
      window({ id: "a1", title: "Main A", worktree: mainWorktree }),
      window({ id: "z2", title: "Feature B", worktree: featureWorktree }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["feature/worktree-ui", "main"]);
    expect(groups[0].windows.map((item) => item.id)).toEqual(["z1", "z2"]);
    expect(groups[1].windows.map((item) => item.id)).toEqual(["a1"]);
  });

  it("uses detached HEAD display names when no branch exists", () => {
    expect(getWorktreeDisplayName({
      ...mainWorktree,
      branch: null,
      isDetached: true,
      displayName: "abc1234",
    })).toBe("detached abc1234");
  });

  it("matches filters against title, source path, branch label, and worktree root", () => {
    const item = window({
      title: "Review Agent",
      sourcePath: "/repo-feature/src/App.tsx",
      worktree: featureWorktree,
    });

    expect(matchesWorktreeWindowQuery(item, "review")).toBe(true);
    expect(matchesWorktreeWindowQuery(item, "app.tsx")).toBe(true);
    expect(matchesWorktreeWindowQuery(item, "worktree-ui")).toBe(true);
    expect(matchesWorktreeWindowQuery(item, "/repo-feature")).toBe(true);
    expect(matchesWorktreeWindowQuery(item, "billing")).toBe(false);
  });
});
