import type { TerminalWindow, WindowState } from "@/types";

export function getWorkspaceTerminalsToStop(
  windows: readonly WindowState[],
  workspaceId: string,
  stoppedTerminalIds: ReadonlySet<string>,
): TerminalWindow[] {
  return windows.filter((window): window is TerminalWindow => (
    window.type === "terminal" &&
    window.workspaceId === workspaceId &&
    !stoppedTerminalIds.has(window.id)
  ));
}

export function clearTerminalPtyIds(
  windows: readonly WindowState[],
  terminalIds: ReadonlySet<string>,
): WindowState[] {
  return windows.map((window) => (
    window.type === "terminal" && terminalIds.has(window.id)
      ? { ...window, ptyId: undefined }
      : window
  ));
}

export function rejectStoppedTerminalSpawn(options: {
  terminalId: string;
  ptyId: string | null;
  stoppedTerminalIds: ReadonlySet<string>;
  kill: (ptyId: string) => void;
  unregister: (terminalId: string) => void;
  clearStatus: (terminalId: string) => void;
}): boolean {
  const { terminalId, ptyId, stoppedTerminalIds, kill, unregister, clearStatus } = options;
  if (!ptyId || !stoppedTerminalIds.has(terminalId)) return false;
  kill(ptyId);
  unregister(terminalId);
  clearStatus(terminalId);
  return true;
}
