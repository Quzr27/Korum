/**
 * Staggered terminal attach scheduling.
 *
 * When the viewport teleports (sidebar click, workspace switch), the set of
 * live terminals can change almost entirely in a single React commit. Each
 * xterm attach is expensive (instance creation, font measurement, fit,
 * snapshot restore, PTY buffer drain through the parser), so attaching a
 * dozen terminals synchronously freezes the main thread for seconds.
 *
 * `advanceAttachSet` is a pure stepper: detaches apply immediately (cheap),
 * while attaches are admitted at most `batchSize` per step, priority id
 * first. The caller drives one step per animation frame until `done`.
 */

export interface AttachStaggerStep {
  /** Next attached set. Same reference as `current` when nothing changed. */
  next: ReadonlySet<string>;
  /** True once `next` equals `target` — no more steps needed. */
  done: boolean;
}

export function advanceAttachSet(
  current: ReadonlySet<string>,
  target: ReadonlySet<string>,
  priorityId: string | null,
  batchSize: number,
): AttachStaggerStep {
  // Drop everything no longer live — detach is cheap and frees resources
  // before the next attach lands.
  const pruned: string[] = [];
  let prunedAny = false;
  for (const id of current) {
    if (target.has(id)) pruned.push(id);
    else prunedAny = true;
  }

  const pending: string[] = [];
  if (priorityId !== null && target.has(priorityId) && !current.has(priorityId)) {
    pending.push(priorityId);
  }
  for (const id of target) {
    if (pending.length >= batchSize) break;
    if (!current.has(id) && id !== priorityId) pending.push(id);
  }

  if (!prunedAny && pending.length === 0) {
    return { next: current, done: current.size === target.size };
  }

  const next = new Set(pruned);
  for (const id of pending) next.add(id);
  return { next, done: next.size === target.size };
}

/** Stable order-insensitive signature of a live-id set, for effect deps. */
export function liveIdsSignature(ids: ReadonlySet<string>): string {
  return [...ids].sort().join("|");
}
