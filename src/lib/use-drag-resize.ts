import { useCallback, useEffect, useRef } from "react";
import type { WindowUpdatable, ResizeEdge } from "@/types";
import {
  snapDraggedWindow,
  WINDOW_SNAP_THRESHOLD,
  type SnapGuide,
  type SnapTargetRect,
} from "@/lib/window-snapping";

interface UseDragResizeOptions {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zoomRef: React.RefObject<number>;
  onUpdate: (id: string, updates: Partial<WindowUpdatable>) => void;
  onFocus: (id: string) => void;
  minWidth?: number;
  minHeight?: number;
  snapTargetsRef?: React.RefObject<readonly SnapTargetRect[]>;
  snapGuideLayerRef?: React.RefObject<HTMLDivElement | null>;
  onLiveRectChange?: (id: string, rect: WindowMotionRect | null) => void;
}

export interface WindowMotionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  mode: "drag" | "resize";
  edge?: ResizeEdge;
}

/**
 * Ref-based drag & resize for canvas windows.
 *
 * **Drag:** uses GPU-accelerated `transform: translate()` during motion
 * (no layout/paint on siblings). On mouseup, clears transform and commits
 * final left/top to React state (single re-render).
 *
 * **Resize:** mutates style.width/height directly (layout confined by
 * `contain: layout paint` on .window). Commits on mouseup.
 */
export function useDragResize({
  id,
  x,
  y,
  width,
  height,
  zoomRef,
  onUpdate,
  onFocus,
  minWidth = 180,
  minHeight = 100,
  snapTargetsRef,
  snapGuideLayerRef,
  onLiveRectChange,
}: UseDragResizeOptions) {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);
  const guideNodesRef = useRef<HTMLDivElement[]>([]);

  // Keep latest values in refs so document listeners always see fresh values
  const stateRef = useRef({ x, y, width, height });
  stateRef.current = { x, y, width, height };
  const emptySnapTargetsRef = useRef<readonly SnapTargetRect[]>([]);
  const activeSnapTargetsRef = snapTargetsRef ?? emptySnapTargetsRef;

  const clearSnapGuides = useCallback(() => {
    for (const node of guideNodesRef.current) node.remove();
    guideNodesRef.current = [];
  }, []);

  const renderSnapGuides = useCallback((guides: readonly SnapGuide[]) => {
    const layer = snapGuideLayerRef?.current;
    if (!layer || guides.length === 0) {
      clearSnapGuides();
      return;
    }

    const nodes = guideNodesRef.current;
    while (nodes.length < guides.length) {
      const node = document.createElement("div");
      node.className = "canvas-snap-guide";
      layer.appendChild(node);
      nodes.push(node);
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const guide = guides[i];
      if (!guide) {
        node.classList.remove("is-visible");
        continue;
      }

      const length = Math.max(1, guide.end - guide.start);
      node.dataset.axis = guide.axis;
      if (guide.axis === "x") {
        node.style.left = `${guide.position}px`;
        node.style.top = `${guide.start}px`;
        node.style.width = "0px";
        node.style.height = `${length}px`;
      } else {
        node.style.left = `${guide.start}px`;
        node.style.top = `${guide.position}px`;
        node.style.width = `${length}px`;
        node.style.height = "0px";
      }
      node.classList.add("is-visible");
    }
  }, [clearSnapGuides, snapGuideLayerRef]);

  // Clean up on unmount (close mid-drag)
  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        document.removeEventListener("mousemove", listenersRef.current.move);
        document.removeEventListener("mouseup", listenersRef.current.up);
        listenersRef.current = null;
      }
      clearSnapGuides();
      onLiveRectChange?.(id, null);
    };
  }, [clearSnapGuides, id, onLiveRectChange]);

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".window-close")) return;
      e.preventDefault();
      e.stopPropagation();
      onFocus(id);

      const el = windowRef.current;
      if (!el) return;

      const s = stateRef.current;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: s.x,
        origY: s.y,
        origW: s.width,
        origH: s.height,
        mode: "drag",
      };

      // Remove smooth-pan animation to prevent CSS transition during drag
      document.querySelector(".canvas-world")?.classList.remove("animating");

      const getDragPosition = (d: DragState, ev: MouseEvent) => {
        const zoom = zoomRef.current;
        const dx = (ev.clientX - d.startX) / zoom;
        const dy = (ev.clientY - d.startY) / zoom;
        if (dx === 0 && dy === 0) {
          return { x: d.origX, y: d.origY, rawDx: dx, rawDy: dy, guides: [] };
        }
        const snapped = snapDraggedWindow(
          { id, x: d.origX + dx, y: d.origY + dy, width: d.origW, height: d.origH },
          activeSnapTargetsRef.current,
          WINDOW_SNAP_THRESHOLD / zoom,
        );
        return { ...snapped, rawDx: dx, rawDy: dy };
      };

      // Use GPU-accelerated transform during drag (no layout thrash)
      const handleMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const next = getDragPosition(d, ev);
        el.style.transform = `translate(${next.x - d.origX}px, ${next.y - d.origY}px)`;
        onLiveRectChange?.(id, { x: next.x, y: next.y, width: d.origW, height: d.origH });
        renderSnapGuides(next.guides);
      };

      const handleUp = (ev: MouseEvent) => {
        const d = dragRef.current;
        dragRef.current = null;
        listenersRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);

        if (!d) return;
        // Clear transform and commit final position
        const next = getDragPosition(d, ev);
        clearSnapGuides();
        el.style.transform = "";
        const finalX = next.x;
        const finalY = next.y;
        if (next.rawDx !== 0 || next.rawDy !== 0) {
          onLiveRectChange?.(id, { x: finalX, y: finalY, width: d.origW, height: d.origH });
          onUpdate(id, { x: finalX, y: finalY });
          requestAnimationFrame(() => onLiveRectChange?.(id, null));
        } else {
          onLiveRectChange?.(id, null);
        }
      };

      listenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [id, zoomRef, onUpdate, onFocus, renderSnapGuides, clearSnapGuides, activeSnapTargetsRef, onLiveRectChange],
  );

  const handleEdgeResize = useCallback(
    (e: React.MouseEvent, edge: ResizeEdge) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(id);

      const el = windowRef.current;
      if (!el) return;

      const s = stateRef.current;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: s.x,
        origY: s.y,
        origW: s.width,
        origH: s.height,
        mode: "resize",
        edge,
      };

      const movesLeft = edge.includes("w");
      const movesTop = edge.includes("n");

      const handleMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = (ev.clientX - d.startX) / zoomRef.current;
        const dy = (ev.clientY - d.startY) / zoomRef.current;

        let newW = d.origW;
        let newH = d.origH;
        let newX = d.origX;
        let newY = d.origY;

        if (edge.includes("e")) newW = Math.max(minWidth, d.origW + dx);
        if (movesLeft) {
          newW = Math.max(minWidth, d.origW - dx);
          newX = d.origX + (d.origW - newW);
        }
        if (edge.includes("s")) newH = Math.max(minHeight, d.origH + dy);
        if (movesTop) {
          newH = Math.max(minHeight, d.origH - dy);
          newY = d.origY + (d.origH - newH);
        }

        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
        onLiveRectChange?.(id, { x: newX, y: newY, width: newW, height: newH });
      };

      const handleUp = () => {
        const d = dragRef.current;
        dragRef.current = null;
        listenersRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);

        if (!d) return;
        const parsedX = parseFloat(el.style.left);
        const parsedY = parseFloat(el.style.top);
        const parsedW = parseFloat(el.style.width);
        const parsedH = parseFloat(el.style.height);
        const finalX = Number.isNaN(parsedX) ? d.origX : parsedX;
        const finalY = Number.isNaN(parsedY) ? d.origY : parsedY;
        const finalW = Number.isNaN(parsedW) ? d.origW : parsedW;
        const finalH = Number.isNaN(parsedH) ? d.origH : parsedH;

        const updates: Partial<WindowUpdatable> = {};
        if (finalX !== d.origX) updates.x = finalX;
        if (finalY !== d.origY) updates.y = finalY;
        if (finalW !== d.origW) updates.width = finalW;
        if (finalH !== d.origH) updates.height = finalH;

        if (Object.keys(updates).length > 0) {
          onLiveRectChange?.(id, { x: finalX, y: finalY, width: finalW, height: finalH });
          onUpdate(id, updates);
          requestAnimationFrame(() => onLiveRectChange?.(id, null));
        } else {
          onLiveRectChange?.(id, null);
        }
      };

      listenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [id, zoomRef, onUpdate, onFocus, minWidth, minHeight, onLiveRectChange],
  );

  return { windowRef, handleTitleMouseDown, handleEdgeResize };
}
