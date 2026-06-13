export interface VirtualCodeRowsInput {
  rowCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan: number;
}

export interface VirtualCodeRows {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
}

export function getVirtualCodeRows({
  rowCount,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
}: VirtualCodeRowsInput): VirtualCodeRows {
  const safeRowCount = Math.max(0, Math.floor(rowCount));
  const safeRowHeight = Math.max(1, rowHeight);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const totalHeight = safeRowCount * safeRowHeight;

  if (safeRowCount === 0) {
    return { start: 0, end: 0, topPadding: 0, bottomPadding: 0, totalHeight: 0 };
  }

  const firstVisible = Math.min(safeRowCount, Math.floor(safeScrollTop / safeRowHeight));
  const visibleCount = Math.ceil(safeViewportHeight / safeRowHeight);
  const start = Math.max(0, firstVisible - safeOverscan);
  const end = Math.min(safeRowCount, firstVisible + visibleCount + safeOverscan);

  return {
    start,
    end,
    topPadding: start * safeRowHeight,
    bottomPadding: Math.max(0, totalHeight - end * safeRowHeight),
    totalHeight,
  };
}
