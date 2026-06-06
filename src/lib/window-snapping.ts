export const WINDOW_GRID_GAP = 24;
export const WINDOW_SNAP_THRESHOLD = 10;

export interface SnapTargetRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface SnapCandidate {
  distance: number;
  position: number;
  value: number;
  target: SnapTargetRect;
}

function makeVerticalGuide(position: number, dragged: SnapTargetRect, target: SnapTargetRect): SnapGuide {
  return {
    axis: "x",
    position,
    start: Math.min(dragged.y, target.y) - 12,
    end: Math.max(dragged.y + dragged.height, target.y + target.height) + 12,
  };
}

function makeHorizontalGuide(position: number, dragged: SnapTargetRect, target: SnapTargetRect): SnapGuide {
  return {
    axis: "y",
    position,
    start: Math.min(dragged.x, target.x) - 12,
    end: Math.max(dragged.x + dragged.width, target.x + target.width) + 12,
  };
}

function chooseClosest(candidates: SnapCandidate[], threshold: number): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.distance > threshold) continue;
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

function rangesOverlapOrNear(aStart: number, aEnd: number, bStart: number, bEnd: number, buffer: number): boolean {
  return aEnd >= bStart - buffer && bEnd >= aStart - buffer;
}

export function snapDraggedWindow(
  proposed: SnapTargetRect,
  targets: readonly SnapTargetRect[],
  threshold = WINDOW_SNAP_THRESHOLD,
  gap = WINDOW_GRID_GAP,
): SnapResult {
  const xCandidates: SnapCandidate[] = [];
  const yCandidates: SnapCandidate[] = [];
  const left = proposed.x;
  const right = proposed.x + proposed.width;
  const top = proposed.y;
  const bottom = proposed.y + proposed.height;

  for (const target of targets) {
    if (target.id === proposed.id) continue;

    const targetLeft = target.x;
    const targetRight = target.x + target.width;
    const targetTop = target.y;
    const targetBottom = target.y + target.height;
    const perpendicularBuffer = gap + threshold;
    const canSnapX = rangesOverlapOrNear(top, bottom, targetTop, targetBottom, perpendicularBuffer);
    const canSnapY = rangesOverlapOrNear(left, right, targetLeft, targetRight, perpendicularBuffer);

    if (canSnapX) {
      xCandidates.push(
        { distance: Math.abs(left - targetLeft), position: targetLeft, value: targetLeft, target },
        { distance: Math.abs(left - targetRight), position: targetRight, value: targetRight, target },
        { distance: Math.abs(right - targetLeft), position: targetLeft, value: targetLeft - proposed.width, target },
        { distance: Math.abs(right - targetRight), position: targetRight, value: targetRight - proposed.width, target },
        {
          distance: Math.abs(left - (targetRight + gap)),
          position: targetRight + gap,
          value: targetRight + gap,
          target,
        },
        {
          distance: Math.abs(right - (targetLeft - gap)),
          position: targetLeft - gap,
          value: targetLeft - gap - proposed.width,
          target,
        },
      );
    }

    if (canSnapY) {
      yCandidates.push(
        { distance: Math.abs(top - targetTop), position: targetTop, value: targetTop, target },
        { distance: Math.abs(top - targetBottom), position: targetBottom, value: targetBottom, target },
        { distance: Math.abs(bottom - targetTop), position: targetTop, value: targetTop - proposed.height, target },
        { distance: Math.abs(bottom - targetBottom), position: targetBottom, value: targetBottom - proposed.height, target },
        {
          distance: Math.abs(top - (targetBottom + gap)),
          position: targetBottom + gap,
          value: targetBottom + gap,
          target,
        },
        {
          distance: Math.abs(bottom - (targetTop - gap)),
          position: targetTop - gap,
          value: targetTop - gap - proposed.height,
          target,
        },
      );
    }
  }

  const xSnap = chooseClosest(xCandidates, threshold);
  const ySnap = chooseClosest(yCandidates, threshold);
  const snapped = {
    ...proposed,
    x: xSnap?.value ?? proposed.x,
    y: ySnap?.value ?? proposed.y,
  };
  const guides: SnapGuide[] = [];

  if (xSnap) guides.push(makeVerticalGuide(xSnap.position, snapped, xSnap.target));
  if (ySnap) guides.push(makeHorizontalGuide(ySnap.position, snapped, ySnap.target));

  return { x: snapped.x, y: snapped.y, guides };
}
