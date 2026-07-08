import type { CodeViewMode, GitFileStatus, GitStatusResult } from "@/types";

export interface ChangedFileRow {
  key: string;
  absolutePath: string;
  displayPath: string;
  repoRelativePath: string;
  status: string;
  insertions: number;
  deletions: number;
  openMode: CodeViewMode;
}

export interface NormalizeChangedFilesInput {
  workspaceRoot: string;
  status: GitStatusResult | null | undefined;
}

export function normalizeChangedFiles({ workspaceRoot, status }: NormalizeChangedFilesInput): ChangedFileRow[] {
  if (!status?.repo_root) return [];

  const normalizedWorkspaceRoot = normalizePath(workspaceRoot);
  const normalizedRepoRoot = normalizePath(status.repo_root);
  const rows: ChangedFileRow[] = [];

  for (const file of status.statuses) {
    const trimmedStatus = file.status.trim();
    if (!trimmedStatus) continue;

    const repoRelativePath = normalizeRelativePath(file.path);
    if (!repoRelativePath) continue;

    const absolutePath = joinPath(normalizedRepoRoot, repoRelativePath);
    const displayPath = getRelativePath(normalizedWorkspaceRoot, absolutePath);
    if (displayPath == null || displayPath.length === 0) continue;

    rows.push({
      key: absolutePath,
      absolutePath,
      displayPath,
      repoRelativePath,
      status: trimmedStatus,
      insertions: file.insertions,
      deletions: file.deletions,
      openMode: getOpenMode(trimmedStatus),
    });
  }

  rows.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  return rows;
}

export function buildGitStatusByAbsolutePath(
  input: NormalizeChangedFilesInput,
): Map<string, Pick<GitFileStatus, "status" | "insertions" | "deletions">> {
  const map = new Map<string, Pick<GitFileStatus, "status" | "insertions" | "deletions">>();
  for (const row of normalizeChangedFiles(input)) {
    map.set(row.absolutePath, {
      status: row.status,
      insertions: row.insertions,
      deletions: row.deletions,
    });
  }
  return map;
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function normalizeRelativePath(value: string): string {
  return normalizePath(value).replace(/^\/+/, "");
}

function joinPath(root: string, relativePath: string): string {
  return `${root}/${relativePath}`.replace(/\/+/g, "/");
}

function getRelativePath(root: string, absolutePath: string): string | null {
  const normalizedPath = normalizePath(absolutePath);
  if (normalizedPath === root) return "";
  if (!normalizedPath.startsWith(`${root}/`)) return null;
  return normalizedPath.slice(root.length + 1);
}

function getOpenMode(status: string): CodeViewMode {
  return status.includes("?") ? "file" : "changes";
}
