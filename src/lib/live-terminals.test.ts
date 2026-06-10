import { describe, expect, it } from "vitest";
import { selectLiveTerminalIds } from "./live-terminals";
import type { WindowState } from "@/types";

function makeTerminal(
  id: string,
  x: number,
  y: number,
  zIndex: number,
  workspaceId = "ws-a",
): WindowState {
  return {
    id,
    type: "terminal",
    x,
    y,
    width: 560,
    height: 348,
    zIndex,
    title: id,
    workspaceId,
    createdAt: zIndex,
    updatedAt: zIndex,
  };
}

describe("selectLiveTerminalIds", () => {
  it("keeps the active terminal live even when it is off-screen", () => {
    const windows = [
      makeTerminal("active", 4000, 0, 9),
      makeTerminal("visible", 100, 100, 4),
    ];

    const result = selectLiveTerminalIds({
      windows,
      activeWorkspaceId: "ws-a",
      activeWindowId: "active",
      pan: { x: 0, y: 0 },
      zoom: 1,
      viewportWidth: 1600,
      viewportHeight: 900,
      keepAliveUntil: {},
      now: 1_000,
    });

    expect(result.liveTerminalIds.has("active")).toBe(true);
    expect(result.liveTerminalIds.has("visible")).toBe(true);
  });

  it("caps the number of live terminals at overview zoom", () => {
    const windows = Array.from({ length: 10 }, (_, index) =>
      makeTerminal(`term-${index}`, index * 300, 0, index),
    );

    const result = selectLiveTerminalIds({
      windows,
      activeWorkspaceId: "ws-a",
      activeWindowId: null,
      pan: { x: 0, y: 0 },
      zoom: 0.45,
      viewportWidth: 3000,
      viewportHeight: 1200,
      keepAliveUntil: {},
      now: 2_000,
    });

    expect(result.liveTerminalIds.size).toBe(8); // overview budget (0.45–0.7)
  });

  it("keeps only the active terminal and one neighbor live at far-overview zoom", () => {
    const windows = Array.from({ length: 30 }, (_, index) =>
      makeTerminal(`term-${index}`, (index % 6) * 300, Math.floor(index / 6) * 250, index),
    );

    const result = selectLiveTerminalIds({
      windows,
      activeWorkspaceId: "ws-a",
      activeWindowId: "term-17",
      pan: { x: 0, y: 0 },
      zoom: 0.3,
      viewportWidth: 3000,
      viewportHeight: 1600,
      keepAliveUntil: {},
      now: 2_000,
    });

    expect(result.liveTerminalIds.size).toBe(2); // far-overview budget
    expect(result.liveTerminalIds.has("term-17")).toBe(true); // active always wins
  });

  it("keeps small terminal counts fully live regardless of zoom", () => {
    const windows = Array.from({ length: 6 }, (_, index) =>
      makeTerminal(`term-${index}`, index * 300, 0, index),
    );

    const result = selectLiveTerminalIds({
      windows,
      activeWorkspaceId: "ws-a",
      activeWindowId: null,
      pan: { x: 0, y: 0 },
      zoom: 0.3,
      viewportWidth: 3000,
      viewportHeight: 1200,
      keepAliveUntil: {},
      now: 2_000,
    });

    expect(result.liveTerminalIds.size).toBe(6);
  });

  it("keeps recently visible terminals alive briefly after leaving the viewport", () => {
    const windows = [makeTerminal("term-1", 4_000, 0, 2)];

    const result = selectLiveTerminalIds({
      windows,
      activeWorkspaceId: "ws-a",
      activeWindowId: null,
      pan: { x: 0, y: 0 },
      zoom: 1,
      viewportWidth: 1600,
      viewportHeight: 900,
      keepAliveUntil: { "term-1": 5_000 },
      now: 3_000,
    });

    expect(result.liveTerminalIds.has("term-1")).toBe(true);
    expect(result.keepAliveUntil["term-1"]).toBe(5_000);
  });

  it("drops expired keep-alive entries", () => {
    const windows = [makeTerminal("term-1", 4_000, 0, 2)];

    const result = selectLiveTerminalIds({
      windows,
      activeWorkspaceId: "ws-a",
      activeWindowId: null,
      pan: { x: 0, y: 0 },
      zoom: 1,
      viewportWidth: 1600,
      viewportHeight: 900,
      keepAliveUntil: { "term-1": 2_500 },
      now: 3_000,
    });

    expect(result.liveTerminalIds.size).toBe(0);
    expect(result.keepAliveUntil["term-1"]).toBeUndefined();
  });
});
