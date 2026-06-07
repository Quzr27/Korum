import { WINDOW_GRID_GAP } from "@/lib/window-snapping";

export interface PlacementRect {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementSize {
  width: number;
  height: number;
}

interface AdjacentPlacementInput {
  origin: PlacementRect;
  existing: readonly PlacementRect[];
  viewport: PlacementViewport;
  size: PlacementSize;
  gap?: number;
}

type Side = "right" | "left" | "bottom" | "top";

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function fitsViewport(rect: PlacementRect, viewport: PlacementViewport): boolean {
  return (
    rect.x >= viewport.x &&
    rect.y >= viewport.y &&
    rect.x + rect.width <= viewport.x + viewport.width &&
    rect.y + rect.height <= viewport.y + viewport.height
  );
}

function rectsOverlap(a: PlacementRect, b: PlacementRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function collides(rect: PlacementRect, existing: readonly PlacementRect[], originId: string | undefined, gap: number): boolean {
  return existing.some((candidate) => {
    if (candidate.id && candidate.id === originId) return false;
    return rectsOverlap(rect, candidate, gap);
  });
}

function baseRectForSide(side: Side, origin: PlacementRect, size: PlacementSize, gap: number): PlacementRect {
  switch (side) {
    case "left":
      return { x: origin.x - size.width - gap, y: origin.y, ...size };
    case "bottom":
      return { x: origin.x, y: origin.y + origin.height + gap, ...size };
    case "top":
      return { x: origin.x, y: origin.y - size.height - gap, ...size };
    case "right":
    default:
      return { x: origin.x + origin.width + gap, y: origin.y, ...size };
  }
}

function offsets(step: number, count: number): number[] {
  const values = [0];
  for (let index = 1; index <= count; index++) {
    values.push(index * step, -index * step);
  }
  return values;
}

function candidatesForSide(
  side: Side,
  origin: PlacementRect,
  size: PlacementSize,
  viewport: PlacementViewport,
  gap: number,
): PlacementRect[] {
  const base = baseRectForSide(side, origin, size, gap);
  if (!fitsViewport(base, viewport)) return [];

  const result: PlacementRect[] = [];
  const maxX = viewport.x + viewport.width - size.width;
  const maxY = viewport.y + viewport.height - size.height;
  const movementOffsets = offsets(gap, 80);

  for (const offset of movementOffsets) {
    const rect = side === "right" || side === "left"
      ? { ...base, y: clamp(base.y + offset, viewport.y, maxY) }
      : { ...base, x: clamp(base.x + offset, viewport.x, maxX) };
    if (!result.some((candidate) => candidate.x === rect.x && candidate.y === rect.y)) {
      result.push(rect);
    }
  }

  return result;
}

function gridFallback(
  existing: readonly PlacementRect[],
  originId: string | undefined,
  viewport: PlacementViewport,
  size: PlacementSize,
  gap: number,
): PlacementRect | null {
  const maxX = viewport.x + viewport.width - size.width;
  const maxY = viewport.y + viewport.height - size.height;
  for (let y = viewport.y; y <= maxY; y += gap) {
    for (let x = viewport.x; x <= maxX; x += gap) {
      const rect = { x, y, ...size };
      if (!collides(rect, existing, originId, gap)) return rect;
    }
  }
  return null;
}

export function placeAdjacentWindow({
  origin,
  existing,
  viewport,
  size,
  gap = WINDOW_GRID_GAP,
}: AdjacentPlacementInput): PlacementRect {
  const sides: Side[] = ["right", "left", "bottom", "top"];

  for (const side of sides) {
    for (const candidate of candidatesForSide(side, origin, size, viewport, gap)) {
      if (!collides(candidate, existing, origin.id, gap)) return candidate;
    }
  }

  const fallback = gridFallback(existing, origin.id, viewport, size, gap);
  if (fallback) return fallback;

  const right = baseRectForSide("right", origin, size, gap);
  return {
    ...right,
    x: clamp(right.x, viewport.x, viewport.x + viewport.width - size.width),
    y: clamp(right.y, viewport.y, viewport.y + viewport.height - size.height),
  };
}
