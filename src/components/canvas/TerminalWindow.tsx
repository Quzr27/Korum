import { memo, useEffect, useRef, useCallback, useMemo, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "@/lib/settings-context";
import { TERMINAL_FONT_FAMILIES, TERMINAL_FONT_LOAD_TARGETS, getXtermTheme } from "@/lib/settings";
import { handleTerminalShortcut } from "@/lib/terminal-shortcuts";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TerminalWindow as TerminalWindowState, WindowUpdatable, ResizeEdge } from "@/types";

// Lighten/darken a hex color
function adjustBrightness(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + Math.round(amount * 255)));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(amount * 255)));
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(amount * 255)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function getChromeShades(background: string): { titlebar: string; border: string } {
  const n = parseInt(background.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const titlebarShift = luminance > 0.7 ? -0.05 : 0.06;
  const borderShift = luminance > 0.7 ? -0.14 : 0.1;

  return {
    titlebar: adjustBrightness(background, titlebarShift),
    border: adjustBrightness(background, borderShift),
  };
}

const SNAPSHOT_SCROLLBACK_ROWS = 120;

function writeTerminalSnapshot(term: Terminal, snapshot: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(snapshot, () => resolve());
  });
}

interface Props {
  id: string;
  window: TerminalWindowState;
  isActive: boolean;
  shouldHydrate: boolean;
  shouldAttach: boolean;
  terminalSnapshot?: string;
  zoomRef: React.RefObject<number>;
  wsColor?: string;
  cwd?: string;
  onClose: (id: string) => void;
  onHydrationSettled: (id: string) => void;
  onPtySpawned: (windowId: string, ptyId: string | null) => void;
  onSnapshotCaptured: (windowId: string, snapshot: string | null) => void;
  onUpdate: (id: string, updates: Partial<WindowUpdatable>) => void;
  onFocus: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export default memo(function TerminalWindow({
  id,
  window: win,
  isActive,
  shouldHydrate,
  shouldAttach,
  terminalSnapshot,
  zoomRef,
  wsColor,
  cwd,
  onClose,
  onHydrationSettled,
  onPtySpawned,
  onSnapshotCaptured,
  onUpdate,
  onFocus,
  onRename,
}: Props) {
  const { settings } = useSettings();
  const termRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const pendingDisposeRef = useRef<{ term: Terminal; timer: number } | null>(null);
  const mountedRef = useRef(false);
  const mountVersionRef = useRef(0);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dragListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isPtyReady, setIsPtyReady] = useState(false);
  const [respawnTrigger, setRespawnTrigger] = useState(0);
  const hydrationSettledRef = useRef(false);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  // Clean up drag/resize document listeners on unmount (close mid-drag)
  useEffect(() => {
    return () => {
      if (dragListenersRef.current) {
        document.removeEventListener("mousemove", dragListenersRef.current.move);
        document.removeEventListener("mouseup", dragListenersRef.current.up);
        dragListenersRef.current = null;
      }
    };
  }, []);

  const reportHydrationSettled = useCallback(() => {
    if (hydrationSettledRef.current) return;
    hydrationSettledRef.current = true;
    onHydrationSettled(id);
  }, [id, onHydrationSettled]);

  const flushPendingDispose = useCallback(() => {
    const pendingDispose = pendingDisposeRef.current;
    if (!pendingDispose) return;
    window.clearTimeout(pendingDispose.timer);
    pendingDispose.term.dispose();
    pendingDisposeRef.current = null;
  }, []);

  useEffect(() => {
    return () => { flushPendingDispose(); };
  }, [flushPendingDispose]);

  // ── Effect A: PTY lifecycle (create or restore) ──
  // On first mount: spawns PTY, stores ptyId in parent state via onPtySpawned.
  // On remount (workspace switch back): restores from win.ptyId — no re-spawn needed.
  // Cleanup does NOT kill PTY — App.tsx owns PTY destruction (removeWindow/deleteWorkspace).
  useEffect(() => {
    if (!shouldHydrate) return;

    // Fast path: restore from persisted ptyId (component remounted after workspace switch)
    if (win.ptyId && respawnTrigger === 0) {
      ptyIdRef.current = win.ptyId;
      mountedRef.current = true;
      setSpawnError(null);
      setIsPtyReady(true);
      reportHydrationSettled();
      return () => {
        mountedRef.current = false;
        ptyIdRef.current = null;
        setIsPtyReady(false);
        reportHydrationSettled(); // guard prevents double-call
      };
    }

    // Slow path: spawn new PTY
    mountVersionRef.current += 1;
    const mountVersion = mountVersionRef.current;
    mountedRef.current = true;
    hydrationSettledRef.current = false; // allows re-settle on respawn (idempotent in hydration queue)
    setSpawnError(null);
    setIsPtyReady(false);

    const spawnAsync = async () => {
      const info = await invoke<{ id: string }>("create_terminal", {
        cwd: cwdRef.current ?? null,
      });

      if (!mountedRef.current || mountVersion !== mountVersionRef.current) {
        void invoke("kill_terminal", { id: info.id }).catch(() => {});
        return;
      }

      ptyIdRef.current = info.id;
      onPtySpawned(id, info.id);
      setIsPtyReady(true);
    };

    spawnAsync()
      .catch((err) => {
        if (!mountedRef.current || mountVersion !== mountVersionRef.current) return;
        setSpawnError(String(err));
      })
      .finally(() => {
        if (mountedRef.current && mountVersion === mountVersionRef.current) {
          reportHydrationSettled();
        }
      });

    return () => {
      mountedRef.current = false;
      mountVersionRef.current += 1;
      ptyIdRef.current = null;
      setIsPtyReady(false);
      // Free hydration slot on unmount — prevents queue stall if spawn was mid-flight.
      // Guard inside reportHydrationSettled prevents double-call if spawn already settled.
      reportHydrationSettled();
      // PTY is NOT killed here — App.tsx kills it on removeWindow/deleteWorkspace.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- respawnTrigger forces re-spawn on reopen; cwdRef/onPtySpawned stable via refs
  }, [shouldHydrate, respawnTrigger]);

  // ── Effect B: xterm + attach lifecycle ──
  // Creates xterm when the PTY is ready AND this terminal has a live-view slot.
  // Detaches and disposes xterm when the slot is released (PTY continues buffering in Rust).
  useEffect(() => {
    const ptyId = ptyIdRef.current;
    if (!isPtyReady || !shouldAttach || !ptyId || !termRef.current) return;

    flushPendingDispose();
    termRef.current.replaceChildren();

    const xtermTheme = getXtermTheme(settings.terminalTheme);
    const term = new Terminal({
      fontSize: settings.terminalFontSize,
      fontFamily: TERMINAL_FONT_FAMILIES[settings.terminalFont],
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
    // Capture snapshot at mount time — never read reactively (avoids Effect B rerun on prop change)
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
          if (alive) setSpawnError("Terminal process is not responding");
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
      if (alive) setSpawnError(String(err));
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
            const data = term.modes.bracketedPasteMode
              ? `\x1b[200~${text}\x1b[201~`
              : text;
            invoke("write_terminal", { id: currentId, data });
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

    return () => {
      alive = false;
      if (attached) {
        // Only update snapshot if live PTY data arrived — prevents gradual
        // history compression when cycling through attach/detach without new output.
        if (hasLiveData) {
          const snapshot = serializeAddon.serialize({
            scrollback: SNAPSHOT_SCROLLBACK_ROWS,
          });
          onSnapshotCaptured(id, snapshot || null);
        }
        invoke("detach_terminal", { id: ptyId }).catch(() => {});
      }
      onDataDisposable.dispose();
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      setIsSessionReady(false);
      // Defer dispose one tick to stay compatible with xterm internals, but
      // guard it so a rapid re-attach cannot tear down the fresh session.
      const timer = window.setTimeout(() => {
        if (pendingDisposeRef.current?.term !== term) return;
        term.dispose();
        if (pendingDisposeRef.current?.term === term) {
          pendingDisposeRef.current = null;
        }
      }, 0);
      pendingDisposeRef.current = { term, timer };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- settings handled by separate effect; terminalSnapshot captured at mount via snapshotAtMount
  }, [flushPendingDispose, id, isPtyReady, onSnapshotCaptured, shouldAttach]);

  // Reopen after error — kill old PTY, trigger respawn via Effect A
  const handleReopen = useCallback(() => {
    const ptyId = ptyIdRef.current;
    if (ptyId) {
      invoke("kill_terminal", { id: ptyId }).catch(() => {});
    }
    ptyIdRef.current = null;
    mountVersionRef.current += 1; // invalidate any in-flight spawn
    onPtySpawned(id, null); // clear stale ptyId in parent state
    onSnapshotCaptured(id, null);
    setIsPtyReady(false);
    setSpawnError(null);
    setRespawnTrigger((prev) => prev + 1);
  }, [id, onPtySpawned, onSnapshotCaptured]);

  // Update terminal options when settings change — debounce expensive refit
  useEffect(() => {
    const term = termInstanceRef.current;
    if (!term) return;
    const fontFamily = TERMINAL_FONT_FAMILIES[settings.terminalFont];
    const fontLoadTarget = TERMINAL_FONT_LOAD_TARGETS[settings.terminalFont];
    term.options.fontFamily = fontFamily;
    term.options.fontSize = settings.terminalFontSize;
    const xtermTheme = getXtermTheme(settings.terminalTheme);
    term.options.theme = {
      ...xtermTheme,
      cursorAccent: xtermTheme.background,
      selectionBackground: `${xtermTheme.foreground}30`,
    };

    let cancelled = false;
    const fitTerminal = () => {
      if (cancelled || !mountedRef.current) return;

      // Force xterm to re-measure font metrics
      term.clearTextureAtlas();
      const fit = fitAddonRef.current;
      if (fit) {
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
        } catch { /* ignore */ }
      }
    };

    const timer = window.setTimeout(() => {
      requestAnimationFrame(fitTerminal);
    }, 120);

    if (fontLoadTarget && "fonts" in document) {
      void Promise.all([
        document.fonts.load(`${settings.terminalFontSize}px ${fontLoadTarget}`, "MW@#"),
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
  }, [settings.terminalFont, settings.terminalFontSize, settings.terminalTheme]);

  // Focus terminal when it becomes the active window
  useEffect(() => {
    if (isActive) termInstanceRef.current?.focus();
  }, [isActive]);

  // Re-fit when resized
  useEffect(() => {
    const fit = fitAddonRef.current;
    if (!fit) return;
    requestAnimationFrame(() => {
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
      } catch { /* ignore */ }
    });
  }, [win.width, win.height]);

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".window-close")) return;
      e.preventDefault();
      e.stopPropagation();
      onFocus(id);
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y };
      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        onUpdate(id, {
          x: dragRef.current.origX + (ev.clientX - dragRef.current.startX) / zoomRef.current,
          y: dragRef.current.origY + (ev.clientY - dragRef.current.startY) / zoomRef.current,
        });
      };
      const handleUp = () => {
        dragRef.current = null;
        dragListenersRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      dragListenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [id, win.x, win.y, zoomRef, onUpdate, onFocus],
  );

  const handleEdgeResize = useCallback(
    (e: React.MouseEvent, edge: ResizeEdge) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(id);
      const start = { x: e.clientX, y: e.clientY, w: win.width, h: win.height, wx: win.x, wy: win.y };
      const growsRight = edge.includes("e");
      const growsDown = edge.includes("s");
      const movesLeft = edge.includes("w");
      const movesTop = edge.includes("n");

      const handleMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - start.x) / zoomRef.current;
        const dy = (ev.clientY - start.y) / zoomRef.current;
        const updates: Partial<WindowUpdatable> = {};

        if (growsRight) {
          updates.width = Math.max(300, start.w + dx);
        }
        if (movesLeft) {
          const newW = Math.max(300, start.w - dx);
          updates.width = newW;
          updates.x = start.wx + (start.w - newW);
        }
        if (growsDown) {
          updates.height = Math.max(150, start.h + dy);
        }
        if (movesTop) {
          const newH = Math.max(150, start.h - dy);
          updates.height = newH;
          updates.y = start.wy + (start.h - newH);
        }

        onUpdate(id, updates);
      };
      const handleUp = () => {
        dragListenersRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        if (fitAddonRef.current && ptyIdRef.current) {
          const fit = fitAddonRef.current;
          requestAnimationFrame(() => {
            try {
              fit.fit();
              const dims = fit.proposeDimensions();
              if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
            } catch { /* renderer not ready */ }
          });
        }
      };
      dragListenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [id, win.x, win.y, win.width, win.height, zoomRef, onUpdate, onFocus],
  );

  const startRename = useCallback(() => {
    setRenameVal(win.title);
    // Delay so Radix context menu finishes closing and focus restore before we show the input
    requestAnimationFrame(() => setIsRenaming(true));
  }, [win.title]);

  const commitRename = useCallback(() => {
    if (renameVal.trim()) onRename(id, renameVal.trim());
    setIsRenaming(false);
  }, [id, renameVal, onRename]);

  const handleClose = useCallback(() => onClose(id), [id, onClose]);
  const handleFocus = useCallback(() => onFocus(id), [id, onFocus]);

  const terminalTheme = getXtermTheme(settings.terminalTheme);
  const chrome = useMemo(() => getChromeShades(terminalTheme.background), [terminalTheme.background]);
  const pendingMessage = shouldHydrate
    ? "Starting shell..."
    : "Queued for restore...";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="window"
          data-active={isActive}
          style={{
            left: win.x,
            top: win.y,
            width: win.width,
            height: win.height,
            zIndex: win.zIndex,
            "--term-bg": terminalTheme.background,
            "--term-titlebar": chrome.titlebar,
            "--term-border": chrome.border,
            "--ws-accent": wsColor,
          } as React.CSSProperties}
          onMouseDown={handleFocus}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="window-titlebar" onMouseDown={handleTitleMouseDown}>
            {isRenaming ? (
              <input
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setIsRenaming(false);
                }}
                onBlur={commitRename}
                onMouseDown={(e) => e.stopPropagation()}
                autoFocus
                aria-label="Rename terminal"
                className="window-title bg-transparent outline-none text-center w-full"
              />
            ) : (
              <span className="window-title">{win.title}</span>
            )}
            <button
              type="button"
              className="window-close"
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              aria-label="Close terminal"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="window-content" onMouseDown={() => termInstanceRef.current?.focus()}>
            <div ref={termRef} className="terminal-container" style={spawnError ? { pointerEvents: "none" } : undefined} />
            {!isSessionReady && !spawnError && !isPtyReady && (
              <div className="terminal-pending-overlay">
                <p className="terminal-error-text">{pendingMessage}</p>
              </div>
            )}
            {spawnError && (
              <div className="terminal-error-overlay">
                <p className="terminal-error-text">Session could not be restored</p>
                <button type="button" className="terminal-reopen-btn" onClick={handleReopen}>
                  Reopen terminal
                </button>
              </div>
            )}
          </div>

          {(["n","s","e","w","ne","nw","se","sw"] as const).map((edge) => (
            <div key={edge} className="resize-edge" data-edge={edge} onMouseDown={(e) => handleEdgeResize(e, edge)} />
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onClick={startRename}>
          <HugeiconsIcon icon={PencilEdit01Icon} data-icon="inline-start" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={handleClose}>
          <HugeiconsIcon icon={Delete01Icon} data-icon="inline-start" />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
