import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CommandIcon,
  FileSearchIcon,
  Folder01Icon,
  GridViewIcon,
  KeyboardIcon,
  Note01Icon,
  CameraIcon,
  Search01Icon,
  Target01Icon,
  TerminalIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  filterCommandCenterItems,
  groupCommandCenterItems,
  type CommandCenterCategory,
  type CommandCenterItem,
} from "@/lib/command-center";
import { getAgentActivityCssVar } from "@/lib/agent-status";
import { getAgentStatusMap, useAgentActivities } from "@/lib/agent-status-store";
import { cn } from "@/lib/utils";
import type {
  AgentActivity,
  Workspace,
  WindowKind,
  WindowState,
  WorkspaceFileSearchEntry,
} from "@/types";

interface CommandCenterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  windows: WindowState[];
  activeWorkspaceId: string | null;
  activeWindowId: string | null;
  isWarRoom: boolean;
  onAddWindow: (type: WindowKind) => void;
  onCreateWorkspace: () => void;
  onArrangeWindows: () => void;
  onToggleWarRoom: () => void;
  onOpenSnapshotExport: () => void;
  onShowShortcuts: () => void;
  onResetViewport: () => void;
  onFocusWindow: (id: string) => void;
  onSelectWorkspace: (id: string) => void;
  onOpenFile: (filePath: string, workspaceId: string) => void;
}

type ExecutableCommandCenterItem = CommandCenterItem & {
  icon: IconSvgElement;
  run: () => void;
  accessory?: string;
  activity?: AgentActivity;
};

const CATEGORY_LABELS: Record<CommandCenterCategory, string> = {
  actions: "Actions",
  agents: "Agents",
  workspaces: "Workspaces",
  windows: "Windows",
  files: "Files",
};

function windowKindLabel(type: WindowKind): string {
  if (type === "terminal") return "Terminal";
  if (type === "note") return "Note";
  return "Code";
}

function windowIcon(type: WindowKind): IconSvgElement {
  if (type === "terminal") return TerminalIcon;
  if (type === "note") return Note01Icon;
  return FileSearchIcon;
}

function activityLabel(activity: AgentActivity): string {
  if (activity === "waiting") return "Waiting";
  if (activity === "working") return "Working";
  if (activity === "idle") return "Idle";
  return "Unknown";
}

export default function CommandCenter({
  open,
  onOpenChange,
  workspaces,
  windows,
  activeWorkspaceId,
  activeWindowId,
  isWarRoom,
  onAddWindow,
  onCreateWorkspace,
  onArrangeWindows,
  onToggleWarRoom,
  onOpenSnapshotExport,
  onShowShortcuts,
  onResetViewport,
  onFocusWindow,
  onSelectWorkspace,
  onOpenFile,
}: CommandCenterProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileResults, setFileResults] = useState<WorkspaceFileSearchEntry[]>([]);
  const [fileSearchPending, setFileSearchPending] = useState(false);
  const [fileSearchFailed, setFileSearchFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeqRef = useRef(0);
  const agentActivities = useAgentActivities();
  const deferredQuery = useDeferredValue(query);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setFileResults([]);
    setFileSearchFailed(false);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const rootPath = activeWorkspace?.rootPath;
    const workspaceId = activeWorkspace?.id;

    if (!open || !rootPath || !workspaceId || trimmedQuery.length < 2) {
      requestSeqRef.current += 1;
      setFileResults([]);
      setFileSearchPending(false);
      setFileSearchFailed(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setFileSearchFailed(false);
    const timer = window.setTimeout(() => {
      setFileSearchPending(true);
      invoke<WorkspaceFileSearchEntry[]>("search_workspace_files", {
        rootPath,
        query: trimmedQuery,
        limit: 40,
      }).then((results) => {
        if (requestSeqRef.current !== seq) return;
        setFileResults(results);
      }).catch((error) => {
        if (requestSeqRef.current !== seq) return;
        console.warn("[command-center] File search failed:", error);
        setFileResults([]);
        setFileSearchFailed(true);
      }).finally(() => {
        if (requestSeqRef.current === seq) setFileSearchPending(false);
      });
    }, 140);

    return () => window.clearTimeout(timer);
  }, [activeWorkspace?.id, activeWorkspace?.rootPath, open, query]);

  const items = useMemo<ExecutableCommandCenterItem[]>(() => {
    const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const statusMap = getAgentStatusMap();
    const nextItems: ExecutableCommandCenterItem[] = [
      {
        id: "action:new-workspace",
        category: "actions",
        title: "New Workspace",
        subtitle: "Create a project space",
        keywords: ["project", "folder"],
        icon: Folder01Icon,
        run: onCreateWorkspace,
        accessory: "⌘⇧W",
      },
      {
        id: "action:shortcuts",
        category: "actions",
        title: "Keyboard Shortcuts",
        subtitle: "Open the shortcuts sheet",
        keywords: ["help", "keys"],
        icon: KeyboardIcon,
        run: onShowShortcuts,
        accessory: "⌘⇧?",
      },
    ];

    if (activeWorkspaceId) {
      nextItems.unshift(
        {
          id: "action:new-terminal",
          category: "actions",
          title: "New Terminal",
          subtitle: activeWorkspace ? activeWorkspace.name : "Active workspace",
          keywords: ["shell", "pty", "agent"],
          icon: TerminalIcon,
          run: () => onAddWindow("terminal"),
          accessory: "⌘N",
          priority: 10,
        },
        {
          id: "action:new-note",
          category: "actions",
          title: "New Note",
          subtitle: activeWorkspace ? activeWorkspace.name : "Active workspace",
          keywords: ["markdown", "scratchpad"],
          icon: Note01Icon,
          run: () => onAddWindow("note"),
          accessory: "⌘⇧N",
        },
        {
          id: "action:arrange-grid",
          category: "actions",
          title: "Arrange Grid",
          subtitle: "Tidy active workspace windows",
          keywords: ["layout", "organize"],
          icon: GridViewIcon,
          run: onArrangeWindows,
          accessory: "⌘⇧A",
        },
        {
          id: "action:snapshot-export",
          category: "actions",
          title: "War Room Snapshot",
          subtitle: "Export a full canvas PNG",
          keywords: ["share", "export", "screenshot", "snapshot", "png"],
          icon: CameraIcon,
          run: onOpenSnapshotExport,
          priority: 30,
        },
        {
          id: "action:war-room",
          category: "actions",
          title: isWarRoom ? "Exit War-room Mode" : "War-room Mode",
          subtitle: "Focus agent activity on the canvas",
          keywords: ["agent", "focus", "radar"],
          icon: Target01Icon,
          run: onToggleWarRoom,
          accessory: "⌘⇧M",
        },
        {
          id: "action:reset-viewport",
          category: "actions",
          title: "Reset Viewport",
          subtitle: "Return canvas zoom to 100%",
          keywords: ["zoom", "pan", "center"],
          icon: ViewIcon,
          run: onResetViewport,
          accessory: "⌘R",
        },
      );
    }

    for (const workspace of workspaces) {
      nextItems.push({
        id: `workspace:${workspace.id}`,
        category: "workspaces",
        title: workspace.name,
        subtitle: workspace.rootPath,
        keywords: [workspace.icon, workspace.color],
        icon: Folder01Icon,
        run: () => onSelectWorkspace(workspace.id),
        accessory: workspace.id === activeWorkspaceId ? "Active" : undefined,
      });
    }

    for (const window of windows) {
      const workspace = workspaceById.get(window.workspaceId);
      const status = window.type === "terminal" ? statusMap.get(window.id) : undefined;
      nextItems.push({
        id: `window:${window.id}`,
        category: "windows",
        title: window.title,
        subtitle: [
          windowKindLabel(window.type),
          workspace?.name,
          window.type === "code" ? window.sourcePath : undefined,
        ].filter(Boolean).join(" · "),
        keywords: [
          window.type,
          workspace?.name ?? "",
          window.type === "code" ? window.sourcePath : "",
          status?.kind ?? "",
          status?.activity ?? "",
          status?.detail ?? "",
        ],
        icon: windowIcon(window.type),
        run: () => onFocusWindow(window.id),
        accessory: window.id === activeWindowId ? "Active" : undefined,
        activity: status?.activity,
      });
    }

    for (const window of windows) {
      if (window.type !== "terminal") continue;
      const activity = agentActivities[window.id];
      if (activity !== "waiting" && activity !== "working") continue;
      const status = statusMap.get(window.id);
      const workspace = workspaceById.get(window.workspaceId);
      nextItems.push({
        id: `agent:${activity}:${window.id}`,
        category: "agents",
        title: activity === "waiting" ? "Jump to Waiting Agent" : "Jump to Working Agent",
        subtitle: [window.title, workspace?.name, status?.kind].filter(Boolean).join(" · "),
        keywords: [activity, status?.kind ?? "", status?.detail ?? "", window.title],
        icon: Target01Icon,
        run: () => onFocusWindow(window.id),
        priority: activity === "waiting" ? 40 : 25,
        activity,
      });
    }

    if (activeWorkspace) {
      for (const file of fileResults) {
        nextItems.push({
          id: `file:${activeWorkspace.id}:${file.path}`,
          category: "files",
          title: file.name,
          subtitle: file.relative_path,
          keywords: [activeWorkspace.name, activeWorkspace.rootPath ?? ""],
          icon: FileSearchIcon,
          run: () => onOpenFile(file.path, activeWorkspace.id),
        });
      }
    }

    return nextItems;
  }, [
    activeWorkspace,
    activeWorkspaceId,
    activeWindowId,
    agentActivities,
    fileResults,
    isWarRoom,
    onAddWindow,
    onArrangeWindows,
    onCreateWorkspace,
    onFocusWindow,
    onOpenFile,
    onOpenSnapshotExport,
    onResetViewport,
    onSelectWorkspace,
    onShowShortcuts,
    onToggleWarRoom,
    windows,
    workspaces,
  ]);

  const filteredItems = useMemo(
    () => filterCommandCenterItems(items, deferredQuery, 80),
    [deferredQuery, items],
  );
  const groups = useMemo(() => groupCommandCenterItems(filteredItems), [filteredItems]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (filteredItems.length === 0) return 0;
      return Math.min(current, filteredItems.length - 1);
    });
  }, [filteredItems.length]);

  const executeItem = (item: ExecutableCommandCenterItem | undefined) => {
    if (!item || item.disabled) return;
    onOpenChange(false);
    item.run();
  };

  const executeActiveItem = () => {
    const currentItems = query === deferredQuery
      ? filteredItems
      : filterCommandCenterItems(items, query, 80);
    const currentIndex = Math.min(activeIndex, currentItems.length - 1);
    executeItem(currentItems[currentIndex]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => filteredItems.length === 0 ? 0 : (current + 1) % filteredItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (
        filteredItems.length === 0 ? 0 : (current - 1 + filteredItems.length) % filteredItems.length
      ));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      executeActiveItem();
    }
  };

  let rowIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[640px]" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Command Center</DialogTitle>
          <DialogDescription>Search commands, workspaces, windows, agents, and files.</DialogDescription>
        </DialogHeader>

        <div className="grid h-14 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 px-4">
          <span className="flex size-6 items-center justify-center text-muted-foreground/75">
            <HugeiconsIcon icon={Search01Icon} className="size-4" strokeWidth={2} />
          </span>
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Command, window, workspace, file"
            className="h-10 rounded-none border-0 bg-transparent px-0 text-[14px] shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:border-0 focus-visible:ring-0 md:text-sm dark:bg-transparent"
          />
          <kbd className="inline-flex h-6 min-w-8 items-center justify-center rounded-md border border-border/60 bg-background/45 px-1.5 text-[10px] font-medium text-muted-foreground">
            esc
          </kbd>
        </div>
        <Separator />

        <ScrollArea className="max-h-[min(560px,calc(100vh-9rem))]">
          <div className="flex min-h-40 flex-col gap-4 px-3 py-3">
            {groups.map((group) => (
              <div key={group.category} className="flex flex-col gap-1">
                <div className="px-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  {CATEGORY_LABELS[group.category]}
                </div>
                <div className="flex flex-col gap-1">
                  {group.items.map((item) => {
                    const index = rowIndex++;
                    const active = index === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "group/item grid min-h-11 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                          active ? "bg-muted/80 text-foreground" : "text-foreground/86 hover:bg-muted/55",
                        )}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => executeItem(item)}
                      >
                        <span className="flex size-8 items-center justify-center rounded-md border border-border/60 bg-background/45 text-muted-foreground">
                          <HugeiconsIcon icon={item.icon} className="size-4" strokeWidth={2} />
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            {item.activity && item.activity !== "unknown" ? (
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: getAgentActivityCssVar(item.activity) }}
                                aria-label={`Agent ${activityLabel(item.activity).toLowerCase()}`}
                              />
                            ) : null}
                            <span className="truncate text-[13px] font-medium leading-4">{item.title}</span>
                          </span>
                          {item.subtitle ? (
                            <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
                              {item.subtitle}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2">
                          {item.accessory ? (
                            <span className="inline-flex h-5 min-w-8 items-center justify-center rounded border border-border/55 bg-background/35 px-1.5 text-[10px] text-muted-foreground">
                              {item.accessory}
                            </span>
                          ) : null}
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            className={cn(
                              "size-3.5 text-muted-foreground/70 opacity-0 transition-opacity group-hover/item:opacity-70",
                              active && "opacity-70",
                            )}
                            strokeWidth={2}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {filteredItems.length === 0 ? (
              <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground">
                <HugeiconsIcon icon={CommandIcon} className="size-5" strokeWidth={2} />
                <span className="text-xs">No results</span>
              </div>
            ) : null}

            {fileSearchPending ? (
              <div className="px-3 pb-2 text-[11px] text-muted-foreground">Searching files…</div>
            ) : null}
            {fileSearchFailed ? (
              <div className="px-3 pb-2 text-[11px] text-destructive">File search unavailable</div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
