import { isWindowInViewport } from "@/lib/viewport";
import type { WindowState, Point2D } from "@/types";

const VIEWPORT_BUFFER_PX = 480;
const KEEP_ALIVE_MS = 4_000;
const BASE_TERMINAL_AREA = 560 * 348;
const MAX_LIVE_TERMINALS_ZOOMED_IN = 16;
const MAX_LIVE_TERMINALS_DEFAULT = 12;
// Overview zooms: each live xterm costs a full attach (instance + font
// measure + fit + snapshot restore + buffer drain) and panning reshuffles the
// distance-sorted budget slice, so generous budgets churn constantly. Below
// ~0.45 the text is unreadable anyway — detached terminals show the static
// Rust-backed preview instead, so only the active one stays live.
const MAX_LIVE_TERMINALS_OVERVIEW = 8;
const MAX_LIVE_TERMINALS_FAR_OVERVIEW = 2;

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
  excludedTerminalIds?: ReadonlySet<string>;
}

export interface LiveTerminalSelectionResult {
  liveTerminalIds: Set<string>;
  keepAliveUntil: Record<string, number>;
}

interface TerminalCandidate {
  id: string;
  cost: number;
  inViewport: boolean;
  isActive: boolean;
  distanceToViewportCenter: number;
  zIndex: number;
}

function getLiveTerminalBudget(zoom: number): number {
  if (zoom >= 0.95) return MAX_LIVE_TERMINALS_ZOOMED_IN;
  if (zoom >= 0.7) return MAX_LIVE_TERMINALS_DEFAULT;
  if (zoom >= 0.45) return MAX_LIVE_TERMINALS_OVERVIEW;
  return MAX_LIVE_TERMINALS_FAR_OVERVIEW;
}

/** Standard 560x348 terminals cost one budget unit. Smaller terminals still
 * cost one because every live xterm has a fixed renderer/parser overhead;
 * larger terminals consume budget in proportion to their rendered area. */
export function getLiveTerminalCost(width: number, height: number): number {
  return Math.max(1, Math.max(0, width) * Math.max(0, height) / BASE_TERMINAL_AREA);
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
  excludedTerminalIds,
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
    if (excludedTerminalIds?.has(win.id)) continue;

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
      cost: getLiveTerminalCost(win.width, win.height),
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

  const budget = getLiveTerminalBudget(zoom);
  const liveTerminalIds = new Set<string>();
  let usedBudget = 0;
  for (const candidate of candidates) {
    // The active terminal is interactive and must never be evicted, even when
    // one oversized window costs more than the entire zoom-level budget.
    if (!candidate.isActive && usedBudget + candidate.cost > budget) continue;
    liveTerminalIds.add(candidate.id);
    usedBudget += candidate.cost;
  }

  return {
    liveTerminalIds,
    keepAliveUntil: nextKeepAliveUntil,
  };
}
