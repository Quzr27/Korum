import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Layers01Icon, Note01Icon, GridViewIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import TerminalWindow from "./TerminalWindow";
import NoteWindow from "./NoteWindow";
import CodeWindow from "./CodeWindow";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSettings } from "@/lib/settings-context";
import { selectLiveTerminalIds } from "@/lib/live-terminals";
import { isWindowInViewport } from "@/lib/viewport";
import type { WindowState, WindowUpdatable, Workspace, Point2D, PasteRequest, CodeViewMode } from "@/types";
import { WORKSPACE_COLORS } from "@/types";

const MINIMAP_W = 160;
const MINIMAP_H = 100;
const MINIMAP_PAD = 10;

interface CanvasProps {
  windows: WindowState[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWindowId: string | null;
  hydratedTerminalIds: ReadonlySet<string>;
  bootingTerminalIds: ReadonlySet<string>;
  pan: Point2D;
  zoom: number;
  onPanChange: (pan: Point2D) => void;
  onZoomChange: (zoom: number) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WindowUpdatable>) => void;
  onUpdateContent: (id: string, content: string) => void;
  onRename: (id: string, title: string) => void;
  onFocus: (id: string) => void;
  onTerminalHydrationSettled: (id: string) => void;
  onPtySpawned: (windowId: string, ptyId: string | null) => void;
  onTerminalSnapshotCaptured: (windowId: string, snapshot: string | null) => void;
  terminalSnapshots: Readonly<Record<string, string>>;
  onDoubleClick: () => void;
  onAddTerminal: () => void;
  onAddNote: () => void;
  onArrangeWindows: () => void;
  onCreateWorkspace: () => void;
  onPasteRequest: (request: PasteRequest) => void;
  onViewModeChange: (id: string, mode: CodeViewMode) => void;
}

export default memo(function Canvas({
  windows,
  workspaces,
  activeWorkspaceId,
  activeWindowId,
  hydratedTerminalIds,
  bootingTerminalIds,
  pan,
  zoom,
  onPanChange,
  onZoomChange,
  onRemove,
  onUpdate,
  onUpdateContent,
  onRename,
  onFocus,
  onTerminalHydrationSettled,
  onPtySpawned,
  onTerminalSnapshotCaptured,
  terminalSnapshots,
  onDoubleClick,
  onAddTerminal,
  onAddNote,
  onArrangeWindows,
  onCreateWorkspace,
  onPasteRequest,
  onViewModeChange,
}: CanvasProps) {
  const { settings } = useSettings();
  const [isPanning, setIsPanning] = useState(false);
  const [selectionNow, setSelectionNow] = useState(() => Date.now());
  const zoomCommitTimerRef = useRef<number | null>(null);
  const wsMap = useMemo(() => new Map(workspaces.map((ws) => [ws.id, ws])), [workspaces]);
  const visibleWindows = useMemo(
    () => windows.filter((w) => w.workspaceId === activeWorkspaceId),
    [windows, activeWorkspaceId],
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const motionRef = useRef(false);
  const liveTerminalKeepAliveRef = useRef<Record<string, number>>({});
  // Only mount windows near the viewport — off-viewport windows stay unmounted.
  // PTYs survive in Rust; code/note content re-loads on remount.
  // Active window is always rendered (user might be editing).
  const renderedWindows = useMemo(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const vpW = rect?.width ?? window.innerWidth;
    const vpH = rect?.height ?? window.innerHeight;
    return visibleWindows.filter((w) => {
      if (w.id === activeWindowId) return true;
      const buffer = w.type === "terminal" ? 600 : 800;
      return isWindowInViewport(w, pan, zoom, vpW, vpH, buffer);
    });
  }, [visibleWindows, pan, zoom, activeWindowId]);

  // Sync refs from React state (except during active motion)
  if (!motionRef.current) {
    panRef.current = pan;
    zoomRef.current = zoom;
  }

  const viewportRect = viewportRef.current?.getBoundingClientRect();
  const viewportWidth = viewportRect?.width ?? window.innerWidth;
  const viewportHeight = viewportRect?.height ?? window.innerHeight;
  const liveSelection = selectLiveTerminalIds({
    windows,
    activeWorkspaceId,
    activeWindowId,
    pan,
    zoom,
    viewportWidth,
    viewportHeight,
    keepAliveUntil: liveTerminalKeepAliveRef.current,
    now: selectionNow,
  });
  liveTerminalKeepAliveRef.current = liveSelection.keepAliveUntil;
  const nextKeepAliveExpiry = Object.values(liveSelection.keepAliveUntil).reduce<number>(
    (earliest, expiry) => (expiry > selectionNow && expiry < earliest ? expiry : earliest),
    Number.POSITIVE_INFINITY,
  );

  useEffect(() => {
    setSelectionNow(Date.now());
  }, [activeWorkspaceId, activeWindowId, pan.x, pan.y, windows, zoom]);

  useEffect(() => {
    if (!Number.isFinite(nextKeepAliveExpiry)) return;
    const delay = Math.max(0, nextKeepAliveExpiry - selectionNow);
    const timer = window.setTimeout(() => {
      setSelectionNow(nextKeepAliveExpiry);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [nextKeepAliveExpiry, selectionNow]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current) window.clearTimeout(zoomCommitTimerRef.current);
    };
  }, []);

  // Apply pan/zoom to DOM directly — bypasses React during motion
  const applyTransformToDOM = useCallback(() => {
    const p = panRef.current;
    const z = zoomRef.current;
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
    }
    if (dotsRef.current) {
      dotsRef.current.style.backgroundSize = `${24 * z}px ${24 * z}px`;
      dotsRef.current.style.backgroundPosition = `${p.x % (24 * z)}px ${p.y % (24 * z)}px`;
    }
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Only zoom on Ctrl/Cmd+scroll — no plain scroll panning (interferes with terminal scroll)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = viewportRef.current!.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const curPan = panRef.current;
        const curZoom = zoomRef.current;
        const worldX = (mouseX - curPan.x) / curZoom;
        const worldY = (mouseY - curPan.y) / curZoom;
        const baseFactor = e.deltaY > 0 ? 0.92 : 1.08;
        const factor = 1 + (baseFactor - 1) * settings.zoomSpeed;
        const nextZoom = Math.max(0.1, Math.min(5, curZoom * factor));

        // Update refs — source of truth during motion
        panRef.current = { x: mouseX - worldX * nextZoom, y: mouseY - worldY * nextZoom };
        zoomRef.current = nextZoom;

        // First wheel in burst: enter motion mode (freeze shouldAttach)
        if (!motionRef.current) {
          motionRef.current = true;
          viewportRef.current?.classList.add("zooming");
        }

        // Apply to DOM directly — zero React re-renders per wheel tick
        applyTransformToDOM();

        // Debounced commit to React state after wheel idle
        if (zoomCommitTimerRef.current) window.clearTimeout(zoomCommitTimerRef.current);
        zoomCommitTimerRef.current = window.setTimeout(() => {
          zoomCommitTimerRef.current = null;
          motionRef.current = false;
          viewportRef.current?.classList.remove("zooming");
          // Interruptible commit — React can abort if user starts scrolling again
          startTransition(() => {
            onPanChange(panRef.current);
            onZoomChange(zoomRef.current);
          });
        }, 150);
      }
    },
    [applyTransformToDOM, onPanChange, onZoomChange, settings.zoomSpeed],
  );

  // Native wheel listener — passive: false so e.preventDefault() works in WKWebView
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const isMiddle = e.button === 1;
      const isLeft = e.button === 0;

      if (!isMiddle && !isLeft) return;

      // Left-click: only pan if clicking canvas background, not a window
      if (isLeft && (e.target as HTMLElement).closest(".canvas-world > *")) return;

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPanX = panRef.current.x;
      const startPanY = panRef.current.y;

      // Left-click uses a drag threshold to not block double-click
      const DRAG_THRESHOLD = 4;
      let panStarted = isMiddle;

      const cancelAnimation = () => {
        // Remove smooth-pan animation class to prevent CSS transition during drag
        viewportRef.current?.querySelector(".canvas-world")?.classList.remove("animating");
      };

      if (panStarted) {
        motionRef.current = true;
        viewportRef.current?.classList.add("panning");
        cancelAnimation();
        setIsPanning(true);
      }

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!panStarted) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          panStarted = true;
          motionRef.current = true;
          viewportRef.current?.classList.add("panning");
          cancelAnimation();
          setIsPanning(true);
        }

        // Update ref + DOM directly — zero React re-renders per pixel
        panRef.current = {
          x: startPanX + dx,
          y: startPanY + dy,
        };
        applyTransformToDOM();
      };

      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        if (panStarted) {
          motionRef.current = false;
          viewportRef.current?.classList.remove("panning");
          setIsPanning(false);
          startTransition(() => {
            onPanChange(panRef.current);
          });
        }
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [applyTransformToDOM, onPanChange],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".canvas-world > *")) return;
      onDoubleClick();
    },
    [onDoubleClick],
  );

  const hasWorkspace = !!activeWorkspaceId;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <section
            ref={viewportRef}
            className={`canvas-viewport${isPanning ? " panning" : ""}`}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
          >
        {/* Canvas atmosphere */}
        <div className="canvas-bg" />

        {/* Dot grid */}
        <div
          ref={dotsRef}
          className="canvas-dots"
          style={{
            backgroundImage: `radial-gradient(circle, var(--canvas-grid-color) 0.8px, transparent 0.8px)`,
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x % (24 * zoom)}px ${pan.y % (24 * zoom)}px`,
          }}
        />

        {/* World */}
        <div
          ref={worldRef}
          className="canvas-world"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {renderedWindows.map((w) => {
            const ws = wsMap.get(w.workspaceId);
            const wsColor = ws ? WORKSPACE_COLORS[ws.color] : undefined;
            const shouldHydrate = hydratedTerminalIds.has(w.id) || bootingTerminalIds.has(w.id);
            const shouldAttach = liveSelection.liveTerminalIds.has(w.id);
            if (w.type === "terminal") {
              return (
                <TerminalWindow
                  key={w.id}
                  id={w.id}
                  window={w}
                  isActive={activeWindowId === w.id}
                  shouldHydrate={shouldHydrate}
                  shouldAttach={shouldAttach}
                  terminalSnapshot={terminalSnapshots[w.id]}
                  zoomRef={zoomRef}
                  wsColor={wsColor}
                  cwd={w.initialCwd ?? ws?.rootPath}
                  onClose={onRemove}
                  onHydrationSettled={onTerminalHydrationSettled}
                  onPtySpawned={onPtySpawned}
                  onSnapshotCaptured={onTerminalSnapshotCaptured}
                  onUpdate={onUpdate}
                  onFocus={onFocus}
                  onRename={onRename}
                  onPasteRequest={onPasteRequest}
                />
              );
            }
            if (w.type === "code") {
              return (
                <CodeWindow
                  key={w.id}
                  id={w.id}
                  window={w}
                  isActive={activeWindowId === w.id}
                  zoomRef={zoomRef}
                  wsColor={wsColor}
                  workspaceRoot={ws?.rootPath}
                  onClose={onRemove}
                  onUpdate={onUpdate}
                  onFocus={onFocus}
                  onRename={onRename}
                  onViewModeChange={onViewModeChange}
                />
              );
            }
            return (
              <NoteWindow
                key={w.id}
                id={w.id}
                window={w}
                isActive={activeWindowId === w.id}
                zoomRef={zoomRef}
                wsColor={wsColor}
                onClose={onRemove}
                onUpdate={onUpdate}
                onFocus={onFocus}
                onRename={onRename}
                onContentChange={onUpdateContent}
              />
            );
          })}
        </div>
      </section>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={!hasWorkspace} onClick={onAddTerminal}>
            <HugeiconsIcon icon={TerminalIcon} data-icon="inline-start" />
            New Terminal
          </ContextMenuItem>
          <ContextMenuItem disabled={!hasWorkspace} onClick={onAddNote}>
            <HugeiconsIcon icon={Note01Icon} data-icon="inline-start" />
            New Note
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!hasWorkspace} onClick={onArrangeWindows}>
            <HugeiconsIcon icon={GridViewIcon} data-icon="inline-start" />
            Arrange in Grid
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCreateWorkspace}>
            <HugeiconsIcon icon={Layers01Icon} data-icon="inline-start" />
            New Workspace
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Minimap — rendered outside viewport to avoid isolation: isolate stacking context */}
      <Minimap
        windows={visibleWindows}
        activeWindowId={activeWindowId}
        pan={pan}
        zoom={zoom}
        viewportRef={viewportRef}
        onNavigate={(worldX, worldY) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          onPanChange({
            x: rect.width / 2 - worldX * zoom,
            y: rect.height / 2 - worldY * zoom,
          });
        }}
      />
    </>
  );
});

// ── Minimap ──

interface MinimapProps {
  windows: WindowState[];
  activeWindowId: string | null;
  pan: Point2D;
  zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: (worldX: number, worldY: number) => void;
}

const Minimap = memo(function Minimap({ windows, activeWindowId, pan, zoom, viewportRef, onNavigate }: MinimapProps) {
  if (windows.length === 0) return null;

  // Compute world bounds from visible windows
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of windows) {
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x + w.width);
    maxY = Math.max(maxY, w.y + w.height);
  }

  // Add viewport bounds to the world extent
  const rect = viewportRef.current?.getBoundingClientRect();
  if (rect) {
    const vpLeft = -pan.x / zoom;
    const vpTop = -pan.y / zoom;
    const vpRight = vpLeft + rect.width / zoom;
    const vpBottom = vpTop + rect.height / zoom;
    minX = Math.min(minX, vpLeft);
    minY = Math.min(minY, vpTop);
    maxX = Math.max(maxX, vpRight);
    maxY = Math.max(maxY, vpBottom);
  }

  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const padded = MINIMAP_PAD;

  // Scale to fit minimap
  const scaleX = (MINIMAP_W - padded * 2) / worldW;
  const scaleY = (MINIMAP_H - padded * 2) / worldH;
  const scale = Math.min(scaleX, scaleY);

  const toMiniX = (wx: number) => padded + (wx - minX) * scale;
  const toMiniY = (wy: number) => padded + (wy - minY) * scale;

  // Viewport rect in minimap coords
  let vpRect = null;
  if (rect) {
    const vpLeft = -pan.x / zoom;
    const vpTop = -pan.y / zoom;
    vpRect = {
      x: toMiniX(vpLeft),
      y: toMiniY(vpTop),
      w: (rect.width / zoom) * scale,
      h: (rect.height / zoom) * scale,
    };
  }

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - svgRect.left;
    const my = e.clientY - svgRect.top;
    const worldX = minX + (mx - padded) / scale;
    const worldY = minY + (my - padded) / scale;
    onNavigate(worldX, worldY);
  };

  return (
    <svg
      width={MINIMAP_W}
      height={MINIMAP_H}
      className="glass-subtle fixed bottom-12 right-3 z-40 rounded-xl cursor-crosshair"
      onClick={handleClick}
    >
      {/* Window rectangles */}
      {windows.map((w) => (
        <rect
          key={w.id}
          x={toMiniX(w.x)}
          y={toMiniY(w.y)}
          width={w.width * scale}
          height={w.height * scale}
          rx={1}
          className={w.id === activeWindowId ? "fill-primary/40 stroke-primary" : "fill-muted-foreground/20 stroke-muted-foreground/30"}
          strokeWidth={0.5}
        />
      ))}

      {/* Viewport indicator */}
      {vpRect && (
        <rect
          x={vpRect.x}
          y={vpRect.y}
          width={vpRect.w}
          height={vpRect.h}
          rx={1}
          fill="none"
          className="stroke-foreground/30"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      )}
    </svg>
  );
});
