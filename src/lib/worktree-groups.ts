import type { WindowKind, WorktreeInfo } from "@/types";

export interface WorktreeGroupWindow {
  id: string;
  type: WindowKind;
  title: string;
  workspaceId: string;
  sourcePath?: string;
  worktree?: WorktreeInfo | null;
}

export interface WorktreeWindowGroup<T extends WorktreeGroupWindow = WorktreeGroupWindow> {
  key: string;
  label: string;
  worktree: WorktreeInfo | null;
  windows: T[];
}

const NO_WORKTREE_KEY = "__korum_no_worktree__";
export const NO_WORKTREE_LABEL = "No worktree";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function pathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function getWorktreeDisplayName(worktree: WorktreeInfo): string {
  if (worktree.branch) return worktree.branch;
  if (worktree.isDetached) {
    const detachedName = worktree.displayName || worktree.headSha?.slice(0, 7) || pathBasename(worktree.worktreeRoot);
    return `detached ${detachedName}`;
  }
  return worktree.displayName || pathBasename(worktree.worktreeRoot);
}

export function buildWorktreeWindowGroups<T extends WorktreeGroupWindow>(
  windows: readonly T[],
): WorktreeWindowGroup<T>[] {
  const groups = new Map<string, WorktreeWindowGroup<T>>();

  for (const window of windows) {
    const worktree = window.worktree ?? null;
    const key = worktree?.worktreeRoot ?? NO_WORKTREE_KEY;
    const existing = groups.get(key);
    if (existing) {
      existing.windows.push(window);
      continue;
    }
    groups.set(key, {
      key,
      label: worktree ? getWorktreeDisplayName(worktree) : NO_WORKTREE_LABEL,
      worktree,
      windows: [window],
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.worktree && !b.worktree) return 0;
    if (!a.worktree) return 1;
    if (!b.worktree) return -1;
    return a.label.localeCompare(b.label);
  });
}

export function hasWorktreeMetadata(windows: readonly WorktreeGroupWindow[]): boolean {
  return windows.some((window) => !!window.worktree);
}

export function matchesWorktreeWindowQuery(window: WorktreeGroupWindow, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const worktreeLabel = window.worktree ? getWorktreeDisplayName(window.worktree) : "";
  const searchText = [
    window.title,
    window.sourcePath,
    window.worktree?.branch,
    window.worktree?.displayName,
    window.worktree?.worktreeRoot,
    window.worktree?.repoRoot,
    worktreeLabel,
  ].filter(Boolean).join(" ").toLowerCase();

  return terms.every((term) => searchText.includes(term));
}
