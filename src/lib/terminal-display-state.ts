interface TerminalDisplayStateInput {
  isDemoTerminal: boolean;
  isSessionReady: boolean;
  spawnError: string | null;
  isPtyReady: boolean;
  hasGhost: boolean;
  previewText: string | null;
}

interface TerminalDisplayState {
  showDemoPreview: boolean;
  showDetachedPreview: boolean;
  showPendingOverlay: boolean;
}

export function getTerminalDisplayState(input: TerminalDisplayStateInput): TerminalDisplayState {
  return {
    showDemoPreview: input.isDemoTerminal,
    showDetachedPreview:
      !input.isDemoTerminal &&
      !input.isSessionReady &&
      !input.spawnError &&
      input.isPtyReady &&
      !input.hasGhost &&
      !!input.previewText,
    showPendingOverlay:
      !input.isDemoTerminal &&
      !input.isSessionReady &&
      !input.spawnError &&
      !input.isPtyReady,
  };
}
