export interface TerminalDisplayRepairTarget {
  rows: number;
  buffer: {
    active: {
      viewportY: number;
      baseY: number;
    };
  };
  clearSelection(): void;
  clearTextureAtlas(): void;
  refresh(start: number, end: number): void;
  scrollToBottom(): void;
  scrollLines(amount: number): void;
}

interface TerminalPrivateRenderer {
  _core?: {
    _renderService?: {
      clear?: () => void;
    };
  };
}

export function clearTerminalRenderer(term: TerminalDisplayRepairTarget): void {
  const privateTerm = term as TerminalDisplayRepairTarget & TerminalPrivateRenderer;
  privateTerm._core?._renderService?.clear?.();
  term.clearTextureAtlas();
}

export function refreshTerminalDisplay(
  term: TerminalDisplayRepairTarget,
  options: {
    isCurrent: () => boolean;
    clearSelection?: boolean;
    onComplete?: () => void;
  },
): number {
  if (options.clearSelection) term.clearSelection();

  const buf = term.buffer.active;
  const wasAtBottom = buf.viewportY >= buf.baseY;
  const savedViewportY = buf.viewportY;
  clearTerminalRenderer(term);

  return window.requestAnimationFrame(() => {
    try {
      if (!options.isCurrent()) return;

      term.refresh(0, term.rows - 1);
      // Restore: if user was scrolled to bottom, stay there (baseY may have
      // changed from new data); otherwise restore exact viewport position.
      if (wasAtBottom) {
        term.scrollToBottom();
      } else if (buf.viewportY !== savedViewportY) {
        term.scrollLines(savedViewportY - buf.viewportY);
      }
    } finally {
      options.onComplete?.();
    }
  });
}
