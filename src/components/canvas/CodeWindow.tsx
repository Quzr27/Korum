import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettings } from "@/lib/settings-context";
import { CODE_THEMES, CODE_THEME_LABELS, CODE_THEME_BG } from "@/lib/settings/types";
import { tokenizeCode } from "@/lib/shiki";
import { detectLanguage } from "@/lib/lang-detect";
import { useDragResize } from "@/lib/use-drag-resize";
import type { CodeWindow as CodeWindowState, CodeViewMode, DiffLine, WindowUpdatable } from "@/types";
import type { ThemedToken } from "shiki";

interface MinimapRow {
  tokens: ThemedToken[] | null;
  text: string;
  type: "normal" | "add" | "delete";
}

interface Props {
  id: string;
  window: CodeWindowState;
  isActive: boolean;
  zoomRef: React.RefObject<number>;
  wsColor?: string;
  workspaceRoot?: string;
  onClose: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WindowUpdatable>) => void;
  onFocus: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onViewModeChange: (id: string, mode: CodeViewMode) => void;
}

export default memo(function CodeWindow({
  id,
  window: win,
  isActive,
  zoomRef,
  wsColor,
  workspaceRoot,
  onClose,
  onUpdate,
  onFocus,
  onRename,
  onViewModeChange,
}: Props) {
  const { settings, update: updateSettings } = useSettings();
  const codeTheme = settings.codeTheme;
  const themeBg = CODE_THEME_BG[codeTheme] ?? "#24292e";
  const { windowRef, handleTitleMouseDown, handleEdgeResize } = useDragResize({
    id, x: win.x, y: win.y, width: win.width, height: win.height,
    zoomRef, onUpdate, onFocus, minWidth: 240, minHeight: 120,
  });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  // Content state — loaded from disk, not persisted
  const [content, setContent] = useState<string | null>(null);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const accent = wsColor ?? "var(--muted-foreground)";
  const sourcePathLabel = win.sourcePath.replace(/^\/Users\/[^/]+/, "~");
  const lang = useMemo(() => detectLanguage(win.sourcePath), [win.sourcePath]);

  // Load file content from disk
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    requestIdRef.current += 1;
    const thisRequest = requestIdRef.current;

    invoke<string>("read_code_file_content", { path: win.sourcePath })
      .then((text) => {
        if (!cancelled && requestIdRef.current === thisRequest) setContent(text);
      })
      .catch((err) => {
        if (!cancelled && requestIdRef.current === thisRequest) setError(String(err));
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === thisRequest) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [win.sourcePath]);

  // Tokenize content with Shiki.
  // Debounce only content changes (rapid file-tree-changed events); theme/lang
  // changes apply immediately so the dropdown feels instant.
  const prevContentRef = useRef(content);
  useEffect(() => {
    if (content == null) return;
    let cancelled = false;
    const contentChanged = prevContentRef.current !== content;
    prevContentRef.current = content;

    const run = () => {
      tokenizeCode(content, lang, codeTheme).then((result) => {
        if (!cancelled) setTokens(result);
      });
    };

    if (contentChanged) {
      const timer = setTimeout(run, 150);
      return () => { cancelled = true; clearTimeout(timer); };
    }

    run();
    return () => { cancelled = true; };
  }, [content, lang, codeTheme]);

  // Load diff annotations when in changes mode
  useEffect(() => {
    if (win.viewMode !== "changes" || !workspaceRoot) {
      setDiffLines(null);
      return;
    }

    let cancelled = false;

    invoke<DiffLine[]>("get_file_diff", { path: win.sourcePath, root: workspaceRoot })
      .then((lines) => { if (!cancelled) setDiffLines(lines); })
      .catch(() => { if (!cancelled) setDiffLines(null); });

    return () => { cancelled = true; };
  }, [win.sourcePath, win.viewMode, workspaceRoot]);

  // Re-read on file change (synchronous unlisten ref pattern)
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<string>("file-tree-changed", (event) => {
      if (cancelled) return;
      // Only react to changes in our workspace root (avoid cross-workspace reloads)
      if (workspaceRoot && event.payload !== workspaceRoot) return;
      requestIdRef.current += 1;
      const thisRequest = requestIdRef.current;
      invoke<string>("read_code_file_content", { path: win.sourcePath })
        .then((text) => { if (!cancelled && requestIdRef.current === thisRequest) setContent(text); })
        .catch(() => {/* file may have been deleted */});

      if (win.viewMode === "changes" && workspaceRoot) {
        invoke<DiffLine[]>("get_file_diff", { path: win.sourcePath, root: workspaceRoot })
          .then((lines) => { if (!cancelled && requestIdRef.current === thisRequest) setDiffLines(lines); })
          .catch(() => { if (!cancelled && requestIdRef.current === thisRequest) setDiffLines(null); });
      }
    }).then((fn) => {
      if (cancelled) fn(); // already unmounted — clean up immediately
      else unlistenFn = fn;
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [win.sourcePath, win.viewMode, workspaceRoot]);

  const startRename = useCallback(() => {
    setRenameVal(win.title);
    requestAnimationFrame(() => setIsRenaming(true));
  }, [win.title]);

  const commitRename = useCallback(() => {
    if (renameVal.trim()) onRename(id, renameVal.trim());
    setIsRenaming(false);
  }, [id, renameVal, onRename]);

  const handleClose = useCallback(() => onClose(id), [id, onClose]);
  const handleFocus = useCallback(() => onFocus(id), [id, onFocus]);

  // ── Scroll + minimap refs ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRafRef = useRef(0);

  // ── Rendered content (rows only) ──
  const fileRows = useMemo(() => {
    if (tokens == null) return null;
    return tokens.map((lineTokens, i) => (
      <tr key={i} className="code-line">
        <td className="code-gutter">{i + 1}</td>
        <td className="code-cell">
          {lineTokens.map((token, j) => (
            <span key={j} style={{ color: token.color }}>{token.content}</span>
          ))}
          {lineTokens.length === 0 && "\u00a0"}
        </td>
      </tr>
    ));
  }, [tokens]);

  // Build diff annotation maps from diff lines
  const diffAnnotations = useMemo(() => {
    if (!diffLines) return null;

    const addedLines = new Set<number>(); // new_lineno values that are additions
    const deletedBefore = new Map<number, DiffLine[]>(); // deleted lines to insert before this new_lineno
    let pendingDeletes: DiffLine[] = [];

    for (const line of diffLines) {
      if (line.origin === "delete") {
        pendingDeletes.push(line);
      } else {
        if (pendingDeletes.length > 0 && line.new_lineno != null) {
          deletedBefore.set(line.new_lineno, [...pendingDeletes]);
          pendingDeletes = [];
        }
        if (line.origin === "add" && line.new_lineno != null) {
          addedLines.add(line.new_lineno);
        }
      }
    }
    // Remaining deletes go after the last line
    const trailingDeletes = pendingDeletes.length > 0 ? pendingDeletes : null;

    return { addedLines, deletedBefore, trailingDeletes };
  }, [diffLines]);

  const changesRows = useMemo(() => {
    if (tokens == null || diffAnnotations == null) return null;
    const { addedLines, deletedBefore, trailingDeletes } = diffAnnotations;

    if (addedLines.size === 0 && deletedBefore.size === 0 && !trailingDeletes) return "empty";

    const rows: React.ReactNode[] = [];
    let key = 0;

    for (let i = 0; i < tokens.length; i++) {
      const lineNum = i + 1;

      const deletes = deletedBefore.get(lineNum);
      if (deletes) {
        for (const del of deletes) {
          rows.push(
            <tr key={key++} className="code-line diff-delete">
              <td className="code-gutter diff-gutter-old">{del.old_lineno ?? ""}</td>
              <td className="code-gutter diff-gutter-new" />
              <td className="code-cell">{del.content || "\u00a0"}</td>
            </tr>,
          );
        }
      }

      const isAdded = addedLines.has(lineNum);
      const lineTokens = tokens[i];
      rows.push(
        <tr key={key++} className={`code-line ${isAdded ? "diff-add" : ""}`}>
          <td className="code-gutter diff-gutter-old">{isAdded ? "" : lineNum}</td>
          <td className="code-gutter diff-gutter-new">{lineNum}</td>
          <td className="code-cell">
            {lineTokens.map((token, j) => (
              <span key={j} style={{ color: token.color }}>{token.content}</span>
            ))}
            {lineTokens.length === 0 && "\u00a0"}
          </td>
        </tr>,
      );
    }

    if (trailingDeletes) {
      for (const del of trailingDeletes) {
        rows.push(
          <tr key={key++} className="code-line diff-delete">
            <td className="code-gutter diff-gutter-old">{del.old_lineno ?? ""}</td>
            <td className="code-gutter diff-gutter-new" />
            <td className="code-cell">{del.content || "\u00a0"}</td>
          </tr>,
        );
      }
    }

    return rows;
  }, [tokens, diffAnnotations]);

  // ── Minimap: build row metadata for canvas drawing ──
  const minimapRows = useMemo((): MinimapRow[] | null => {
    if (!tokens) return null;

    if (win.viewMode === "file" || !diffAnnotations) {
      return tokens.map((t) => ({ tokens: t, text: "", type: "normal" }));
    }

    const { addedLines, deletedBefore, trailingDeletes } = diffAnnotations;
    const rows: MinimapRow[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const lineNum = i + 1;
      const deletes = deletedBefore.get(lineNum);
      if (deletes) {
        for (const del of deletes) {
          rows.push({ tokens: null, text: del.content, type: "delete" });
        }
      }
      rows.push({
        tokens: tokens[i],
        text: "",
        type: addedLines.has(lineNum) ? "add" : "normal",
      });
    }
    if (trailingDeletes) {
      for (const del of trailingDeletes) {
        rows.push({ tokens: null, text: del.content, type: "delete" });
      }
    }
    return rows;
  }, [tokens, win.viewMode, diffAnnotations]);

  // ── Minimap: draw content layer (redrawn when tokens/diff change) ──
  useLayoutEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || !minimapRows) return;

    const dpr = window.devicePixelRatio || 1;
    const MINIMAP_W = 60;
    const LINE_H = 2;
    const CHAR_W = 1.2;
    const MAX_CANVAS_H = 8000; // WebKit caps canvas textures at ~32K px
    const rawH = minimapRows.length * LINE_H;
    const canvasH = Math.min(rawH, MAX_CANVAS_H);
    const scale = canvasH / rawH || 1; // compress rows when capped

    canvas.width = MINIMAP_W * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${MINIMAP_W}px`;
    canvas.style.height = `${canvasH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, MINIMAP_W, canvasH);

    const scaledLineH = LINE_H * scale;
    for (let r = 0; r < minimapRows.length; r++) {
      const row = minimapRows[r];
      const y = r * scaledLineH;

      // Diff background tint
      if (row.type === "add") {
        ctx.fillStyle = "rgba(46, 160, 67, 0.22)";
        ctx.fillRect(0, y, MINIMAP_W, scaledLineH);
      } else if (row.type === "delete") {
        ctx.fillStyle = "rgba(248, 81, 73, 0.22)";
        ctx.fillRect(0, y, MINIMAP_W, scaledLineH);
      }

      // Draw token blocks
      if (row.tokens) {
        let x = 2;
        for (const token of row.tokens) {
          const w = token.content.length * CHAR_W;
          if (token.content.trim()) {
            ctx.fillStyle = token.color ?? "#8b949e";
            ctx.globalAlpha = 0.8;
            ctx.fillRect(x, y + 0.25 * scale, Math.min(w, MINIMAP_W - x - 2), scaledLineH - 0.5 * scale);
            ctx.globalAlpha = 1;
          }
          x += w;
          if (x >= MINIMAP_W - 2) break;
        }
      } else if (row.text) {
        // Deleted line — draw muted text hint
        const w = Math.min(row.text.length * CHAR_W, MINIMAP_W - 4);
        ctx.fillStyle = "rgba(248, 81, 73, 0.4)";
        ctx.fillRect(2, y + 0.25 * scale, w, scaledLineH - 0.5 * scale);
      }
    }
  }, [minimapRows]);

  // ── Minimap: viewport indicator (updated on scroll) ──
  const updateMinimapViewport = useCallback(() => {
    const scroller = scrollRef.current;
    const canvas = minimapCanvasRef.current;
    if (!scroller || !canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    // Find or create the viewport indicator overlay
    let indicator = parent.querySelector<HTMLDivElement>(".code-minimap-viewport");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "code-minimap-viewport";
      parent.appendChild(indicator);
    }

    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const canvasDisplayH = canvas.clientHeight;
    const ratio = canvasDisplayH / scrollHeight;

    indicator.style.top = `${scrollTop * ratio}px`;
    indicator.style.height = `${Math.max(clientHeight * ratio, 8)}px`;
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onScroll = () => {
      cancelAnimationFrame(viewportRafRef.current);
      viewportRafRef.current = requestAnimationFrame(updateMinimapViewport);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // Initial draw
    updateMinimapViewport();

    const canvasEl = minimapCanvasRef.current;
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(viewportRafRef.current);
      // Clean up imperatively created viewport indicator
      const indicator = canvasEl?.parentElement?.querySelector(".code-minimap-viewport");
      indicator?.remove();
    };
  }, [updateMinimapViewport, minimapRows]);

  // ── Minimap: click to navigate ──
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const scroller = scrollRef.current;
    const canvas = minimapCanvasRef.current;
    if (!scroller || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const ratio = clickY / canvas.clientHeight;
    const targetScroll = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
    scroller.scrollTop = Math.max(0, targetScroll);
  }, []);

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
                aria-label="Rename code viewer"
                className="window-title bg-transparent text-center w-full outline-none"
              />
            ) : (
              <span className="window-title">{win.title}</span>
            )}
            <button
              type="button"
              className="window-close"
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              aria-label="Close code viewer"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Metadata bar */}
          <div className="flex shrink-0 items-center justify-between gap-2 h-7 bg-card px-2 border-b border-border/50">
            {/* Left cluster: badge + theme + lang + path */}
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
                style={{ color: accent, background: `color-mix(in oklch, ${accent} 12%, transparent)` }}
              >
                Code
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-1.5 text-[10px] font-medium text-muted-foreground"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <span
                      className="size-2.5 rounded-sm shrink-0"
                      style={{ background: themeBg, boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.18)" }}
                    />
                    {CODE_THEME_LABELS[codeTheme]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-48"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {CODE_THEMES.map((t) => (
                    <DropdownMenuItem
                      key={t}
                      className="gap-2 text-xs"
                      onClick={() => updateSettings({ codeTheme: t })}
                    >
                      <span
                        className="size-3 rounded-sm shrink-0"
                        style={{ background: CODE_THEME_BG[t], boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.12)" }}
                      />
                      {CODE_THEME_LABELS[t]}
                      {t === codeTheme && (
                        <span className="ml-auto text-[9px] text-muted-foreground/50">{"\u2713"}</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Separator orientation="vertical" className="h-3" />

              <span className="text-xs">{lang}</span>
              <span className="truncate text-xs" title={sourcePathLabel} translate="no">
                {sourcePathLabel}
              </span>
            </div>

            {/* Right cluster: mode toggle */}
            <ToggleGroup
              type="single"
              value={win.viewMode}
              onValueChange={(v: string) => { if (v === "file" || v === "changes") onViewModeChange(id, v); }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ToggleGroupItem
                value="file"
                className="text-[10px] uppercase bg-transparent!"
                style={win.viewMode === "file" ? { color: accent } : undefined}
              >
                File
              </ToggleGroupItem>
              <ToggleGroupItem
                value="changes"
                className="text-[10px] uppercase bg-transparent!"
                style={win.viewMode === "changes" ? { color: accent } : undefined}
              >
                Changes
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Content */}
          <div className="window-content">
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground/50 text-xs">
                Loading{"\u2026"}
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center text-destructive/60 text-xs px-4 text-center">
                {error}
              </div>
            ) : changesRows === "empty" && win.viewMode === "changes" ? (
              <div className="flex h-full items-center justify-center text-muted-foreground/50 text-xs">
                No changes
              </div>
            ) : (
              <div className="flex size-full overflow-hidden" style={{ background: themeBg }}>
                <div className="code-viewer flex-1 min-w-0 h-full overflow-auto" ref={scrollRef} role="presentation">
                  <table className="w-full border-collapse font-mono text-[13px] leading-[1.5] [tab-size:4]">
                    <tbody>{win.viewMode === "file" ? fileRows : changesRows}</tbody>
                  </table>
                </div>
                {minimapRows && (
                  <div className="code-minimap-track relative w-[60px] shrink-0 overflow-hidden cursor-pointer border-l border-border/10">
                    <canvas
                      ref={minimapCanvasRef}
                      className="block"
                      onClick={handleMinimapClick}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => (
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
