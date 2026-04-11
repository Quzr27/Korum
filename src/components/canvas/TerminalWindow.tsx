import { memo, useEffect, useRef, useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "@/lib/settings-context";
import { getXtermTheme } from "@/lib/settings";
import { useXtermSession } from "@/lib/xterm-session";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDragResize } from "@/lib/use-drag-resize";
import type { TerminalWindow as TerminalWindowState, WindowUpdatable, PasteRequest } from "@/types";

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

const RESIZE_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

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
  onPasteRequest: (request: PasteRequest) => void;
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
  onPasteRequest,
}: Props) {
  const { settings } = useSettings();
  const { windowRef, handleTitleMouseDown, handleEdgeResize } = useDragResize({
    id, x: win.x, y: win.y, width: win.width, height: win.height,
    zoomRef, onUpdate, onFocus, minWidth: 240, minHeight: 120,
  });
  const termRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string | null>(null);
  const pendingDisposeRef = useRef<{ term: Terminal; timer: number } | null>(null);
  const mountedRef = useRef(false);
  const mountVersionRef = useRef(0);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [isPtyReady, setIsPtyReady] = useState(false);
  const [respawnTrigger, setRespawnTrigger] = useState(0);
  const hydrationSettledRef = useRef(false);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

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

  // ── xterm session (Effect B + settings/focus/resize effects) ──
  const { termInstanceRef, isSessionReady } = useXtermSession({
    id,
    isPtyReady,
    shouldAttach,
    terminalSnapshot,
    terminalFont: settings.terminalFont,
    terminalFontSize: settings.terminalFontSize,
    terminalTheme: settings.terminalTheme,
    zoomRef,
    ptyIdRef,
    mountedRef,
    termRef,
    pendingDisposeRef,
    windowWidth: win.width,
    windowHeight: win.height,
    isActive,
    flushPendingDispose,
    onSnapshotCaptured,
    onPasteRequest,
    onSpawnError: setSpawnError,
  });

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
          ref={windowRef}
          className="window"
          data-window-id={id}
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

          {RESIZE_EDGES.map((edge) => (
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
