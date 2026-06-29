import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { advanceAttachSet, liveIdsSignature } from "@/lib/staggered-attach";
import { isWindowInViewport } from "@/lib/viewport";
import {
  buildTetherRenderIndex,
  getTetherEndpoints,
  TETHER_ARROW_MARKER_ID,
  type TetherRenderIndex,
  type TetherRect,
} from "@/lib/window-tethers";
import type { WindowMotionRect } from "@/lib/use-drag-resize";
import type { SnapTargetRect } from "@/lib/window-snapping";
import type { WindowState, WindowUpdatable, Workspace, Point2D, PasteRequest, CodeViewMode } from "@/types";
import { WORKSPACE_COLORS } from "@/types";

const MINIMAP_W = 160;
const MINIMAP_H = 100;
const MINIMAP_PAD = 10;
// One xterm attach per frame — a viewport teleport (sidebar click) can swap
// nearly the whole live set at once; attaching them all in one commit blocks
// the main thread for seconds. The active terminal always attaches first.
const ATTACH_BATCH_PER_FRAME = 1;

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
  onOpenTerminalFileLink: (workspaceId: string, originTerminalId: string, filePath: string, line: number, column?: number) => void;
  onViewModeChange: (id: string, mode: CodeViewMode) => void;
  onActivateDemoTerminal: (id: string) => void;
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
  onOpenTerminalFileLink,
  onViewModeChange,
  onActivateDemoTerminal,
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
  const tetherLayerRef = useRef<SVGSVGElement>(null);
  const tetherNodesRef = useRef<Map<string, SVGLineElement>>(new Map());
  const snapGuideLayerRef = useRef<HTMLDivElement>(null);
  const snapTargetsRef = useRef<readonly SnapTargetRect[]>([]);
  const snapTargetSignatureRef = useRef("");
  const tetherIndexRef = useRef<TetherRenderIndex<WindowState>>({
    windowsById: new Map(),
    pairs: [],
    pairKeys: new Set(),
    windowIds: new Set(),
  });
  const wsMapRef = useRef(wsMap);
  const liveWindowRectsRef = useRef<Map<string, WindowMotionRect>>(new Map());
  const viewportSizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const motionRef = useRef(false);
  const liveTerminalKeepAliveRef = useRef<Record<string, number>>({});
  // Only mount windows near the viewport — off-viewport windows stay unmounted.
  // PTYs survive in Rust; code/note content re-loads on remount.
  // Active window is always rendered (user might be editing).
  const renderedWindows = useMemo(() => {
    // Reuse the cached viewport size (maintained by the resize listener + layout
    // effect) instead of getBoundingClientRect() — avoids a forced layout read
    // on every Canvas render. Culling has a 600–800px buffer, so the rare
    // clientWidth/innerWidth drift before the first layout effect is harmless.
    const { width: vpW, height: vpH } = viewportSizeRef.current;
    return visibleWindows.filter((w) => {
      if (w.id === activeWindowId) return true;
      const buffer = w.type === "terminal" ? 600 : 800;
      return isWindowInViewport(w, pan, zoom, vpW, vpH, buffer);
    });
  }, [visibleWindows, pan, zoom, activeWindowId]);
  const snapTargetSignature = useMemo(
    () => visibleWindows.map(({ id, x, y, width, height }) => `${id}:${x}:${y}:${width}:${height}`).join("|"),
    [visibleWindows],
  );
  if (snapTargetSignatureRef.current !== snapTargetSignature) {
    snapTargetSignatureRef.current = snapTargetSignature;
    snapTargetsRef.current = visibleWindows.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
  }

  // Sync refs from React state (except during active motion)
  if (!motionRef.current) {
    panRef.current = pan;
    zoomRef.current = zoom;
  }
  wsMapRef.current = wsMap;

  const syncTetherLayer = useCallback(() => {
    const layer = tetherLayerRef.current;
    if (!layer) return;

    const tetherIndex = tetherIndexRef.current;
    const { width: viewportWidth, height: viewportHeight } = viewportSizeRef.current;
    const currentPan = panRef.current;
    const currentZoom = zoomRef.current;

    const getRect = (windowState: WindowState): TetherRect => (
      liveWindowRectsRef.current.get(windowState.id) ?? windowState
    );

    for (const pair of tetherIndex.pairs) {
      const origin = tetherIndex.windowsById.get(pair.originId);
      const target = tetherIndex.windowsById.get(pair.targetId);
      if (!origin || !target) continue;

      const originRect = getRect(origin);
      const targetRect = getRect(target);
      if (
        !isWindowInViewport(originRect, currentPan, currentZoom, viewportWidth, viewportHeight, 80) ||
        !isWindowInViewport(targetRect, currentPan, currentZoom, viewportWidth, viewportHeight, 80)
      ) {
        continue;
      }

      layer.style.setProperty("--tether-accent", pair.accent);
      let line = tetherNodesRef.current.get(pair.key);
      if (!line) {
        line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.classList.add("canvas-tether-line");
        line.dataset.tetherId = pair.key;
        line.setAttribute("marker-end", pair.markerEnd);
        layer.appendChild(line);
        tetherNodesRef.current.set(pair.key, line);
      }

      const endpoints = getTetherEndpoints(originRect, targetRect);
      line.setAttribute("x1", String(endpoints.x1));
      line.setAttribute("y1", String(endpoints.y1));
      line.setAttribute("x2", String(endpoints.x2));
      line.setAttribute("y2", String(endpoints.y2));
    }

    for (const [key, node] of tetherNodesRef.current) {
      if (tetherIndex.pairKeys.has(key)) continue;
      node.remove();
      tetherNodesRef.current.delete(key);
    }
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    viewportSizeRef.current = {
      width: viewport?.clientWidth ?? window.innerWidth,
      height: viewport?.clientHeight ?? window.innerHeight,
    };
    tetherIndexRef.current = buildTetherRenderIndex(visibleWindows, (workspaceId) => {
      const ws = wsMapRef.current.get(workspaceId);
      return ws ? WORKSPACE_COLORS[ws.color] : undefined;
    });
    syncTetherLayer();
  }, [visibleWindows, wsMap, syncTetherLayer]);

  useLayoutEffect(() => {
    syncTetherLayer();
  }, [pan.x, pan.y, zoom, syncTetherLayer]);

  useEffect(() => {
    const handleResize = () => {
      const viewport = viewportRef.current;
      viewportSizeRef.current = {
        width: viewport?.clientWidth ?? window.innerWidth,
        height: viewport?.clientHeight ?? window.innerHeight,
      };
      syncTetherLayer();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [syncTetherLayer]);

  useEffect(() => {
    const tetherNodes = tetherNodesRef.current;
    const liveWindowRects = liveWindowRectsRef.current;
    return () => {
      for (const node of tetherNodes.values()) node.remove();
      tetherNodes.clear();
      liveWindowRects.clear();
    };
  }, []);

  const handleLiveRectChange = useCallback((id: string, rect: WindowMotionRect | null) => {
    if (!tetherIndexRef.current.windowIds.has(id)) {
      liveWindowRectsRef.current.delete(id);
      return;
    }

    if (rect) {
      liveWindowRectsRef.current.set(id, rect);
    } else {
      liveWindowRectsRef.current.delete(id);
    }
    syncTetherLayer();
  }, [syncTetherLayer]);

  // Cached size (see renderedWindows) — no forced layout read per render.
  const { width: viewportWidth, height: viewportHeight } = viewportSizeRef.current;
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

  // Staggered attach: `attachedTerminalIds` trails the live selection so a
  // viewport teleport never attaches a dozen xterms in one commit. Detaches
  // apply on the first step; attaches land ATTACH_BATCH_PER_FRAME per frame,
  // active terminal first (see src/lib/staggered-attach.ts).
  const [attachedTerminalIds, setAttachedTerminalIds] = useState<ReadonlySet<string>>(() => new Set());
  const attachedTerminalIdsRef = useRef(attachedTerminalIds);
  const liveTargetRef = useRef(liveSelection.liveTerminalIds);
  liveTargetRef.current = liveSelection.liveTerminalIds;
  const activeWindowIdRef = useRef(activeWindowId);
  activeWindowIdRef.current = activeWindowId;
  const liveTerminalSignature = liveIdsSignature(liveSelection.liveTerminalIds);

  useEffect(() => {
    let raf: number | null = null;
    const step = () => {
      raf = null;
      const { next, done } = advanceAttachSet(
        attachedTerminalIdsRef.current,
        liveTargetRef.current,
        activeWindowIdRef.current,
        ATTACH_BATCH_PER_FRAME,
      );
      if (next !== attachedTerminalIdsRef.current) {
        attachedTerminalIdsRef.current = next;
        setAttachedTerminalIds(next);
      }
      if (!done) raf = requestAnimationFrame(step);
    };
    step();
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [liveTerminalSignature, activeWindowId]);

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
    snapGuideLayerRef.current?.style.setProperty("--snap-guide-inverse-zoom", String(1 / z));
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

  // Stable navigate callback for Minimap — reads zoom from ref so the callback
  // identity doesn't change when zoom updates, avoiding Minimap memo busts.
  const handleMinimapNavigate = useCallback(
    (worldX: number, worldY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const currentZoom = zoomRef.current;
      onPanChange({
        x: rect.width / 2 - worldX * currentZoom,
        y: rect.height / 2 - worldY * currentZoom,
      });
    },
    [onPanChange],
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
          <svg
            ref={tetherLayerRef}
            className="canvas-tethers"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={TETHER_ARROW_MARKER_ID}
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path className="canvas-tether-arrowhead" d="M 1 1 L 9 5 L 1 9 z" />
              </marker>
            </defs>
          </svg>
          <div
            ref={snapGuideLayerRef}
            className="canvas-snap-guides"
            aria-hidden="true"
            style={{ "--snap-guide-inverse-zoom": 1 / zoom } as React.CSSProperties}
          />
          {renderedWindows.map((w) => {
            const ws = wsMap.get(w.workspaceId);
            const wsColor = ws ? WORKSPACE_COLORS[ws.color] : undefined;
            const shouldHydrate = hydratedTerminalIds.has(w.id) || bootingTerminalIds.has(w.id);
            const shouldAttach = attachedTerminalIds.has(w.id);
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
                  snapTargetsRef={snapTargetsRef}
                  snapGuideLayerRef={snapGuideLayerRef}
                  wsColor={wsColor}
                  cwd={w.initialCwd ?? ws?.rootPath}
                  workspaceRoot={ws?.rootPath}
                  onClose={onRemove}
                  onHydrationSettled={onTerminalHydrationSettled}
                  onPtySpawned={onPtySpawned}
                  onSnapshotCaptured={onTerminalSnapshotCaptured}
                  onUpdate={onUpdate}
                  onFocus={onFocus}
                  onRename={onRename}
                  onPasteRequest={onPasteRequest}
                  onOpenFileLink={onOpenTerminalFileLink}
                  onActivateDemoTerminal={onActivateDemoTerminal}
                  onLiveRectChange={handleLiveRectChange}
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
                  zoom={zoom}
                  zoomRef={zoomRef}
                  snapTargetsRef={snapTargetsRef}
                  snapGuideLayerRef={snapGuideLayerRef}
                  wsColor={wsColor}
                  workspaceRoot={ws?.rootPath}
                  onClose={onRemove}
                  onUpdate={onUpdate}
                  onFocus={onFocus}
                  onRename={onRename}
                  onViewModeChange={onViewModeChange}
                  onLiveRectChange={handleLiveRectChange}
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
                snapTargetsRef={snapTargetsRef}
                snapGuideLayerRef={snapGuideLayerRef}
                wsColor={wsColor}
                onClose={onRemove}
                onUpdate={onUpdate}
                onFocus={onFocus}
                onRename={onRename}
                onContentChange={onUpdateContent}
                onLiveRectChange={handleLiveRectChange}
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
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
        onNavigate={handleMinimapNavigate}
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
  viewportWidth: number;
  viewportHeight: number;
  onNavigate: (worldX: number, worldY: number) => void;
}

const Minimap = memo(function Minimap({ windows, activeWindowId, pan, zoom, viewportWidth, viewportHeight, onNavigate }: MinimapProps) {
  if (windows.length === 0) return null;

  // Compute world bounds from visible windows
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of windows) {
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x + w.width);
    maxY = Math.max(maxY, w.y + w.height);
  }

  // Add viewport bounds to the world extent (cached size — no layout read)
  const vpLeft = -pan.x / zoom;
  const vpTop = -pan.y / zoom;
  minX = Math.min(minX, vpLeft);
  minY = Math.min(minY, vpTop);
  maxX = Math.max(maxX, vpLeft + viewportWidth / zoom);
  maxY = Math.max(maxY, vpTop + viewportHeight / zoom);

  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const padded = MINIMAP_PAD;

  // Scale to fit minimap (preserve world aspect ratio)
  const availW = MINIMAP_W - padded * 2;
  const availH = MINIMAP_H - padded * 2;
  const scale = Math.min(availW / worldW, availH / worldH);

  // Centre the scaled content so leftover space is balanced on both axes;
  // otherwise the map is anchored top-left and leaves a gap on the right/bottom.
  const offX = padded + (availW - worldW * scale) / 2;
  const offY = padded + (availH - worldH * scale) / 2;

  const toMiniX = (wx: number) => offX + (wx - minX) * scale;
  const toMiniY = (wy: number) => offY + (wy - minY) * scale;

  // Viewport rect in minimap coords
  const vpRect = {
    x: toMiniX(vpLeft),
    y: toMiniY(vpTop),
    w: (viewportWidth / zoom) * scale,
    h: (viewportHeight / zoom) * scale,
  };

  // Corner-bracket "viewfinder" path for the viewport lens — only when the
  // viewport is large enough that 4 brackets read cleanly (when zoomed in it
  // shrinks, so fall back to the plain bordered lens below).
  let vpBracketPath: string | null = null;
  if (vpRect && vpRect.w >= 24 && vpRect.h >= 18) {
    const { x, y, w, h } = vpRect;
    const L = Math.min(6, vpRect.w / 3, vpRect.h / 3);
    vpBracketPath =
      `M${x},${y + L} L${x},${y} L${x + L},${y}` +
      ` M${x + w - L},${y} L${x + w},${y} L${x + w},${y + L}` +
      ` M${x + w},${y + h - L} L${x + w},${y + h} L${x + w - L},${y + h}` +
      ` M${x + L},${y + h} L${x},${y + h} L${x},${y + h - L}`;
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const buttonRect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - buttonRect.left) / buttonRect.width) * MINIMAP_W;
    const my = ((e.clientY - buttonRect.top) / buttonRect.height) * MINIMAP_H;
    const worldX = minX + (mx - offX) / scale;
    const worldY = minY + (my - offY) / scale;
    onNavigate(worldX, worldY);
  };

  return (
    <button
      type="button"
      className="canvas-minimap glass-subtle fixed bottom-12 right-3 z-40 h-[100px] w-[160px] cursor-crosshair rounded-xl focus-visible:ring-2 focus-visible:ring-ring/35"
      onClick={handleClick}
      aria-label="Navigate canvas minimap"
    >
      <svg width={MINIMAP_W} height={MINIMAP_H} viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`} className="h-full w-full" aria-hidden="true">
        {/* Window rectangles */}
        {windows.map((w) => (
          <rect
            key={w.id}
            data-minimap-window-id={w.id}
            data-minimap-window-type={w.type}
            x={toMiniX(w.x)}
            y={toMiniY(w.y)}
            width={w.width * scale}
            height={w.height * scale}
            rx={2}
            className={w.id === activeWindowId ? "fill-primary/45 stroke-primary" : "fill-muted-foreground/25 stroke-muted-foreground/15"}
            strokeWidth={0.5}
          />
        ))}

        {/* Terminal agent status dots */}
        {windows.filter((w) => w.type === "terminal").map((w) => {
          const dotX = toMiniX(w.x + w.width / 2);
          const dotY = toMiniY(w.y + w.height / 2);
          const dotR = Math.max(2, Math.min(4.5, Math.min(w.width * scale, w.height * scale) * 0.16));
          return (
            <circle
              key={`${w.id}-agent-status`}
              data-minimap-status-dot-id={w.id}
              cx={dotX}
              cy={dotY}
              r={dotR}
              className="fill-muted-foreground/40 stroke-background/70"
              strokeWidth={0.75}
            />
          );
        })}

        {/* Viewport "lens" — a soft neutral region with a crisp frame and
            corner brackets (viewfinder). Neutral on purpose: the accent colour
            stays reserved for the active window. */}
        {vpRect && (
          <g className="pointer-events-none">
            <rect
              x={vpRect.x}
              y={vpRect.y}
              width={vpRect.w}
              height={vpRect.h}
              rx={2.5}
              className="fill-foreground/5 stroke-foreground/30"
              strokeWidth={1}
            />
            {vpBracketPath && (
              <path
                d={vpBracketPath}
                fill="none"
                className="stroke-foreground/60"
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
        )}
      </svg>
    </button>
  );
});
