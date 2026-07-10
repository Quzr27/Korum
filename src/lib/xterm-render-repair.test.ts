import { describe, expect, it, vi } from "vitest";
import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import {
  activateTerminalRenderer,
  createTerminalDisplayRepairScheduler,
  refreshTerminalDisplay,
  type TerminalDisplayRepairTarget,
} from "./xterm-render-repair";

function mockVoid() {
  return vi.fn(() => undefined);
}

type VoidMock = ReturnType<typeof mockVoid>;

interface FakeTerminal extends TerminalDisplayRepairTarget {
  clearSelection: VoidMock;
  clearTextureAtlas: VoidMock;
  refresh: VoidMock;
  scrollToBottom: VoidMock;
  scrollLines: VoidMock;
  _core: {
    _renderService: {
      clear: VoidMock;
    };
  };
}

function makeTerminal(): FakeTerminal {
  return {
    rows: 24,
    buffer: {
      active: {
        viewportY: 10,
        baseY: 10,
      },
    },
    clearSelection: mockVoid(),
    clearTextureAtlas: mockVoid(),
    refresh: mockVoid(),
    scrollToBottom: mockVoid(),
    scrollLines: mockVoid(),
    _core: {
      _renderService: {
        clear: mockVoid(),
      },
    },
  };
}

function withImmediateAnimationFrame(action: () => void) {
  const requestAnimationFrameSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

  try {
    action();
  } finally {
    requestAnimationFrameSpy.mockRestore();
  }
}

describe("refreshTerminalDisplay", () => {
  it("clears the xterm renderer before refreshing rows", () => {
    const term = makeTerminal();

    withImmediateAnimationFrame(() => {
      refreshTerminalDisplay(term, { isCurrent: () => true });
    });

    expect(term._core._renderService.clear).toHaveBeenCalledTimes(1);
    expect(term.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);

    const clearOrder = term._core._renderService.clear.mock.invocationCallOrder[0];
    const refreshOrder = term.refresh.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(refreshOrder);
  });
});

describe("activateTerminalRenderer", () => {
  it("loads CanvasAddon in auto mode", () => {
    const addon = { activate: vi.fn(), dispose: vi.fn() } satisfies ITerminalAddon;
    const loadAddon = vi.fn();

    const active = activateTerminalRenderer(
      { loadAddon } as unknown as Terminal,
      "auto",
      () => addon,
    );

    expect(active).toBe("canvas");
    expect(loadAddon).toHaveBeenCalledWith(addon);
  });

  it("keeps the DOM renderer when CanvasAddon activation fails", () => {
    const addon = { activate: vi.fn(), dispose: vi.fn() } satisfies ITerminalAddon;
    const loadAddon = vi.fn(() => {
      throw new Error("canvas unavailable");
    });

    const active = activateTerminalRenderer(
      { loadAddon } as unknown as Terminal,
      "auto",
      () => addon,
    );

    expect(active).toBe("dom");
    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not construct CanvasAddon in explicit DOM mode", () => {
    const createCanvasAddon = vi.fn();
    const loadAddon = vi.fn();

    const active = activateTerminalRenderer(
      { loadAddon } as unknown as Terminal,
      "dom",
      createCanvasAddon,
    );

    expect(active).toBe("dom");
    expect(createCanvasAddon).not.toHaveBeenCalled();
    expect(loadAddon).not.toHaveBeenCalled();
  });
});

describe("createTerminalDisplayRepairScheduler", () => {
  it("waits for 180 ms of output idle without a periodic maximum repaint", () => {
    vi.useFakeTimers();
    const repair = vi.fn();
    const scheduler = createTerminalDisplayRepairScheduler(repair);

    try {
      for (let elapsed = 0; elapsed < 1_000; elapsed += 100) {
        scheduler.schedule();
        vi.advanceTimersByTime(100);
      }
      expect(repair).not.toHaveBeenCalled();

      vi.advanceTimersByTime(79);
      expect(repair).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(repair).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });
});
