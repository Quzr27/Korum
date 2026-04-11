export type Point2D = { x: number; y: number };

export type WindowKind = "terminal" | "note" | "code";

export interface BaseWindow {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  title: string;
  workspaceId: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TerminalWindow extends BaseWindow {
  type: "terminal";
  terminalId?: string;
  initialCwd?: string;
  ptyId?: string;
}

export interface NoteWindow extends BaseWindow {
  type: "note";
  content?: string;
  sourcePath?: string;
}

export type CodeViewMode = "file" | "changes";

export interface CodeWindow extends BaseWindow {
  type: "code";
  sourcePath: string;
  viewMode: CodeViewMode;
}

export type WindowState = TerminalWindow | NoteWindow | CodeWindow;

/** Fields safe to mutate via drag/resize. */
export type WindowUpdatable = Pick<BaseWindow, "x" | "y" | "width" | "height">;

/** Resize handle edge/corner directions. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type WorkspaceColor = "green" | "blue" | "orange" | "red" | "purple" | "yellow" | "pink" | "cyan";
export type WorkspaceIconKey = "code" | "terminal" | "rocket" | "star" | "globe" | "home" | "folder" | "fire" | "diamond" | "bug" | "coffee" | "crown" | "git" | "api" | "database" | "server" | "cpu" | "cloud" | "shield" | "package" | "layers" | "dashboard" | "target" | "wrench";

export interface Workspace {
  id: string;
  name: string;
  color: WorkspaceColor;
  icon: WorkspaceIconKey;
  rootPath?: string;
}

// ── File tree types ──

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  is_ignored: boolean;
  child_count?: number;
}

export interface GitFileStatus {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
}

export interface GitStatusResult {
  statuses: GitFileStatus[];
  changed_count: number;
  insertions: number;
  deletions: number;
}

export interface DiffLine {
  origin: "add" | "delete" | "context";
  old_lineno: number | null;
  new_lineno: number | null;
  content: string;
}

/** Request to paste clipboard text into a terminal (may trigger confirmation dialog). */
export interface PasteRequest {
  text: string;
  terminalId: string;
  ptyId: string;
  bracketedPasteMode: boolean;
}

export interface UsageBucket {
  utilization: number;
  resets_at: string;
}

export interface ClaudeUsageResponse {
  five_hour: UsageBucket | null;
  seven_day: UsageBucket | null;
  seven_day_opus: UsageBucket | null;
  seven_day_sonnet: UsageBucket | null;
  subscription_type: string | null;
  rate_limit_tier: string | null;
}

export interface CodexUsageResponse {
  primary_window: UsageBucket | null;
  secondary_window: UsageBucket | null;
  plan_type: string | null;
}

export const WORKSPACE_COLORS: Record<WorkspaceColor, string> = {
  green: "#2dcf67",
  blue: "#58a6ff",
  orange: "#F59E0B",
  red: "#FF5F57",
  purple: "#A78BFA",
  yellow: "#FBBF24",
  pink: "#F472B6",
  cyan: "#22D3EE",
};
