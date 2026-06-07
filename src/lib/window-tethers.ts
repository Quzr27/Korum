export interface TetherRect {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TetherEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const TETHER_ARROW_MARKER_ID = "canvas-tether-arrow";

export interface TetherVisualAttrs {
  accent: string;
  markerEnd: string;
}

export function getTetherVisualAttrs(accent?: string): TetherVisualAttrs {
  return {
    accent: accent ?? "var(--primary)",
    markerEnd: `url(#${TETHER_ARROW_MARKER_ID})`,
  };
}

export interface TetherWindow extends TetherRect {
  id: string;
  type: string;
  workspaceId: string;
  viewMode?: string;
  originTerminalId?: string;
}

export interface TetherPair extends TetherVisualAttrs {
  key: string;
  originId: string;
  targetId: string;
}

export interface TetherRenderIndex<TWindow extends TetherWindow = TetherWindow> {
  windowsById: Map<string, TWindow>;
  pairs: TetherPair[];
  pairKeys: Set<string>;
  windowIds: Set<string>;
}

export function buildTetherRenderIndex<TWindow extends TetherWindow>(
  windows: readonly TWindow[],
  getWorkspaceAccent: (workspaceId: string) => string | undefined,
): TetherRenderIndex<TWindow> {
  const windowsById = new Map<string, TWindow>();
  for (const window of windows) {
    windowsById.set(window.id, window);
  }

  const pairs: TetherPair[] = [];
  const pairKeys = new Set<string>();
  const windowIds = new Set<string>();
  for (const target of windows) {
    if (target.type !== "code" || target.viewMode !== "changes" || !target.originTerminalId) continue;

    const origin = windowsById.get(target.originTerminalId);
    if (!origin || origin.type !== "terminal" || origin.workspaceId !== target.workspaceId) continue;

    const key = `${origin.id}->${target.id}`;
    const visualAttrs = getTetherVisualAttrs(getWorkspaceAccent(target.workspaceId));
    pairs.push({
      key,
      originId: origin.id,
      targetId: target.id,
      accent: visualAttrs.accent,
      markerEnd: visualAttrs.markerEnd,
    });
    pairKeys.add(key);
    windowIds.add(origin.id);
    windowIds.add(target.id);
  }

  return { windowsById, pairs, pairKeys, windowIds };
}

function center(rect: TetherRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function getTetherEndpoints(origin: TetherRect, target: TetherRect): TetherEndpoints {
  const originCenter = center(origin);
  const targetCenter = center(target);
  const dx = targetCenter.x - originCenter.x;
  const dy = targetCenter.y - originCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const targetIsRight = dx >= 0;
    return {
      x1: targetIsRight ? origin.x + origin.width : origin.x,
      y1: originCenter.y,
      x2: targetIsRight ? target.x : target.x + target.width,
      y2: targetCenter.y,
    };
  }

  const targetIsBelow = dy >= 0;
  return {
    x1: originCenter.x,
    y1: targetIsBelow ? origin.y + origin.height : origin.y,
    x2: targetCenter.x,
    y2: targetIsBelow ? target.y : target.y + target.height,
  };
}
