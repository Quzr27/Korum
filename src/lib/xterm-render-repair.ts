export interface TerminalDisplayRepairScheduler {
  schedule(): void;
  dispose(): void;
}

/** Debounce hard renderer repair until output is idle. There is intentionally
 * no maximum-delay timer: clearing the full renderer during continuous output
 * recreates thousands of DOM nodes and drives WKWebView heap growth. */
export function createTerminalDisplayRepairScheduler(
  repair: () => void,
  idleDelayMs = 180,
): TerminalDisplayRepairScheduler {
  let timer: number | null = null;
  let disposed = false;

  return {
    schedule() {
      if (disposed) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (!disposed) repair();
      }, idleDelayMs);
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
  };
}

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
