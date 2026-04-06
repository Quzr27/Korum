import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTerminalShortcut, type TerminalShortcutContext } from "./terminal-shortcuts";

function makeContext(overrides: Partial<TerminalShortcutContext> = {}): TerminalShortcutContext {
  return {
    selection: "",
    isMounted: true,
    copySelection: vi.fn(),
    pasteClipboard: vi.fn(),
    clearTerminal: vi.fn(),
    sendLineFeed: vi.fn(),
    ...overrides,
  };
}

function makeKeyboardEvent(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("handleTerminalShortcut", () => {
  it("maps Shift+Enter to a line feed without letting xterm submit Enter", () => {
    const context = makeContext();

    const result = handleTerminalShortcut(
      makeKeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
      context,
    );

    expect(result).toBe(false);
    expect(context.sendLineFeed).toHaveBeenCalledTimes(1);
  });

  it("swallows Shift+Enter keyup so the browser does not re-handle it", () => {
    const context = makeContext();

    const result = handleTerminalShortcut(
      makeKeyboardEvent("keyup", { key: "Enter", shiftKey: true }),
      context,
    );

    expect(result).toBe(false);
    expect(context.sendLineFeed).not.toHaveBeenCalled();
  });

  it("copies the selection on Cmd/Ctrl+C and preserves plain Ctrl+C when nothing is selected", () => {
    const selectedContext = makeContext({ selection: "hello" });
    const selectedResult = handleTerminalShortcut(
      makeKeyboardEvent("keydown", { key: "c", ctrlKey: true }),
      selectedContext,
    );
    expect(selectedResult).toBe(false);
    expect(selectedContext.copySelection).toHaveBeenCalledWith("hello");

    const emptyContext = makeContext();
    const emptyResult = handleTerminalShortcut(
      makeKeyboardEvent("keydown", { key: "c", ctrlKey: true }),
      emptyContext,
    );
    expect(emptyResult).toBe(true);
    expect(emptyContext.copySelection).not.toHaveBeenCalled();
  });

  it("keeps paste and clear shortcuts working", () => {
    const context = makeContext();

    const pasteResult = handleTerminalShortcut(
      makeKeyboardEvent("keydown", { key: "v", metaKey: true }),
      context,
    );
    const clearResult = handleTerminalShortcut(
      makeKeyboardEvent("keydown", { key: "k", metaKey: true }),
      context,
    );

    expect(pasteResult).toBe(false);
    expect(clearResult).toBe(false);
    expect(context.pasteClipboard).toHaveBeenCalledTimes(1);
    expect(context.clearTerminal).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts when the terminal is not mounted", () => {
    const context = makeContext({ isMounted: false });

    const result = handleTerminalShortcut(
      makeKeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
      context,
    );

    expect(result).toBe(true);
    expect(context.sendLineFeed).not.toHaveBeenCalled();
  });

  describe("global shortcut passthrough", () => {
    it.each([
      { key: "n", metaKey: true, desc: "Cmd+N (new terminal)" },
      { key: "N", metaKey: true, shiftKey: true, desc: "Cmd+Shift+N (new note)" },
      { key: "w", metaKey: true, desc: "Cmd+W (close window)" },
      { key: "W", metaKey: true, shiftKey: true, desc: "Cmd+Shift+W (new workspace)" },
      { key: "?", metaKey: true, shiftKey: true, desc: "Cmd+Shift+? (shortcuts)" },
      { key: "A", metaKey: true, shiftKey: true, desc: "Cmd+Shift+A (arrange)" },
    ])("blocks $desc so it bubbles to document", ({ desc: _, ...init }) => {
      const context = makeContext();
      const result = handleTerminalShortcut(
        makeKeyboardEvent("keydown", init),
        context,
      );
      expect(result).toBe(false);
    });

    it.each([
      { key: "n", metaKey: true, desc: "Cmd+N" },
      { key: "w", metaKey: true, desc: "Cmd+W" },
      { key: "W", metaKey: true, shiftKey: true, desc: "Cmd+Shift+W" },
      { key: "?", metaKey: true, shiftKey: true, desc: "Cmd+Shift+?" },
      { key: "A", metaKey: true, shiftKey: true, desc: "Cmd+Shift+A" },
    ])("blocks keyup for $desc to prevent xterm leak", ({ desc: _, ...init }) => {
      const context = makeContext();
      const result = handleTerminalShortcut(
        makeKeyboardEvent("keyup", init),
        context,
      );
      expect(result).toBe(false);
    });

    it("does not block plain n/w typing without modifier", () => {
      const context = makeContext();
      expect(handleTerminalShortcut(makeKeyboardEvent("keydown", { key: "n" }), context)).toBe(true);
      expect(handleTerminalShortcut(makeKeyboardEvent("keydown", { key: "w" }), context)).toBe(true);
    });
  });
});
