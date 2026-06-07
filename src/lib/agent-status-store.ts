import { useSyncExternalStore } from "react";
import type { AgentActivity, AgentStatus } from "@/types";

/**
 * Single source of truth for agent statuses, keyed by frontend terminal id.
 *
 * The canvas/minimap consume this imperatively (App reads {@link getAgentStatusMap}
 * and projects styles to DOM, avoiding window re-renders on every poll). The
 * sidebar instead subscribes via {@link useAgentActivities} so its per-terminal
 * status dots stay correct across all workspaces without touching the canvas.
 */
const statuses = new Map<string, AgentStatus>();
let activitySnapshot: Record<string, AgentActivity> = {};
const listeners = new Set<() => void>();

function rebuildActivitySnapshot(): void {
  const next: Record<string, AgentActivity> = {};
  for (const [terminalId, status] of statuses) {
    next[terminalId] = status.activity;
  }
  activitySnapshot = next;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Merge incoming statuses; notifies subscribers only when an activity changes. */
export function mergeAgentStatusesIntoStore(incoming: AgentStatus[]): void {
  let activityChanged = false;
  for (const status of incoming) {
    const previous = statuses.get(status.terminalId);
    statuses.set(status.terminalId, status);
    if (previous?.activity !== status.activity) activityChanged = true;
  }
  if (activityChanged) {
    rebuildActivitySnapshot();
    notify();
  }
}

/** Forget a terminal's status (on close / unregister). */
export function removeAgentStatusFromStore(terminalId: string): void {
  if (!statuses.delete(terminalId)) return;
  rebuildActivitySnapshot();
  notify();
}

/** Live map for imperative readers (canvas window halos, minimap paint). */
export function getAgentStatusMap(): Map<string, AgentStatus> {
  return statuses;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getActivitySnapshot(): Record<string, AgentActivity> {
  return activitySnapshot;
}

/** Reactive activity-by-terminal-id map for the sidebar. */
export function useAgentActivities(): Record<string, AgentActivity> {
  return useSyncExternalStore(subscribe, getActivitySnapshot, getActivitySnapshot);
}
