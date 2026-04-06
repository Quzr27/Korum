import { describe, expect, it } from "vitest";
import { buildTerminalHydrationQueue, collectTerminalIds } from "./terminal-hydration";
import type { WindowState } from "@/types";

function makeTerminal(id: string, workspaceId: string, zIndex: number, createdAt = 0): WindowState {
  return {
    id,
    type: "terminal",
    x: 0,
    y: 0,
    width: 560,
    height: 348,
    zIndex,
    title: id,
    workspaceId,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeNote(id: string, workspaceId: string): WindowState {
  return {
    id,
    type: "note",
    x: 0,
    y: 0,
    width: 280,
    height: 180,
    zIndex: 1,
    title: id,
    workspaceId,
    content: "",
  };
}

describe("terminal hydration helpers", () => {
  it("collectTerminalIds returns only terminal window ids", () => {
    const ids = collectTerminalIds([
      makeTerminal("term-1", "ws-a", 2),
      makeNote("note-1", "ws-a"),
      makeTerminal("term-2", "ws-b", 3),
    ]);

    expect([...ids]).toEqual(["term-1", "term-2"]);
  });

  it("prioritizes the active window and only includes the active workspace", () => {
    const windows = [
      makeTerminal("term-a", "ws-a", 2, 1),
      makeTerminal("term-b", "ws-a", 6, 2),
      makeTerminal("term-c", "ws-a", 4, 3),
      makeTerminal("term-d", "ws-b", 9, 4),
    ];

    const queue = buildTerminalHydrationQueue(
      windows,
      "ws-a",
      "term-c",
      new Set(),
      new Set(),
    );

    expect(queue).toEqual(["term-c", "term-b", "term-a"]);
  });

  it("skips already hydrated or currently booting terminals", () => {
    const windows = [
      makeTerminal("term-a", "ws-a", 3),
      makeTerminal("term-b", "ws-a", 2),
      makeTerminal("term-c", "ws-a", 1),
    ];

    const queue = buildTerminalHydrationQueue(
      windows,
      "ws-a",
      null,
      new Set(["term-a"]),
      new Set(["term-b"]),
    );

    expect(queue).toEqual(["term-c"]);
  });
});
