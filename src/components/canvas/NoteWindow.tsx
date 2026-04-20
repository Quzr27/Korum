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
import { useDragResize } from "@/lib/use-drag-resize";
import type { NoteWindow as NoteWindowState, WindowUpdatable } from "@/types";

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
  const { windowRef, handleTitleMouseDown, handleEdgeResize } = useDragResize({
    id, x: win.x, y: win.y, width: win.width, height: win.height,
    zoomRef, onUpdate, onFocus,
  });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Local content state — avoids per-keystroke App re-render cascade.
  // Synced to App state via debounced onContentChange.
  const [localContent, setLocalContent] = useState(win.content ?? "");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of localContent for reading in cleanup without stale closure
  const localContentRef = useRef(localContent);
  localContentRef.current = localContent;

  // Reset local state when App state changes externally.
  // Uses useEffect (not if-during-render) to avoid concurrent mode race conditions.
  // App reflects localContent verbatim — no transformation — so the reset is a no-op
  // after our own debounced sync fires (win.content === what we just sent).
  useEffect(() => {
    setLocalContent(win.content ?? "");
  }, [win.content]);

  // Debounced sync to App state (300ms) — prevents full-tree re-render on every keystroke
  const syncToApp = useCallback((value: string) => {
    if (syncTimerRef.current != null) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      onContentChange(id, value);
    }, 300);
  }, [id, onContentChange]);

  // Flush pending sync on unmount — prevents data loss when window is culled mid-edit
  useEffect(() => {
    return () => {
      if (syncTimerRef.current != null) {
        clearTimeout(syncTimerRef.current);
        onContentChange(id, localContentRef.current);
      }
    };
    // onContentChange + id are stable (useCallback in App). localContentRef is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onContentChange]);

  const hasContent = localContent.length > 0;
  const accent = wsColor ?? "var(--muted-foreground)";
  const sourcePathLabel = win.sourcePath?.replace(/^\/Users\/[^/]+/, "~");

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
    () => <Markdown components={SAFE_MD_COMPONENTS}>{localContent}</Markdown>,
    [localContent],
  );

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
          <div className="flex min-w-0 shrink-0 items-center gap-2.5 border-b border-border/50 px-3 py-1.5">
            <span
              className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
              style={{ color: accent, background: `color-mix(in oklch, ${accent} 14%, transparent)` }}
            >
              {win.sourcePath ? "File" : "Note"}
            </span>
            {sourcePathLabel && (
              <span
                className="min-w-0 truncate text-[10px] text-muted-foreground/45"
                title={sourcePathLabel}
                translate="no"
              >
                {sourcePathLabel}
              </span>
            )}
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
                value={localContent}
                onChange={(e) => {
                  setLocalContent(e.target.value);
                  syncToApp(e.target.value);
                }}
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
