import { describe, expect, it } from "vitest";
import { stripSessionWindowFields } from "@/lib/window-persistence";
import type { CodeWindow, TerminalWindow } from "@/types";

describe("stripSessionWindowFields", () => {
  it("removes terminal PTY ids before persistence", () => {
    const win: TerminalWindow = {
      id: "term-1",
      type: "terminal",
      title: "Terminal",
      workspaceId: "ws-1",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      zIndex: 1,
      ptyId: "session-only",
    };

    expect(stripSessionWindowFields(win)).not.toHaveProperty("ptyId");
  });

  it("removes CodeWindow target navigation fields before persistence", () => {
    const win: CodeWindow = {
      id: "code-1",
      type: "code",
      title: "App.tsx",
      workspaceId: "ws-1",
      x: 0,
      y: 0,
      width: 820,
      height: 600,
      zIndex: 1,
      sourcePath: "/project/src/App.tsx",
      viewMode: "file",
      targetLine: 42,
      targetColumn: 13,
      targetNonce: 7,
    };

    expect(stripSessionWindowFields(win)).toEqual({
      id: "code-1",
      type: "code",
      title: "App.tsx",
      workspaceId: "ws-1",
      x: 0,
      y: 0,
      width: 820,
      height: 600,
      zIndex: 1,
      sourcePath: "/project/src/App.tsx",
      viewMode: "file",
    });
  });
});
