import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { NoteWindow as NoteWindowState, WindowUpdatable, ResizeEdge } from "@/types";

interface Props {
  id: string;
  window: NoteWindowState;
  isActive: boolean;
  zoomRef: React.RefObject<number>;
  wsColor?: string;
  onClose: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WindowUpdatable>) => void;
  onFocus: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onContentChange: (id: string, content: string) => void;
}

function formatDate(ts?: number): string {
  if (ts == null || ts < 0) return "\u2014";
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts));
}

/** Block javascript: URIs and open links externally. */
const SAFE_MD_COMPONENTS: Components = {
  a: ({ href, children }) => {
    const lower = href?.toLowerCase() ?? "";
    const isSafe = href && !lower.startsWith("javascript:") && !lower.startsWith("data:") && !lower.startsWith("vbscript:");
    return (
      <a
        href={isSafe ? href : undefined}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { if (!isSafe) e.preventDefault(); }}
      >
        {children}
      </a>
    );
  },
};

export default memo(function NoteWindow({ id, window: win, isActive, zoomRef, wsColor, onClose, onUpdate, onFocus, onRename, onContentChange }: Props) {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dragListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const content = win.content ?? "";
  const hasContent = content.length > 0;
  const accent = wsColor ?? "var(--muted-foreground)";

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".note-close")) return;
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
      const movesLeft = edge.includes("w");
      const movesTop = edge.includes("n");

      const handleMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - start.x) / zoomRef.current;
        const dy = (ev.clientY - start.y) / zoomRef.current;
        const updates: Partial<WindowUpdatable> = {};

        if (edge.includes("e")) updates.width = Math.max(180, start.w + dx);
        if (movesLeft) {
          const newW = Math.max(180, start.w - dx);
          updates.width = newW;
          updates.x = start.wx + (start.w - newW);
        }
        if (edge.includes("s")) updates.height = Math.max(100, start.h + dy);
        if (movesTop) {
          const newH = Math.max(100, start.h - dy);
          updates.height = newH;
          updates.y = start.wy + (start.h - newH);
        }
        onUpdate(id, updates);
      };
      const handleUp = () => {
        dragListenersRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
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

  const enterEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const exitEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  // Focus textarea after React commits the isEditing state change — cursor at end
  useEffect(() => {
    const ta = textareaRef.current;
    if (!isEditing || !ta) return;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }, [isEditing]);

  // Memoize markdown rendering — avoids re-parse when unrelated windows change
  const renderedMarkdown = useMemo(
    () => <Markdown components={SAFE_MD_COMPONENTS}>{content}</Markdown>,
    [content],
  );

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
            "--ws-accent": accent,
            "--term-bg": "var(--card)",
            "--term-titlebar": "var(--card)",
            "--term-border": "var(--border)",
          } as React.CSSProperties}

          onMouseDown={handleFocus}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {/* Titlebar */}
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
                aria-label="Rename note"
                className="window-title bg-transparent text-center w-full outline-none"
              />
            ) : (
              <span className="window-title">{win.title}</span>
            )}
            <button
              type="button"
              className="note-close window-close"
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              aria-label="Close note"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Metadata bar — badge + dates */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border/50 px-3 py-1.5">
            <span
              className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
              style={{ color: accent, background: `color-mix(in oklch, ${accent} 14%, transparent)` }}
            >
              Note
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              {formatDate(win.createdAt)}
            </span>
            {win.updatedAt && win.updatedAt !== win.createdAt && (
              <>
                <span className="text-muted-foreground/30">&middot;</span>
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  edited {formatDate(win.updatedAt)}
                </span>
              </>
            )}
          </div>

          {/* Content area — edit (textarea) or preview (markdown) */}
          <div className="window-content">
            {isEditing ? (
              <textarea
                ref={textareaRef}
                aria-label="Note content"
                className="note-editor"
                placeholder={"Type your notes here\u2026"}
                spellCheck={false}
                value={content}
                onChange={(e) => onContentChange(id, e.target.value)}
                onBlur={exitEdit}
                onMouseDown={(e) => { handleFocus(); e.stopPropagation(); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    exitEdit();
                  }
                }}
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                className="note-preview"
                onMouseDown={(e) => { handleFocus(); e.stopPropagation(); }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  enterEdit();
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") enterEdit(); }}
              >
                {hasContent ? (
                  renderedMarkdown
                ) : (
                  <p className="text-muted-foreground/50 italic">
                    Click to start writing{"\u2026"}
                  </p>
                )}
              </div>
            )}
          </div>

          {(["n","s","e","w","ne","nw","se","sw"] as const).map((edge) => (
            <div key={edge} className="resize-edge" data-edge={edge} onMouseDown={(e) => handleEdgeResize(e, edge)} />
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={startRename}>
          <HugeiconsIcon icon={PencilEdit01Icon} data-icon="inline-start" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" className="text-destructive! *:text-destructive!" onClick={handleClose}>
          <HugeiconsIcon icon={Delete01Icon} data-icon="inline-start" />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
