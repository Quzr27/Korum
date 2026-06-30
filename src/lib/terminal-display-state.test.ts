import { describe, expect, it } from "vitest";
import { getTerminalDisplayState } from "./terminal-display-state";

describe("getTerminalDisplayState", () => {
  it("shows demo preview without the shell pending overlay", () => {
    const state = getTerminalDisplayState({
      isDemoTerminal: true,
      isSessionReady: false,
      spawnError: null,
      isPtyReady: false,
      hasGhost: false,
      previewText: null,
    });

    expect(state.showDemoPreview).toBe(true);
    expect(state.showPendingOverlay).toBe(false);
    expect(state.showDetachedPreview).toBe(false);
  });

  it("keeps the pending overlay for live terminals waiting on PTY readiness", () => {
    const state = getTerminalDisplayState({
      isDemoTerminal: false,
      isSessionReady: false,
      spawnError: null,
      isPtyReady: false,
      hasGhost: false,
      previewText: null,
    });

    expect(state.showDemoPreview).toBe(false);
    expect(state.showPendingOverlay).toBe(true);
  });
});
