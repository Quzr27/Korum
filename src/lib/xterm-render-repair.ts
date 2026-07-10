import { CanvasAddon } from "@xterm/addon-canvas";
import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import type { TerminalRenderer } from "@/lib/settings/types";

export type ActiveTerminalRenderer = "canvas" | "dom";

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

/** Prefer the lower-DOM Canvas renderer, but keep the built-in DOM renderer
 * as a reliable WKWebView fallback and an explicit diagnostics escape hatch. */
export function activateTerminalRenderer(
  term: Terminal,
  renderer: TerminalRenderer,
  createCanvasAddon: () => ITerminalAddon = () => new CanvasAddon(),
): ActiveTerminalRenderer {
  if (renderer === "dom") return "dom";

  let canvasAddon: ITerminalAddon | null = null;
  try {
    canvasAddon = createCanvasAddon();
    term.loadAddon(canvasAddon);
    return "canvas";
  } catch {
    try {
      canvasAddon?.dispose();
    } catch {
      // The built-in DOM renderer remains active even if partial addon cleanup
      // also fails; renderer selection must never prevent terminal startup.
    }
    return "dom";
  }
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
