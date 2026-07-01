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
import { tokenizeCode, tokenizeCodeLines } from "@/lib/shiki";
import { detectLanguage } from "@/lib/lang-detect";
import { useDragResize, type WindowMotionRect } from "@/lib/use-drag-resize";
import { shouldHandleCodeTarget } from "@/lib/code-window-target";
import { getVirtualCodeRows } from "@/lib/code-window-virtualization";
import { getCodeWindowPerformancePolicy } from "@/lib/code-window-performance";
import { createCodeLineHtmlCache, type CodeLineHtmlCache } from "@/lib/code-window-rendering";
import type { SnapTargetRect } from "@/lib/window-snapping";
import type { CodeWindow as CodeWindowState, CodeViewMode, DiffLine, WindowUpdatable } from "@/types";
import type { ThemedToken } from "shiki";

const CODE_ROW_HEIGHT = 19.5; // 13px code font × leading 1.5
const CODE_ROW_OVERSCAN = 24;
const CODE_LINE_HTML_CACHE_SIZE = 2_000;
const CODE_FULL_TOKENIZE_IDLE_DELAY_MS = 650;
const CODE_FULL_TOKENIZE_EAGER_DELAY_MS = 120;
const CODE_PREVIEW_LINE_COUNT = 80;

interface MinimapRow {
  tokens: ThemedToken[] | null;
  text: string;
  type: "normal" | "add" | "delete";
}

type CodeRenderRow =
  | { kind: "file"; key: string; lineNumber: number; tokens: ThemedToken[] | null; text: string }
  | { kind: "diff-line"; key: string; lineNumber: number; oldLine: number | ""; tokens: ThemedToken[] | null; text: string; added: boolean }
  | { kind: "diff-delete"; key: string; oldLine: number | ""; text: string };

interface HighlightState {
  content: string;
  lang: string;
  theme: string;
  lines: Array<ThemedToken[] | null>;
  full: boolean;
  tokenCount: number;
}

interface Props {
  id: string;
  window: CodeWindowState;
  isActive: boolean;
  zoom: number;
  zoomRef: React.RefObject<number>;
  snapTargetsRef: React.RefObject<readonly SnapTargetRect[]>;
  snapGuideLayerRef: React.RefObject<HTMLDivElement | null>;
  wsColor?: string;
  workspaceRoot?: string;
  onClose: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WindowUpdatable>) => void;
  onFocus: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onViewModeChange: (id: string, mode: CodeViewMode) => void;
  onLiveRectChange?: (id: string, rect: WindowMotionRect | null) => void;
}

function splitCodeLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

function countTokenSpans(lines: readonly (readonly ThemedToken[] | null)[]): number {
  let count = 0;
  for (const line of lines) count += line?.length ?? 0;
  return count;
}

function normalizeTokenLines(tokens: ThemedToken[][], lineCount: number): ThemedToken[][] {
  return Array.from({ length: lineCount }, (_, i) => tokens[i] ?? []);
}

function renderCodeCell(tokens: ThemedToken[] | null, text: string, htmlCache: CodeLineHtmlCache) {
  return {
    __html: tokens ? htmlCache.getTokenLine(tokens) : htmlCache.getPlainLine(text),
  };
}

function renderCodeRow(row: CodeRenderRow, htmlCache: CodeLineHtmlCache) {
  if (row.kind === "file") {
    return (
      <tr key={row.key} className={`code-line${row.tokens ? "" : " code-line-pending"}`} data-line={row.lineNumber}>
        <td className="code-gutter">{row.lineNumber}</td>
        <td className="code-cell" dangerouslySetInnerHTML={renderCodeCell(row.tokens, row.text, htmlCache)} />
      </tr>
    );
  }

  if (row.kind === "diff-delete") {
    return (
      <tr key={row.key} className="code-line diff-delete">
        <td className="code-gutter diff-gutter-old">{row.oldLine}</td>
        <td className="code-gutter diff-gutter-new" />
        <td className="code-cell" dangerouslySetInnerHTML={{ __html: htmlCache.getPlainLine(row.text) }} />
      </tr>
    );
  }

  return (
    <tr
      key={row.key}
      className={`code-line ${row.added ? "diff-add" : ""}${row.tokens ? "" : " code-line-pending"}`}
      data-line={row.lineNumber}
    >
      <td className="code-gutter diff-gutter-old">{row.oldLine}</td>
      <td className="code-gutter diff-gutter-new">{row.lineNumber}</td>
      <td className="code-cell" dangerouslySetInnerHTML={renderCodeCell(row.tokens, row.text, htmlCache)} />
    </tr>
  );
}

export default memo(function CodeWindow({
  id,
  window: win,
  isActive,
  zoom,
  zoomRef,
  snapTargetsRef,
  snapGuideLayerRef,
  wsColor,
  workspaceRoot,
  onClose,
  onUpdate,
  onFocus,
  onRename,
  onViewModeChange,
  onLiveRectChange,
}: Props) {
  const { settings, update: updateSettings } = useSettings();
  const codeTheme = settings.codeTheme;
  const themeBg = CODE_THEME_BG[codeTheme] ?? "#24292e";
  const { windowRef, handleTitleMouseDown, handleEdgeResize } = useDragResize({
    id, x: win.x, y: win.y, width: win.width, height: win.height,
    zoomRef, onUpdate, onFocus, minWidth: 240, minHeight: 120,
    snapTargetsRef, snapGuideLayerRef, onLiveRectChange,
  });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  // Content state — loaded from disk, not persisted
  const [content, setContent] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightState, setHighlightState] = useState<HighlightState | null>(null);

  const requestIdRef = useRef(0);
  const highlightVersionRef = useRef(0);
  const htmlCacheRef = useRef(createCodeLineHtmlCache(CODE_LINE_HTML_CACHE_SIZE));
  const accent = wsColor ?? "var(--muted-foreground)";
  const sourcePathLabel = win.sourcePath.replace(/^\/Users\/[^/]+/, "~");
  const lang = useMemo(() => detectLanguage(win.sourcePath), [win.sourcePath]);
  const sourceLines = useMemo(() => (content == null ? null : splitCodeLines(content)), [content]);
  const validHighlightState =
    highlightState &&
    content != null &&
    highlightState.content === content &&
    highlightState.lang === lang &&
    highlightState.theme === codeTheme
      ? highlightState
      : null;
  const lineTokens = validHighlightState?.lines ?? null;
  const lineCount = sourceLines?.length ?? 0;
  const performancePolicy = useMemo(() => getCodeWindowPerformancePolicy({
    lineCount,
    byteLength: content?.length ?? 0,
    tokenCount: validHighlightState?.tokenCount,
    zoom,
    isActive,
  }), [content?.length, isActive, lineCount, validHighlightState?.tokenCount, zoom]);

  const readContentForRequest = useCallback(
    (thisRequest: number, isCancelled: () => boolean, isInitial: boolean) => {
      // Only show the "Loading…" placeholder on the first read for this file.
      // Watcher-driven refreshes keep the current content rendered until the new
      // text is ready, so an unrelated file changing in the workspace (or our own
      // atomic save) does not blank the view. This is the no-flicker swap editors do.
      if (isInitial) {
        setLoading(true);
        setError(null);
      }

      invoke<string>("read_code_file_content", { path: win.sourcePath })
        .then((text) => {
          if (!isCancelled() && requestIdRef.current === thisRequest) setContent(text);
        })
        .catch((err) => {
          if (!isCancelled() && requestIdRef.current !== thisRequest) return;
          // On refresh keep the last good content instead of flashing an error —
          // atomic saves briefly unlink the file and would otherwise blink.
          if (isInitial && !isCancelled()) setError(String(err));
        })
        .finally(() => {
          if (isInitial && !isCancelled() && requestIdRef.current === thisRequest) setLoading(false);
        });
    },
    [win.sourcePath],
  );

  // Load file content from disk
  useEffect(() => {
    let cancelled = false;
    requestIdRef.current += 1;
    const thisRequest = requestIdRef.current;

    readContentForRequest(thisRequest, () => cancelled, true);

    return () => { cancelled = true; };
  }, [readContentForRequest]);

  // Reset highlighting when the file, language, or theme changes. Plain text
  // rows can render immediately; Shiki fills visible rows first and the whole
  // file later from a worker.
  useEffect(() => {
    highlightVersionRef.current += 1;
    htmlCacheRef.current.clear();

    if (content == null || sourceLines == null) {
      setHighlightState(null);
      return;
    }

    setHighlightState({
      content,
      lang,
      theme: codeTheme,
      lines: Array.from({ length: sourceLines.length }, () => null),
      full: false,
      tokenCount: 0,
    });
  }, [codeTheme, content, lang, sourceLines]);

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

  // Re-read on file change (synchronous unlisten ref pattern).
  // Debounced: rapid watcher bursts (e.g. a build writing many files) collapse into
  // one re-read. The workspace-root filter runs BEFORE scheduling so cross-workspace
  // events are discarded immediately with no timer overhead.
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    listen<string>("file-tree-changed", (event) => {
      if (cancelled) return;
      // Only react to changes in our workspace root (avoid cross-workspace reloads)
      if (workspaceRoot && event.payload !== workspaceRoot) return;

      // Coalesce rapid events — trailing edge, 300ms
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (cancelled) return;
        requestIdRef.current += 1;
        const thisRequest = requestIdRef.current;
        readContentForRequest(thisRequest, () => cancelled, false);

        if (win.viewMode === "changes" && workspaceRoot) {
          invoke<DiffLine[]>("get_file_diff", { path: win.sourcePath, root: workspaceRoot })
            .then((lines) => { if (!cancelled && requestIdRef.current === thisRequest) setDiffLines(lines); })
            .catch(() => { if (!cancelled && requestIdRef.current === thisRequest) setDiffLines(null); });
        }
      }, 300);
    }).then((fn) => {
      if (cancelled) fn(); // already unmounted — clean up immediately
      else unlistenFn = fn;
    });

    return () => {
      cancelled = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      unlistenFn?.();
    };
  }, [readContentForRequest, win.sourcePath, win.viewMode, workspaceRoot]);

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
  const highlightTimerRef = useRef<number | null>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);
  const lastHandledTargetNonceRef = useRef<number | null>(null);
  const [virtualViewport, setVirtualViewport] = useState({ scrollTop: 0, height: 0 });

  const updateVirtualViewport = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const next = { scrollTop: scroller.scrollTop, height: scroller.clientHeight };
    setVirtualViewport((prev) => (
      prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next
    ));
  }, []);

  // Gutter width is driven by the line-number digit count so all rows align
  // (block/flex rows can't auto-size a shared column the way a <table> did).
  const gutterCh = useMemo(() => {
    let maxLine = lineCount;
    if (diffLines) {
      for (const line of diffLines) {
        maxLine = Math.max(maxLine, line.old_lineno ?? 0, line.new_lineno ?? 0);
      }
    }
    return Math.max(2, String(maxLine).length);
  }, [diffLines, lineCount]);

  // ── Render row data (React nodes are created only for the virtual slice) ──
  const fileRows = useMemo(() => {
    if (sourceLines == null) return null;
    return sourceLines.map((text, i): CodeRenderRow => ({
      kind: "file",
      key: `f-${i}`,
      lineNumber: i + 1,
      tokens: lineTokens?.[i] ?? null,
      text,
    }));
  }, [lineTokens, sourceLines]);

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
    if (sourceLines == null || diffAnnotations == null) return null;
    const { addedLines, deletedBefore, trailingDeletes } = diffAnnotations;

    if (addedLines.size === 0 && deletedBefore.size === 0 && !trailingDeletes) return [];

    const rows: CodeRenderRow[] = [];
    let key = 0;

    for (let i = 0; i < sourceLines.length; i++) {
      const lineNum = i + 1;

      const deletes = deletedBefore.get(lineNum);
      if (deletes) {
        for (const del of deletes) {
          rows.push({
            kind: "diff-delete",
            key: `d-${key++}`,
            oldLine: del.old_lineno ?? "",
            text: del.content,
          });
        }
      }

      const isAdded = addedLines.has(lineNum);
      rows.push({
        kind: "diff-line",
        key: `l-${key++}`,
        lineNumber: lineNum,
        oldLine: isAdded ? "" : lineNum,
        tokens: lineTokens?.[i] ?? null,
        text: sourceLines[i],
        added: isAdded,
      });
    }

    if (trailingDeletes) {
      for (const del of trailingDeletes) {
        rows.push({
          kind: "diff-delete",
          key: `d-${key++}`,
          oldLine: del.old_lineno ?? "",
          text: del.content,
        });
      }
    }

    return rows;
  }, [lineTokens, sourceLines, diffAnnotations]);

  const activeRows = win.viewMode === "file" ? fileRows : changesRows;
  const activeRowCount = activeRows?.length ?? 0;
  const virtualRows = useMemo(() => getVirtualCodeRows({
    rowCount: activeRowCount,
    scrollTop: virtualViewport.scrollTop,
    viewportHeight: virtualViewport.height || Math.max(120, win.height - 60),
    rowHeight: CODE_ROW_HEIGHT,
    overscan: CODE_ROW_OVERSCAN,
  }), [activeRowCount, virtualViewport.height, virtualViewport.scrollTop, win.height]);
  const renderedCodeRows = useMemo(() => {
    if (!activeRows) return null;
    const htmlCache = htmlCacheRef.current;
    return activeRows.slice(virtualRows.start, virtualRows.end).map((row) => renderCodeRow(row, htmlCache));
  }, [activeRows, virtualRows.end, virtualRows.start]);
  const changesEmpty = win.viewMode === "changes" && changesRows != null && changesRows.length === 0;

  const visibleFileRange = useMemo(() => {
    if (!sourceLines || !activeRows || !performancePolicy.tokenizeVisible) return null;

    if (win.viewMode === "file") {
      return {
        start: Math.max(0, virtualRows.start),
        end: Math.min(sourceLines.length, virtualRows.end),
      };
    }

    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    for (let i = virtualRows.start; i < virtualRows.end; i++) {
      const row = activeRows[i];
      if (!row || row.kind !== "diff-line") continue;
      const index = row.lineNumber - 1;
      start = Math.min(start, index);
      end = Math.max(end, index + 1);
    }

    return end >= start ? { start, end } : null;
  }, [
    activeRows,
    performancePolicy.tokenizeVisible,
    sourceLines,
    virtualRows.end,
    virtualRows.start,
    win.viewMode,
  ]);

  useEffect(() => {
    if (
      content == null ||
      sourceLines == null ||
      lineTokens == null ||
      visibleFileRange == null ||
      !performancePolicy.tokenizeVisible
    ) return;

    const start = Math.max(0, Math.min(sourceLines.length, visibleFileRange.start));
    const end = Math.max(start, Math.min(sourceLines.length, visibleFileRange.end));
    if (start === end) return;

    let hasMissingLine = false;
    for (let i = start; i < end; i++) {
      if (lineTokens[i] == null) {
        hasMissingLine = true;
        break;
      }
    }
    if (!hasMissingLine) return;

    let cancelled = false;
    const version = highlightVersionRef.current;
    const visibleLines = sourceLines.slice(start, end);

    tokenizeCodeLines(visibleLines, lang, codeTheme).then((result) => {
      if (cancelled || version !== highlightVersionRef.current) return;

      setHighlightState((prev) => {
        if (!prev || prev.content !== content || prev.lang !== lang || prev.theme !== codeTheme) return prev;

        const nextLines = prev.lines.slice();
        let changed = false;
        for (let i = 0; i < visibleLines.length; i++) {
          const lineIndex = start + i;
          if (nextLines[lineIndex] != null) continue;
          nextLines[lineIndex] = result[i] ?? [];
          changed = true;
        }
        if (!changed) return prev;

        return {
          ...prev,
          lines: nextLines,
          tokenCount: countTokenSpans(nextLines),
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    codeTheme,
    content,
    lang,
    lineTokens,
    performancePolicy.tokenizeVisible,
    sourceLines,
    visibleFileRange,
  ]);

  useEffect(() => {
    if (
      content == null ||
      sourceLines == null ||
      !performancePolicy.tokenizeFull ||
      validHighlightState?.full
    ) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const version = highlightVersionRef.current;
    const delay = performancePolicy.deferFullTokenization
      ? CODE_FULL_TOKENIZE_IDLE_DELAY_MS
      : CODE_FULL_TOKENIZE_EAGER_DELAY_MS;

    const run = () => {
      tokenizeCode(content, lang, codeTheme).then((result) => {
        if (cancelled || version !== highlightVersionRef.current) return;
        const normalizedLines = normalizeTokenLines(result, sourceLines.length);

        setHighlightState((prev) => {
          if (!prev || prev.content !== content || prev.lang !== lang || prev.theme !== codeTheme) return prev;
          return {
            ...prev,
            lines: normalizedLines,
            full: true,
            tokenCount: countTokenSpans(normalizedLines),
          };
        });
      });
    };

    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(run, { timeout: 1_500 });
      } else {
        run();
      }
    }, delay);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    };
  }, [
    codeTheme,
    content,
    lang,
    performancePolicy.deferFullTokenization,
    performancePolicy.tokenizeFull,
    sourceLines,
    validHighlightState?.full,
  ]);

  // ── Minimap: build row metadata for canvas drawing ──
  const minimapRows = useMemo((): MinimapRow[] | null => {
    if (!sourceLines || !performancePolicy.renderMinimap) return null;
    const useDetailedTokens = performancePolicy.renderDetailedMinimap;

    if (win.viewMode === "file" || !diffAnnotations) {
      return sourceLines.map((text, i) => ({
        tokens: useDetailedTokens ? lineTokens?.[i] ?? null : null,
        text,
        type: "normal",
      }));
    }

    const { addedLines, deletedBefore, trailingDeletes } = diffAnnotations;
    const rows: MinimapRow[] = [];

    for (let i = 0; i < sourceLines.length; i++) {
      const lineNum = i + 1;
      const deletes = deletedBefore.get(lineNum);
      if (deletes) {
        for (const del of deletes) {
          rows.push({ tokens: null, text: del.content, type: "delete" });
        }
      }
      rows.push({
        tokens: useDetailedTokens ? lineTokens?.[i] ?? null : null,
        text: sourceLines[i],
        type: addedLines.has(lineNum) ? "add" : "normal",
      });
    }
    if (trailingDeletes) {
      for (const del of trailingDeletes) {
        rows.push({ tokens: null, text: del.content, type: "delete" });
      }
    }
    return rows;
  }, [
    diffAnnotations,
    lineTokens,
    performancePolicy.renderDetailedMinimap,
    performancePolicy.renderMinimap,
    sourceLines,
    win.viewMode,
  ]);

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
        const w = Math.min(row.text.length * CHAR_W, MINIMAP_W - 4);
        ctx.fillStyle = row.type === "delete"
          ? "rgba(248, 81, 73, 0.4)"
          : row.type === "add"
            ? "rgba(63, 185, 80, 0.42)"
            : "rgba(139, 148, 158, 0.34)";
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
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightedRowRef.current?.classList.remove("code-line-target");
      highlightedRowRef.current = null;
    };
  }, []);

  useEffect(() => {
    const line = win.targetLine;
    const nonce = win.targetNonce;
    if (!shouldHandleCodeTarget({
      line,
      nonce,
      viewMode: win.viewMode,
      tokensReady: sourceLines != null,
      lastHandledNonce: lastHandledTargetNonceRef.current,
    })) return;

    const scroller = scrollRef.current;
    if (!scroller) return;

    if (line == null || line < 1 || line > lineCount) {
      lastHandledTargetNonceRef.current = nonce ?? null;
      onUpdate(id, { targetLine: undefined, targetColumn: undefined, targetNonce: undefined });
      return;
    }

    const row = scroller.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`);
    if (!row) {
      const targetTop = (line - 1) * CODE_ROW_HEIGHT;
      scroller.scrollTop = Math.max(0, targetTop - scroller.clientHeight / 2 + CODE_ROW_HEIGHT / 2);
      updateVirtualViewport();
      updateMinimapViewport();
      return;
    }

    const raf = requestAnimationFrame(() => {
      lastHandledTargetNonceRef.current = nonce ?? null;
      onUpdate(id, { targetLine: undefined, targetColumn: undefined, targetNonce: undefined });
      row.scrollIntoView({ block: "center", inline: "nearest" });
      updateVirtualViewport();
      updateMinimapViewport();
      highlightedRowRef.current?.classList.remove("code-line-target");
      row.classList.add("code-line-target");
      highlightedRowRef.current = row;

      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        if (highlightedRowRef.current === row) {
          row.classList.remove("code-line-target");
          highlightedRowRef.current = null;
        }
        highlightTimerRef.current = null;
      }, 2600);
    });

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [
    id,
    lineCount,
    onUpdate,
    sourceLines,
    updateMinimapViewport,
    updateVirtualViewport,
    virtualRows.end,
    virtualRows.start,
    win.targetLine,
    win.targetNonce,
    win.viewMode,
  ]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onScroll = () => {
      cancelAnimationFrame(viewportRafRef.current);
      viewportRafRef.current = requestAnimationFrame(() => {
        updateVirtualViewport();
        updateMinimapViewport();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // Initial draw
    updateVirtualViewport();
    updateMinimapViewport();

    const canvasEl = minimapCanvasRef.current;
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(viewportRafRef.current);
      // Clean up imperatively created viewport indicator
      const indicator = canvasEl?.parentElement?.querySelector(".code-minimap-viewport");
      indicator?.remove();
    };
  }, [activeRowCount, minimapRows, updateMinimapViewport, updateVirtualViewport]);

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
    updateVirtualViewport();
    updateMinimapViewport();
  }, [updateMinimapViewport, updateVirtualViewport]);

  const previewRows = useMemo(() => {
    if (!sourceLines || !performancePolicy.previewMode) return null;
    const htmlCache = htmlCacheRef.current;

    return sourceLines.slice(0, CODE_PREVIEW_LINE_COUNT).map((text, i) => (
      <div key={i} className="code-preview-line">
        <span className="code-preview-gutter">{i + 1}</span>
        <span className="code-preview-cell" dangerouslySetInnerHTML={{ __html: htmlCache.getPlainLine(text) }} />
      </div>
    ));
  }, [performancePolicy.previewMode, sourceLines]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={windowRef}
          className="window"
          data-window-id={id}
          data-window-type="code"
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
            ) : changesEmpty ? (
              <div className="flex h-full items-center justify-center text-muted-foreground/50 text-xs">
                No changes
              </div>
            ) : performancePolicy.previewMode && previewRows ? (
              <div
                className="code-preview size-full overflow-hidden font-mono text-[13px] leading-[1.5]"
                style={{ background: themeBg, "--code-gutter-ch": gutterCh } as React.CSSProperties}
              >
                {previewRows}
              </div>
            ) : (
              <div className="flex size-full overflow-hidden" style={{ background: themeBg }}>
                <div
                  className="code-viewer flex-1 min-w-0 h-full overflow-auto"
                  ref={scrollRef}
                  role="presentation"
                  style={{ "--code-gutter-ch": gutterCh } as React.CSSProperties}
                >
                  <table className="w-full border-collapse font-mono text-[13px] leading-[1.5] [tab-size:4]">
                    <tbody>
                      {virtualRows.topPadding > 0 && (
                        <tr
                          key="top-spacer"
                          className="code-virtual-spacer"
                          style={{ height: virtualRows.topPadding }}
                          aria-hidden="true"
                        >
                          <td colSpan={3} />
                        </tr>
                      )}
                      {renderedCodeRows}
                      {virtualRows.bottomPadding > 0 && (
                        <tr
                          key="bottom-spacer"
                          className="code-virtual-spacer"
                          style={{ height: virtualRows.bottomPadding }}
                          aria-hidden="true"
                        >
                          <td colSpan={3} />
                        </tr>
                      )}
                    </tbody>
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
