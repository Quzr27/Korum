import { isWindowInViewport } from "@/lib/viewport";
import type { WindowState, Point2D } from "@/types";

const VIEWPORT_BUFFER_PX = 480;
const KEEP_ALIVE_MS = 4_000;
const MAX_LIVE_TERMINALS_ZOOMED_IN = 16;
const MAX_LIVE_TERMINALS_DEFAULT = 12;
// At low zoom, canvases are tiny (low GPU cost) and user sees many terminals
const MAX_LIVE_TERMINALS_ZOOMED_OUT = 24;

export interface LiveTerminalSelectionInput {
  windows: WindowState[];
  activeWorkspaceId: string | null;
  activeWindowId: string | null;
  pan: Point2D;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  keepAliveUntil: Record<string, number>;
  now: number;
}

export interface LiveTerminalSelectionResult {
  liveTerminalIds: Set<string>;
  keepAliveUntil: Record<string, number>;
}

interface TerminalCandidate {
  id: string;
  inViewport: boolean;
  isActive: boolean;
  distanceToViewportCenter: number;
  zIndex: number;
}

function getLiveTerminalBudget(zoom: number, candidateCount: number): number {
  if (candidateCount <= 6) return candidateCount;
  if (zoom >= 0.95) return Math.min(candidateCount, MAX_LIVE_TERMINALS_ZOOMED_IN);
  if (zoom >= 0.7) return Math.min(candidateCount, MAX_LIVE_TERMINALS_DEFAULT);
  return Math.min(candidateCount, MAX_LIVE_TERMINALS_ZOOMED_OUT);
}

function getDistanceToViewportCenter(
  win: WindowState,
  pan: Point2D,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const centerX = (win.x + win.width / 2) * zoom + pan.x;
  const centerY = (win.y + win.height / 2) * zoom + pan.y;
  const dx = centerX - viewportWidth / 2;
  const dy = centerY - viewportHeight / 2;
  return Math.hypot(dx, dy);
}

export function selectLiveTerminalIds({
  windows,
  activeWorkspaceId,
  activeWindowId,
  pan,
  zoom,
  viewportWidth,
  viewportHeight,
  keepAliveUntil,
  now,
}: LiveTerminalSelectionInput): LiveTerminalSelectionResult {
  if (!activeWorkspaceId) {
    return {
      liveTerminalIds: new Set(),
      keepAliveUntil: {},
    };
  }

  const nextKeepAliveUntil: Record<string, number> = {};
  const candidates: TerminalCandidate[] = [];

  for (const win of windows) {
    if (win.type !== "terminal" || win.workspaceId !== activeWorkspaceId) continue;

    const isActive = win.id === activeWindowId;
    const inViewport = isWindowInViewport(
      win,
      pan,
      zoom,
      viewportWidth,
      viewportHeight,
      VIEWPORT_BUFFER_PX,
    );

    const nextExpiry = isActive || inViewport
      ? now + KEEP_ALIVE_MS
      : keepAliveUntil[win.id] ?? 0;

    if (nextExpiry > now) {
      nextKeepAliveUntil[win.id] = nextExpiry;
    }

    if (!isActive && !inViewport && nextExpiry <= now) continue;

    candidates.push({
      id: win.id,
      inViewport,
      isActive,
      distanceToViewportCenter: getDistanceToViewportCenter(
        win,
        pan,
        zoom,
        viewportWidth,
        viewportHeight,
      ),
      zIndex: win.zIndex,
    });
  }

  candidates.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
    if (a.distanceToViewportCenter !== b.distanceToViewportCenter) {
      return a.distanceToViewportCenter - b.distanceToViewportCenter;
    }
    return b.zIndex - a.zIndex;
  });

  const budget = getLiveTerminalBudget(zoom, candidates.length);
  const liveTerminalIds = new Set(
    candidates
      .slice(0, budget)
      .map((candidate) => candidate.id),
  );

  return {
    liveTerminalIds,
    keepAliveUntil: nextKeepAliveUntil,
  };
}
