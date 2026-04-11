import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar, { CreateWorkspaceDialog, type SidebarWindow } from "@/components/layout/Sidebar";
import SettingsPanel from "@/components/layout/SettingsPanel";
import QuitGuardDialog from "@/components/layout/QuitGuardDialog";
import PasteConfirmDialog from "@/components/layout/PasteConfirmDialog";
import ShortcutsOverlay from "@/components/layout/ShortcutsOverlay";
import ZoomSpeedControl from "@/components/layout/ZoomSpeedControl";
import UsageLimitsCard from "@/components/layout/UsageLimitsCard";
import Canvas from "@/components/canvas/Canvas";
import EmptyCanvasState from "@/components/canvas/EmptyCanvasState";
import { persistState, loadPersistedState } from "@/lib/persistence";
import { DEFAULT_VIEWPORT, hydratePersistedState } from "@/lib/persisted-state";
import {
  buildTerminalHydrationQueue,
  collectTerminalIds,
  TERMINAL_HYDRATION_CONCURRENCY,
} from "@/lib/terminal-hydration";
import { isWindowInViewport } from "@/lib/viewport";
import { confirmAppQuit, QUIT_REQUESTED_EVENT } from "@/lib/quit-guard";
import type { PersistedState, ViewportState } from "@/lib/persistence";
import type { WindowState, Workspace, WindowKind, WindowUpdatable, Point2D, PasteRequest, CodeViewMode } from "@/types";

interface AppSnapshot {
  workspaces: Workspace[];
  windows: WindowState[];
  activeWorkspaceId: string | null;
  pan: Point2D;
  zoom: number;
}

const SIDEBAR_RIGHT_EDGE = 288 + 12 + 24; // w-72 (288px) + left-3 (12px) + gap (24px)
const GRID_TOP = 13; // align with sidebar top-3 (13px)
const GRID_GAP = 24;

export default function App() {
  // ── Loading ──
  const [loaded, setLoaded] = useState(false);

  // ── Core state ──
  const nextZRef = useRef(1);
  const countsRef = useRef<Record<WindowKind, number>>({ terminal: 0, note: 0, code: 0 });
  const spawnOffset = useRef(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [hydratedTerminalIds, setHydratedTerminalIds] = useState<Set<string>>(() => new Set());
  const [bootingTerminalIds, setBootingTerminalIds] = useState<Set<string>>(() => new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [quitDialogOpen, setQuitDialogOpen] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsDismissVersion, setSettingsDismissVersion] = useState(0);
  const [pasteConfirmState, setPasteConfirmState] = useState<PasteRequest | null>(null);
  const hasWorkspaces = workspaces.length > 0;

  // ── Viewport (per-workspace, lifted from Canvas) ──
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const viewportsRef = useRef<Record<string, ViewportState>>({});

  // Keep viewportsRef always in sync with live pan/zoom for the active workspace.
  // This avoids stale overlays in collectState during rapid workspace switching.
  const activeWsIdRef = useRef<string | null>(null);
  activeWsIdRef.current = activeWorkspaceId;
  if (activeWorkspaceId) {
    viewportsRef.current[activeWorkspaceId] = { panX: pan.x, panY: pan.y, zoom };
  }

  const activeWindowIdRef = useRef<string | null>(null);
  activeWindowIdRef.current = activeWindowId;

  const terminalRestoreQueueRef = useRef<string[]>([]);
  const hydratedTerminalIdsRef = useRef(new Set<string>());
  const bootingTerminalIdsRef = useRef(new Set<string>());
  const terminalSnapshotsRef = useRef<Record<string, string>>({});

  // ── State ref (always current, avoids stale closures in save callbacks) ──
  const stateRef = useRef<AppSnapshot>({ workspaces, windows, activeWorkspaceId, pan, zoom });
  stateRef.current = { workspaces, windows, activeWorkspaceId, pan, zoom };

  // ── Pending z-index overrides (avoids direct mutation of state objects) ──
  const pendingZIndexRef = useRef<Map<string, number>>(new Map());

  // ── Save infrastructure ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmedExitRef = useRef(false);

  const collectState = useCallback((): PersistedState => {
    const { workspaces, windows, activeWorkspaceId } = stateRef.current;
    // viewportsRef is always in sync (updated in render body above), so no overlay needed
    return {
      version: 1,
      savedAt: Date.now(),
      activeWorkspaceId,
      workspaces,
      // Strip session-only ptyId before persisting; merge pending z-index overrides
      windows: windows.map((w): WindowState => {
        const pendingZ = pendingZIndexRef.current.get(w.id);
        const withZ = pendingZ != null ? { ...w, zIndex: pendingZ } : w;
        return withZ.type === "terminal" ? (({ ptyId: _, ...rest }) => rest)(withZ) : withZ;
      }),
      viewports: { ...viewportsRef.current },
      nextZ: nextZRef.current,
    };
  }, []);

  /** Schedule a save with the given delay. Cancels any pending save. */
  const scheduleSave = useCallback((delay: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (delay <= 0) {
      saveTimerRef.current = null;
      persistState(collectState()).catch(console.error);
    } else {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persistState(collectState()).catch(console.error);
      }, delay);
    }
  }, [collectState]);

  /** Immediate save after React commits the current batch of state updates. */
  const saveAfterUpdate = useCallback(() => {
    setTimeout(() => scheduleSave(0), 0);
  }, [scheduleSave]);

  // ── Load state on mount ──
  useEffect(() => {
    function initFreshState() {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setWindows([]);
      setActiveWindowId(null);
      terminalRestoreQueueRef.current = [];
      hydratedTerminalIdsRef.current = new Set();
      bootingTerminalIdsRef.current = new Set();
      terminalSnapshotsRef.current = {};
      setHydratedTerminalIds(new Set());
      setBootingTerminalIds(new Set());
      countsRef.current = { terminal: 0, note: 0, code: 0 };
      setPan({ x: 0, y: 0 });
      setZoom(1);
      viewportsRef.current = {};
    }

    loadPersistedState().then((state) => {
      if (state) {
        const hydrated = hydratePersistedState(state, {
          x: SIDEBAR_RIGHT_EDGE,
          y: 24,
          width: 560,
          height: 348,
        });
        setWorkspaces(hydrated.workspaces);
        setWindows(hydrated.windows);
        setActiveWindowId(null);
        viewportsRef.current = hydrated.viewports;
        nextZRef.current = hydrated.nextZ;
        countsRef.current = hydrated.counts;
        setActiveWorkspaceId(hydrated.activeWorkspaceId);
        setPan(hydrated.pan);
        setZoom(hydrated.zoom);
      } else {
        initFreshState();
      }
      setLoaded(true);
    }).catch((err) => {
      console.error("[persistence] Load failed:", err);
      initFreshState();
      setLoaded(true);
    });
  }, []);

  const requestQuit = useCallback(() => {
    setQuitDialogOpen(true);
  }, []);

  const syncTerminalHydrationState = useCallback(() => {
    startTransition(() => {
      setHydratedTerminalIds(new Set(hydratedTerminalIdsRef.current));
      setBootingTerminalIds(new Set(bootingTerminalIdsRef.current));
    });
  }, []);

  const pumpTerminalHydrationQueue = useCallback((sync = true): boolean => {
    let changed = false;
    const terminalIds = collectTerminalIds(stateRef.current.windows);

    while (
      bootingTerminalIdsRef.current.size < TERMINAL_HYDRATION_CONCURRENCY &&
      terminalRestoreQueueRef.current.length > 0
    ) {
      const nextId = terminalRestoreQueueRef.current.shift();
      if (!nextId) break;
      if (
        !terminalIds.has(nextId) ||
        hydratedTerminalIdsRef.current.has(nextId) ||
        bootingTerminalIdsRef.current.has(nextId)
      ) {
        continue;
      }
      bootingTerminalIdsRef.current.add(nextId);
      changed = true;
    }

    if (changed && sync) syncTerminalHydrationState();
    return changed;
  }, [syncTerminalHydrationState]);

  const handleTerminalHydrationSettled = useCallback((id: string) => {
    let changed = false;

    if (bootingTerminalIdsRef.current.delete(id)) {
      changed = true;
    }
    if (!hydratedTerminalIdsRef.current.has(id)) {
      hydratedTerminalIdsRef.current.add(id);
      changed = true;
    }

    const pumped = pumpTerminalHydrationQueue(false);
    if (changed || pumped) {
      syncTerminalHydrationState();
    }
  }, [pumpTerminalHydrationQueue, syncTerminalHydrationState]);

  useEffect(() => {
    const terminalIds = collectTerminalIds(windows);
    let changed = false;
    const nextHydrated = new Set(
      [...hydratedTerminalIdsRef.current].filter((id) => terminalIds.has(id)),
    );
    if (nextHydrated.size !== hydratedTerminalIdsRef.current.size) {
      hydratedTerminalIdsRef.current = nextHydrated;
      changed = true;
    }

    const nextBooting = new Set(
      [...bootingTerminalIdsRef.current].filter((id) => terminalIds.has(id)),
    );
    if (nextBooting.size !== bootingTerminalIdsRef.current.size) {
      bootingTerminalIdsRef.current = nextBooting;
      changed = true;
    }

    // Auto-settle booting terminals that left the viewport before they could mount.
    // This frees hydration slots that would otherwise stall the queue.
    for (const bootId of bootingTerminalIdsRef.current) {
      const win = windows.find((w) => w.id === bootId);
      if (!win || win.workspaceId !== activeWorkspaceId) continue;
      if (!isWindowInViewport(win, pan, zoom, window.innerWidth, window.innerHeight, 600)) {
        bootingTerminalIdsRef.current.delete(bootId);
        hydratedTerminalIdsRef.current.add(bootId);
        changed = true;
      }
    }

    // Only hydrate terminals that are near the viewport (mounted in Canvas).
    // Off-viewport terminals stay in queue — hydrate when user scrolls to them.
    const vpW = window.innerWidth - SIDEBAR_RIGHT_EDGE;
    const vpH = window.innerHeight;
    const mountedIds = new Set(
      windows
        .filter((w) => w.type === "terminal" && w.workspaceId === activeWorkspaceId && isWindowInViewport(w, pan, zoom, vpW, vpH, 600))
        .map((w) => w.id),
    );
    const nextQueue = buildTerminalHydrationQueue(
      windows,
      activeWorkspaceId,
      activeWindowId,
      hydratedTerminalIdsRef.current,
      bootingTerminalIdsRef.current,
      mountedIds,
    );
    const queueChanged =
      nextQueue.length !== terminalRestoreQueueRef.current.length ||
      nextQueue.some((id, index) => id !== terminalRestoreQueueRef.current[index]);
    if (queueChanged) {
      terminalRestoreQueueRef.current = nextQueue;
      changed = true;
    }

    const pumped = pumpTerminalHydrationQueue(false);
    if (changed || pumped) {
      syncTerminalHydrationState();
    }
  }, [
    windows,
    activeWorkspaceId,
    activeWindowId,
    pan,
    zoom,
    pumpTerminalHydrationQueue,
    syncTerminalHydrationState,
  ]);

  const cancelQuit = useCallback(() => {
    if (isQuitting) return;
    setQuitDialogOpen(false);
  }, [isQuitting]);

  const handleQuitConfirm = useCallback(async () => {
    if (isQuitting) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    confirmedExitRef.current = true;
    setIsQuitting(true);
    try {
      await confirmAppQuit(collectState);
    } catch (error) {
      confirmedExitRef.current = false;
      setIsQuitting(false);
      console.error("[quit-guard] Quit confirmation failed:", error);
    }
  }, [collectState, isQuitting]);

  // ── Window close → guard modal ──
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow().onCloseRequested((event) => {
      if (confirmedExitRef.current) return;
      event.preventDefault();
      requestQuit();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [requestQuit]);

  // ── App-level quit (Cmd+Q / platform quit) → same guard modal ──
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen(QUIT_REQUESTED_EVENT, () => {
      requestQuit();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [requestQuit]);

  // ── Window operations ──

  const addWindow = useCallback((type: WindowKind, forceWsId?: string) => {
    const wsId = forceWsId ?? stateRef.current.activeWorkspaceId;
    if (!wsId) return;
    setSettingsDismissVersion((value) => value + 1);
    const offset = spawnOffset.current * 30;
    spawnOffset.current = (spawnOffset.current + 1) % 8;
    countsRef.current[type] += 1;
    const title = type === "terminal"
      ? `Terminal ${countsRef.current[type]}`
      : `Note ${countsRef.current[type]}`;
    const now = Date.now();
    const ws = stateRef.current.workspaces.find((w) => w.id === wsId);
    const base = {
      id: crypto.randomUUID(),
      x: SIDEBAR_RIGHT_EDGE + offset,
      y: 24 + offset,
      width: type === "terminal" ? 820 : 420,
      height: type === "terminal" ? 600 : 320,
      zIndex: nextZRef.current++,
      title,
      workspaceId: wsId,
      createdAt: now,
      updatedAt: now,
    };
    const w: WindowState = type === "terminal"
      ? { ...base, type: "terminal", initialCwd: ws?.rootPath }
      : { ...base, type: "note" };
    if (type === "terminal") {
      // Bypass hydration queue — user-created terminals boot immediately
      hydratedTerminalIdsRef.current.add(w.id);
      setHydratedTerminalIds(new Set(hydratedTerminalIdsRef.current));
    }
    setWindows((prev) => [...prev, w]);
    setActiveWindowId(w.id);
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  /** Opens a file from the file tree as a CodeWindow (read-only, syntax highlighted). */
  const openFile = useCallback((filePath: string, workspaceId: string) => {
    // Check for existing CodeWindow or legacy NoteWindow with same source
    const existing = stateRef.current.windows.find(
      (w) => w.workspaceId === workspaceId &&
        ((w.type === "code" && w.sourcePath === filePath) ||
         (w.type === "note" && w.sourcePath === filePath)),
    );

    if (existing) {
      // DOM-direct focus (same pattern as focusWindow, inlined to avoid declaration order)
      const z = nextZRef.current++;
      const el = document.querySelector<HTMLElement>(`.canvas-world [data-window-id="${existing.id}"]`);
      if (el) el.style.zIndex = String(z);
      pendingZIndexRef.current.set(existing.id, z);
      setActiveWindowId(existing.id);
      return;
    }

    const name = filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
    countsRef.current.code += 1;
    const now = Date.now();
    const offset = spawnOffset.current * 30;
    spawnOffset.current = (spawnOffset.current + 1) % 8;
    const w: WindowState = {
      id: crypto.randomUUID(),
      x: SIDEBAR_RIGHT_EDGE + offset,
      y: 24 + offset,
      width: 820,
      height: 600,
      zIndex: nextZRef.current++,
      title: name,
      workspaceId,
      type: "code",
      sourcePath: filePath,
      viewMode: "file",
      createdAt: now,
      updatedAt: now,
    };
    setWindows((prev) => [...prev, w]);
    setActiveWindowId(w.id);
    saveAfterUpdate();
  }, [saveAfterUpdate]);

  /** Called by TerminalWindow when PTY spawns — stores ptyId in-memory (not persisted). */
  const handlePtySpawned = useCallback((windowId: string, ptyId: string | null) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === windowId && w.type === "terminal"
          ? { ...w, ptyId: ptyId ?? undefined }
          : w,
      ),
    );
    // No save — ptyId is session-ephemeral
  }, []);

  const handleTerminalSnapshotCaptured = useCallback((windowId: string, snapshot: string | null) => {
    if (snapshot) {
      terminalSnapshotsRef.current[windowId] = snapshot;
    } else {
      delete terminalSnapshotsRef.current[windowId];
    }
  }, []);

  // ── Paste confirmation ──
  const handlePasteRequest = useCallback((request: PasteRequest) => {
    const isMultiLine = request.text.includes("\n");
    if (isMultiLine) {
      setPasteConfirmState(request);
    } else {
      const data = request.bracketedPasteMode
        ? `\x1b[200~${request.text}\x1b[201~`
        : request.text;
      invoke("write_terminal", { id: request.ptyId, data }).catch(() => {});
    }
  }, []);

  const handlePasteConfirm = useCallback(() => {
    const req = pasteConfirmState;
    if (!req) return;
    const data = req.bracketedPasteMode
      ? `\x1b[200~${req.text}\x1b[201~`
      : req.text;
    invoke("write_terminal", { id: req.ptyId, data }).catch(() => {});
    setPasteConfirmState(null);
  }, [pasteConfirmState]);

  const handlePasteCancel = useCallback(() => {
    setPasteConfirmState(null);
  }, []);

  const removeWindow = useCallback((id: string) => {
    // Kill PTY before removing from state
    const win = stateRef.current.windows.find((w) => w.id === id);
    if (win?.type === "terminal" && win.ptyId) {
      invoke("kill_terminal", { id: win.ptyId }).catch(() => {});
    }
    delete terminalSnapshotsRef.current[id];
    pendingZIndexRef.current.delete(id);
    // Dismiss paste dialog if it belongs to the terminal being closed
    setPasteConfirmState((prev) => (prev?.terminalId === id ? null : prev));
    setWindows((prev) => {
      const remaining = prev.filter((w) => w.id !== id);
      setActiveWindowId((cur) =>
        cur !== id ? cur : [...remaining].sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null,
      );
      return remaining;
    });
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  /** Position/size updates during drag — debounced 2s save. */
  const updateWindow = useCallback((id: string, updates: Partial<WindowUpdatable>) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, ...updates, updatedAt: Date.now() } : w)));
    scheduleSave(2000); // drag/resize safety debounce
  }, [scheduleSave]);

  /** Note content update — debounced 500ms save. */
  const updateWindowContent = useCallback((id: string, content: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id && w.type === "note" ? { ...w, content, updatedAt: Date.now() } : w)));
    scheduleSave(500); // note editing debounce
  }, [scheduleSave]);

  const setCodeViewMode = useCallback((id: string, mode: CodeViewMode) => {
    setWindows((prev) => prev.map((w) => (w.id === id && w.type === "code" ? { ...w, viewMode: mode } : w)));
    saveAfterUpdate();
  }, [saveAfterUpdate]);

  const renameWindow = useCallback((id: string, title: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, title, updatedAt: Date.now() } : w)));
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  const focusWindow = useCallback((id: string) => {
    // Apply z-index directly via DOM — no React re-render for z stacking.
    // zIndex is session-ephemeral; it's captured from refs on the next save trigger.
    const z = nextZRef.current++;
    const el = document.querySelector<HTMLElement>(`.canvas-world [data-window-id="${id}"]`);
    if (el) el.style.zIndex = String(z);
    // Store updated zIndex in pending ref — merged on next save (no state mutation)
    pendingZIndexRef.current.set(id, z);
    setActiveWindowId(id);
  }, []);

  const arrangeWindows = useCallback(() => {
    const wsId = stateRef.current.activeWorkspaceId;
    if (!wsId) return;
    setWindows((prev) => {
      const wsWindows = prev.filter((w) => w.workspaceId === wsId);
      if (wsWindows.length === 0) return prev;
      const currentZoom = stateRef.current.zoom;
      const maxRowWidth = Math.max((window.innerWidth - SIDEBAR_RIGHT_EDGE - GRID_GAP) / currentZoom, 800);
      const positions = new Map<string, { x: number; y: number }>();

      // Group by type — notes first, then code files, then terminals
      const notes = wsWindows.filter((w) => w.type === "note");
      const code = wsWindows.filter((w) => w.type === "code");
      const terminals = wsWindows.filter((w) => w.type === "terminal");
      const groups = [notes, code, terminals].filter((g) => g.length > 0);

      // Layout a group in rows, returns the Y after the last row
      const layoutGroup = (group: WindowState[], startY: number): number => {
        let curX = SIDEBAR_RIGHT_EDGE;
        let curY = startY;
        let rowHeight = 0;
        for (const w of group) {
          if (curX + w.width > SIDEBAR_RIGHT_EDGE + maxRowWidth && curX > SIDEBAR_RIGHT_EDGE) {
            curX = SIDEBAR_RIGHT_EDGE;
            curY += rowHeight + GRID_GAP;
            rowHeight = 0;
          }
          positions.set(w.id, { x: curX, y: curY });
          curX += w.width + GRID_GAP;
          rowHeight = Math.max(rowHeight, w.height);
        }
        return group.length > 0 ? curY + rowHeight : startY;
      };

      let bottomY = GRID_TOP;
      for (let i = 0; i < groups.length; i++) {
        if (i > 0) bottomY += GRID_GAP;
        bottomY = layoutGroup(groups[i], bottomY);
      }

      return prev.map((w) => {
        const pos = positions.get(w.id);
        return pos ? { ...w, ...pos } : w;
      });
    });
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  // ── Workspace operations ──

  const switchWorkspace = useCallback((newId: string) => {
    const { activeWorkspaceId: curId, pan, zoom } = stateRef.current;
    if (newId === curId) return;
    // Save current viewport
    if (curId) {
      viewportsRef.current[curId] = { panX: pan.x, panY: pan.y, zoom };
    }
    // Restore new workspace viewport
    const vp = viewportsRef.current[newId] ?? DEFAULT_VIEWPORT;
    setPan({ x: vp.panX, y: vp.panY });
    setZoom(vp.zoom);
    setActiveWorkspaceId(newId);
    saveAfterUpdate(); // immediate — workspace switch
  }, [saveAfterUpdate]);

  const addWorkspace = useCallback((workspace: Workspace) => {
    // Save current viewport before switching
    const { activeWorkspaceId: curId, pan, zoom } = stateRef.current;
    if (curId) {
      viewportsRef.current[curId] = { panX: pan.x, panY: pan.y, zoom };
    }
    // New workspace starts at default viewport
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setWorkspaces((prev) => [...prev, workspace]);
    setActiveWorkspaceId(workspace.id);
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  const updateWorkspace = useCallback((id: string, updates: Partial<Omit<Workspace, "id">>) => {
    setWorkspaces((prev) => prev.map((ws) => (ws.id === id ? { ...ws, ...updates } : ws)));
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  const deleteWorkspace = useCallback((id: string) => {
    // Kill all PTYs for this workspace
    for (const win of stateRef.current.windows) {
      if (win.workspaceId === id && win.type === "terminal" && win.ptyId) {
        invoke("kill_terminal", { id: win.ptyId }).catch(() => {});
      }
      if (win.workspaceId === id) {
        delete terminalSnapshotsRef.current[win.id];
        pendingZIndexRef.current.delete(win.id);
      }
    }
    setWorkspaces((prev) => {
      const remaining = prev.filter((ws) => ws.id !== id);
      setActiveWorkspaceId((cur) => {
        if (cur === id) {
          const newId = remaining[0]?.id ?? null;
          const vp = newId ? (viewportsRef.current[newId] ?? DEFAULT_VIEWPORT) : DEFAULT_VIEWPORT;
          setPan({ x: vp.panX, y: vp.panY });
          setZoom(vp.zoom);
          return newId;
        }
        return cur;
      });
      return remaining;
    });
    setWindows((prev) => {
      const next = prev.filter((w) => w.workspaceId !== id);
      const removedIds = new Set(prev.filter((w) => w.workspaceId === id).map((w) => w.id));
      if (removedIds.size > 0) {
        setActiveWindowId((cur) => (cur && removedIds.has(cur) ? null : cur));
      }
      // Reset naming counters when no windows remain
      if (next.length === 0) {
        countsRef.current = { terminal: 0, note: 0, code: 0 };
      }
      return next;
    });
    delete viewportsRef.current[id];
    saveAfterUpdate(); // immediate — structural change
  }, [saveAfterUpdate]);

  // ── Canvas double-click: add terminal, or auto-create scratch workspace first ──
  const handleCanvasDoubleClick = useCallback(() => {
    if (stateRef.current.workspaces.length === 0) {
      const ws: Workspace = {
        id: crypto.randomUUID(),
        name: "Scratch",
        color: "blue",
        icon: "terminal",
      };
      addWorkspace(ws);
      addWindow("terminal", ws.id);
    } else {
      addWindow("terminal");
    }
  }, [addWorkspace, addWindow]);

  // ── Sidebar terminal click → switch workspace + zoom-to-fit + focus ──
  const focusWindowFromSidebar = useCallback((id: string) => {
    const win = stateRef.current.windows.find((w) => w.id === id);
    if (!win) return;
    if (win.workspaceId !== stateRef.current.activeWorkspaceId) {
      switchWorkspace(win.workspaceId);
    }
    // Smooth pan to the window — add transition class, remove after animation
    const world = document.querySelector<HTMLElement>(".canvas-world");
    if (world) {
      world.classList.add("animating");
      const cleanup = () => { world.classList.remove("animating"); world.removeEventListener("transitionend", cleanup); };
      world.addEventListener("transitionend", cleanup, { once: true });
      // Safety fallback — remove class after 400ms if transitionend doesn't fire
      setTimeout(cleanup, 400);
    }
    // Center viewport on the window at zoom 1.0 — offset for sidebar
    const targetZoom = 1;
    const centerX = win.x + win.width / 2;
    const centerY = win.y + win.height / 2;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const fileDrawerW = document.querySelector('.sidebar-file-drawer[data-state="open"]') ? 240 : 0;
    const visibleCenterX = (SIDEBAR_RIGHT_EDGE + fileDrawerW + vpW) / 2;
    setPan({ x: visibleCenterX - centerX * targetZoom, y: vpH / 2 - centerY * targetZoom });
    setZoom(targetZoom);
    focusWindow(id);
    // Terminals: useEffect([isActive]) in TerminalWindow handles xterm focus after React commit.
    // Notes: click preview to enter edit mode (cursor-at-end via useEffect([isEditing])).
    if (win.type === "note") {
      requestAnimationFrame(() => {
        const active = document.querySelector<HTMLElement>(`.window[data-active="true"]`);
        if (!active) return;
        const editor = active.querySelector<HTMLElement>('.note-editor');
        if (editor) { editor.focus(); return; }
        active.querySelector<HTMLElement>('.note-preview')?.click();
      });
    }
  }, [focusWindow, switchWorkspace]);

  // ── Global keyboard shortcuts ──
  const modalOpenRef = useRef(false);
  modalOpenRef.current = quitDialogOpen || shortcutsOpen || createDialogOpen || pasteConfirmState !== null;
  const shortcutsOpenRef = useRef(false);
  shortcutsOpenRef.current = shortcutsOpen;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Block all shortcuts when any modal is open (except closing shortcuts itself)
      if (modalOpenRef.current) {
        // Only allow Cmd+Shift+? to close the shortcuts overlay
        if (meta && e.shiftKey && e.key === "?" && shortcutsOpenRef.current) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }

      // Cmd+Shift+? — toggle shortcuts overlay
      if (meta && e.shiftKey && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      // Cmd+W — close active window
      if (meta && !e.shiftKey && e.key === "w") {
        if (activeWindowIdRef.current) {
          e.preventDefault();
          removeWindow(activeWindowIdRef.current);
        }
        return;
      }

      // Cmd+N — new terminal
      if (meta && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        addWindow("terminal");
        return;
      }

      // Cmd+Shift+N — new note
      if (meta && e.shiftKey && e.key === "N") {
        e.preventDefault();
        addWindow("note");
        return;
      }

      // Cmd+Shift+W — new workspace
      if (meta && e.shiftKey && e.key === "W") {
        e.preventDefault();
        setCreateDialogOpen(true);
        return;
      }

      // Cmd+Shift+A — arrange windows in grid
      if (meta && e.shiftKey && e.key === "A") {
        e.preventDefault();
        arrangeWindows();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [addWindow, removeWindow, arrangeWindows]);

  // ── Sidebar window projection (excludes geometry → stable during drag/resize) ──
  const sidebarWindowsKeyRef = useRef("");
  const sidebarWindowsCacheRef = useRef<SidebarWindow[]>([]);
  const sidebarWindows = useMemo(() => {
    // Build a key from only the fields sidebar cares about
    const key = windows
      .map((w) => `${w.id}|${w.type}|${w.title}|${w.workspaceId}|${"sourcePath" in w ? w.sourcePath : ""}`)
      .join("\n");
    if (key === sidebarWindowsKeyRef.current) return sidebarWindowsCacheRef.current;
    sidebarWindowsKeyRef.current = key;
    sidebarWindowsCacheRef.current = windows.map((w) => ({
      id: w.id,
      type: w.type,
      title: w.title,
      workspaceId: w.workspaceId,
      sourcePath: "sourcePath" in w ? w.sourcePath : undefined,
    }));
    return sidebarWindowsCacheRef.current;
  }, [windows]);

  // ── Loading screen ──
  if (!loaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Loading workspace\u2026</p>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Canvas
        windows={windows}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeWindowId={activeWindowId}
        hydratedTerminalIds={hydratedTerminalIds}
        bootingTerminalIds={bootingTerminalIds}
        pan={pan}
        zoom={zoom}
        onPanChange={setPan}
        onZoomChange={setZoom}
        onRemove={removeWindow}
        onUpdate={updateWindow}
        onUpdateContent={updateWindowContent}
        onRename={renameWindow}
        onFocus={focusWindow}
        onTerminalHydrationSettled={handleTerminalHydrationSettled}
        onPtySpawned={handlePtySpawned}
        onTerminalSnapshotCaptured={handleTerminalSnapshotCaptured}
        terminalSnapshots={terminalSnapshotsRef.current}
        onDoubleClick={handleCanvasDoubleClick}
        onAddTerminal={() => addWindow("terminal")}
        onAddNote={() => addWindow("note")}
        onArrangeWindows={arrangeWindows}
        onCreateWorkspace={() => setCreateDialogOpen(true)}
        onPasteRequest={handlePasteRequest}
        onViewModeChange={setCodeViewMode}
      />

      {hasWorkspaces ? (
        <Sidebar
          windows={sidebarWindows}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          activeWindowId={activeWindowId}
          onCreateDialogChange={setCreateDialogOpen}
          onFocusWindow={focusWindowFromSidebar}
          onAddNote={() => addWindow("note")}
          onSelectWorkspace={switchWorkspace}
          onUpdateWorkspace={updateWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onArrangeWindows={arrangeWindows}
          onRenameWindow={renameWindow}
          onRemoveWindow={removeWindow}
          onOpenFile={openFile}
        />
      ) : null}

      {hasWorkspaces ? null : (
        <EmptyCanvasState onCreateWorkspace={() => setCreateDialogOpen(true)} />
      )}

      <CreateWorkspaceDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateWorkspace={addWorkspace}
      />

      <PasteConfirmDialog
        open={pasteConfirmState !== null}
        text={pasteConfirmState?.text ?? ""}
        onCancel={handlePasteCancel}
        onConfirm={handlePasteConfirm}
      />

      <QuitGuardDialog
        open={quitDialogOpen}
        isQuitting={isQuitting}
        onCancel={cancelQuit}
        onConfirm={handleQuitConfirm}
      />

      <ShortcutsOverlay
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />

      {hasWorkspaces ? <UsageLimitsCard /> : null}

      {hasWorkspaces ? (
        <div className="fixed bottom-3 right-3 z-40 grid w-40 grid-cols-3 gap-1">
          <ZoomSpeedControl />
          <SettingsPanel dismissVersion={settingsDismissVersion} />
          <button
            type="button"
            className="glass-subtle flex h-8 cursor-pointer items-center justify-center rounded-lg text-[11px] font-medium tabular-nums text-muted-foreground transition-colors select-none hover:text-foreground"
            onClick={() => {
              setZoom(1);
              // Offset pan.x so content starts after file tree drawer if open (w-60 = 240px)
              const fileDrawerOpen = !!document.querySelector('.sidebar-file-drawer[data-state="open"]');
              setPan({ x: fileDrawerOpen ? 240 : 0, y: 0 });
            }}
            aria-label="Reset viewport"
          >
            {Math.round(zoom * 100)}%
          </button>
        </div>
      ) : null}
    </div>
  );
}
