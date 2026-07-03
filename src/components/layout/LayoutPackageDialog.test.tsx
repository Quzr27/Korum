import { act } from "react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import * as tauriCore from "@tauri-apps/api/core";
import * as dialogPlugin from "@tauri-apps/plugin-dialog";
import LayoutPackageDialog from "./LayoutPackageDialog";
import { createLayoutPackage, type LayoutPackage } from "@/lib/layout-package";
import type { ViewportState } from "@/lib/persistence";
import type { WindowState, Workspace } from "@/types";

const tauriCoreMock = tauriCore as typeof tauriCore & {
  __clearInvokeResults: () => void;
  __getInvokeCalls: () => Array<{ command: string; args?: Record<string, unknown> }>;
  __setInvokeResult: (command: string, result: unknown) => void;
};

const dialogPluginMock = dialogPlugin as typeof dialogPlugin & {
  __clearDialogMocks: () => void;
  __setOpenResults: (results: Array<string | null>) => void;
  __setSaveResult: (result: string | null) => void;
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const workspace: Workspace = {
  id: "ws-1",
  name: "Release Desk",
  color: "blue",
  icon: "rocket",
  rootPath: "/projects/korum",
};

const viewport: ViewportState = { panX: -20, panY: 10, zoom: 1 };

const windows: WindowState[] = [
  {
    id: "term-1",
    type: "terminal",
    title: "Agent",
    workspaceId: "ws-1",
    x: 280,
    y: 40,
    width: 820,
    height: 600,
    zIndex: 1,
    initialCwd: "/projects/korum",
  },
];

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  return button as HTMLButtonElement;
}

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderLayoutPackageDialog(props?: Partial<ComponentProps<typeof LayoutPackageDialog>>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const onOpenChange = props?.onOpenChange ?? vi.fn();
  const onBuildPackage = props?.onBuildPackage ?? vi.fn(() => createLayoutPackage({
    workspace,
    windows,
    viewport,
    pathMode: "keep",
    exportedAt: "2026-07-03T10:00:00.000Z",
  }));
  const onImportLayout = props?.onImportLayout ?? vi.fn();

  await act(async () => {
    root.render(
      <LayoutPackageDialog
        open
        onOpenChange={onOpenChange}
        initialScope="workspace"
        workspaceName="Release Desk"
        workspaceCount={1}
        windowCount={windows.length}
        workspaceWindowCount={windows.length}
        canExportKorum
        canExportWorkspace
        onBuildPackage={onBuildPackage}
        onImportLayout={onImportLayout}
        {...props}
      />,
    );
  });
  await flushReactWork();

  return { onBuildPackage, onImportLayout, onOpenChange };
}

beforeEach(() => {
  tauriCoreMock.__clearInvokeResults();
  dialogPluginMock.__clearDialogMocks();
});

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
  tauriCoreMock.__clearInvokeResults();
  dialogPluginMock.__clearDialogMocks();
  vi.restoreAllMocks();
});

describe("LayoutPackageDialog", () => {
  it("exports the selected workspace layout through the native save command", async () => {
    dialogPluginMock.__setSaveResult("/tmp/release.korum-layout.json");
    tauriCoreMock.__setInvokeResult("save_layout_package", undefined);
    const { onBuildPackage } = await renderLayoutPackageDialog();

    await act(async () => {
      findButton("Export Layout").click();
    });
    await flushReactWork();

    expect(document.body.textContent).not.toContain("Paths");
    expect(onBuildPackage).toHaveBeenCalledWith("workspace");
    expect(tauriCoreMock.__getInvokeCalls()).toEqual([
      {
        command: "save_layout_package",
        args: {
          path: "/tmp/release.korum-layout.json",
          text: expect.stringContaining('"schema": "dev.quzr.korum.layout"'),
        },
      },
    ]);
    expect(document.body.textContent).toContain("Exported");
  });

  it("disables export when no workspace layout is available", async () => {
    await renderLayoutPackageDialog({ canExportWorkspace: false });

    expect(findButton("Export Layout").disabled).toBe(true);
  });

  it("lets users choose whole Korum before exporting", async () => {
    dialogPluginMock.__setSaveResult("/tmp/korum.korum-layout.json");
    tauriCoreMock.__setInvokeResult("save_layout_package", undefined);
    const { onBuildPackage } = await renderLayoutPackageDialog({
      initialScope: "korum",
      workspaceCount: 2,
      windowCount: 5,
      workspaceWindowCount: 1,
    });

    expect(document.body.textContent).toContain("Whole Korum");
    expect(document.body.textContent).toContain("Selected Workspace");

    await act(async () => {
      findButton("Export Layout").click();
    });
    await flushReactWork();

    expect(onBuildPackage).toHaveBeenCalledWith("korum");
  });

  it("switches from whole Korum to the selected workspace scope", async () => {
    dialogPluginMock.__setSaveResult("/tmp/release.korum-layout.json");
    tauriCoreMock.__setInvokeResult("save_layout_package", undefined);
    const { onBuildPackage } = await renderLayoutPackageDialog({
      initialScope: "korum",
      workspaceCount: 2,
      windowCount: 5,
      workspaceWindowCount: 1,
    });

    await act(async () => {
      findButton("Selected Workspace").click();
    });
    await act(async () => {
      findButton("Export Layout").click();
    });
    await flushReactWork();

    expect(onBuildPackage).toHaveBeenCalledWith("workspace");
  });

  it("imports layouts from one native open flow and closes the dialog", async () => {
    const pkg: LayoutPackage = createLayoutPackage({
      workspace,
      windows,
      viewport,
      pathMode: "relative",
      exportedAt: "2026-07-03T10:00:00.000Z",
    });
    dialogPluginMock.__setOpenResults(["/tmp/release.korum-layout.json"]);
    tauriCoreMock.__setInvokeResult("load_layout_package", JSON.stringify(pkg));
    const { onImportLayout, onOpenChange } = await renderLayoutPackageDialog();

    await act(async () => {
      findButton("Import Layout").click();
    });
    await flushReactWork();

    expect(tauriCoreMock.__getInvokeCalls()).toEqual([
      {
        command: "load_layout_package",
        args: { path: "/tmp/release.korum-layout.json" },
      },
    ]);
    expect(onImportLayout).toHaveBeenCalledWith(pkg);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.body.textContent).toContain("Imported");
  });
});
