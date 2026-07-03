import type { WindowState, Workspace } from "@/types";

export function getWindowWorktreeLookupPath(
  window: WindowState,
  workspace?: Workspace,
  terminalCwdById: Record<string, string> = {},
): string | undefined {
  if (window.type === "terminal") return terminalCwdById[window.id] ?? window.initialCwd ?? workspace?.rootPath;
  if ((window.type === "code" || window.type === "note") && window.sourcePath) return window.sourcePath;
  return workspace?.rootPath;
}

export function shouldRefreshWorktreeInfo(
  path: string,
  now: number,
  checkedAtByPath: Record<string, number>,
  inFlightPaths: ReadonlySet<string>,
  refreshMs: number,
): boolean {
  if (inFlightPaths.has(path)) return false;
  const checkedAt = checkedAtByPath[path];
  return checkedAt == null || now - checkedAt >= refreshMs;
}
