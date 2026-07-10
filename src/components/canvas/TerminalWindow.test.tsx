import { act, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import TerminalWindow from "./TerminalWindow";
import type { TerminalWindow as TerminalWindowState } from "@/types";
import {
  __clearInvokeResults,
  __getInvokeCalls,
  __setInvokeResult,
} from "@/__mocks__/tauri-api-core";

vi.mock("@/lib/settings-context", () => ({
  useSettings: () => ({
    settings: {
      terminalFont: "IBM Plex Mono",
      terminalFontSize: 14,
      terminalTheme: "tomorrow-night",
      terminalRenderer: "auto",
      terminalScrollSpeed: 2,
    },
  }),
}));

vi.mock("@/lib/xterm-session", () => ({
  useXtermSession: () => ({
    termInstanceRef: { current: null },
    fitAddonRef: { current: null },
    isSessionReady: false,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const terminal: TerminalWindowState = {
  id: "term-1",
  type: "terminal",
  title: "Agent",
  workspaceId: "ws-1",
  x: 0,
  y: 0,
  width: 560,
  height: 348,
  zIndex: 1,
};

function makeProps(isStopped: boolean) {
  return {
    id: terminal.id,
    window: terminal,
    isActive: true,
    shouldHydrate: true,
    shouldAttach: true,
    isStopped,
    zoomRef: { current: 1 },
    snapTargetsRef: { current: [] },
    snapGuideLayerRef: createRef<HTMLDivElement>(),
    onClose: vi.fn(),
    onHydrationSettled: vi.fn(),
    onPtySpawned: vi.fn(),
    onSnapshotCaptured: vi.fn(),
    onUpdate: vi.fn(),
    onFocus: vi.fn(),
    onRename: vi.fn(),
    onPasteRequest: vi.fn(),
    onOpenFileLink: vi.fn(),
    onActivateDemoTerminal: vi.fn(),
    onRestart: vi.fn(),
  };
}

async function renderTerminal(isStopped: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  const props = makeProps(isStopped);
  await act(async () => {
    root.render(<TerminalWindow {...props} />);
  });
  return { root, props };
}

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
  }
  document.body.replaceChildren();
  __clearInvokeResults();
  vi.restoreAllMocks();
});

describe("TerminalWindow stopped lifecycle", () => {
  it("keeps the stopped overlay and spawns a fresh PTY after Restart clears the state", async () => {
    __setInvokeResult("create_terminal", { id: "pty-new" });
    const { root, props } = await renderTerminal(true);

    expect(document.body.textContent).toContain("Session stopped");
    expect(__getInvokeCalls().some((call) => call.command === "create_terminal")).toBe(false);

    const restart = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Restart");
    if (!restart) throw new Error("Restart button not found");
    await act(async () => restart.click());
    expect(props.onRestart).toHaveBeenCalledWith(terminal.id);

    await act(async () => {
      root.render(<TerminalWindow {...props} isStopped={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(__getInvokeCalls().some((call) => call.command === "create_terminal")).toBe(true);
    expect(props.onPtySpawned).toHaveBeenCalledWith(terminal.id, "pty-new");
  });

  it("kills a create_terminal result that resolves after the window becomes stopped", async () => {
    let resolveCreate: ((value: { id: string }) => void) | undefined;
    __setInvokeResult("create_terminal", new Promise<{ id: string }>((resolve) => {
      resolveCreate = resolve;
    }));
    __setInvokeResult("kill_terminal", undefined);
    const { root, props } = await renderTerminal(false);

    await act(async () => {
      root.render(<TerminalWindow {...props} isStopped />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveCreate?.({ id: "pty-late" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(__getInvokeCalls()).toContainEqual({
      command: "kill_terminal",
      args: { id: "pty-late" },
    });
    expect(props.onPtySpawned).not.toHaveBeenCalledWith(terminal.id, "pty-late");
  });
});
