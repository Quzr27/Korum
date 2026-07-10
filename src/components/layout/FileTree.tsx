import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  PencilEdit01Icon,
  Delete01Icon,
  Add01Icon,
  FolderAddIcon,
} from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { getFileIconName, GIT_STATUS_COLORS } from "@/lib/file-icons";
import { getFileTreeRevealDirectories } from "@/lib/file-tree-reveal";
import { buildGitStatusByAbsolutePath, normalizeChangedFiles } from "@/lib/changed-files";
import ChangedFilesStrip from "@/components/layout/ChangedFilesStrip";
import type { CodeViewMode, FileEntry, GitStatusResult } from "@/types";

// ── Helpers ──

function FileIcon({ entry, isExpanded, size = 16 }: { entry: FileEntry; isExpanded?: boolean; size?: number }) {
  const iconName = getFileIconName(entry, isExpanded);
  return <Icon icon={`material-icon-theme:${iconName}`} width={size} height={size} className="shrink-0" />;
}

// ── Flat tree row ──

interface TreeRow {
  entry: FileEntry;
  depth: number;
}

const WATCHER_REFRESH_DEBOUNCE_MS = 100;

// ── Props ──

interface FileTreeProps {
  rootPath: string;
  query: string;
  wsColor: string;
  showIgnored: boolean;
  activeFilePath?: string;
  openFilePaths?: ReadonlySet<string>;
  onOpenFile: (filePath: string, viewMode?: CodeViewMode) => void;
}

/** Reject names with path separators or traversal components. */
function isValidFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/[/\\]/.test(trimmed) && !/^\.\.?$/.test(trimmed);
}

export default function FileTree({
  rootPath,
  query,
  wsColor,
  showIgnored,
  activeFilePath,
  openFilePaths = new Set<string>(),
  onOpenFile,
}: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([rootPath]));
  const [entries, setEntries] = useState<Map<string, FileEntry[]>>(new Map());
  const [gitStatusResult, setGitStatusResult] = useState<GitStatusResult | null>(null);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingIn, setCreatingIn] = useState<{ dir: string; type: "file" | "folder" } | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [watcherError, setWatcherError] = useState(false);
  const mountedRef = useRef(true);
  const expandedPathsRef = useRef(expandedPaths);
  const requestCoalescedRefreshRef = useRef<() => void>(() => {});
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const validationMessageId = useId();
  expandedPathsRef.current = expandedPaths;

  // ── Fetch directory ──

  const showIgnoredRef = useRef(showIgnored);
  showIgnoredRef.current = showIgnored;

  const fetchDirectory = useCallback(async (dirPath: string) => {
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
    try {
      const result = await invoke<FileEntry[]>("read_directory", { path: dirPath, showIgnored: showIgnoredRef.current });
      if (!mountedRef.current) return;
      setEntries((prev) => {
        const next = new Map(prev);
        next.set(dirPath, result);
        return next;
      });
    } catch (err) {
      console.error("[file-tree] Failed to read directory:", err);
    } finally {
      if (mountedRef.current) {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    }
  }, []);

  const fetchGitStatus = useCallback(async () => {
    try {
      const result = await invoke<GitStatusResult>("get_git_status", { rootPath });
      if (!mountedRef.current) return;
      setGitStatusResult(result);
    } catch {
      if (mountedRef.current) setGitStatusResult(null);
    }
  }, [rootPath]);

  // ── Mount: load root + git status + start watcher ──

  useEffect(() => {
    let alive = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;
    let watcherStarted = false;
    let watcherReleased = false;
    mountedRef.current = true;

    function scheduleRefresh() {
      if (!alive) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void runRefresh();
      }, WATCHER_REFRESH_DEBOUNCE_MS);
    }
    requestCoalescedRefreshRef.current = scheduleRefresh;

    async function runRefresh() {
      if (!alive) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      refreshQueued = false;
      try {
        const directoryRefreshes = [...expandedPathsRef.current].map((dir) => fetchDirectory(dir));
        await Promise.all([...directoryRefreshes, fetchGitStatus()]);
      } finally {
        refreshInFlight = false;
        if (alive && refreshQueued) scheduleRefresh();
      }
    }

    void runRefresh();
    const releaseWatcher = () => {
      if (!watcherStarted || watcherReleased) return;
      watcherReleased = true;
      void invoke("stop_watching", { rootPath }).catch(() => {});
    };
    void invoke("start_watching", { rootPath }).then(() => {
      watcherStarted = true;
      // start_watching resolves only after its ref-count entry is committed.
      // If unmount won the race, release this exact start once now.
      if (!alive) releaseWatcher();
    }).catch(() => {
      if (alive) setWatcherError(true);
    });

    // Store unlisten fn synchronously when resolved
    let unlistenFn: (() => void) | null = null;

    listen<string>("file-tree-changed", (event) => {
      if (!alive) return;
      if (event.payload === rootPath) {
        scheduleRefresh();
      }
    }).then((fn) => {
      if (alive) {
        unlistenFn = fn;
      } else {
        // Effect already cleaned up before listen resolved — unlisten immediately
        fn();
      }
    });

    return () => {
      alive = false;
      mountedRef.current = false;
      requestCoalescedRefreshRef.current = () => {};
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      unlistenFn?.();
      releaseWatcher();
    };
  }, [rootPath, fetchDirectory, fetchGitStatus]);

  // ── Re-fetch on showIgnored toggle (without restarting watcher) ──

  const showIgnoredInitRef = useRef(showIgnored);
  useEffect(() => {
    // Skip the initial mount — the mount effect already fetches
    if (showIgnoredInitRef.current === showIgnored) return;
    showIgnoredInitRef.current = showIgnored;
    requestCoalescedRefreshRef.current();
  }, [showIgnored]);

  useEffect(() => {
    if (!activeFilePath) return;
    const dirs = getFileTreeRevealDirectories(rootPath, activeFilePath);
    if (dirs.length === 0) return;

    setExpandedPaths((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of dirs) {
        if (!next.has(dir)) {
          next.add(dir);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    for (const dir of dirs) {
      if (!entries.has(dir)) {
        fetchDirectory(dir);
      }
    }
  }, [activeFilePath, entries, fetchDirectory, rootPath]);

  // ── Expand/collapse ──

  const toggleExpand = useCallback(
    (dirPath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          if (!entries.has(dirPath)) {
            fetchDirectory(dirPath);
          }
        }
        return next;
      });
    },
    [entries, fetchDirectory],
  );

  // ── Flatten tree (memoized) ──

  const flatRows = useMemo(() => {
    const rows: TreeRow[] = [];
    const normalizedQuery = query.trim().toLowerCase();

    const hasMatchInSubtree = (dirPath: string, q: string, visited = new Set<string>()): boolean => {
      if (visited.has(dirPath)) return false; // prevent symlink loops
      visited.add(dirPath);
      const dirEntries = entries.get(dirPath);
      if (!dirEntries) return false;
      for (const entry of dirEntries) {
        if (entry.name.toLowerCase().includes(q)) return true;
        if (entry.is_dir && hasMatchInSubtree(entry.path, q, visited)) return true;
      }
      return false;
    };

    const buildFlatList = (dirPath: string, depth: number) => {
      const dirEntries = entries.get(dirPath);
      if (!dirEntries) return;

      for (const entry of dirEntries) {
        const matchesFilter = !normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery);

        if (entry.is_dir) {
          const isExpanded = expandedPaths.has(entry.path);
          const hasMatchingDescendants = normalizedQuery ? hasMatchInSubtree(entry.path, normalizedQuery) : true;

          if (matchesFilter || hasMatchingDescendants) {
            rows.push({ entry, depth });
            if (isExpanded || (normalizedQuery && hasMatchingDescendants)) {
              buildFlatList(entry.path, depth + 1);
            }
          }
        } else if (matchesFilter) {
          rows.push({ entry, depth });
        }
      }
    };

    buildFlatList(rootPath, 0);
    return rows;
  }, [entries, expandedPaths, query, rootPath]);

  useEffect(() => {
    if (!activeFilePath || !activeRowRef.current) return;
    const frame = requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeFilePath, flatRows]);

  // ── Git status for a path ──

  const changedFileRows = useMemo(
    () => normalizeChangedFiles({ workspaceRoot: rootPath, status: gitStatusResult }),
    [gitStatusResult, rootPath],
  );
  const changedFileStats = useMemo(() => (
    changedFileRows.reduce(
      (total, row) => ({
        insertions: total.insertions + row.insertions,
        deletions: total.deletions + row.deletions,
      }),
      { insertions: 0, deletions: 0 },
    )
  ), [changedFileRows]);

  const gitStatus = useMemo(
    () => buildGitStatusByAbsolutePath({ workspaceRoot: rootPath, status: gitStatusResult }),
    [gitStatusResult, rootPath],
  );

  const getFileGitInfo = useCallback(
    (entryPath: string): { status: string; insertions: number; deletions: number } | undefined => {
      return gitStatus.get(entryPath.replace(/\\/g, "/").replace(/\/$/, ""));
    },
    [gitStatus],
  );

  const dirHasChanges = useCallback(
    (dirPath: string): boolean => {
      const normalizedDirPath = dirPath.replace(/\\/g, "/").replace(/\/$/, "");
      for (const [path] of gitStatus) {
        if (path.startsWith(`${normalizedDirPath}/`)) return true;
      }
      return false;
    },
    [gitStatus],
  );

  // ── File operations (pass rootPath for confinement) ──

  const handleRenameCommit = useCallback(async () => {
    const currentPath = renamingPath;
    if (!currentPath || !renameValue.trim()) {
      setRenamingPath(null);
      setDraftError(null);
      return;
    }
    if (!isValidFileName(renameValue)) {
      setDraftError("Use a name without slashes or \".\" / \"..\".");
      return;
    }
    const parentDir = currentPath.substring(0, currentPath.lastIndexOf("/"));
    const newPath = `${parentDir}/${renameValue.trim()}`;
    if (newPath !== currentPath) {
      try {
        await invoke("rename_path", { oldPath: currentPath, newPath, root: rootPath });
      } catch (err) {
        console.error("[file-tree] Rename failed:", err);
        // Only surface error if this rename is still active (not superseded by another)
        if (renamingPath === currentPath) {
          setDraftError(String(err));
          return;
        }
        return;
      }
    }
    // Only clear if this rename is still active
    if (renamingPath === currentPath) {
      setRenamingPath(null);
      setDraftError(null);
    }
  }, [renamingPath, renameValue, rootPath]);

  const handleCreateCommit = useCallback(async () => {
    if (!creatingIn || !createValue.trim()) {
      setCreatingIn(null);
      setDraftError(null);
      return;
    }
    if (!isValidFileName(createValue)) {
      setDraftError("Use a name without slashes or \".\" / \"..\".");
      return;
    }
    const newPath = `${creatingIn.dir}/${createValue.trim()}`;
    try {
      if (creatingIn.type === "file") {
        await invoke("create_file", { path: newPath, root: rootPath });
      } else {
        await invoke("create_directory", { path: newPath, root: rootPath });
      }
    } catch (err) {
      console.error("[file-tree] Create failed:", err);
      setDraftError(`Couldn\u2019t create this ${creatingIn.type}.`);
      return;
    }
    setCreatingIn(null);
    setCreateValue("");
    setDraftError(null);
  }, [creatingIn, createValue, rootPath]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_path", { path: deleteTarget.path, root: rootPath });
    } catch (err) {
      console.error("[file-tree] Delete failed:", err);
    }
    setDeleteTarget(null);
  }, [deleteTarget, rootPath]);

  const startRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
    setCreatingIn(null);
    setDraftError(null);
  }, []);

  const startCreate = useCallback((dirPath: string, type: "file" | "folder") => {
    setCreatingIn({ dir: dirPath, type });
    setCreateValue("");
    setRenamingPath(null);
    setDraftError(null);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });
    if (!entries.has(dirPath)) {
      fetchDirectory(dirPath);
    }
  }, [entries, fetchDirectory]);

  // ── Render ──

  return (
    <>
      <ChangedFilesStrip rows={changedFileRows} onOpenFile={onOpenFile} />

      {/* Watcher error indicator */}
      {watcherError && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-muted-foreground/50 italic">
          <span className="size-1.5 rounded-full bg-amber-500/60 shrink-0" />
          Live updates unavailable
        </div>
      )}

      {/* Git diff stats summary */}
      {(changedFileStats.insertions > 0 || changedFileStats.deletions > 0) && (
        <div className="flex items-center gap-2.5 px-3 py-1.5 text-[10px] tabular-nums">
          {changedFileStats.insertions > 0 && (
            <span style={{ color: GIT_STATUS_COLORS.A }}>+{changedFileStats.insertions}</span>
          )}
          {changedFileStats.deletions > 0 && (
            <span style={{ color: GIT_STATUS_COLORS.D }}>&minus;{changedFileStats.deletions}</span>
          )}
          <span className="text-muted-foreground/30">
            {changedFileRows.length} file{changedFileRows.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {flatRows.length === 0 && !loadingDirs.has(rootPath) && (
          <span className="pl-7 text-[10px] text-muted-foreground/50 italic">
            {query.trim() ? "No matching files" : "Empty"}
          </span>
        )}

        {flatRows.map((row) => {
          const { entry, depth } = row;
          const isExpanded = expandedPaths.has(entry.path);
          const gitInfo = entry.is_dir ? undefined : getFileGitInfo(entry.path);
          const hasChanges = entry.is_dir && dirHasChanges(entry.path);
          const isRenaming = renamingPath === entry.path;
          const isOpen = !entry.is_dir && openFilePaths.has(entry.path);
          const isActiveFile = !entry.is_dir && activeFilePath === entry.path;

          if (isRenaming) {
            return (
              <div
                key={entry.path}
                className="rounded-md bg-sidebar-accent/80 px-2 py-1"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
              >
                <div className="flex items-center gap-1.5">
                  <FileIcon entry={entry} size={14} />
                  <input
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                      setDraftError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameCommit();
                      if (e.key === "Escape") {
                        setRenamingPath(null);
                        setDraftError(null);
                      }
                    }}
                    onBlur={handleRenameCommit}
                    autoFocus
                    name="rename-file"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Rename file or folder"
                    aria-invalid={!!draftError}
                    aria-describedby={draftError ? validationMessageId : undefined}
                    className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
                  />
                </div>
                {draftError && (
                  <p id={validationMessageId} className="pt-1 text-[10px] text-destructive" aria-live="polite">
                    {draftError}
                  </p>
                )}
              </div>
            );
          }

          return (
            <ContextMenu key={entry.path}>
              <ContextMenuTrigger asChild>
                <button
                  ref={isActiveFile ? activeRowRef : undefined}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[11px] transition-colors",
                    isActiveFile
                      ? "font-medium"
                      : isOpen
                        ? "text-foreground/80"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50",
                    entry.is_ignored && "opacity-40",
                  )}
                  style={{ paddingLeft: `${8 + depth * 16}px`, ...(isActiveFile ? { color: wsColor } : undefined) }}
                  onClick={() => {
                    if (entry.is_dir) {
                      toggleExpand(entry.path);
                    } else {
                      onOpenFile(entry.path);
                    }
                  }}
                >
                  {entry.is_dir ? (
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      size={12}
                      className="shrink-0 opacity-40 motion-safe:transition-transform motion-safe:duration-150"
                      style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                    />
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}

                  <FileIcon entry={entry} isExpanded={isExpanded} size={14} />

                  <span className="truncate flex-1">{entry.name}</span>

                  {/* Folder child count badge */}
                  {entry.is_dir && entry.child_count != null && entry.child_count > 0 && (
                    <span className="text-[9px] tabular-nums text-muted-foreground/40 shrink-0">
                      {entry.child_count}
                    </span>
                  )}

                  {/* Per-file diff stats */}
                  {gitInfo && (gitInfo.insertions > 0 || gitInfo.deletions > 0) && (
                    <span className="flex items-center gap-1 text-[9px] tabular-nums shrink-0">
                      {gitInfo.insertions > 0 && (
                        <span style={{ color: GIT_STATUS_COLORS.A }}>+{gitInfo.insertions}</span>
                      )}
                      {gitInfo.deletions > 0 && (
                        <span style={{ color: GIT_STATUS_COLORS.D }}>&minus;{gitInfo.deletions}</span>
                      )}
                    </span>
                  )}

                  {gitInfo && (
                    <span className="text-[9px] font-bold shrink-0 pr-1 text-sidebar-primary/70">
                      {gitInfo.status}
                    </span>
                  )}

                  {hasChanges && !gitInfo && (
                    <span
                      className="size-1.5 rounded-full shrink-0 mr-1"
                      style={{ backgroundColor: wsColor, opacity: 0.8 }}
                    />
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {entry.is_dir && (
                  <>
                    <ContextMenuItem onClick={() => startCreate(entry.path, "file")}>
                      <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                      New File
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => startCreate(entry.path, "folder")}>
                      <HugeiconsIcon icon={FolderAddIcon} data-icon="inline-start" />
                      New Folder
                    </ContextMenuItem>
                  </>
                )}
                <ContextMenuItem onClick={() => startRename(entry)}>
                  <HugeiconsIcon icon={PencilEdit01Icon} data-icon="inline-start" />
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive! **:text-destructive!"
                  onClick={() => setDeleteTarget(entry)}
                >
                  <HugeiconsIcon icon={Delete01Icon} data-icon="inline-start" />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}

        {creatingIn && (
          <div
            className="rounded-md bg-sidebar-accent/80 px-2 py-1"
            style={{
              paddingLeft: `${8 + (flatRows.find((r) => r.entry.path === creatingIn.dir)?.depth ?? 0) * 16 + 16}px`,
            }}
          >
            <div className="flex items-center gap-1.5">
              <Icon
                icon={creatingIn.type === "folder" ? "material-icon-theme:folder" : "material-icon-theme:file"}
                width={14}
                height={14}
                className="shrink-0"
              />
              <input
                value={createValue}
                onChange={(e) => {
                  setCreateValue(e.target.value);
                  setDraftError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCommit();
                  if (e.key === "Escape") {
                    setCreatingIn(null);
                    setDraftError(null);
                  }
                }}
                onBlur={handleCreateCommit}
                autoFocus
                name={creatingIn.type === "folder" ? "new-folder-name" : "new-file-name"}
                autoComplete="off"
                spellCheck={false}
                placeholder={creatingIn.type === "folder" ? "folder name\u2026" : "file name\u2026"}
                aria-label={creatingIn.type === "folder" ? "New folder name" : "New file name"}
                aria-invalid={!!draftError}
                aria-describedby={draftError ? validationMessageId : undefined}
                className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm placeholder:text-muted-foreground/40"
              />
            </div>
            {draftError && (
              <p id={validationMessageId} className="pt-1 text-[10px] text-destructive" aria-live="polite">
                {draftError}
              </p>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.is_dir
                ? "This directory and all its contents will be permanently deleted."
                : "This file will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className="text-destructive! **:text-destructive!" onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export type { FileTreeProps };
