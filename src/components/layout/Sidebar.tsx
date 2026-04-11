import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CodeIcon,
  TerminalIcon as HugeTerminalIcon,
  RocketIcon,
  StarIcon,
  GlobeIcon,
  Home01Icon,
  Folder01Icon,
  FolderTreeIcon,
  FireIcon,
  DiamondIcon,
  Bug01Icon,
  Coffee01Icon,
  CrownIcon,
  PencilEdit01Icon,
  Delete01Icon,
  GitBranchIcon,
  ApiIcon,
  DatabaseIcon,
  ServerStack01Icon,
  CpuIcon,
  CloudIcon,
  Shield01Icon,
  PackageIcon,
  Layers01Icon,
  DashboardBrowsingIcon,
  Target01Icon,
  Wrench01Icon,
  Note01Icon,
  GridViewIcon,
  EyeIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { Workspace, WorkspaceColor, WorkspaceIconKey, WindowKind } from "@/types";
import { WORKSPACE_COLORS } from "@/types";
import FileTree from "@/components/layout/FileTree";

// biome-ignore format: icon map
const WORKSPACE_ICONS: Record<WorkspaceIconKey, IconSvgElement> = {
  code: CodeIcon, terminal: HugeTerminalIcon, rocket: RocketIcon,
  star: StarIcon, globe: GlobeIcon, home: Home01Icon,
  folder: Folder01Icon, fire: FireIcon, diamond: DiamondIcon,
  bug: Bug01Icon, coffee: Coffee01Icon, crown: CrownIcon,
  git: GitBranchIcon, api: ApiIcon, database: DatabaseIcon,
  server: ServerStack01Icon, cpu: CpuIcon, cloud: CloudIcon,
  shield: Shield01Icon, package: PackageIcon, layers: Layers01Icon,
  dashboard: DashboardBrowsingIcon, target: Target01Icon, wrench: Wrench01Icon,
};

const ICON_KEYS: readonly WorkspaceIconKey[] = Object.keys(WORKSPACE_ICONS) as WorkspaceIconKey[];
const COLOR_KEYS: readonly WorkspaceColor[] = Object.keys(WORKSPACE_COLORS) as WorkspaceColor[];
const SIDEBAR_UI_STORAGE_KEY = "korum-sidebar-ui";

interface SidebarUiState {
  fileDrawerOpenByWorkspaceId: Record<string, boolean>;
  fileQueryByWorkspaceId: Record<string, string>;
  showIgnoredByWorkspaceId: Record<string, boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSidebarUiState(): SidebarUiState {
  if (typeof window === "undefined") {
    return { fileDrawerOpenByWorkspaceId: {}, fileQueryByWorkspaceId: {}, showIgnoredByWorkspaceId: {} };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_UI_STORAGE_KEY);
    if (!raw) return { fileDrawerOpenByWorkspaceId: {}, fileQueryByWorkspaceId: {}, showIgnoredByWorkspaceId: {} };
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return { fileDrawerOpenByWorkspaceId: {}, fileQueryByWorkspaceId: {}, showIgnoredByWorkspaceId: {} };

    const fileDrawerOpenByWorkspaceId = isRecord(parsed.fileDrawerOpenByWorkspaceId)
      ? Object.fromEntries(
          Object.entries(parsed.fileDrawerOpenByWorkspaceId).filter(([, value]) => typeof value === "boolean"),
        ) as Record<string, boolean>
      : {};

    const fileQueryByWorkspaceId = isRecord(parsed.fileQueryByWorkspaceId)
      ? Object.fromEntries(
          Object.entries(parsed.fileQueryByWorkspaceId).filter(([, value]) => typeof value === "string"),
        ) as Record<string, string>
      : {};

    const showIgnoredByWorkspaceId = isRecord(parsed.showIgnoredByWorkspaceId)
      ? Object.fromEntries(
          Object.entries(parsed.showIgnoredByWorkspaceId).filter(([, value]) => typeof value === "boolean"),
        ) as Record<string, boolean>
      : {};

    return { fileDrawerOpenByWorkspaceId, fileQueryByWorkspaceId, showIgnoredByWorkspaceId };
  } catch {
    return { fileDrawerOpenByWorkspaceId: {}, fileQueryByWorkspaceId: {}, showIgnoredByWorkspaceId: {} };
  }
}

function writeSidebarUiState(next: SidebarUiState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIDEBAR_UI_STORAGE_KEY, JSON.stringify(next));
}

// ── Workspace form (edit mode — no folder picker) ──

interface WorkspaceEditFormProps {
  name: string;
  color: WorkspaceColor;
  icon: WorkspaceIconKey;
  onNameChange: (v: string) => void;
  onColorChange: (v: WorkspaceColor) => void;
  onIconChange: (v: WorkspaceIconKey) => void;
  onSubmit: () => void;
  submitLabel: string;
  autoFocusName?: boolean;
}

function WorkspaceEditForm({
  name, color, icon,
  onNameChange, onColorChange, onIconChange,
  onSubmit, submitLabel, autoFocusName,
}: WorkspaceEditFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Workspace name"
        autoFocus={autoFocusName}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSubmit(); }}
      />
      <ColorIconPicker color={color} icon={icon} onColorChange={onColorChange} onIconChange={onIconChange} />
      <Button type="button" size="sm" className="w-full" disabled={!name.trim()} onClick={onSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}

// ── Shared color + icon picker ──

function ColorIconPicker({
  color, icon, onColorChange, onIconChange,
}: {
  color: WorkspaceColor;
  icon: WorkspaceIconKey;
  onColorChange: (v: WorkspaceColor) => void;
  onIconChange: (v: WorkspaceIconKey) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Color</span>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_KEYS.map((c) => (
            <Button
              key={c}
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                "rounded-full border-2 p-0 hover:bg-transparent",
                c === color ? "border-foreground/60 scale-110" : "border-transparent hover:scale-110",
              )}
              style={{ backgroundColor: WORKSPACE_COLORS[c] }}
              onClick={() => onColorChange(c)}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Icon</span>
        <div className="flex flex-wrap gap-1">
          {ICON_KEYS.map((k) => (
            <Button
              key={k}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-lg",
                k === icon
                  ? "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70",
              )}
              onClick={() => onIconChange(k)}
              aria-label={k}
            >
              <HugeiconsIcon icon={WORKSPACE_ICONS[k]} size={14} />
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Create workspace dialog (folder-first) ──

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateWorkspace: (ws: Workspace) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange, onCreateWorkspace }: CreateWorkspaceDialogProps) {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<WorkspaceColor>("blue");
  const [icon, setIcon] = useState<WorkspaceIconKey>("code");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const pickerActiveRef = useRef(false);

  const reset = useCallback(() => {
    pickerActiveRef.current = false;
    setFolderPath(null);
    setName("");
    setColor("blue");
    setIcon("code");
    setNameManuallyEdited(false);
  }, []);

  const handleChooseFolder = useCallback(async () => {
    pickerActiveRef.current = true;
    const selected = await openDialog({ directory: true, multiple: false, title: "Choose project folder" });
    if (!pickerActiveRef.current) return;
    if (selected) {
      setFolderPath(selected);
      if (!nameManuallyEdited) {
        const basename = selected.split(/[\\/]/).filter(Boolean).pop() ?? selected;
        setName(basename);
        setIcon("code");
      }
    }
  }, [nameManuallyEdited]);

  const clearFolder = useCallback(() => {
    setFolderPath(null);
    if (!nameManuallyEdited) {
      setName("");
      setIcon("code");
    }
  }, [nameManuallyEdited]);

  const handleNameChange = useCallback((v: string) => {
    setName(v);
    setNameManuallyEdited(v.length > 0);
  }, []);

  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    const ws: Workspace = {
      id: crypto.randomUUID(),
      name: name.trim(),
      color,
      icon,
      rootPath: folderPath ?? undefined,
    };
    onCreateWorkspace(ws);
    reset();
    onOpenChange(false);
  }, [name, color, icon, folderPath, onCreateWorkspace, onOpenChange, reset]);

  const handleScratch = useCallback(() => {
    const scratchName = name.trim() || "Scratch";
    const ws: Workspace = {
      id: crypto.randomUUID(),
      name: scratchName,
      color,
      icon: icon === "code" && !nameManuallyEdited ? "terminal" : icon,
    };
    onCreateWorkspace(ws);
    reset();
    onOpenChange(false);
  }, [name, color, icon, nameManuallyEdited, onCreateWorkspace, onOpenChange, reset]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[340px]" showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Create Workspace</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Project folder */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project folder</span>
            {folderPath ? (
              <div className="relative">
                <Input readOnly value={folderPath} className="pr-8 truncate cursor-default" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={clearFolder}
                  aria-label="Clear folder"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleChooseFolder}>
                <HugeiconsIcon icon={Folder01Icon} size={14} />
                Choose folder{"\u2026"}
              </Button>
            )}
            <span className="text-[10px] text-muted-foreground/60">Optional — skip for a scratch workspace</span>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace name</span>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={folderPath ? "Auto-filled from folder" : "Workspace name"}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleCreate(); }}
            />
          </div>

          {/* Color + Icon */}
          <ColorIconPicker color={color} icon={icon} onColorChange={setColor} onIconChange={setIcon} />

          {/* Actions */}
          <div className="flex flex-col gap-1.5">
            <Button type="button" size="sm" className="w-full" disabled={!name.trim()} onClick={handleCreate}>
              Create Workspace
            </Button>
            <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleScratch}>
              Create Scratch Workspace
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Window list item ──

interface WindowItemProps {
  win: SidebarWindow;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  wsColor: string;
  icon: React.ReactNode;
  onFocus: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

function WindowItem({
  win, isActive, isRenaming, renameValue, wsColor, icon,
  onFocus, onStartRename, onRenameChange, onCommitRename, onCancelRename, onDelete,
}: WindowItemProps) {
  if (isRenaming) {
    return (
      <div className="flex items-center gap-2 pl-7 pr-2.5 py-1.5 rounded-md bg-sidebar-accent/80">
        {icon}
        <input
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={onCommitRename}
          autoFocus
          aria-label="Rename window"
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none"
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "w-full h-auto justify-start gap-2 pl-7 pr-2.5 py-1.5 text-xs",
            isActive
              ? "font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70",
          )}
          style={isActive ? { color: wsColor } : undefined}
          onClick={onFocus}
          onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}
        >
          {icon}
          <span className="truncate max-w-45">{win.title}</span>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartRename}>
          <HugeiconsIcon icon={PencilEdit01Icon} data-icon="inline-start" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem className="text-destructive! **:text-destructive!" onClick={onDelete}>
          <HugeiconsIcon icon={Delete01Icon} data-icon="inline-start" />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Main Sidebar ──

/** Lightweight window summary — excludes geometry fields to prevent re-renders on drag/resize. */
export interface SidebarWindow {
  id: string;
  type: WindowKind;
  title: string;
  workspaceId: string;
  sourcePath?: string;
}

interface SidebarProps {
  windows: SidebarWindow[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWindowId: string | null;
  onCreateDialogChange: (open: boolean) => void;
  onFocusWindow: (id: string) => void;
  onAddNote: () => void;
  onSelectWorkspace: (id: string) => void;
  onUpdateWorkspace: (id: string, updates: Partial<Omit<Workspace, "id">>) => void;
  onDeleteWorkspace: (id: string) => void;
  onArrangeWindows: () => void;
  onRenameWindow: (id: string, title: string) => void;
  onRemoveWindow: (id: string) => void;
  onOpenFile: (filePath: string, workspaceId: string) => void;
}

export default function Sidebar({
  windows, workspaces, activeWorkspaceId, activeWindowId,
  onCreateDialogChange,
  onFocusWindow, onAddNote, onSelectWorkspace,
  onUpdateWorkspace, onDeleteWorkspace,
  onArrangeWindows, onRenameWindow, onRemoveWindow,
  onOpenFile,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [fileDrawerOpenByWorkspaceId, setFileDrawerOpenByWorkspaceId] = useState<Record<string, boolean>>(
    () => readSidebarUiState().fileDrawerOpenByWorkspaceId,
  );
  const [fileQueryByWorkspaceId, setFileQueryByWorkspaceId] = useState<Record<string, string>>(
    () => readSidebarUiState().fileQueryByWorkspaceId,
  );
  const [showIgnoredByWorkspaceId, setShowIgnoredByWorkspaceId] = useState<Record<string, boolean>>(
    () => readSidebarUiState().showIgnoredByWorkspaceId,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [editWorkspace, setEditWorkspace] = useState<Workspace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Track which workspaces are collapsed — expanded by default
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [openMenuWsId, setOpenMenuWsId] = useState<string | null>(null);

  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<WorkspaceColor>("green");
  const [editIcon, setEditIcon] = useState<WorkspaceIconKey>("code");

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);
  const activeWs = useMemo(() => workspaces.find((ws) => ws.id === activeWorkspaceId), [workspaces, activeWorkspaceId]);
  const activeWorkspaceFileQuery = activeWs ? (fileQueryByWorkspaceId[activeWs.id] ?? "") : "";
  const filePanelOpen = !!(activeWs?.rootPath && fileDrawerOpenByWorkspaceId[activeWs.id]);
  const showIgnored = !!(activeWs && showIgnoredByWorkspaceId[activeWs.id]);
  const activeFilePath = useMemo(() => {
    const activeWindow = windows.find((w) => w.id === activeWindowId);
    if (activeWindow?.type === "code") return activeWindow.sourcePath;
    if (activeWindow?.type === "note") return activeWindow.sourcePath;
    return undefined;
  }, [windows, activeWindowId]);
  const openFilePaths = useMemo(
    () =>
      new Set(
        windows.flatMap((w) => {
          if (w.workspaceId !== activeWorkspaceId) return [];
          if ((w.type === "code" || w.type === "note") && typeof w.sourcePath === "string") return [w.sourcePath];
          return [];
        }),
      ),
    [windows, activeWorkspaceId],
  );

  useEffect(() => {
    writeSidebarUiState({ fileDrawerOpenByWorkspaceId, fileQueryByWorkspaceId, showIgnoredByWorkspaceId });
  }, [fileDrawerOpenByWorkspaceId, fileQueryByWorkspaceId, showIgnoredByWorkspaceId]);

  const openEdit = useCallback((ws: Workspace) => {
    setEditWorkspace(ws);
    setEditName(ws.name);
    setEditColor(ws.color);
    setEditIcon(ws.icon);
  }, []);

  const handleEditWorkspace = useCallback(() => {
    if (!editWorkspace || !editName.trim()) return;
    onUpdateWorkspace(editWorkspace.id, { name: editName.trim(), color: editColor, icon: editIcon });
    setEditWorkspace(null);
  }, [editWorkspace, editName, editColor, editIcon, onUpdateWorkspace]);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    onDeleteWorkspace(deleteTarget.id);
    setDeleteTarget(null);
    setOpenMenuWsId(null);
  }, [deleteTarget, onDeleteWorkspace]);

  const startRename = useCallback((w: SidebarWindow) => {
    setRenamingId(w.id);
    setRenameValue(w.title);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) onRenameWindow(renamingId, renameValue.trim());
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameWindow]);

  const requestDelete = useCallback((ws: Workspace) => {
    const wsWindows = windows.filter((w) => w.workspaceId === ws.id);
    if (wsWindows.length > 0) {
      setDeleteTarget(ws);
    } else {
      onDeleteWorkspace(ws.id);
      setOpenMenuWsId(null);
    }
  }, [windows, onDeleteWorkspace]);

  const toggleExpand = useCallback((wsId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) next.delete(wsId);
      else next.add(wsId);
      return next;
    });
  }, []);

  const handleWorkspaceClick = useCallback((wsId: string) => {
    onSelectWorkspace(wsId);
    setCollapsedIds((prev) => { const next = new Set(prev); next.delete(wsId); return next; });
    setOpenMenuWsId(null);
  }, [onSelectWorkspace]);

  const toggleFilePanel = useCallback(() => {
    if (!activeWs?.rootPath) return;
    setFileDrawerOpenByWorkspaceId((prev) => ({ ...prev, [activeWs.id]: !prev[activeWs.id] }));
  }, [activeWs]);

  const updateActiveFileQuery = useCallback((value: string) => {
    if (!activeWs) return;
    setFileQueryByWorkspaceId((prev) => {
      if (value.length === 0) {
        const { [activeWs.id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [activeWs.id]: value };
    });
  }, [activeWs]);

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="glass fixed left-3 top-3 z-40 rounded-xl text-muted-foreground"
        onClick={() => setCollapsed(false)}
        aria-label="Open sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </Button>
    );
  }

  return (
    <>
      <aside className={cn(
        "glass fixed left-3 top-3 bottom-3 z-40 w-72 flex flex-col shadow-2xl shadow-black/25 overflow-hidden",
        filePanelOpen && activeWs?.rootPath ? "rounded-l-xl rounded-r-none border-r-0" : "rounded-xl",
      )}>
        {/* Header */}
        <div className="px-3 pt-3 pb-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </Button>
        </div>

        {/* Filter */}
        <div className="px-3 pb-2">
          <Input
            name="workspace-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={"Filter Windows\u2026"}
            aria-label="Filter workspace windows"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <Separator />

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-2 py-2 flex flex-col gap-0.5">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              const isExpanded = !collapsedIds.has(ws.id);
              const wsWindows = windows.filter((w) => w.workspaceId === ws.id);
              const filteredTerminals = wsWindows.filter((w) => w.type === "terminal" && w.title.toLowerCase().includes(normalizedQuery));
              const filteredNotes = wsWindows.filter((w) => w.type === "note" && w.title.toLowerCase().includes(normalizedQuery));
              const filteredCode = wsWindows.filter((w) => w.type === "code" && w.title.toLowerCase().includes(normalizedQuery));
              const hasItems = filteredTerminals.length > 0 || filteredNotes.length > 0 || filteredCode.length > 0;

              const color = WORKSPACE_COLORS[ws.color];
              const workspaceRowReservedWidth = isActive && ws.rootPath ? 72 : 40;
              return (
                <div key={ws.id} className="flex flex-col">
                  {/* Workspace row */}
                  <div
                    className={cn(
                      "group/ws flex w-full min-w-0 items-center overflow-hidden rounded-lg transition-colors",
                      isActive
                        ? "bg-sidebar-accent"
                        : "hover:bg-sidebar-accent/50",
                    )}
                  >
                    {/* Chevron */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground active:translate-y-0 bg-transparent!"
                      onClick={() => toggleExpand(ws.id)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        size={16}
                        className="motion-safe:transition-transform motion-safe:duration-150"
                        style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                      />
                    </Button>

                    {/* Workspace name */}
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(
                        "w-0 min-w-0 shrink flex-1 h-auto justify-start gap-1.5 overflow-hidden py-[7px] text-xs hover:bg-transparent",
                        isActive
                          ? "font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      style={{
                        maxWidth: `calc(100% - ${workspaceRowReservedWidth}px)`,
                        ...(isActive ? { color } : undefined),
                      }}
                      onClick={() => handleWorkspaceClick(ws.id)}
                      aria-current={isActive || undefined}
                    >
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <HugeiconsIcon
                        icon={WORKSPACE_ICONS[ws.icon]}
                        size={13}
                        className={cn("shrink-0", isActive ? "opacity-80" : "opacity-40")}
                        style={isActive ? { color } : undefined}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{ws.name}</span>
                    </Button>

                    {/* Right slot: files toggle + count / menu */}
                    <div className="mr-0.5 flex shrink-0 items-center gap-1 pl-1">
                      {isActive && ws.rootPath && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className={cn(
                            "shrink-0 rounded-md",
                            filePanelOpen
                              ? "hover:bg-sidebar-accent/80"
                              : "text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent/70",
                          )}
                          style={filePanelOpen ? { color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` } : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFilePanel();
                          }}
                          title={filePanelOpen ? `Hide files for ${ws.name}` : `Show files for ${ws.name}`}
                          aria-label={filePanelOpen ? `Hide files for ${ws.name}` : `Show files for ${ws.name}`}
                          aria-pressed={filePanelOpen}
                        >
                          <HugeiconsIcon icon={FolderTreeIcon} size={13} />
                        </Button>
                      )}

                      <div className="relative flex items-center justify-center size-7">
                        <span
                          className={cn(
                            "text-[10px] tabular-nums text-muted-foreground/50 transition-opacity pointer-events-none select-none",
                            "group-hover/ws:opacity-0",
                            openMenuWsId === ws.id && "opacity-0",
                          )}
                        >
                          {wsWindows.length || null}
                        </span>
                        <DropdownMenu onOpenChange={(open) => {
                          if (open) {
                            setOpenMenuWsId(ws.id);
                          } else {
                            const closingId = ws.id;
                            setTimeout(() => setOpenMenuWsId((prev) => prev === closingId ? null : prev), 150);
                          }
                        }}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "absolute inset-0 text-muted-foreground/40 hover:bg-transparent",
                                "opacity-0 pointer-events-none group-hover/ws:opacity-100 group-hover/ws:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto",
                                openMenuWsId === ws.id && "opacity-100! pointer-events-auto",
                              )}
                              aria-label={`${ws.name} options`}
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <circle cx="4" cy="8" r="1.2" fill="currentColor" />
                                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                                <circle cx="12" cy="8" r="1.2" fill="currentColor" />
                              </svg>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(ws)}>
                              <HugeiconsIcon icon={PencilEdit01Icon} data-icon="inline-start" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => requestDelete(ws)}>
                              <HugeiconsIcon icon={Delete01Icon} data-icon="inline-start" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>

                  {/* Children — terminals & notes */}
                  {isExpanded && hasItems && (
                    <div className="flex flex-col gap-0.5 mt-0.5 mb-1.5">
                      {filteredTerminals.map((w) => (
                        <WindowItem
                          key={w.id}
                          win={w}
                          isActive={w.id === activeWindowId}
                          isRenaming={renamingId === w.id}
                          renameValue={renameValue}
                          wsColor={color}
                          icon={<HugeiconsIcon icon={HugeTerminalIcon} size={14} className="shrink-0 opacity-50" />}
                          onFocus={() => onFocusWindow(w.id)}
                          onStartRename={() => startRename(w)}
                          onRenameChange={setRenameValue}
                          onCommitRename={commitRename}
                          onCancelRename={() => setRenamingId(null)}
                          onDelete={() => onRemoveWindow(w.id)}
                        />
                      ))}
                      {filteredNotes.map((w) => (
                        <WindowItem
                          key={w.id}
                          win={w}
                          isActive={w.id === activeWindowId}
                          isRenaming={renamingId === w.id}
                          renameValue={renameValue}
                          wsColor={color}
                          icon={<HugeiconsIcon icon={Note01Icon} size={14} className="shrink-0 opacity-50" />}
                          onFocus={() => onFocusWindow(w.id)}
                          onStartRename={() => startRename(w)}
                          onRenameChange={setRenameValue}
                          onCommitRename={commitRename}
                          onCancelRename={() => setRenamingId(null)}
                          onDelete={() => onRemoveWindow(w.id)}
                        />
                      ))}
                      {filteredCode.map((w) => (
                        <WindowItem
                          key={w.id}
                          win={w}
                          isActive={w.id === activeWindowId}
                          isRenaming={renamingId === w.id}
                          renameValue={renameValue}
                          wsColor={color}
                          icon={<HugeiconsIcon icon={CodeIcon} size={14} className="shrink-0 opacity-50" />}
                          onFocus={() => onFocusWindow(w.id)}
                          onStartRename={() => startRename(w)}
                          onRenameChange={setRenameValue}
                          onCommitRename={commitRename}
                          onCancelRename={() => setRenamingId(null)}
                          onDelete={() => onRemoveWindow(w.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-2 flex gap-1">
          <Button type="button" variant="ghost" size="sm" className="flex-1 justify-start gap-1.5" onClick={() => onCreateDialogChange(true)}>
            <HugeiconsIcon icon={Layers01Icon} data-icon="inline-start" />
            New Workspace
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="px-2" onClick={onAddNote} aria-label="Add note">
                <HugeiconsIcon icon={Note01Icon} size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>New note</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="px-2" onClick={onArrangeWindows} aria-label="Arrange windows in grid">
                <HugeiconsIcon icon={GridViewIcon} size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Arrange in grid</p></TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* File tree drawer — docked to sidebar right edge */}
      {activeWs?.rootPath && (
        <aside
          data-state={filePanelOpen ? "open" : "closed"}
          className={cn(
            "sidebar-file-drawer glass-subtle fixed top-3 bottom-3 left-[calc(0.75rem+18rem)] z-39 w-60 rounded-r-xl flex flex-col overflow-hidden text-foreground",
            "border-y border-r border-border/30",
            "shadow-xl shadow-black/15",
            filePanelOpen ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          <div className="sidebar-file-drawer__inner flex h-full flex-col">
            {/* Compact header */}
            <div className="border-b border-border/30 px-2.5 pt-2.5 pb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: WORKSPACE_COLORS[activeWs.color] }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">
                      {activeWs.name}
                    </p>
                    <p
                      className="truncate text-[10px] text-muted-foreground/42"
                      title={activeWs.rootPath}
                      translate="no"
                    >
                      {activeWs.rootPath.replace(/^\/Users\/[^/]+/, "~")}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground/30 hover:text-muted-foreground shrink-0"
                  onClick={toggleFilePanel}
                  aria-label="Close file drawer"
                >
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </Button>
              </div>
              <div className="mt-2 flex gap-1">
                <Input
                  name="file-filter"
                  value={activeWorkspaceFileQuery}
                  onChange={(e) => updateActiveFileQuery(e.target.value)}
                  placeholder={"Find Files\u2026"}
                  aria-label={`Find files in ${activeWs.name}`}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        "shrink-0 size-8",
                        showIgnored
                          ? "text-muted-foreground"
                          : "text-muted-foreground/30 hover:text-muted-foreground",
                      )}
                      onClick={() => { if (activeWs) setShowIgnoredByWorkspaceId((prev) => ({ ...prev, [activeWs.id]: !prev[activeWs.id] })); }}
                      aria-label={showIgnored ? "Hide ignored files" : "Show ignored files"}
                      aria-pressed={showIgnored}
                    >
                      <HugeiconsIcon icon={showIgnored ? EyeIcon : ViewOffSlashIcon} size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {showIgnored ? "Hide ignored files" : "Show ignored files"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {filePanelOpen && (
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-0.5 py-1">
                  <FileTree
                    rootPath={activeWs.rootPath}
                    query={activeWorkspaceFileQuery}
                    wsColor={WORKSPACE_COLORS[activeWs.color]}
                    showIgnored={showIgnored}
                    activeFilePath={activeFilePath}
                    openFilePaths={openFilePaths}
                    onOpenFile={(filePath) => onOpenFile(filePath, activeWs.id)}
                  />
                </div>
              </ScrollArea>
            )}
          </div>
        </aside>
      )}

      {/* Edit workspace dialog */}
      <Dialog open={!!editWorkspace} onOpenChange={(open) => { if (!open) setEditWorkspace(null); }}>
        <DialogContent className="sm:max-w-70" showCloseButton={false} aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Edit Workspace</DialogTitle></DialogHeader>
          <WorkspaceEditForm
            name={editName} color={editColor} icon={editIcon}
            onNameChange={setEditName} onColorChange={setEditColor} onIconChange={setEditIcon}
            onSubmit={handleEditWorkspace} submitLabel="Save" autoFocusName
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This workspace has {windows.filter((w) => w.workspaceId === deleteTarget?.id).length} active window(s). All terminals and notes will be closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className="text-destructive! **:text-destructive!" onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
