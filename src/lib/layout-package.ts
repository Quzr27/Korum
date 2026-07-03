import type { ViewportState } from "@/lib/persistence";
import { stripSessionWindowFields } from "@/lib/window-persistence";
import {
  WORKSPACE_COLORS,
  type CodeWindow,
  type NoteWindow,
  type TerminalWindow,
  type WindowState,
  type Workspace,
  type WorkspaceColor,
  type WorkspaceIconKey,
} from "@/types";

export const LAYOUT_PACKAGE_SCHEMA = "dev.quzr.korum.layout";
export const LAYOUT_PACKAGE_VERSION = 1;

export type LayoutPathMode = "keep" | "relative" | "sanitize";
export type LayoutPackageScope = "workspace" | "korum";

export interface LayoutPackageLayout {
  workspace: Workspace;
  windows: WindowState[];
  viewport: ViewportState;
}

export interface KorumLayoutPackageLayout {
  workspaces: Workspace[];
  windows: WindowState[];
  viewports: Record<string, ViewportState>;
  activeWorkspaceId: string | null;
}

interface LayoutPackageBase {
  schema: typeof LAYOUT_PACKAGE_SCHEMA;
  version: typeof LAYOUT_PACKAGE_VERSION;
  exportedAt: string;
  pathMode: LayoutPathMode;
}

export interface WorkspaceLayoutPackage extends LayoutPackageBase {
  scope: "workspace";
  layout: LayoutPackageLayout;
}

export interface KorumLayoutPackage extends LayoutPackageBase {
  scope: "korum";
  appLayout: KorumLayoutPackageLayout;
}

export type LayoutPackage = WorkspaceLayoutPackage | KorumLayoutPackage;

export interface CreateLayoutPackageInput {
  workspace: Workspace;
  windows: WindowState[];
  viewport: ViewportState;
  pathMode: LayoutPathMode;
  exportedAt?: string;
}

export interface CreateKorumLayoutPackageInput {
  workspaces: Workspace[];
  windows: WindowState[];
  viewports: Record<string, ViewportState>;
  activeWorkspaceId: string | null;
  pathMode: LayoutPathMode;
  exportedAt?: string;
}

export interface BuildImportedLayoutOptions {
  idFactory?: () => string;
  now?: number;
  workspaceRootPath?: string;
}

export interface ImportedLayout {
  workspace: Workspace;
  windows: WindowState[];
  viewport: ViewportState;
  nextZ: number;
}

export interface ImportedKorumLayout {
  workspaces: Workspace[];
  windows: WindowState[];
  viewports: Record<string, ViewportState>;
  activeWorkspaceId: string | null;
  nextZ: number;
}

const WORKSPACE_ICON_KEYS = [
  "code",
  "terminal",
  "rocket",
  "star",
  "globe",
  "home",
  "folder",
  "fire",
  "diamond",
  "bug",
  "coffee",
  "crown",
  "git",
  "api",
  "database",
  "server",
  "cpu",
  "cloud",
  "shield",
  "package",
  "layers",
  "dashboard",
  "target",
  "wrench",
] as const satisfies readonly WorkspaceIconKey[];

const WORKSPACE_COLOR_KEYS = Object.keys(WORKSPACE_COLORS) as WorkspaceColor[];
const VALID_WORKSPACE_COLORS = new Set<WorkspaceColor>(WORKSPACE_COLOR_KEYS);
const VALID_WORKSPACE_ICONS = new Set<WorkspaceIconKey>(WORKSPACE_ICON_KEYS);

function defaultIdFactory() {
  return crypto.randomUUID();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLayoutPathMode(value: unknown): value is LayoutPathMode {
  return value === "keep" || value === "relative" || value === "sanitize";
}

function isWorkspaceColor(value: unknown): value is WorkspaceColor {
  return typeof value === "string" && VALID_WORKSPACE_COLORS.has(value as WorkspaceColor);
}

function isWorkspaceIconKey(value: unknown): value is WorkspaceIconKey {
  return typeof value === "string" && VALID_WORKSPACE_ICONS.has(value as WorkspaceIconKey);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function cleanPathSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function trimTrailingSlash(path: string): string {
  const cleaned = cleanPathSlashes(path);
  return cleaned.length > 1 ? cleaned.replace(/\/+$/, "") : cleaned;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:\//.test(cleanPathSlashes(path));
}

function relativizePath(path: string | undefined, rootPath: string | undefined): string | undefined {
  if (!path || !rootPath) return undefined;
  const root = trimTrailingSlash(rootPath);
  const candidate = cleanPathSlashes(path);
  if (candidate === root) return "";
  const prefix = `${root}/`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : undefined;
}

function rebasePath(path: string | undefined, rootPath: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (isAbsolutePath(path)) return path;
  if (!rootPath) return path;
  const root = trimTrailingSlash(rootPath);
  const relative = cleanPathSlashes(path).replace(/^\/+/, "");
  return relative ? `${root}/${relative}` : root;
}

function sanitizeWorkspace(workspace: Workspace, pathMode: LayoutPathMode): Workspace {
  if (pathMode === "keep") return { ...workspace };
  const { rootPath: _rootPath, ...rest } = workspace;
  return rest;
}

function sanitizeWindowForExport(
  window: WindowState,
  pathMode: LayoutPathMode,
  workspaceRootPath: string | undefined,
): WindowState | null {
  const stripped = stripSessionWindowFields(window);

  if (pathMode === "keep") return { ...stripped };

  if (stripped.type === "terminal") {
    const next: TerminalWindow = { ...stripped };
    if (pathMode === "relative") {
      const relativeCwd = relativizePath(next.initialCwd, workspaceRootPath);
      if (relativeCwd !== undefined) next.initialCwd = relativeCwd;
      else delete next.initialCwd;
    } else {
      delete next.initialCwd;
    }
    return next;
  }

  if (stripped.type === "note") {
    const next: NoteWindow = { ...stripped };
    if (pathMode === "relative") {
      const relativeSource = relativizePath(next.sourcePath, workspaceRootPath);
      if (relativeSource !== undefined) next.sourcePath = relativeSource;
      else delete next.sourcePath;
    } else {
      delete next.sourcePath;
    }
    return next;
  }

  if (stripped.type === "code") {
    if (pathMode === "sanitize") return null;
    const relativeSource = relativizePath(stripped.sourcePath, workspaceRootPath);
    if (!relativeSource) return null;
    return { ...stripped, sourcePath: relativeSource };
  }

  return null;
}

function sanitizeWindowForImport(
  window: WindowState,
  pathMode: LayoutPathMode,
  workspaceId: string,
  id: string,
  idMap: Map<string, string>,
  now: number,
  workspaceRootPath: string | undefined,
): WindowState | null {
  const stripped = stripSessionWindowFields(window);
  const base = {
    ...stripped,
    id,
    workspaceId,
    createdAt: now,
    updatedAt: now,
  };

  if (stripped.type === "terminal") {
    const next: TerminalWindow = {
      ...base,
      type: "terminal",
      initialCwd: pathMode === "relative"
        ? rebasePath(stripped.initialCwd, workspaceRootPath)
        : stripped.initialCwd,
    };
    if (!next.initialCwd) delete next.initialCwd;
    return next;
  }

  if (stripped.type === "note") {
    const next: NoteWindow = {
      ...base,
      type: "note",
      sourcePath: pathMode === "relative"
        ? rebasePath(stripped.sourcePath, workspaceRootPath)
        : stripped.sourcePath,
    };
    if (!next.sourcePath) delete next.sourcePath;
    return next;
  }

  if (stripped.type === "code") {
    const sourcePath = pathMode === "relative"
      ? rebasePath(stripped.sourcePath, workspaceRootPath)
      : stripped.sourcePath;
    if (!sourcePath) return null;
    const originTerminalId = stripped.originTerminalId ? idMap.get(stripped.originTerminalId) : undefined;
    const next: CodeWindow = {
      ...base,
      type: "code",
      sourcePath,
      viewMode: stripped.viewMode === "changes" ? "changes" : "file",
      originTerminalId,
    };
    if (!next.originTerminalId) delete next.originTerminalId;
    return next;
  }

  return null;
}

function normalizeViewport(viewport: ViewportState): ViewportState {
  return {
    panX: Number.isFinite(viewport.panX) ? viewport.panX : 0,
    panY: Number.isFinite(viewport.panY) ? viewport.panY : 0,
    zoom: Number.isFinite(viewport.zoom) ? viewport.zoom : 1,
  };
}

function parsePackageWorkspace(value: unknown): Workspace | null {
  if (!isPlainObject(value)) return null;
  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.name !== "string" ||
    !isWorkspaceColor(value.color) ||
    !isWorkspaceIconKey(value.icon)
  ) {
    return null;
  }

  const workspace: Workspace = {
    id: value.id,
    name: value.name,
    color: value.color,
    icon: value.icon,
  };

  if (typeof value.rootPath === "string") {
    workspace.rootPath = value.rootPath;
  }

  return workspace;
}

function parsePackageViewport(value: unknown): ViewportState | null {
  if (!isPlainObject(value)) return null;
  if (!isFiniteNumber(value.panX) || !isFiniteNumber(value.panY) || !isFiniteNumber(value.zoom)) {
    return null;
  }
  return normalizeViewport({
    panX: value.panX,
    panY: value.panY,
    zoom: value.zoom,
  });
}

function parsePackageWindow(value: unknown): WindowState | null {
  if (!isPlainObject(value)) return null;
  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.trim().length === 0 ||
    typeof value.title !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    !isFiniteNumber(value.height) ||
    value.height <= 0 ||
    !isFiniteNumber(value.zIndex)
  ) {
    return null;
  }

  const base: {
    id: string;
    title: string;
    workspaceId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    createdAt?: number;
    updatedAt?: number;
  } = {
    id: value.id,
    title: value.title,
    workspaceId: value.workspaceId,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    zIndex: value.zIndex,
  };

  const createdAt = readOptionalNumber(value.createdAt);
  const updatedAt = readOptionalNumber(value.updatedAt);
  if (createdAt !== undefined) base.createdAt = createdAt;
  if (updatedAt !== undefined) base.updatedAt = updatedAt;

  if (value.type === "terminal") {
    const next: TerminalWindow = { ...base, type: "terminal" };
    const terminalId = readOptionalString(value.terminalId);
    const initialCwd = readOptionalString(value.initialCwd);
    const demoStartLabel = readOptionalString(value.demoStartLabel);
    const demoStartCommand = readOptionalString(value.demoStartCommand);
    if (terminalId !== undefined) next.terminalId = terminalId;
    if (initialCwd !== undefined) next.initialCwd = initialCwd;
    if (Array.isArray(value.demoContent) && value.demoContent.every((line) => typeof line === "string")) {
      next.demoContent = value.demoContent;
    }
    if (demoStartLabel !== undefined) next.demoStartLabel = demoStartLabel;
    if (demoStartCommand !== undefined) next.demoStartCommand = demoStartCommand;
    return next;
  }

  if (value.type === "note") {
    const next: NoteWindow = { ...base, type: "note" };
    const content = readOptionalString(value.content);
    const sourcePath = readOptionalString(value.sourcePath);
    if (content !== undefined) next.content = content;
    if (sourcePath !== undefined) next.sourcePath = sourcePath;
    return next;
  }

  if (value.type === "code") {
    if (typeof value.sourcePath !== "string") return null;
    const next: CodeWindow = {
      ...base,
      type: "code",
      sourcePath: value.sourcePath,
      viewMode: value.viewMode === "changes" ? "changes" : "file",
    };
    const originTerminalId = readOptionalString(value.originTerminalId);
    if (originTerminalId !== undefined) next.originTerminalId = originTerminalId;
    return next;
  }

  return null;
}

function parsePackageWindows(value: unknown, validWorkspaceIds: Set<string>): WindowState[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((window) => parsePackageWindow(window))
    .filter((window): window is WindowState => window !== null && validWorkspaceIds.has(window.workspaceId));
}

function parseWorkspacePackageLayout(value: unknown): LayoutPackageLayout | null {
  if (!isPlainObject(value)) return null;
  const workspace = parsePackageWorkspace(value.workspace);
  const viewport = parsePackageViewport(value.viewport);
  if (!workspace || !viewport) return null;
  const windows = parsePackageWindows(value.windows, new Set([workspace.id]));
  if (!windows) return null;

  return {
    workspace,
    windows,
    viewport,
  };
}

function parseKorumPackageLayout(value: unknown): KorumLayoutPackageLayout | null {
  if (!isPlainObject(value) || !Array.isArray(value.workspaces) || !isPlainObject(value.viewports)) {
    return null;
  }
  const rawViewports = value.viewports;
  if (
    value.activeWorkspaceId !== null &&
    value.activeWorkspaceId !== undefined &&
    typeof value.activeWorkspaceId !== "string"
  ) {
    return null;
  }

  const workspaceIds = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const rawWorkspace of value.workspaces) {
    const workspace = parsePackageWorkspace(rawWorkspace);
    if (!workspace || workspaceIds.has(workspace.id)) continue;
    workspaceIds.add(workspace.id);
    workspaces.push(workspace);
  }

  const windows = parsePackageWindows(value.windows, workspaceIds);
  if (!windows) return null;

  const viewports = Object.fromEntries(
    workspaces.map((workspace) => [
      workspace.id,
      parsePackageViewport(rawViewports[workspace.id]) ?? { panX: 0, panY: 0, zoom: 1 },
    ] as const),
  );

  const activeWorkspaceId = typeof value.activeWorkspaceId === "string" && workspaceIds.has(value.activeWorkspaceId)
    ? value.activeWorkspaceId
    : workspaces[0]?.id ?? null;

  return {
    workspaces,
    windows,
    viewports,
    activeWorkspaceId,
  };
}

export function createLayoutPackage({
  workspace,
  windows,
  viewport,
  pathMode,
  exportedAt,
}: CreateLayoutPackageInput): WorkspaceLayoutPackage {
  const layoutWindows = windows
    .filter((window) => window.workspaceId === workspace.id)
    .map((window) => sanitizeWindowForExport(window, pathMode, workspace.rootPath))
    .filter((window): window is WindowState => window !== null);

  return {
    schema: LAYOUT_PACKAGE_SCHEMA,
    version: LAYOUT_PACKAGE_VERSION,
    scope: "workspace",
    exportedAt: exportedAt ?? new Date().toISOString(),
    pathMode,
    layout: {
      workspace: sanitizeWorkspace(workspace, pathMode),
      windows: layoutWindows,
      viewport: normalizeViewport(viewport),
    },
  };
}

export function createKorumLayoutPackage({
  workspaces,
  windows,
  viewports,
  activeWorkspaceId,
  pathMode,
  exportedAt,
}: CreateKorumLayoutPackageInput): KorumLayoutPackage {
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceRootById = new Map(workspaces.map((workspace) => [workspace.id, workspace.rootPath] as const));
  const layoutWindows = windows
    .filter((window) => workspaceIds.has(window.workspaceId))
    .map((window) => sanitizeWindowForExport(
      window,
      pathMode,
      workspaceRootById.get(window.workspaceId),
    ))
    .filter((window): window is WindowState => window !== null);

  const layoutViewports = Object.fromEntries(
    workspaces.map((workspace) => [
      workspace.id,
      normalizeViewport(viewports[workspace.id] ?? { panX: 0, panY: 0, zoom: 1 }),
    ] as const),
  );

  return {
    schema: LAYOUT_PACKAGE_SCHEMA,
    version: LAYOUT_PACKAGE_VERSION,
    scope: "korum",
    exportedAt: exportedAt ?? new Date().toISOString(),
    pathMode,
    appLayout: {
      workspaces: workspaces.map((workspace) => sanitizeWorkspace(workspace, pathMode)),
      windows: layoutWindows,
      viewports: layoutViewports,
      activeWorkspaceId: activeWorkspaceId && workspaceIds.has(activeWorkspaceId)
        ? activeWorkspaceId
        : workspaces[0]?.id ?? null,
    },
  };
}

export function buildImportedLayout(pkg: WorkspaceLayoutPackage, options: BuildImportedLayoutOptions = {}): ImportedLayout {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? Date.now();
  const workspaceId = idFactory();
  const workspace: Workspace = {
    ...pkg.layout.workspace,
    id: workspaceId,
    rootPath: pkg.pathMode === "relative"
      ? options.workspaceRootPath
      : pkg.layout.workspace.rootPath,
  };
  if (!workspace.rootPath) delete workspace.rootPath;

  const idMap = new Map<string, string>();
  for (const window of pkg.layout.windows) {
    idMap.set(window.id, idFactory());
  }

  const windows = pkg.layout.windows
    .map((window) => {
      const nextId = idMap.get(window.id);
      if (!nextId) return null;
      return sanitizeWindowForImport(
        window,
        pkg.pathMode,
        workspaceId,
        nextId,
        idMap,
        now,
        options.workspaceRootPath,
      );
    })
    .filter((window): window is WindowState => window !== null);

  return {
    workspace,
    windows,
    viewport: normalizeViewport(pkg.layout.viewport),
    nextZ: Math.max(1, ...windows.map((window) => window.zIndex)) + 1,
  };
}

export function buildImportedKorumLayout(
  pkg: KorumLayoutPackage,
  options: BuildImportedLayoutOptions = {},
): ImportedKorumLayout {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? Date.now();
  const workspaceIdMap = new Map<string, string>();
  for (const workspace of pkg.appLayout.workspaces) {
    workspaceIdMap.set(workspace.id, idFactory());
  }

  const workspaces = pkg.appLayout.workspaces.map((workspace) => {
    const nextId = workspaceIdMap.get(workspace.id);
    if (!nextId) return null;
    const next: Workspace = {
      ...workspace,
      id: nextId,
      rootPath: pkg.pathMode === "relative"
        ? options.workspaceRootPath
        : workspace.rootPath,
    };
    if (!next.rootPath) delete next.rootPath;
    return next;
  }).filter((workspace): workspace is Workspace => workspace !== null);

  const importedWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceByOriginalId = new Map(pkg.appLayout.workspaces.map((workspace) => [workspace.id, workspace] as const));
  const windowIdMap = new Map<string, string>();
  for (const window of pkg.appLayout.windows) {
    if (workspaceIdMap.has(window.workspaceId)) {
      windowIdMap.set(window.id, idFactory());
    }
  }

  const windows = pkg.appLayout.windows
    .map((window) => {
      const nextWorkspaceId = workspaceIdMap.get(window.workspaceId);
      const nextId = windowIdMap.get(window.id);
      if (!nextWorkspaceId || !nextId || !importedWorkspaceIds.has(nextWorkspaceId)) return null;
      return sanitizeWindowForImport(
        window,
        pkg.pathMode,
        nextWorkspaceId,
        nextId,
        windowIdMap,
        now,
        workspaceByOriginalId.get(window.workspaceId)?.rootPath ?? options.workspaceRootPath,
      );
    })
    .filter((window): window is WindowState => window !== null);

  const viewports = Object.fromEntries(
    pkg.appLayout.workspaces
      .map((workspace) => {
        const nextWorkspaceId = workspaceIdMap.get(workspace.id);
        if (!nextWorkspaceId || !importedWorkspaceIds.has(nextWorkspaceId)) return null;
        return [
          nextWorkspaceId,
          normalizeViewport(pkg.appLayout.viewports[workspace.id] ?? { panX: 0, panY: 0, zoom: 1 }),
        ] as const;
      })
      .filter((entry): entry is readonly [string, ViewportState] => entry !== null),
  );

  const activeWorkspaceId = pkg.appLayout.activeWorkspaceId
    ? workspaceIdMap.get(pkg.appLayout.activeWorkspaceId) ?? workspaces[0]?.id ?? null
    : workspaces[0]?.id ?? null;

  return {
    workspaces,
    windows,
    viewports,
    activeWorkspaceId,
    nextZ: Math.max(1, ...windows.map((window) => window.zIndex)) + 1,
  };
}

export function parseLayoutPackageText(text: string): LayoutPackage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON");
  }

  if (!isPlainObject(value) || value.schema !== LAYOUT_PACKAGE_SCHEMA) {
    throw new Error("File is not a Korum layout package");
  }
  if (value.version !== LAYOUT_PACKAGE_VERSION) {
    throw new Error("Unsupported Korum layout package version");
  }
  if (!isLayoutPathMode(value.pathMode)) {
    throw new Error("Korum layout package has an invalid path mode");
  }
  if (typeof value.exportedAt !== "string") {
    throw new Error("Korum layout package has invalid metadata");
  }
  const scope = value.scope === undefined ? "workspace" : value.scope;
  if (scope !== "workspace" && scope !== "korum") {
    throw new Error("Korum layout package has an invalid scope");
  }

  if (scope === "workspace") {
    const layout = parseWorkspacePackageLayout(value.layout);
    if (!layout) {
      throw new Error("Korum layout package has invalid workspace layout data");
    }
    return {
      schema: LAYOUT_PACKAGE_SCHEMA,
      version: LAYOUT_PACKAGE_VERSION,
      exportedAt: value.exportedAt,
      pathMode: value.pathMode,
      scope: "workspace",
      layout,
    };
  }

  const appLayout = parseKorumPackageLayout(value.appLayout);
  if (!appLayout) {
    throw new Error("Korum layout package has invalid app layout data");
  }
  if (appLayout.workspaces.length === 0) {
    throw new Error("Korum layout package must include at least one workspace");
  }

  return {
    schema: LAYOUT_PACKAGE_SCHEMA,
    version: LAYOUT_PACKAGE_VERSION,
    exportedAt: value.exportedAt,
    pathMode: value.pathMode,
    scope: "korum",
    appLayout,
  };
}

export function buildLayoutPackageFileName(workspaceName: string): string {
  const slug = workspaceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "korum-layout"}.korum-layout.json`;
}
