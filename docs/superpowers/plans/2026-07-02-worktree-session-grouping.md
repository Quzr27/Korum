# Worktree Session Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make parallel AI coding sessions easier to navigate by showing git worktree/branch context across Korum workspaces, terminals, agent jumps, and code windows.

**Architecture:** Add a small git metadata IPC command backed by the existing Rust file tree/git2 module, then keep all UI grouping in pure frontend helpers. Workspaces stay the durable project container; worktree metadata is a cached navigation layer, not a PTY or persistence primitive.

**Tech Stack:** Tauri 2 commands, Rust `git2`, React 19, TypeScript, Vitest, Cargo tests.

---

## File Structure

- `src/types/index.ts`: add `WorktreeInfo` and optional `worktree` metadata on terminal/code sidebar projections.
- `src-tauri/src/file_tree.rs`: add `WorktreeInfo`, `get_worktree_info(path)`, and Rust unit tests.
- `src-tauri/src/commands.rs`: expose a thin `get_worktree_info(path)` command.
- `src-tauri/src/lib.rs`: register the new command in the existing single `generate_handler!`.
- `src/lib/worktree-groups.ts`: pure grouping and labels for worktree/session navigation.
- `src/lib/worktree-groups.test.ts`: TDD coverage for grouping behavior.
- `src/App.tsx`: cache worktree metadata, enrich sidebar projections, and pass metadata to Command Center.
- `src/components/layout/Sidebar.tsx`: render worktree groups under each workspace.
- `src/components/layout/CommandCenter.tsx`: include branch/worktree context in search, subtitles, and active agent jump items.
- `.claude/rules/workspaces-sidebar.md`, `.claude/rules/tauri-ipc-backend.md`: document the new worktree metadata boundary.

## Task 1: Pure Worktree Grouping Helper

**Files:**
- Create: `src/lib/worktree-groups.ts`
- Create: `src/lib/worktree-groups.test.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { buildWorktreeWindowGroups, getWorktreeDisplayName } from "@/lib/worktree-groups";
import type { SidebarWindow, WorktreeInfo } from "@/types";

const main: WorktreeInfo = {
  repoRoot: "/repo",
  worktreeRoot: "/repo",
  branch: "main",
  headSha: "abc1234",
  isDetached: false,
  displayName: "main",
};

function win(overrides: Partial<SidebarWindow>): SidebarWindow {
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
      win({ id: "a", title: "Agent A", worktree: main }),
      win({ id: "b", title: "Scratch" }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["main", "No worktree"]);
    expect(groups[0].windows.map((item) => item.id)).toEqual(["a"]);
    expect(groups[1].windows.map((item) => item.id)).toEqual(["b"]);
  });

  it("uses detached HEAD display names when no branch exists", () => {
    expect(getWorktreeDisplayName({ ...main, branch: null, isDetached: true, displayName: "abc1234" })).toBe("detached abc1234");
  });
});
```

- [ ] **Step 2: Run red test**

Run: `bun run test -- src/lib/worktree-groups.test.ts`

Expected: FAIL because `@/lib/worktree-groups` does not exist.

- [ ] **Step 3: Implement helper and shared types**

```typescript
export interface WorktreeInfo {
  repoRoot: string;
  worktreeRoot: string;
  branch: string | null;
  headSha: string | null;
  isDetached: boolean;
  displayName: string;
}
```

`buildWorktreeWindowGroups()` should sort named groups alphabetically, keep input order inside each group, and place `No worktree` last.

- [ ] **Step 4: Run green test**

Run: `bun run test -- src/lib/worktree-groups.test.ts`

Expected: PASS.

## Task 2: Rust Git Metadata Command

**Files:**
- Modify: `src-tauri/src/file_tree.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/file_tree.rs`:

```rust
#[test]
fn get_worktree_info_reports_current_branch() {
    let (root, repo) = init_git_repo_with_file("wti_branch", "src/app.rs", "fn main() {}\n");
    repo.branch("feature/worktree-ui", &repo.head().unwrap().peel_to_commit().unwrap(), true)
        .expect("create branch");
    repo.set_head("refs/heads/feature/worktree-ui").expect("set head");

    let info = get_worktree_info(&root.to_string_lossy()).expect("worktree info").expect("git repo");

    assert_eq!(info.worktree_root, fs::canonicalize(&root).unwrap().to_string_lossy());
    assert_eq!(info.branch.as_deref(), Some("feature/worktree-ui"));
    assert!(!info.is_detached);
    assert_eq!(info.display_name, "feature/worktree-ui");

    drop(repo);
    fs::remove_dir_all(&root).ok();
}

#[test]
fn get_worktree_info_returns_none_outside_git() {
    let root = make_temp_dir("wti_none");
    let info = get_worktree_info(&root.to_string_lossy()).expect("lookup");
    assert!(info.is_none());
    fs::remove_dir_all(&root).ok();
}
```

- [ ] **Step 2: Run red test**

Run: `cd src-tauri && cargo test get_worktree_info --lib`

Expected: FAIL because `get_worktree_info` is missing.

- [ ] **Step 3: Implement command**

Use `git2::Repository::discover(path)`, `repo.workdir()`, `repo.path()`, and `repo.head()` to produce canonical `repoRoot`, `worktreeRoot`, `branch`, `headSha`, `isDetached`, and `displayName`. Return `Ok(None)` for non-git paths.

- [ ] **Step 4: Register command**

Add `get_worktree_info` to `commands.rs`, import it in `lib.rs`, and register it in the existing `generate_handler!` list.

- [ ] **Step 5: Run green Rust test**

Run: `cd src-tauri && cargo test get_worktree_info --lib`

Expected: PASS.

## Task 3: Frontend Metadata Cache

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add projection test coverage if helper logic expands**

Keep cache logic shallow in `App.tsx`; do not add rendering tests for cache wiring unless behavior moves into a helper.

- [ ] **Step 2: Implement cache**

Use a ref keyed by absolute path and call `invoke<WorktreeInfo | null>("get_worktree_info", { path })` for workspace `rootPath`, terminal `initialCwd`, and code `sourcePath` roots where available. Deduplicate in-flight requests and update React state only when metadata changes.

- [ ] **Step 3: Enrich projections**

Add `worktree?: WorktreeInfo` to `SidebarWindow` and pass the full window list plus worktree metadata to `CommandCenter`.

- [ ] **Step 4: Run TypeScript**

Run: `bun run typecheck`

Expected: PASS.

## Task 4: Sidebar And Command Center UX

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/CommandCenter.tsx`

- [ ] **Step 1: Render sidebar groups**

Inside each expanded workspace row, group `filteredTerminals`, `filteredNotes`, and `filteredCode` with `buildWorktreeWindowGroups()`. Render compact branch headers only when at least one child has worktree metadata, keeping existing `WindowItem` behavior unchanged.

- [ ] **Step 2: Improve filtering**

Sidebar filter should match window title, source path, branch name, display name, and worktree root.

- [ ] **Step 3: Improve command center**

Include branch/worktree labels in workspace/window/agent subtitles and keywords. Waiting/working agent jump items should show `Terminal · Workspace · branch · provider` when metadata exists.

- [ ] **Step 4: Run focused tests**

Run: `bun run test -- src/lib/worktree-groups.test.ts src/lib/command-center.test.ts`

Expected: PASS.

## Task 5: Verification And Docs

**Files:**
- Modify: `.claude/rules/workspaces-sidebar.md`
- Modify: `.claude/rules/tauri-ipc-backend.md`

- [ ] **Step 1: Document behavior**

Add rules that worktree metadata is a derived navigation layer, may be cached, and must not persist live agent status or raw terminal output.

- [ ] **Step 2: Run focused checks**

Run:

```bash
bun run lint
bun run typecheck
bun run test
cd src-tauri && cargo check && cargo test
```

Expected: all pass.

- [ ] **Step 3: Manual smoke**

Run `bunx tauri dev`, open a git-backed workspace, create terminals from different worktree folders, and verify sidebar/Command Center show useful branch context without changing PTY behavior.

## Self-Review

- Spec coverage: covers metadata discovery, workspace/session grouping, agent jump productivity, test coverage, and docs.
- Placeholder scan: no TBD/TODO/later placeholders.
- Type consistency: `WorktreeInfo`, `SidebarWindow.worktree`, and `get_worktree_info` are the shared names used across tasks.
