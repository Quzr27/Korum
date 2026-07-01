type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export interface WarRoomModalGuardState {
  quitDialogOpen: boolean;
  shortcutsOpen: boolean;
  commandCenterOpen: boolean;
  createDialogOpen: boolean;
  pasteConfirmOpen: boolean;
  sidebarModalOpen: boolean;
  snapshotExportOpen?: boolean;
}

export function isWarRoomModalGuardActive(state: WarRoomModalGuardState): boolean {
  return state.quitDialogOpen ||
    state.shortcutsOpen ||
    state.commandCenterOpen ||
    state.createDialogOpen ||
    state.pasteConfirmOpen ||
    state.sidebarModalOpen ||
    state.snapshotExportOpen === true;
}

export function shouldToggleWarRoomShortcut(event: ShortcutEvent, modalOpen: boolean): boolean {
  if (modalOpen || event.altKey) return false;
  const meta = event.metaKey || event.ctrlKey;
  return meta && event.shiftKey && event.key.toLowerCase() === "m";
}
