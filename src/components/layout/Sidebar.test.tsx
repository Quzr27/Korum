import { act } from "react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import Sidebar from "./Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Workspace } from "@/types";
import {
  __clearInvokeResults,
  __getInvokeCalls,
  __setInvokeResult,
} from "@/__mocks__/tauri-api-core";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const workspace: Workspace = {
  id: "ws-1",
  name: "Cockpit",
  color: "default",
  icon: "code",
};

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function findButtonByText(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

async function openWorkspaceContextMenu() {
  const workspaceButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes(workspace.name));
  if (!workspaceButton) throw new Error("Workspace button not found");

  await act(async () => {
    workspaceButton.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    }));
    await Promise.resolve();
  });
}

function findMenuItem(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!item) throw new Error(`Menu item not found: ${label}`);
  return item;
}

async function renderSidebar(props?: Partial<ComponentProps<typeof Sidebar>>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const onOpenLayoutPackage = props?.onOpenLayoutPackage ?? vi.fn();
  const onArrangeWindows = props?.onArrangeWindows ?? vi.fn();

  await act(async () => {
    root.render(
      <TooltipProvider>
        <Sidebar
          windows={[]}
          workspaces={[workspace]}
          activeWorkspaceId={workspace.id}
          activeWindowId={null}
          runningTerminalIds={new Set()}
          stoppedTerminalIds={new Set()}
          onCreateDialogChange={vi.fn()}
          onModalOpenChange={vi.fn()}
          onFocusWindow={vi.fn()}
          onAddWindowToWorkspace={vi.fn()}
          onOpenSnapshotExport={vi.fn()}
          onOpenLayoutPackage={onOpenLayoutPackage}
          onSelectWorkspace={vi.fn()}
          onUpdateWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onArrangeWindows={onArrangeWindows}
          onRenameWindow={vi.fn()}
          onRemoveWindow={vi.fn()}
          onOpenFile={vi.fn()}
          onStopWorkspaceTerminals={vi.fn()}
          onRestartWorkspaceTerminals={vi.fn()}
          {...props}
        />
      </TooltipProvider>,
    );
  });

  return { onArrangeWindows, onOpenLayoutPackage };
}

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    await act(async () => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  document.body.replaceChildren();
  window.localStorage.clear();
  __clearInvokeResults();
  vi.restoreAllMocks();
});

describe("Sidebar", () => {
  it("exposes layout import/export from the footer instead of the duplicate grid arrangement", async () => {
    const { onArrangeWindows, onOpenLayoutPackage } = await renderSidebar();

    expect(document.querySelector("button[aria-label='Arrange windows in grid']")).toBeNull();

    await act(async () => {
      findButtonByLabel("Import / Export Layout").click();
    });

    expect(onOpenLayoutPackage).toHaveBeenCalledTimes(1);
    expect(onOpenLayoutPackage).toHaveBeenCalledWith();
    expect(onArrangeWindows).not.toHaveBeenCalled();
  });

  it("unmounts the file tree and releases its watcher when the drawer closes", async () => {
    window.localStorage.setItem("korum-sidebar-ui", JSON.stringify({
      fileDrawerOpenByWorkspaceId: { [workspace.id]: true },
      fileQueryByWorkspaceId: {},
      showIgnoredByWorkspaceId: {},
    }));
    __setInvokeResult("read_directory", []);
    __setInvokeResult("get_git_status", {
      repo_root: null,
      statuses: [],
      changed_count: 0,
      insertions: 0,
      deletions: 0,
    });
    __setInvokeResult("start_watching", undefined);
    __setInvokeResult("stop_watching", undefined);

    await renderSidebar({
      workspaces: [{ ...workspace, rootPath: "/tmp/korum-workspace" }],
    });

    expect(document.querySelector(".sidebar-file-drawer")).not.toBeNull();
    await act(async () => {
      findButtonByLabel("Close workspace drawer").click();
      await Promise.resolve();
    });

    expect(document.querySelector(".sidebar-file-drawer")).toBeNull();
    expect(__getInvokeCalls().some((call) => call.command === "stop_watching")).toBe(true);
  });

  it("stops a watcher whose async start finishes after the drawer unmounts", async () => {
    window.localStorage.setItem("korum-sidebar-ui", JSON.stringify({
      fileDrawerOpenByWorkspaceId: { [workspace.id]: true },
      fileQueryByWorkspaceId: {},
      showIgnoredByWorkspaceId: {},
    }));
    let resolveStart: (() => void) | undefined;
    __setInvokeResult("read_directory", []);
    __setInvokeResult("get_git_status", {
      repo_root: null,
      statuses: [],
      changed_count: 0,
      insertions: 0,
      deletions: 0,
    });
    __setInvokeResult("start_watching", new Promise<void>((resolve) => { resolveStart = resolve; }));
    __setInvokeResult("stop_watching", undefined);

    await renderSidebar({
      workspaces: [{ ...workspace, rootPath: "/tmp/korum-workspace" }],
    });
    await act(async () => {
      findButtonByLabel("Close workspace drawer").click();
      await Promise.resolve();
    });

    expect(__getInvokeCalls().filter((call) => call.command === "stop_watching")).toHaveLength(0);

    await act(async () => {
      resolveStart?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(__getInvokeCalls().filter((call) => call.command === "stop_watching")).toHaveLength(1);
  });

  it("confirms stopping running workspace terminals without removing windows", async () => {
    const onStopWorkspaceTerminals = vi.fn();
    await renderSidebar({
      windows: [{ id: "term-1", type: "terminal", title: "Agent", workspaceId: workspace.id }],
      runningTerminalIds: new Set(["term-1"]),
      onStopWorkspaceTerminals,
    });

    await openWorkspaceContextMenu();
    await act(async () => {
      findMenuItem("Stop Terminal Sessions").click();
      await Promise.resolve();
    });

    expect(onStopWorkspaceTerminals).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Running commands and agents will be terminated");

    await act(async () => {
      findButtonByText("Stop Sessions").click();
      await Promise.resolve();
    });

    expect(onStopWorkspaceTerminals).toHaveBeenCalledWith(workspace.id);
    expect(document.body.textContent).toContain("Agent");
  });

  it("restarts stopped workspace terminals from the context menu", async () => {
    const onRestartWorkspaceTerminals = vi.fn();
    await renderSidebar({
      windows: [{ id: "term-1", type: "terminal", title: "Agent", workspaceId: workspace.id }],
      stoppedTerminalIds: new Set(["term-1"]),
      onRestartWorkspaceTerminals,
    });

    await openWorkspaceContextMenu();
    await act(async () => {
      findMenuItem("Restart Stopped Sessions").click();
      await Promise.resolve();
    });

    expect(onRestartWorkspaceTerminals).toHaveBeenCalledWith(workspace.id);
  });
});
