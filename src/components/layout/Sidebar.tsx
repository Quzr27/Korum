import { useCallback, useMemo, useRef, useState } from "react";
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
import type { WindowState, Workspace, WorkspaceColor, WorkspaceIconKey } from "@/types";
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
  win: WindowState;
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

interface SidebarProps {
  windows: WindowState[];
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
  const [collapsed, setCollapsed] = useState(false);
  const [editWorkspace, setEditWorkspace] = useState<Workspace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Track which workspaces are collapsed — expanded by default
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [openMenuWsId, setOpenMenuWsId] = useState<string | null>(null);
  const [filePanelOpen, setFilePanelOpen] = useState(false);

  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<WorkspaceColor>("green");
  const [editIcon, setEditIcon] = useState<WorkspaceIconKey>("code");

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);
  const activeWs = useMemo(() => workspaces.find((ws) => ws.id === activeWorkspaceId), [workspaces, activeWorkspaceId]);

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

  const startRename = useCallback((w: WindowState) => {
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
    // Close file panel if new workspace has no rootPath
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws?.rootPath) setFilePanelOpen(false);
  }, [onSelectWorkspace, workspaces]);

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
        filePanelOpen && activeWs?.rootPath ? "rounded-l-xl rounded-r-none" : "rounded-xl",
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
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={"Filter\u2026"} />
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
              const hasItems = filteredTerminals.length > 0 || filteredNotes.length > 0;

              const color = WORKSPACE_COLORS[ws.color];
              return (
                <div key={ws.id} className="flex flex-col">
                  {/* Workspace row */}
                  <div
                    className={cn(
                      "group/ws flex items-center rounded-lg transition-colors",
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
                        "flex-1 h-auto justify-start gap-1.5 py-[7px] text-xs min-w-0 hover:bg-transparent",
                        isActive
                          ? "font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      style={isActive ? { color } : undefined}
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
                      />
                      <span className="truncate flex-1 text-left">{ws.name}</span>
                    </Button>

                    {/* Right slot: count / menu */}
                    <div className="relative flex items-center justify-center size-7 shrink-0 mr-0.5">
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
          {activeWs?.rootPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn("px-2", filePanelOpen && "bg-sidebar-accent text-sidebar-accent-foreground")}
                  onClick={() => setFilePanelOpen((prev) => !prev)}
                  aria-label="Toggle file tree"
                  aria-pressed={filePanelOpen}
                >
                  <HugeiconsIcon icon={Folder01Icon} size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top"><p>Files</p></TooltipContent>
            </Tooltip>
          )}
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
          className={cn(
            "glass-subtle fixed top-3 bottom-3 z-39 w-60 rounded-r-xl flex flex-col overflow-hidden text-foreground",
            "border border-l-0 border-border/30",
            "shadow-xl shadow-black/15",
            "motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out",
            filePanelOpen
              ? "left-[calc(0.75rem+18rem)] opacity-100 translate-x-0"
              : "left-[calc(0.75rem+18rem)] opacity-0 -translate-x-3 pointer-events-none",
          )}
        >
          {/* Compact header */}
          <div className="px-2.5 pt-2.5 pb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-muted-foreground/50 truncate" title={activeWs.rootPath}>
                {activeWs.rootPath.replace(/^\/Users\/[^/]+/, "~")}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground/30 hover:text-muted-foreground shrink-0"
              onClick={() => setFilePanelOpen(false)}
              aria-label="Close file drawer"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </Button>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-0.5 py-1">
              {filePanelOpen && (
                <FileTree
                  rootPath={activeWs.rootPath}
                  query={normalizedQuery}
                  onOpenFile={(filePath) => onOpenFile(filePath, activeWs.id)}
                />
              )}
            </div>
          </ScrollArea>
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
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
