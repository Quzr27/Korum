import { invoke } from "@tauri-apps/api/core";
import type { WindowState, Workspace } from "@/types";

// ── Types ──

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface PersistedState {
  version: number;
  savedAt: number;
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
  windows: WindowState[];
  viewports: Record<string, ViewportState>;
  nextZ: number;
}

// ── State persistence ──

export async function persistState(state: PersistedState): Promise<void> {
  await invoke("save_state", { state });
}

export async function loadPersistedState(): Promise<PersistedState | null> {
  return await invoke<PersistedState | null>("load_state");
}

// ── Settings persistence (for future Phase 1.10 migration) ──

export async function persistSettings(settings: unknown): Promise<void> {
  await invoke("save_settings", { settings });
}

export async function loadPersistedSettings(): Promise<unknown | null> {
  return await invoke<unknown | null>("load_settings");
}
