import { describe, expect, it, vi } from "vitest";
import {
  clearTerminalPtyIds,
  getWorkspaceTerminalsToStop,
  rejectStoppedTerminalSpawn,
} from "./terminal-session-lifecycle";
import type { WindowState } from "@/types";

const windows: WindowState[] = [
  {
    id: "running",
    type: "terminal",
    title: "Running",
    workspaceId: "ws-a",
    ptyId: "pty-running",
    x: 10,
    y: 20,
    width: 560,
    height: 348,
    zIndex: 1,
  },
  {
    id: "cold",
    type: "terminal",
    title: "Not hydrated yet",
    workspaceId: "ws-a",
    x: 600,
    y: 20,
    width: 700,
    height: 400,
    zIndex: 2,
  },
  {
    id: "note",
    type: "note",
    title: "Keep me",
    workspaceId: "ws-a",
    content: "layout stays",
    x: 10,
    y: 400,
    width: 300,
    height: 200,
    zIndex: 3,
  },
];

describe("workspace terminal stop lifecycle", () => {
  it("targets hydrated and cold terminals while preserving every window and layout field", () => {
    const targets = getWorkspaceTerminalsToStop(windows, "ws-a", new Set());
    const targetIds = new Set(targets.map((terminal) => terminal.id));
    const stoppedWindows = clearTerminalPtyIds(windows, targetIds);

    expect(targets.map((terminal) => terminal.id)).toEqual(["running", "cold"]);
    expect(stoppedWindows).toHaveLength(windows.length);
    expect(stoppedWindows.find((window) => window.id === "running")).toEqual({
      ...windows[0],
      ptyId: undefined,
    });
    expect(stoppedWindows.find((window) => window.id === "cold")).toEqual(windows[1]);
    expect(stoppedWindows.find((window) => window.id === "note")).toBe(windows[2]);
  });

  it("kills and rejects a late PTY spawn after Stop wins", () => {
    const kill = vi.fn();
    const unregister = vi.fn();
    const clearStatus = vi.fn();

    expect(rejectStoppedTerminalSpawn({
      terminalId: "cold",
      ptyId: "pty-late",
      stoppedTerminalIds: new Set(["cold"]),
      kill,
      unregister,
      clearStatus,
    })).toBe(true);
    expect(kill).toHaveBeenCalledWith("pty-late");
    expect(unregister).toHaveBeenCalledWith("cold");
    expect(clearStatus).toHaveBeenCalledWith("cold");
  });
});
