/**
 * useXtermSession — extracted from TerminalWindow's Effect B + supporting effects.
 *
 * Encapsulates:
 * - xterm Terminal create/open/fit
 * - Tauri Channel + PTY attach/detach
 * - Keyboard shortcuts (copy, paste, clear, line feed)
 * - CSS scale compensation for canvas zoom
 * - Visibility refresh (via VisibilityProvider)
 * - SerializeAddon snapshot capture on detach
 * - Settings sync (font, theme changes)
 * - Focus management (isActive)
 * - Resize (win.width/height)
 */

import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { TERMINAL_FONT_FAMILIES, TERMINAL_FONT_LOAD_TARGETS, getXtermTheme } from "@/lib/settings";
import type { TerminalFont, TerminalTheme } from "@/lib/settings/types";
import { handleTerminalShortcut } from "@/lib/terminal-shortcuts";
import { adjustMouseForZoom } from "@/lib/xterm-mouse-compat";
import { useVisibility } from "@/lib/visibility-context";
import type { PasteRequest } from "@/types";

const SNAPSHOT_SCROLLBACK_ROWS = 120;

function writeTerminalSnapshot(term: Terminal, snapshot: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(snapshot, () => resolve());
  });
}

export interface UseXtermSessionOptions {
  id: string;
  isPtyReady: boolean;
  shouldAttach: boolean;
  terminalSnapshot: string | undefined;
  terminalFont: TerminalFont;
  terminalFontSize: number;
  terminalTheme: TerminalTheme;
  zoomRef: React.RefObject<number>;
  ptyIdRef: React.MutableRefObject<string | null>;
  mountedRef: React.MutableRefObject<boolean>;
  termRef: React.RefObject<HTMLDivElement | null>;
  pendingDisposeRef: React.MutableRefObject<{ term: Terminal; timer: number } | null>;
  windowWidth: number;
  windowHeight: number;
  isActive: boolean;
  flushPendingDispose: () => void;
  onSnapshotCaptured: (windowId: string, snapshot: string | null) => void;
  onPasteRequest: (request: PasteRequest) => void;
  onSpawnError: (error: string) => void;
}

export interface UseXtermSessionResult {
  termInstanceRef: React.RefObject<Terminal | null>;
  fitAddonRef: React.RefObject<FitAddon | null>;
  isSessionReady: boolean;
}

export function useXtermSession(opts: UseXtermSessionOptions): UseXtermSessionResult {
  const {
    id,
    isPtyReady,
    shouldAttach,
    terminalSnapshot,
    terminalFont,
    terminalFontSize,
    terminalTheme,
    zoomRef,
    ptyIdRef,
    mountedRef,
    termRef,
    pendingDisposeRef,
    windowWidth,
    windowHeight,
    isActive,
    flushPendingDispose,
    onSnapshotCaptured,
    onPasteRequest,
    onSpawnError,
  } = opts;

  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);

  const { register: registerVisibility, unregister: unregisterVisibility } = useVisibility();

  // ── Effect B: xterm + attach lifecycle ──
  useEffect(() => {
    const ptyId = ptyIdRef.current;
    if (!isPtyReady || !shouldAttach || !ptyId || !termRef.current) return;

    flushPendingDispose();
    termRef.current.replaceChildren();

    const xtermTheme = getXtermTheme(terminalTheme);
    const term = new Terminal({
      fontSize: terminalFontSize,
      fontFamily: TERMINAL_FONT_FAMILIES[terminalFont],
      lineHeight: 1.22,
      theme: {
        ...xtermTheme,
        cursorAccent: xtermTheme.background,
        selectionBackground: `${xtermTheme.foreground}30`,
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);
    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    // Open terminal synchronously (container is in DOM from React commit)
    term.open(termRef.current!);

    // Fit synchronously BEFORE anything else — ensures correct dimensions
    try { fitAddon.fit(); } catch { /* container not ready */ }

    let alive = true;
    let attached = false;
    let hasLiveData = false;
    // Capture snapshot at mount time — never read reactively
    const snapshotAtMount = terminalSnapshot;
    const channel = new Channel<number[]>();
    channel.onmessage = (data: number[]) => {
      if (!alive) return;
      hasLiveData = true;
      term.write(new Uint8Array(data));
    };
    const onDataDisposable = term.onData((data: string) => {
      if (ptyIdRef.current) {
        invoke("write_terminal", { id: ptyIdRef.current, data }).catch(() => {
          if (alive) onSpawnError("Terminal process is not responding");
        });
      }
    });

    void (async () => {
      // Restore visual state from previous detach (if any)
      if (snapshotAtMount) {
        await writeTerminalSnapshot(term, snapshotAtMount);
      }

      if (!alive) return;

      // Attach first — ring buffer replays at current dimensions
      await invoke("attach_terminal", { id: ptyId, outputChannel: channel });
      if (!alive) return;

      attached = true;
      setIsSessionReady(true);

      // Resize AFTER attach — shell redraws go directly to xterm (not buffered)
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        invoke("resize_terminal", { id: ptyId, rows: dims.rows, cols: dims.cols }).catch(() => {});
      }
    })().catch((err) => {
      if (alive) onSpawnError(String(err));
    });

    // Keyboard shortcuts — Cmd+C (copy), Cmd+V (paste), Cmd+K (clear), Shift+Enter (line feed)
    term.attachCustomKeyEventHandler((ev) => {
      return handleTerminalShortcut(ev, {
        selection: term.getSelection(),
        isMounted: mountedRef.current,
        copySelection: (selection) => {
          writeText(selection).catch(() => {});
        },
        pasteClipboard: () => {
          const currentId = ptyIdRef.current;
          readText().then((text) => {
            if (!text || !currentId || !mountedRef.current) return;
            onPasteRequest({
              text,
              terminalId: id,
              ptyId: currentId,
              bracketedPasteMode: term.modes.bracketedPasteMode,
            });
          }).catch(() => {});
        },
        clearTerminal: () => {
          term.clear();
          if (ptyIdRef.current) invoke("write_terminal", { id: ptyIdRef.current, data: "\x0c" });
        },
        sendLineFeed: () => {
          if (ptyIdRef.current) invoke("write_terminal", { id: ptyIdRef.current, data: "\n" });
        },
      });
    });

    // CSS scale compensation
    const container = termRef.current!;
    const handleMouseZoom = (e: MouseEvent) => adjustMouseForZoom(e, container, zoomRef.current);
    container.addEventListener("mousedown", handleMouseZoom, true);
    container.addEventListener("mousemove", handleMouseZoom, true);
    container.addEventListener("mouseup", handleMouseZoom, true);

    // Visibility refresh (via VisibilityProvider — single global listener)
    // Preserve scroll position across atlas clear + refresh to prevent
    // scroll-to-top on focus return while PTY is actively writing data.
    registerVisibility(id, () => {
      term.clearSelection();
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      const savedViewportY = buf.viewportY;
      term.clearTextureAtlas();
      requestAnimationFrame(() => {
        if (termInstanceRef.current !== term) return;
        term.refresh(0, term.rows - 1);
        // Restore: if user was scrolled to bottom, stay there (baseY may have
        // changed from new data); otherwise restore exact viewport position.
        if (wasAtBottom) {
          term.scrollToBottom();
        } else if (buf.viewportY !== savedViewportY) {
          term.scrollLines(savedViewportY - buf.viewportY);
        }
      });
    });

    return () => {
      alive = false;
      if (attached) {
        if (hasLiveData) {
          const snapshot = serializeAddon.serialize({
            scrollback: SNAPSHOT_SCROLLBACK_ROWS,
          });
          onSnapshotCaptured(id, snapshot || null);
        }
        invoke("detach_terminal", { id: ptyId }).catch(() => {});
      }
      onDataDisposable.dispose();
      container.removeEventListener("mousedown", handleMouseZoom, true);
      container.removeEventListener("mousemove", handleMouseZoom, true);
      container.removeEventListener("mouseup", handleMouseZoom, true);
      unregisterVisibility(id);
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      setIsSessionReady(false);
      const timer = window.setTimeout(() => {
        if (pendingDisposeRef.current?.term !== term) return;
        term.dispose();
        if (pendingDisposeRef.current?.term === term) {
          pendingDisposeRef.current = null;
        }
      }, 0);
      pendingDisposeRef.current = { term, timer };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- settings handled by separate effect; terminalSnapshot captured at mount via snapshotAtMount; onPasteRequest/onSpawnError omitted — both are stable (useCallback with [] deps / useState setter)
  }, [flushPendingDispose, id, isPtyReady, onSnapshotCaptured, shouldAttach]);

  // Update terminal options when settings change
  useEffect(() => {
    const term = termInstanceRef.current;
    if (!term) return;
    const fontFamily = TERMINAL_FONT_FAMILIES[terminalFont];
    const fontLoadTarget = TERMINAL_FONT_LOAD_TARGETS[terminalFont];
    term.options.fontFamily = fontFamily;
    term.options.fontSize = terminalFontSize;
    const xtermTheme = getXtermTheme(terminalTheme);
    term.options.theme = {
      ...xtermTheme,
      cursorAccent: xtermTheme.background,
      selectionBackground: `${xtermTheme.foreground}30`,
    };

    let cancelled = false;
    const fitTerminal = () => {
      if (cancelled || !mountedRef.current) return;
      // Preserve scroll position across atlas clear + fit
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      const savedViewportY = buf.viewportY;
      term.clearTextureAtlas();
      const fit = fitAddonRef.current;
      if (fit) {
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
        } catch { /* ignore */ }
      }
      if (wasAtBottom) {
        term.scrollToBottom();
      } else if (buf.viewportY !== savedViewportY) {
        term.scrollLines(savedViewportY - buf.viewportY);
      }
    };

    const timer = window.setTimeout(() => {
      requestAnimationFrame(fitTerminal);
    }, 120);

    if (fontLoadTarget && "fonts" in document) {
      void Promise.all([
        document.fonts.load(`${terminalFontSize}px ${fontLoadTarget}`, "MW@#"),
        document.fonts.ready,
      ]).then(() => {
        window.clearTimeout(timer);
        requestAnimationFrame(fitTerminal);
      }).catch(() => {
        window.clearTimeout(timer);
        requestAnimationFrame(fitTerminal);
      });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [terminalFont, terminalFontSize, terminalTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus terminal when it becomes the active window.
  // isSessionReady ensures focus applies if isActive was already true at mount time.
  useEffect(() => {
    if (isActive) termInstanceRef.current?.focus();
  }, [isActive, isSessionReady]);

  // Re-fit when resized
  useEffect(() => {
    const term = termInstanceRef.current;
    const fit = fitAddonRef.current;
    if (!fit || !term) return;
    requestAnimationFrame(() => {
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
      } catch { /* ignore */ }
      if (wasAtBottom) term.scrollToBottom();
    });
  }, [windowWidth, windowHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  return { termInstanceRef, fitAddonRef, isSessionReady };
}
