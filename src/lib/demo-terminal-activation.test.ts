import { describe, expect, it } from "vitest";
import type { TerminalWindow } from "@/types";
import { activateDemoTerminalWindow } from "./demo-terminal-activation";

function makeDemoTerminal(overrides: Partial<TerminalWindow> = {}): TerminalWindow {
  return {
    id: "term-1",
    type: "terminal",
    x: 0,
    y: 0,
    width: 720,
    height: 390,
    zIndex: 1,
    title: "Codex: test + typecheck",
    workspaceId: "ws-1",
    demoContent: ["$ codex", "Status: waiting"],
    demoStartLabel: "Start Codex",
    demoStartCommand: "codex",
    ptyId: "stale-session",
    ...overrides,
  };
}

describe("activateDemoTerminalWindow", () => {
  it("converts a demo terminal into a live terminal and returns its command", () => {
    const result = activateDemoTerminalWindow(makeDemoTerminal());

    expect(result.startCommand).toBe("codex");
    expect(result.window).toEqual(expect.objectContaining({
      id: "term-1",
      type: "terminal",
      title: "Codex: test + typecheck",
      workspaceId: "ws-1",
    }));
    expect(result.window).not.toHaveProperty("demoContent");
    expect(result.window).not.toHaveProperty("demoStartLabel");
    expect(result.window).not.toHaveProperty("demoStartCommand");
    expect(result.window).not.toHaveProperty("ptyId");
  });

  it("returns no command when the demo terminal should only open a shell", () => {
    const result = activateDemoTerminalWindow(makeDemoTerminal({
      demoStartCommand: undefined,
      demoStartLabel: "Start terminal",
    }));

    expect(result.startCommand).toBeUndefined();
    expect(result.window).not.toHaveProperty("demoContent");
  });
});
