import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Folder01Icon,
  CodeIcon,
  Note01Icon,
  ApiIcon,
  Settings01Icon,
  File01Icon,
  PencilEdit01Icon,
  Delete01Icon,
  Add01Icon,
  FolderAddIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
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
import type { FileEntry, GitStatusResult } from "@/types";

// ── File icon mapping ──

const EXT_ICONS: Record<string, IconSvgElement> = {
  ts: CodeIcon,
  tsx: CodeIcon,
  js: CodeIcon,
  jsx: CodeIcon,
  rs: CodeIcon,
  py: CodeIcon,
  go: CodeIcon,
  rb: CodeIcon,
  java: CodeIcon,
  c: CodeIcon,
  cpp: CodeIcon,
  h: CodeIcon,
  swift: CodeIcon,
  kt: CodeIcon,
  md: Note01Icon,
  mdx: Note01Icon,
  txt: Note01Icon,
  json: ApiIcon,
  yaml: ApiIcon,
  yml: ApiIcon,
  toml: Settings01Icon,
  css: CodeIcon,
  scss: CodeIcon,
  html: CodeIcon,
  svg: CodeIcon,
};

function getFileIcon(entry: FileEntry): IconSvgElement {
  if (entry.is_dir) return Folder01Icon;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_ICONS[ext] ?? File01Icon;
}

// ── Git status colors ──

const STATUS_COLORS: Record<string, string> = {
  M: "#F59E0B",
  A: "#2dcf67",
  D: "#FF5F57",
  "?": "#2dcf6799",
  R: "#58a6ff",
};

// ── Flat tree row ──

interface TreeRow {
  entry: FileEntry;
  depth: number;
}

// ── Props ──

interface FileTreeProps {
  rootPath: string;
  query: string;
  onOpenFile: (filePath: string) => void;
}

/** Reject names with path separators or traversal components. */
function isValidFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/[/\\]/.test(trimmed) && !/^\.\.?$/.test(trimmed);
}

export default function FileTree({ rootPath, query, onOpenFile }: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([rootPath]));
  const [entries, setEntries] = useState<Map<string, FileEntry[]>>(new Map());
  const [gitStatus, setGitStatus] = useState<Map<string, { status: string; insertions: number; deletions: number }>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingIn, setCreatingIn] = useState<{ dir: string; type: "file" | "folder" } | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const mountedRef = useRef(true);
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;

  // ── Fetch directory ──

  const fetchDirectory = useCallback(async (dirPath: string) => {
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
    try {
      const result = await invoke<FileEntry[]>("read_directory", { path: dirPath });
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
      const map = new Map<string, { status: string; insertions: number; deletions: number }>();
      for (const s of result.statuses) {
        map.set(s.path, { status: s.status, insertions: s.insertions, deletions: s.deletions });
      }
      setGitStatus(map);
      setDiffStats({ insertions: result.insertions, deletions: result.deletions });
    } catch {
      // Not a git repo or error
    }
  }, [rootPath]);

  // ── Mount: load root + git status + start watcher ──

  useEffect(() => {
    mountedRef.current = true;
    fetchDirectory(rootPath);
    fetchGitStatus();
    invoke("start_watching", { rootPath }).catch(() => {});

    // Store unlisten fn synchronously when resolved
    let unlistenFn: (() => void) | null = null;

    listen<string>("file-tree-changed", (event) => {
      if (!mountedRef.current) return;
      if (event.payload === rootPath) {
        // Re-fetch expanded dirs from ref (no side-effect in state updater)
        for (const dir of expandedPathsRef.current) {
          fetchDirectory(dir);
        }
        fetchGitStatus();
      }
    }).then((fn) => {
      if (mountedRef.current) {
        unlistenFn = fn;
      } else {
        // Component already unmounted before listen resolved
        fn();
      }
    });

    return () => {
      mountedRef.current = false;
      unlistenFn?.();
      invoke("stop_watching", { rootPath }).catch(() => {});
    };
  }, [rootPath, fetchDirectory, fetchGitStatus]);

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

    const hasMatchInSubtree = (dirPath: string, q: string): boolean => {
      const dirEntries = entries.get(dirPath);
      if (!dirEntries) return false;
      for (const entry of dirEntries) {
        if (entry.name.toLowerCase().includes(q)) return true;
        if (entry.is_dir && hasMatchInSubtree(entry.path, q)) return true;
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

  // ── Git status for a path ──

  const rootPrefix = useMemo(
    () => (rootPath.endsWith("/") ? rootPath : `${rootPath}/`),
    [rootPath],
  );

  const getFileGitInfo = useCallback(
    (entryPath: string): { status: string; insertions: number; deletions: number } | undefined => {
      const relative = entryPath.startsWith(rootPrefix)
        ? entryPath.slice(rootPrefix.length)
        : entryPath;
      return gitStatus.get(relative);
    },
    [rootPrefix, gitStatus],
  );

  const dirHasChanges = useCallback(
    (dirPath: string): boolean => {
      const relative = dirPath.startsWith(rootPrefix)
        ? dirPath.slice(rootPrefix.length) + "/"
        : dirPath + "/";
      for (const [path] of gitStatus) {
        if (path.startsWith(relative)) return true;
      }
      return false;
    },
    [rootPrefix, gitStatus],
  );

  // ── File operations (pass rootPath for confinement) ──

  const handleRenameCommit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    if (!isValidFileName(renameValue)) {
      setRenamingPath(null);
      return;
    }
    const parentDir = renamingPath.substring(0, renamingPath.lastIndexOf("/"));
    const newPath = `${parentDir}/${renameValue.trim()}`;
    if (newPath !== renamingPath) {
      try {
        await invoke("rename_path", { oldPath: renamingPath, newPath, root: rootPath });
      } catch (err) {
        console.error("[file-tree] Rename failed:", err);
      }
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, rootPath]);

  const handleCreateCommit = useCallback(async () => {
    if (!creatingIn || !createValue.trim()) {
      setCreatingIn(null);
      return;
    }
    if (!isValidFileName(createValue)) {
      setCreatingIn(null);
      setCreateValue("");
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
    }
    setCreatingIn(null);
    setCreateValue("");
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
  }, []);

  const startCreate = useCallback((dirPath: string, type: "file" | "folder") => {
    setCreatingIn({ dir: dirPath, type });
    setCreateValue("");
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });
    if (!entries.has(dirPath)) {
      fetchDirectory(dirPath);
    }
  }, [entries, fetchDirectory]);

  // ── Git diff line stats (from backend) ──

  const [diffStats, setDiffStats] = useState<{ insertions: number; deletions: number }>({ insertions: 0, deletions: 0 });

  // ── Render ──

  return (
    <>
      {/* Git diff stats summary */}
      {(diffStats.insertions > 0 || diffStats.deletions > 0) && (
        <div className="flex items-center gap-2.5 px-3 py-1.5 text-[10px] tabular-nums">
          {diffStats.insertions > 0 && (
            <span style={{ color: STATUS_COLORS.A }}>+{diffStats.insertions}</span>
          )}
          {diffStats.deletions > 0 && (
            <span style={{ color: STATUS_COLORS.D }}>&minus;{diffStats.deletions}</span>
          )}
          <span className="text-muted-foreground/30">
            {gitStatus.size} file{gitStatus.size !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {flatRows.length === 0 && !loadingDirs.has(rootPath) && (
          <span className="pl-7 text-[10px] text-muted-foreground/50 italic">Empty</span>
        )}

        {flatRows.map((row) => {
          const { entry, depth } = row;
          const isExpanded = expandedPaths.has(entry.path);
          const gitInfo = entry.is_dir ? undefined : getFileGitInfo(entry.path);
          const hasChanges = entry.is_dir && dirHasChanges(entry.path);
          const isRenaming = renamingPath === entry.path;

          if (isRenaming) {
            return (
              <div
                key={entry.path}
                className="flex items-center gap-1.5 py-0.5 rounded-md bg-sidebar-accent/80"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
              >
                <HugeiconsIcon icon={getFileIcon(entry)} size={13} className="shrink-0 opacity-50" />
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameCommit();
                    if (e.key === "Escape") setRenamingPath(null);
                  }}
                  onBlur={handleRenameCommit}
                  autoFocus
                  aria-label="Rename"
                  className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
                />
              </div>
            );
          }

          return (
            <ContextMenu key={entry.path}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 py-0.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 w-full text-left transition-colors"
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                  onClick={() => {
                    if (entry.is_dir) {
                      toggleExpand(entry.path);
                    } else {
                      onOpenFile(entry.path);
                    }
                  }}
                  onDoubleClick={(e) => {
                    if (!entry.is_dir) {
                      e.stopPropagation();
                      startRename(entry);
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

                  <HugeiconsIcon
                    icon={getFileIcon(entry)}
                    size={13}
                    className={cn("shrink-0", entry.is_dir ? "text-sidebar-primary/60" : "opacity-50")}
                  />

                  <span className="truncate flex-1">{entry.name}</span>

                  {/* Per-file diff stats */}
                  {gitInfo && (gitInfo.insertions > 0 || gitInfo.deletions > 0) && (
                    <span className="flex items-center gap-1 text-[9px] tabular-nums shrink-0">
                      {gitInfo.insertions > 0 && (
                        <span style={{ color: STATUS_COLORS.A }}>+{gitInfo.insertions}</span>
                      )}
                      {gitInfo.deletions > 0 && (
                        <span style={{ color: STATUS_COLORS.D }}>&minus;{gitInfo.deletions}</span>
                      )}
                    </span>
                  )}

                  {gitInfo && (
                    <span className="text-[9px] font-bold shrink-0 pr-1 text-sidebar-primary/70">
                      {gitInfo.status}
                    </span>
                  )}

                  {hasChanges && !gitInfo && (
                    <span className="size-1.5 rounded-full shrink-0 mr-1 bg-sidebar-primary/50" />
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
            className="flex items-center gap-1.5 py-0.5 rounded-md bg-sidebar-accent/80"
            style={{
              paddingLeft: `${8 + (flatRows.find((r) => r.entry.path === creatingIn.dir)?.depth ?? 0) * 16 + 16}px`,
            }}
          >
            <HugeiconsIcon
              icon={creatingIn.type === "folder" ? Folder01Icon : File01Icon}
              size={13}
              className="shrink-0 opacity-50"
            />
            <input
              value={createValue}
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateCommit();
                if (e.key === "Escape") setCreatingIn(null);
              }}
              onBlur={handleCreateCommit}
              autoFocus
              placeholder={creatingIn.type === "folder" ? "folder name\u2026" : "file name\u2026"}
              aria-label={creatingIn.type === "folder" ? "New folder name" : "New file name"}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm placeholder:text-muted-foreground/40"
            />
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
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export type { FileTreeProps };
