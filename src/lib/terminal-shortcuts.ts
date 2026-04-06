export interface TerminalShortcutContext {
  selection: string;
  isMounted: boolean;
  copySelection: (selection: string) => void;
  pasteClipboard: () => void;
  clearTerminal: () => void;
  sendLineFeed: () => void;
}

export function handleTerminalShortcut(
  event: KeyboardEvent,
  context: TerminalShortcutContext,
): boolean {
  const mod = event.metaKey || event.ctrlKey;

  if (mod && (event.key === "v" || event.key === "k" || event.key === "?" || event.key === "n" || event.key === "N" || event.key === "w" || event.key === "W" || event.key === "A")) {
    if (event.type === "keyup") return false;
  }

  if (event.key === "Enter" && event.shiftKey) {
    if (event.type === "keyup") return false;
    if (event.type !== "keydown") return false;
    if (!context.isMounted) return true;
    context.sendLineFeed();
    return false;
  }

  if (event.type !== "keydown") return true;
  if (!context.isMounted) return true;

  if (mod && event.key === "c") {
    if (context.selection) {
      context.copySelection(context.selection);
      return false;
    }
    return true;
  }

  if (mod && event.key === "v") {
    context.pasteClipboard();
    return false;
  }

  if (mod && event.key === "k") {
    context.clearTerminal();
    return false;
  }

  // Global shortcuts — let bubble to document handler
  if (mod && (event.key === "?" || event.key === "n" || event.key === "N" || event.key === "w" || event.key === "W" || event.key === "A")) {
    return false;
  }

  return true;
}
