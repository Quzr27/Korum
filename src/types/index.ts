export type Point2D = { x: number; y: number };

export type WindowKind = "terminal" | "note";

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
}

export type WindowState = TerminalWindow | NoteWindow;

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
