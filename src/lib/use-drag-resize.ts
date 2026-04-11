import { useCallback, useEffect, useRef } from "react";
import type { WindowUpdatable, ResizeEdge } from "@/types";

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
}: UseDragResizeOptions) {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    mode: "drag" | "resize";
    edge?: ResizeEdge;
  } | null>(null);
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);

  // Keep latest values in refs so document listeners always see fresh values
  const stateRef = useRef({ x, y, width, height });
  stateRef.current = { x, y, width, height };

  // Clean up on unmount (close mid-drag)
  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        document.removeEventListener("mousemove", listenersRef.current.move);
        document.removeEventListener("mouseup", listenersRef.current.up);
        listenersRef.current = null;
      }
    };
  }, []);

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

      // Use GPU-accelerated transform during drag (no layout thrash)
      const handleMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = (ev.clientX - d.startX) / zoomRef.current;
        const dy = (ev.clientY - d.startY) / zoomRef.current;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      };

      const handleUp = (ev: MouseEvent) => {
        const d = dragRef.current;
        dragRef.current = null;
        listenersRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);

        if (!d) return;
        // Clear transform and commit final position
        el.style.transform = "";
        const dx = (ev.clientX - d.startX) / zoomRef.current;
        const dy = (ev.clientY - d.startY) / zoomRef.current;
        const finalX = d.origX + dx;
        const finalY = d.origY + dy;
        if (dx !== 0 || dy !== 0) {
          onUpdate(id, { x: finalX, y: finalY });
        }
      };

      listenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [id, zoomRef, onUpdate, onFocus],
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
          onUpdate(id, updates);
        }
      };

      listenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [id, zoomRef, onUpdate, onFocus, minWidth, minHeight],
  );

  return { windowRef, handleTitleMouseDown, handleEdgeResize };
}
