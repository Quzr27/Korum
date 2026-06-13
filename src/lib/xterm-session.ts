/**
 * useXtermSession — extracted from TerminalWindow's Effect B + supporting effects.
 *
 * Encapsulates:
 * - xterm Terminal create/open/fit
 * - Tauri Channel + PTY attach/detach
 * - Keyboard shortcuts (copy, paste, clear, line feed)
 * - CSS scale compensation for canvas zoom
 * - Visibility refresh (via VisibilityProvider)
 * - SerializeAddon snapshot capture on detach
 * - Settings sync (font, theme changes)
 * - Focus management (isActive)
 * - Resize (win.width/height)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal, type IBufferLine, type ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import {
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_LOAD_TARGETS,
  TERMINAL_NERD_FONT_SAMPLE,
  getXtermTheme,
} from "@/lib/settings";
import type { TerminalFont, TerminalTheme } from "@/lib/settings/types";
import {
  findTerminalDiagnosticLink,
  findTerminalFileContext,
  findTerminalSmartLinks,
  looksLikeTerminalDiagnostic,
  mapTerminalLinkRange,
  resolveTerminalFilePath,
  type TerminalLinkSegment,
} from "@/lib/terminal-smart-links";
import {
  createTerminalOutputNormalizer,
  normalizeTerminalStatusGlyphs,
} from "@/lib/terminal-glyph-normalizer";
import { handleTerminalShortcut } from "@/lib/terminal-shortcuts";
import { adjustMouseForZoom, invalidateContainerRect } from "@/lib/xterm-mouse-compat";
import { useVisibility } from "@/lib/visibility-context";
import type { PasteRequest } from "@/types";

const SNAPSHOT_SCROLLBACK_ROWS = 120;
const LIVE_WRITE_REPAIR_IDLE_DELAY_MS = 180;
const LIVE_WRITE_REPAIR_MAX_DELAY_MS = 1000;
// Flow control: when xterm's un-parsed write backlog exceeds the high-water
// mark we pause the Rust PTY read thread; we resume once it drains below the
// low-water mark. Sized so ordinary output never trips them — only sustained
// floods (`yes`, huge `cat`, many busy agents) do — bounding IPC/memory growth.
const LIVE_WRITE_PAUSE_HIGH_WATER = 2_000_000;
const LIVE_WRITE_PAUSE_LOW_WATER = 400_000;
const ESLINT_CONTEXT_SCAN_LINES = 24;
const TERMINAL_FONT_LOAD_TIMEOUT_MS = 1500;

// A viewport teleport detaches many xterms in one commit; their deferred
// dispose() calls would otherwise all land in the same task and block the
// main thread. Each pending dispose takes the next frame-sized slot; a gap
// since the last schedule starts a fresh burst.
const DISPOSE_SLOT_MS = 16;
const DISPOSE_BURST_RESET_MS = 250;
let disposeBurstSlot = 0;
let lastDisposeScheduledAt = 0;

function nextDisposeDelay(): number {
  const now = performance.now();
  if (now - lastDisposeScheduledAt > DISPOSE_BURST_RESET_MS) disposeBurstSlot = 0;
  lastDisposeScheduledAt = now;
  return disposeBurstSlot++ * DISPOSE_SLOT_MS;
}

/**
 * Leave a static clone of the terminal's rendered rows in the container when
 * a still-mounted terminal is detached (live-budget eviction, attach
 * staggering). The window keeps showing its last frame instead of going
 * blank; the next attach clears it via `replaceChildren()`.
 */
function appendTerminalGhost(container: HTMLElement, term: Terminal): void {
  const rows = term.element?.querySelector(".xterm-rows");
  if (!rows) return;
  container.querySelector(".terminal-ghost")?.remove();
  const ghost = document.createElement("div");
  // The `xterm` class keeps xterm.css row styling and the container's gutter
  // padding applying to the clone, so the ghost aligns with the live layout.
  ghost.className = "terminal-ghost xterm";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.fontFamily = String(term.options.fontFamily ?? "");
  ghost.style.fontSize = `${term.options.fontSize ?? 13}px`;
  ghost.style.lineHeight = String(term.options.lineHeight ?? 1.22);
  ghost.appendChild(rows.cloneNode(true));
  container.appendChild(ghost);
}

interface LogicalTerminalLine {
  text: string;
  segments: TerminalLinkSegment[];
}

function writeTerminalSnapshot(term: Terminal, snapshot: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(snapshot, () => resolve());
  });
}

function waitForTerminalFont(fontLoadTarget: string | undefined, fontSize: number): Promise<void> {
  if (!fontLoadTarget || !("fonts" in document)) return Promise.resolve();

  const fontSpec = `${fontSize}px ${fontLoadTarget}`;
  const fontLoad = document.fonts
    .load(fontSpec, TERMINAL_NERD_FONT_SAMPLE)
    .then(() => undefined, () => undefined);

  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(finish, TERMINAL_FONT_LOAD_TIMEOUT_MS);

    function finish() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    }

    void fontLoad.then(finish);
  });
}

function forceTerminalFontRemeasure(term: Terminal, fontFamily: string) {
  // xterm ignores assigning the same fontFamily string, even after WebKit swaps
  // in a newly-loaded @font-face. Nudge the option so the char-size service
  // measures the real patched font before FitAddon computes cols/rows.
  term.options.fontFamily = `${fontFamily}, monospace`;
  term.options.fontFamily = fontFamily;
  term.clearTextureAtlas();
}

function refreshTerminalDisplay(
  term: Terminal,
  options: {
    isCurrent: () => boolean;
    clearSelection?: boolean;
    onComplete?: () => void;
  },
): number {
  if (options.clearSelection) term.clearSelection();

  const buf = term.buffer.active;
  const wasAtBottom = buf.viewportY >= buf.baseY;
  const savedViewportY = buf.viewportY;
  term.clearTextureAtlas();

  return requestAnimationFrame(() => {
    try {
      if (!options.isCurrent()) return;

      term.refresh(0, term.rows - 1);
      // Restore: if user was scrolled to bottom, stay there (baseY may have
      // changed from new data); otherwise restore exact viewport position.
      if (wasAtBottom) {
        term.scrollToBottom();
      } else if (buf.viewportY !== savedViewportY) {
        term.scrollLines(savedViewportY - buf.viewportY);
      }
    } finally {
      options.onComplete?.();
    }
  });
}

function buildCellBoundaryMaps(line: IBufferLine, text: string, maxCols: number) {
  const cellStartByIndex: number[] = [1];
  const cellEndByIndex: number[] = [0];
  let stringIndex = 0;

  for (let cellIndex = 0; cellIndex < maxCols && stringIndex < text.length; cellIndex++) {
    const cell = line.getCell(cellIndex);
    if (!cell) break;

    const width = cell.getWidth();
    if (width === 0) continue;

    const chars = cell.getChars();
    const content = chars === "" ? " " : chars;
    const cellStart = cellIndex + 1;
    const cellEnd = cellIndex + Math.max(width, 1);
    cellStartByIndex[stringIndex] = cellStart;

    stringIndex += content.length;
    cellEndByIndex[stringIndex] = cellEnd;
    cellStartByIndex[stringIndex] = cellEnd + 1;
  }

  for (let i = 0; i <= text.length; i++) {
    cellStartByIndex[i] ??= i + 1;
    cellEndByIndex[i] ??= i;
  }

  return { cellStartByIndex, cellEndByIndex };
}

function readLogicalTerminalLine(term: Terminal, bufferLineNumber: number): LogicalTerminalLine | null {
  const buffer = term.buffer.active;
  let startLineIndex = bufferLineNumber - 1;
  if (!buffer.getLine(startLineIndex)) return null;

  while (startLineIndex > 0 && buffer.getLine(startLineIndex)?.isWrapped) {
    startLineIndex -= 1;
  }

  let endLineIndex = startLineIndex;
  while (endLineIndex + 1 < buffer.length && buffer.getLine(endLineIndex + 1)?.isWrapped) {
    endLineIndex += 1;
  }

  let text = "";
  const segments: TerminalLinkSegment[] = [];
  for (let lineIndex = startLineIndex; lineIndex <= endLineIndex; lineIndex++) {
    const line = buffer.getLine(lineIndex);
    if (!line) return null;

    const isLast = lineIndex === endLineIndex;
    const chunk = line.translateToString(isLast, 0, term.cols);
    const startIndex = text.length;
    const cellMaps = buildCellBoundaryMaps(line, chunk, term.cols);
    text += chunk;
    segments.push({
      bufferLineNumber: lineIndex + 1,
      startIndex,
      endIndex: text.length,
      cellStartByIndex: cellMaps.cellStartByIndex,
      cellEndByIndex: cellMaps.cellEndByIndex,
    });
  }

  return { text, segments };
}

function findRecentTerminalFileContext(term: Terminal, beforeBufferLineNumber: number): string | null {
  let cursor = beforeBufferLineNumber - 1;
  let scanned = 0;

  while (cursor >= 1 && scanned < ESLINT_CONTEXT_SCAN_LINES) {
    const logicalLine = readLogicalTerminalLine(term, cursor);
    if (!logicalLine) return null;

    const context = findTerminalFileContext(logicalLine.text);
    if (context) return context.path;

    const firstSegment = logicalLine.segments[0];
    if (!firstSegment) return null;
    cursor = firstSegment.bufferLineNumber - 1;
    scanned += logicalLine.segments.length;
  }

  return null;
}

/** A detached terminal awaiting a staggered dispose. `capture` runs the
 *  deferred scrollback snapshot (idempotent) and is invoked by the dispose
 *  timer or by `flushPendingDispose` on a fast reattach. */
export interface PendingDispose {
  term: Terminal;
  timer: number;
  capture?: () => string | null;
}

export interface UseXtermSessionOptions {
  id: string;
  isPtyReady: boolean;
  shouldAttach: boolean;
  terminalSnapshot: string | undefined;
  terminalFont: TerminalFont;
  terminalFontSize: number;
  terminalTheme: TerminalTheme;
  zoomRef: React.RefObject<number>;
  ptyIdRef: React.MutableRefObject<string | null>;
  mountedRef: React.MutableRefObject<boolean>;
  termRef: React.RefObject<HTMLDivElement | null>;
  pendingDisposeRef: React.MutableRefObject<PendingDispose | null>;
  windowWidth: number;
  windowHeight: number;
  isActive: boolean;
  /** Disposes the pending term, capturing its deferred snapshot and returning it. */
  flushPendingDispose: () => string | null;
  onSnapshotCaptured: (windowId: string, snapshot: string | null) => void;
  onPasteRequest: (request: PasteRequest) => void;
  workspaceRoot?: string;
  onOpenFileLink: (filePath: string, line: number, column?: number) => void;
  onSpawnError: (error: string) => void;
  /** Notifies the owner whether a static detach ghost occupies the container. */
  onGhosted: (hasGhost: boolean) => void;
}

export interface UseXtermSessionResult {
  termInstanceRef: React.RefObject<Terminal | null>;
  fitAddonRef: React.RefObject<FitAddon | null>;
  isSessionReady: boolean;
}

export function useXtermSession(opts: UseXtermSessionOptions): UseXtermSessionResult {
  const {
    id,
    isPtyReady,
    shouldAttach,
    terminalSnapshot,
    terminalFont,
    terminalFontSize,
    terminalTheme,
    zoomRef,
    ptyIdRef,
    mountedRef,
    termRef,
    pendingDisposeRef,
    windowWidth,
    windowHeight,
    isActive,
    flushPendingDispose,
    onSnapshotCaptured,
    onPasteRequest,
    workspaceRoot,
    onOpenFileLink,
    onSpawnError,
    onGhosted,
  } = opts;

  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const workspaceRootRef = useRef(workspaceRoot);
  const onOpenFileLinkRef = useRef(onOpenFileLink);
  // Track the settings/size already applied to the live terminal. Effect B
  // creates each terminal pre-configured at the current settings + size and
  // fits it once, so the settings and resize effects skip their redundant
  // mount run (a fit reads computed styles — expensive ×N during attach storms)
  // and only re-fit on an actual change.
  const lastAppliedSettingsRef = useRef({ terminalFont, terminalFontSize, terminalTheme });
  const lastFitSizeRef = useRef({ windowWidth, windowHeight });

  const { register: registerVisibility, unregister: unregisterVisibility } = useVisibility();

  // Read at cleanup time on purpose: distinguishes a detach-while-mounted
  // (live-budget eviction → leave a ghost) from a component unmount, where
  // Effect A's cleanup has already flipped mountedRef to false.
  const isStillMounted = useCallback(() => mountedRef.current, [mountedRef]);

  useEffect(() => {
    workspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);

  useEffect(() => {
    onOpenFileLinkRef.current = onOpenFileLink;
  }, [onOpenFileLink]);

  // ── Effect B: xterm + attach lifecycle ──
  useEffect(() => {
    const ptyId = ptyIdRef.current;
    if (!isPtyReady || !shouldAttach || !ptyId || !termRef.current) return;

    // Disposing the previous term also captures its (deferred) snapshot. On a
    // fast reattach the snapshot prop may not have round-tripped through App
    // state yet, so prefer the just-flushed value to avoid losing scrollback.
    const flushedSnapshot = flushPendingDispose();
    termRef.current.replaceChildren();
    onGhosted(false);

    const xtermTheme = getXtermTheme(terminalTheme);
    const fontFamily = TERMINAL_FONT_FAMILIES[terminalFont];
    const fontLoadTarget = TERMINAL_FONT_LOAD_TARGETS[terminalFont];
    const term = new Terminal({
      fontSize: terminalFontSize,
      fontFamily,
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
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);
    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;
    // This fresh terminal is created + fit with the current settings/size, so
    // sync the skip-guards to match. Without this, a settings/size change that
    // happened while the terminal was detached (and then changed back) would be
    // seen as "unchanged" by the settings/resize effects and never re-applied.
    lastAppliedSettingsRef.current = { terminalFont, terminalFontSize, terminalTheme };
    lastFitSizeRef.current = { windowWidth, windowHeight };

    // Open terminal synchronously (container is in DOM from React commit)
    term.open(termRef.current!);

    const linkProviderDisposable = term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const logicalLine = readLogicalTerminalLine(term, bufferLineNumber);
        if (!logicalLine) {
          callback(undefined);
          return;
        }

        const links: ILink[] = [];
        const smartLinks = findTerminalSmartLinks(logicalLine.text);
        const firstSegment = logicalLine.segments[0];
        // Only walk the scrollback for a preceding file path when this line
        // actually looks like a diagnostic row that needs one — otherwise every
        // hover scans up to 24 logical lines for nothing.
        if (firstSegment && looksLikeTerminalDiagnostic(logicalLine.text)) {
          const contextPath = findRecentTerminalFileContext(term, firstSegment.bufferLineNumber);
          const diagnosticLink = contextPath
            ? findTerminalDiagnosticLink(logicalLine.text, contextPath)
            : null;
          if (diagnosticLink) smartLinks.push(diagnosticLink);
        }

        for (const smartLink of smartLinks) {
          if (smartLink.kind === "file" && !resolveTerminalFilePath(smartLink.path, workspaceRootRef.current)) {
            continue;
          }

          const range = mapTerminalLinkRange(logicalLine.segments, smartLink.startIndex, smartLink.endIndex);
          if (!range || bufferLineNumber < range.start.y || bufferLineNumber > range.end.y) {
            continue;
          }

          links.push({
            range,
            text: smartLink.text,
            decorations: {
              pointerCursor: true,
              underline: true,
            },
            activate: (event) => {
              event.preventDefault();
              if (smartLink.kind === "url") {
                invoke("open_external_url", { url: smartLink.url }).catch(() => {});
                return;
              }

              const filePath = resolveTerminalFilePath(smartLink.path, workspaceRootRef.current);
              if (filePath) {
                onOpenFileLinkRef.current(filePath, smartLink.line, smartLink.column);
              }
            },
          });
        }

        callback(links.length > 0 ? links : undefined);
      },
    });

    let alive = true;
    let attached = false;
    let hasLiveData = false;
    // Flow control: bytes written to xterm but not yet parsed (callback pending).
    let pendingParseBytes = 0;
    let readPaused = false;
    let liveWriteRepairTimer: number | null = null;
    let liveWriteRepairMaxTimer: number | null = null;
    let liveWriteRepairRaf: number | null = null;
    const clearLiveWriteRepairTimers = () => {
      if (liveWriteRepairTimer !== null) {
        window.clearTimeout(liveWriteRepairTimer);
        liveWriteRepairTimer = null;
      }
      if (liveWriteRepairMaxTimer !== null) {
        window.clearTimeout(liveWriteRepairMaxTimer);
        liveWriteRepairMaxTimer = null;
      }
    };
    const runLiveWriteRepair = () => {
      clearLiveWriteRepairTimers();
      if (!alive || liveWriteRepairRaf !== null) return;

      liveWriteRepairRaf = refreshTerminalDisplay(term, {
        isCurrent: () => alive && termInstanceRef.current === term,
        onComplete: () => {
          liveWriteRepairRaf = null;
        },
      });
    };
    const scheduleLiveWriteRepair = () => {
      if (!alive) return;

      if (liveWriteRepairTimer !== null) {
        window.clearTimeout(liveWriteRepairTimer);
      }
      liveWriteRepairTimer = window.setTimeout(runLiveWriteRepair, LIVE_WRITE_REPAIR_IDLE_DELAY_MS);

      if (liveWriteRepairMaxTimer === null) {
        liveWriteRepairMaxTimer = window.setTimeout(
          runLiveWriteRepair,
          LIVE_WRITE_REPAIR_MAX_DELAY_MS,
        );
      }
    };
    // Capture snapshot at mount time — never read reactively. Prefer a snapshot
    // just flushed from a fast reattach over the (possibly stale) prop.
    const snapshotAtMount = flushedSnapshot ?? terminalSnapshot;
    const fontReady = waitForTerminalFont(fontLoadTarget, terminalFontSize);
    const outputNormalizer = createTerminalOutputNormalizer();
    // PTY output arrives as raw bytes: the Rust side sends a `Response`
    // (InvokeResponseBody::Raw) so the channel delivers a binary ArrayBuffer,
    // not a JSON number-array. `new Uint8Array(buffer)` is a zero-copy view —
    // no per-chunk JSON.parse + array copy on the webview main thread.
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (data) => {
      if (!alive) return;
      hasLiveData = true;
      const chunkBytes = data.byteLength;
      const text = outputNormalizer.normalize(new Uint8Array(data));
      if (!text) return;

      // Backpressure: track xterm's un-parsed backlog and pause the PTY read
      // thread when it gets too far ahead, resuming in the write callback once
      // xterm catches up. Without this a flood queues unbounded IPC + grows
      // xterm's internal buffer, janking the whole canvas.
      pendingParseBytes += chunkBytes;
      if (!readPaused && pendingParseBytes >= LIVE_WRITE_PAUSE_HIGH_WATER && ptyIdRef.current) {
        readPaused = true;
        invoke("pause_terminal_read", { id: ptyIdRef.current }).catch(() => {});
      }
      term.write(text, () => {
        pendingParseBytes -= chunkBytes;
        if (readPaused && pendingParseBytes <= LIVE_WRITE_PAUSE_LOW_WATER && ptyIdRef.current) {
          readPaused = false;
          invoke("resume_terminal_read", { id: ptyIdRef.current }).catch(() => {});
        }
        scheduleLiveWriteRepair();
      });
    };
    const onDataDisposable = term.onData((data: string) => {
      if (ptyIdRef.current) {
        invoke("write_terminal", { id: ptyIdRef.current, data }).catch(() => {
          if (alive) onSpawnError("Terminal process is not responding");
        });
      }
    });

    void (async () => {
      await fontReady;
      if (!alive) return;

      forceTerminalFontRemeasure(term, fontFamily);
      try { fitAddon.fit(); } catch { /* container not ready */ }
      term.refresh(0, term.rows - 1);

      // Restore visual state from previous detach (if any)
      if (snapshotAtMount) {
        await writeTerminalSnapshot(term, normalizeTerminalStatusGlyphs(snapshotAtMount));
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
      if (alive) onSpawnError(String(err));
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
            onPasteRequest({
              text,
              terminalId: id,
              ptyId: currentId,
              bracketedPasteMode: term.modes.bracketedPasteMode,
            });
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

    // CSS scale compensation
    const container = termRef.current!;
    const handleMouseZoom = (e: MouseEvent) => adjustMouseForZoom(e, container, zoomRef.current);
    container.addEventListener("mousedown", handleMouseZoom, true);
    container.addEventListener("mousemove", handleMouseZoom, true);
    container.addEventListener("mouseup", handleMouseZoom, true);

    // Visibility refresh (via VisibilityProvider — single global listener).
    registerVisibility(id, () => {
      refreshTerminalDisplay(term, {
        clearSelection: true,
        isCurrent: () => termInstanceRef.current === term,
      });
    });

    return () => {
      alive = false;
      // Capturing the scrollback snapshot (serializeAddon.serialize) is the
      // expensive part of a detach. A teleport/zoom can detach many terminals
      // in ONE React commit, so doing it synchronously here blocks the main
      // thread N×. Defer it into the staggered dispose slot (one per frame) —
      // it still runs before term.dispose(), and flushPendingDispose() runs it
      // (and returns it) on a fast reattach, so no snapshot is ever lost.
      let snapshotCaptured = false;
      let capturedSnapshot: string | null = null;
      const captureSnapshot = (): string | null => {
        if (snapshotCaptured) return capturedSnapshot;
        snapshotCaptured = true;
        if (attached && hasLiveData) {
          capturedSnapshot = serializeAddon.serialize({ scrollback: SNAPSHOT_SCROLLBACK_ROWS }) || null;
          onSnapshotCaptured(id, capturedSnapshot);
        }
        return capturedSnapshot;
      };
      if (attached) {
        // Detach without unmount (live-budget eviction / attach staggering):
        // keep a frozen visual of the terminal instead of a blank window.
        if (isStillMounted()) {
          appendTerminalGhost(container, term);
          onGhosted(true);
          // Hide the live element now — its dispose is deferred, and the
          // ghost stacked on top would otherwise double-draw the same text.
          if (term.element) term.element.style.visibility = "hidden";
        }
        invoke("detach_terminal", { id: ptyId }).catch(() => {});
      }
      linkProviderDisposable.dispose();
      onDataDisposable.dispose();
      container.removeEventListener("mousedown", handleMouseZoom, true);
      container.removeEventListener("mousemove", handleMouseZoom, true);
      container.removeEventListener("mouseup", handleMouseZoom, true);
      unregisterVisibility(id);
      clearLiveWriteRepairTimers();
      if (liveWriteRepairRaf !== null) {
        cancelAnimationFrame(liveWriteRepairRaf);
        liveWriteRepairRaf = null;
      }
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      setIsSessionReady(false);
      const timer = window.setTimeout(() => {
        if (pendingDisposeRef.current?.term !== term) return;
        captureSnapshot();
        term.dispose();
        if (pendingDisposeRef.current?.term === term) {
          pendingDisposeRef.current = null;
        }
      }, nextDisposeDelay());
      pendingDisposeRef.current = { term, timer, capture: captureSnapshot };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- settings handled by separate effect; terminalSnapshot captured at mount via snapshotAtMount; link callbacks use refs to avoid remounting xterm; onPasteRequest/onSpawnError omitted — both are stable (useCallback with [] deps / useState setter)
  }, [flushPendingDispose, id, isPtyReady, onGhosted, onSnapshotCaptured, shouldAttach]);

  // Update terminal options when settings change
  useEffect(() => {
    const term = termInstanceRef.current;
    if (!term) return;
    // Skip the redundant mount run — Effect B already created the terminal with
    // the current settings and fit it. Only a real change needs to re-apply.
    const prev = lastAppliedSettingsRef.current;
    const changed =
      prev.terminalFont !== terminalFont ||
      prev.terminalFontSize !== terminalFontSize ||
      prev.terminalTheme !== terminalTheme;
    lastAppliedSettingsRef.current = { terminalFont, terminalFontSize, terminalTheme };
    if (!changed) return;
    const fontFamily = TERMINAL_FONT_FAMILIES[terminalFont];
    const fontLoadTarget = TERMINAL_FONT_LOAD_TARGETS[terminalFont];
    term.options.fontFamily = fontFamily;
    term.options.fontSize = terminalFontSize;
    const xtermTheme = getXtermTheme(terminalTheme);
    term.options.theme = {
      ...xtermTheme,
      cursorAccent: xtermTheme.background,
      selectionBackground: `${xtermTheme.foreground}30`,
    };

    let cancelled = false;
    const fitTerminal = () => {
      if (cancelled || !mountedRef.current) return;
      // Preserve scroll position across atlas clear + fit
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      const savedViewportY = buf.viewportY;
      forceTerminalFontRemeasure(term, fontFamily);
      const fit = fitAddonRef.current;
      if (fit) {
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
        } catch { /* ignore */ }
      }
      // Font change may alter container metrics — invalidate cached rect.
      if (mountedRef.current && termRef.current) invalidateContainerRect(termRef.current);
      term.refresh(0, term.rows - 1);
      if (wasAtBottom) {
        term.scrollToBottom();
      } else if (buf.viewportY !== savedViewportY) {
        term.scrollLines(savedViewportY - buf.viewportY);
      }
    };

    const timer = window.setTimeout(() => {
      requestAnimationFrame(fitTerminal);
    }, 120);

    if (fontLoadTarget && "fonts" in document) {
      void waitForTerminalFont(fontLoadTarget, terminalFontSize).then(() => {
        window.clearTimeout(timer);
        requestAnimationFrame(fitTerminal);
      });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [terminalFont, terminalFontSize, terminalTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus terminal when it becomes the active window.
  // isSessionReady ensures focus applies if isActive was already true at mount time.
  useEffect(() => {
    if (isActive) termInstanceRef.current?.focus();
  }, [isActive, isSessionReady]);

  // Re-fit when resized
  useEffect(() => {
    const term = termInstanceRef.current;
    const fit = fitAddonRef.current;
    const container = termRef.current;
    if (!fit || !term) return;
    // Skip the redundant mount run — Effect B already fit at the current size.
    const prev = lastFitSizeRef.current;
    const changed = prev.windowWidth !== windowWidth || prev.windowHeight !== windowHeight;
    lastFitSizeRef.current = { windowWidth, windowHeight };
    if (!changed) return;
    requestAnimationFrame(() => {
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && ptyIdRef.current) invoke("resize_terminal", { id: ptyIdRef.current, rows: dims.rows, cols: dims.cols });
      } catch { /* ignore */ }
      if (wasAtBottom) term.scrollToBottom();
      // Container geometry changed — invalidate cached rect so the next
      // mousemove re-measures the real position.
      if (container) invalidateContainerRect(container);
    });
  }, [windowWidth, windowHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  return { termInstanceRef, fitAddonRef, isSessionReady };
}
