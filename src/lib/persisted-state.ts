import type { PersistedState, ViewportState } from "./persistence";
import type { WindowState, WindowKind, Workspace, WorkspaceColor, WorkspaceIconKey, Point2D } from "@/types";
import { WORKSPACE_COLORS } from "@/types";

export const DEFAULT_VIEWPORT: ViewportState = { panX: 0, panY: 0, zoom: 1 };

interface WindowDefaults {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HydratedPersistedState {
  workspaces: Workspace[];
  windows: WindowState[];
  activeWorkspaceId: string | null;
  pan: Point2D;
  zoom: number;
  viewports: Record<string, ViewportState>;
  nextZ: number;
  counts: Record<WindowKind, number>;
}

const DEFAULT_WINDOW_DEFAULTS: WindowDefaults = {
  x: 284,
  y: 24,
  width: 560,
  height: 348,
};

const VALID_COLORS = new Set<string>(Object.keys(WORKSPACE_COLORS));
const VALID_ICONS = new Set<string>([
  "code", "terminal", "rocket", "star", "globe", "home", "folder", "fire",
  "diamond", "bug", "coffee", "crown", "git", "api", "database", "server",
  "cpu", "cloud", "shield", "package", "layers", "dashboard", "target", "wrench",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.color !== "string" ||
    typeof value.icon !== "string"
  ) {
    return null;
  }

  const color = VALID_COLORS.has(value.color) ? (value.color as WorkspaceColor) : "blue";
  const icon = VALID_ICONS.has(value.icon) ? (value.icon as WorkspaceIconKey) : "terminal";

  return {
    id: value.id,
    name: value.name,
    color,
    icon,
    rootPath: typeof value.rootPath === "string" ? value.rootPath : undefined,
  };
}

function sanitizeViewport(value: unknown): ViewportState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.panX !== "number" ||
    typeof value.panY !== "number" ||
    typeof value.zoom !== "number"
  ) {
    return null;
  }

  const panX = Number.isFinite(value.panX) ? Math.max(-100000, Math.min(100000, value.panX)) : 0;
  const panY = Number.isFinite(value.panY) ? Math.max(-100000, Math.min(100000, value.panY)) : 0;
  const zoom = Number.isFinite(value.zoom)
    ? Math.max(0.1, Math.min(5, value.zoom))
    : 1;

  return { panX, panY, zoom };
}

function sanitizeWindow(value: unknown, defaults: WindowDefaults): WindowState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.type !== "string" ||
    (value.type !== "terminal" && value.type !== "note")
  ) {
    return null;
  }

  const title =
    typeof value.title === "string" && value.title.trim().length > 0
      ? value.title
      : value.type === "terminal"
        ? "Terminal"
        : "Note";

  const safeNum = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  const rawWidth = safeNum(value.width, 0);
  const rawHeight = safeNum(value.height, 0);

  const clampCoord = (v: number, fallback: number) =>
    Number.isFinite(v) ? Math.max(-50000, Math.min(50000, v)) : fallback;

  const base = {
    id: value.id,
    x: clampCoord(safeNum(value.x, defaults.x), defaults.x),
    y: clampCoord(safeNum(value.y, defaults.y), defaults.y),
    width: Math.max(100, Math.min(rawWidth > 0 ? rawWidth : defaults.width, 8192)),
    height: Math.max(60, Math.min(rawHeight > 0 ? rawHeight : defaults.height, 8192)),
    zIndex: safeNum(value.zIndex, 1),
    title,
    workspaceId: value.workspaceId,
    createdAt:
      typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
        ? value.createdAt
        : undefined,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : undefined,
  };

  if (value.type === "terminal") {
    return {
      ...base,
      type: "terminal",
      terminalId: typeof value.terminalId === "string" ? value.terminalId : undefined,
      initialCwd: typeof value.initialCwd === "string" ? value.initialCwd : undefined,
    };
  }
  return {
    ...base,
    type: "note",
    content: typeof value.content === "string" ? value.content : "",
  };
}

export function hydratePersistedState(
  input: PersistedState,
  windowDefaults: Partial<WindowDefaults> = {},
): HydratedPersistedState {
  const defaults = { ...DEFAULT_WINDOW_DEFAULTS, ...windowDefaults };

  const workspaces = Array.isArray(input.workspaces)
    ? input.workspaces
        .map((workspace) => sanitizeWorkspace(workspace))
        .filter((workspace): workspace is Workspace => workspace !== null)
    : [];
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));

  const windows = Array.isArray(input.windows)
    ? input.windows
        .map((window) => sanitizeWindow(window, defaults))
        .filter((window): window is WindowState => {
          return window !== null && workspaceIds.has(window.workspaceId);
        })
    : [];

  const rawViewports = isRecord(input.viewports) ? input.viewports : {};
  const viewports = Object.fromEntries(
    Object.entries(rawViewports)
      .map(([workspaceId, viewport]) => [workspaceId, sanitizeViewport(viewport)] as const)
      .filter(
        (entry): entry is [string, ViewportState] =>
          workspaceIds.has(entry[0]) && entry[1] !== null,
      ),
  );

  const activeWorkspaceId =
    typeof input.activeWorkspaceId === "string" && workspaceIds.has(input.activeWorkspaceId)
      ? input.activeWorkspaceId
      : workspaces[0]?.id ?? null;
  const activeViewport = activeWorkspaceId ? viewports[activeWorkspaceId] : undefined;

  // Renormalize z-indices to 1..N preserving relative order.
  // This heals corrupt/inflated values and keeps nextZ bounded.
  const counts: Record<WindowKind, number> = { terminal: 0, note: 0 };
  if (windows.length > 0) {
    const sorted = windows
      .map((w, i) => ({ i, z: w.zIndex }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    for (let rank = 0; rank < sorted.length; rank++) {
      windows[sorted[rank].i].zIndex = rank + 1;
    }
  }
  for (const window of windows) {
    counts[window.type] += 1;
  }

  return {
    workspaces,
    windows,
    activeWorkspaceId,
    pan: activeViewport
      ? { x: activeViewport.panX, y: activeViewport.panY }
      : { x: DEFAULT_VIEWPORT.panX, y: DEFAULT_VIEWPORT.panY },
    zoom: activeViewport?.zoom ?? DEFAULT_VIEWPORT.zoom,
    viewports,
    nextZ: windows.length + 1,
    counts,
  };
}
