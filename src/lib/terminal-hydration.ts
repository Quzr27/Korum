import type { WindowState } from "@/types";

export const TERMINAL_HYDRATION_CONCURRENCY = 8;

function compareHydrationPriority(
  a: WindowState,
  b: WindowState,
  activeWindowId: string | null,
): number {
  const aIsActive = a.id === activeWindowId;
  const bIsActive = b.id === activeWindowId;
  if (aIsActive !== bIsActive) return aIsActive ? -1 : 1;

  if (a.zIndex !== b.zIndex) return b.zIndex - a.zIndex;

  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export function collectTerminalIds(windows: WindowState[]): Set<string> {
  return new Set(
    windows
      .filter((window) => window.type === "terminal")
      .map((window) => window.id),
  );
}

export function buildTerminalHydrationQueue(
  windows: WindowState[],
  activeWorkspaceId: string | null,
  activeWindowId: string | null,
  hydratedIds: ReadonlySet<string>,
  bootingIds: ReadonlySet<string>,
  mountedIds?: ReadonlySet<string>,
): string[] {
  if (!activeWorkspaceId) return [];

  return windows
    .filter((window) => {
      return (
        window.type === "terminal" &&
        window.workspaceId === activeWorkspaceId &&
        !hydratedIds.has(window.id) &&
        !bootingIds.has(window.id) &&
        // Only hydrate terminals that are actually mounted (in viewport).
        // Off-viewport terminals stay in queue until user scrolls to them.
        (mountedIds ? mountedIds.has(window.id) : true)
      );
    })
    .sort((a, b) => compareHydrationPriority(a, b, activeWindowId))
    .map((window) => window.id);
}
