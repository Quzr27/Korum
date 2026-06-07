import type { CodeViewMode, GitFileStatus } from "@/types";

export interface CodeTargetDecisionInput {
  line: number | undefined;
  nonce: number | undefined;
  viewMode: CodeViewMode;
  tokensReady: boolean;
  lastHandledNonce: number | null;
}

export function shouldHandleCodeTarget({
  line,
  nonce,
  viewMode,
  tokensReady,
  lastHandledNonce,
}: CodeTargetDecisionInput): boolean {
  return (
    typeof line === "number" &&
    line >= 1 &&
    typeof nonce === "number" &&
    viewMode === "file" &&
    tokensReady &&
    nonce !== lastHandledNonce
  );
}

interface SmartLinkCodeViewModeInput {
  sourcePath: string;
  workspaceRoot?: string;
  statuses: readonly Pick<GitFileStatus, "path" | "status">[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function getWorkspaceRelativePath(sourcePath: string, workspaceRoot?: string): string | null {
  if (!workspaceRoot) return null;

  const normalizedSource = normalizePath(sourcePath);
  const normalizedRoot = normalizePath(workspaceRoot);
  if (normalizedSource === normalizedRoot) return "";
  if (!normalizedSource.startsWith(`${normalizedRoot}/`)) return null;

  return normalizedSource.slice(normalizedRoot.length + 1);
}

function statusMatchesSource(
  statusPath: string,
  sourcePath: string,
  workspaceRelativePath: string | null,
): boolean {
  const normalizedStatusPath = normalizePath(statusPath);
  if (workspaceRelativePath && normalizedStatusPath === workspaceRelativePath) return true;

  const normalizedSource = normalizePath(sourcePath);
  return normalizedSource.endsWith(`/${normalizedStatusPath}`);
}

export function selectSmartLinkCodeViewMode({
  sourcePath,
  workspaceRoot,
  statuses,
}: SmartLinkCodeViewModeInput): CodeViewMode {
  const workspaceRelativePath = getWorkspaceRelativePath(sourcePath, workspaceRoot);
  if (!workspaceRoot || workspaceRelativePath === null) return "file";

  const status = statuses.find((candidate) => (
    candidate.status.trim().length > 0 &&
    statusMatchesSource(candidate.path, sourcePath, workspaceRelativePath)
  ));

  if (!status) return "file";
  return status.status.includes("?") ? "file" : "changes";
}
