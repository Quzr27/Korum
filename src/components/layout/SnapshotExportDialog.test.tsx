import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import * as tauriCore from "@tauri-apps/api/core";
import * as dialogPlugin from "@tauri-apps/plugin-dialog";
import SnapshotExportDialog from "./SnapshotExportDialog";

const tauriCoreMock = tauriCore as typeof tauriCore & {
  __clearInvokeResults: () => void;
  __getInvokeCalls: () => Array<{ command: string; args?: Record<string, unknown> }>;
  __setInvokeResult: (command: string, result: unknown) => void;
};

const dialogPluginMock = dialogPlugin as typeof dialogPlugin & {
  __clearDialogMocks: () => void;
  __setSaveResult: (result: string | null) => void;
};

const htmlToImageMock = vi.hoisted(() => ({
  toCanvas: vi.fn(),
}));

vi.mock("html-to-image", () => ({
  toCanvas: htmlToImageMock.toCanvas,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const captureClassNames: string[] = [];
const captureNodes: HTMLElement[] = [];
const captureOptions: Array<{
  width?: number;
  height?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  style?: Partial<CSSStyleDeclaration>;
}> = [];

function mockCanvas(dataUrl = "data:image/png;base64,AAAA"): HTMLCanvasElement {
  return {
    toDataURL: () => dataUrl,
  } as HTMLCanvasElement;
}

function recordCapture(
  node: HTMLElement,
  options?: (typeof captureOptions)[number],
  dataUrl = "data:image/png;base64,AAAA",
): HTMLCanvasElement {
  captureNodes.push(node);
  captureOptions.push(options ?? {});
  captureClassNames.push(node.className);
  return mockCanvas(dataUrl);
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  return button as HTMLButtonElement;
}

function findSwitch(label: string): HTMLButtonElement {
  const control = document.querySelector<HTMLButtonElement>(`[role='switch'][aria-label='${label}']`);
  if (!control) throw new Error(`Switch not found: ${label}`);
  return control;
}

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceTimers(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await flushReactWork();
}

function mockRect(element: HTMLElement, rect: Partial<DOMRectReadOnly>) {
  const nextRect = {
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    left: rect.left ?? rect.x ?? 0,
    top: rect.top ?? rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    right: rect.right ?? (rect.left ?? rect.x ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + (rect.height ?? 0),
    toJSON: () => undefined,
  } as DOMRectReadOnly;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(nextRect);
}

beforeEach(() => {
  vi.useFakeTimers();
  tauriCoreMock.__clearInvokeResults();
  dialogPluginMock.__clearDialogMocks();
  htmlToImageMock.toCanvas.mockClear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  htmlToImageMock.toCanvas.mockImplementation(async (node: HTMLElement, options?: (typeof captureOptions)[number]) => {
    return recordCapture(node, options);
  });
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
  captureClassNames.length = 0;
  captureNodes.length = 0;
  captureOptions.length = 0;
  tauriCoreMock.__clearInvokeResults();
  dialogPluginMock.__clearDialogMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderSnapshotDialogController(captureElement: HTMLElement, workspaceName = "quzr-main-page") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  let openState = true;
  let workspaceNameState = workspaceName;
  const onOpenChange = vi.fn((nextOpen: boolean) => {
    openState = nextOpen;
  });

  const render = async (updates?: { open?: boolean; workspaceName?: string }) => {
    openState = updates?.open ?? openState;
    workspaceNameState = updates?.workspaceName ?? workspaceNameState;
    await act(async () => {
      root.render(
        <SnapshotExportDialog
          open={openState}
          onOpenChange={onOpenChange}
          workspaceName={workspaceNameState}
          getCaptureElement={() => captureElement}
        />,
      );
    });
    await flushReactWork();
  };

  await render();

  return { onOpenChange, render };
}

async function renderSnapshotDialog(captureElement: HTMLElement, workspaceName = "quzr-main-page") {
  await renderSnapshotDialogController(captureElement, workspaceName);
}

describe("SnapshotExportDialog", () => {
  it("keeps option changes fast and refreshes the preview after debounce", async () => {
    const captureElement = document.createElement("div");
    captureElement.className = "korum-app-shell";
    document.body.appendChild(captureElement);

    await renderSnapshotDialog(captureElement);
    await advanceTimers(100);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(1);
    expect(captureClassNames[0]).toContain("snapshot-capture-mode");
    expect(captureClassNames[0]).not.toContain("snapshot-hide-minimap");
    expect(captureClassNames[0]).not.toContain("snapshot-hide-sidebar");

    await act(async () => {
      findButton("Options").click();
    });
    await flushReactWork();

    expect(document.querySelectorAll("[role='switch']")).toHaveLength(3);
    expect(findSwitch("Show minimap").parentElement?.className).not.toContain("border");
    expect(findSwitch("Show minimap").getAttribute("aria-checked")).toBe("true");
    expect(findSwitch("Show minimap").getAttribute("data-slot")).toBe("switch");
    expect(findSwitch("Hide sidebar").className).not.toContain("text-muted-foreground");

    await act(async () => {
      findSwitch("Show minimap").click();
    });
    await flushReactWork();

    expect(findSwitch("Show minimap").getAttribute("aria-checked")).toBe("false");
    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Options changed - refresh or export");

    await advanceTimers(300);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(1);

    await advanceTimers(250);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(2);
    expect(captureClassNames[1]).toContain("snapshot-hide-minimap");
  });

  it("keeps sidebar visible by default and crops it out when hidden", async () => {
    const captureElement = document.createElement("div");
    captureElement.className = "korum-app-shell";
    mockRect(captureElement, { left: 0, top: 0, width: 1600, height: 900 });
    const sidebarRoot = document.createElement("div");
    sidebarRoot.dataset.snapshotSidebar = "true";
    const sidebarPanel = document.createElement("aside");
    mockRect(sidebarRoot, { left: 0, top: 0, width: 0, height: 0 });
    mockRect(sidebarPanel, { left: 0, top: 0, width: 288, height: 900 });
    sidebarRoot.appendChild(sidebarPanel);
    captureElement.appendChild(sidebarRoot);
    document.body.appendChild(captureElement);

    await renderSnapshotDialog(captureElement);
    await advanceTimers(100);

    expect(captureClassNames[0]).not.toContain("snapshot-hide-sidebar");
    expect(captureNodes[0]).toBe(captureElement);
    expect(captureOptions[0].width).toBeUndefined();

    await act(async () => {
      findButton("Options").click();
    });
    await flushReactWork();

    expect(findSwitch("Hide sidebar").getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      findSwitch("Hide sidebar").click();
    });
    await flushReactWork();

    expect(findSwitch("Hide sidebar").getAttribute("aria-checked")).toBe("true");

    await advanceTimers(300);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(1);

    await advanceTimers(250);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(2);
    expect(captureClassNames[1]).toContain("snapshot-hide-sidebar");
    expect(captureNodes[1]).toBe(captureElement);
    expect(captureOptions[1]).toMatchObject({
      width: 1312,
      height: 900,
      canvasWidth: 1312,
      canvasHeight: 900,
      style: {
        transform: "translateX(-288px)",
        transformOrigin: "top left",
        width: "1600px",
        height: "900px",
      },
    });
  });

  it("does not crop into windows when hiding the sidebar", async () => {
    const captureElement = document.createElement("div");
    captureElement.className = "korum-app-shell";
    mockRect(captureElement, { left: 0, top: 0, width: 1600, height: 900 });
    const sidebarRoot = document.createElement("div");
    sidebarRoot.dataset.snapshotSidebar = "true";
    const sidebarPanel = document.createElement("aside");
    mockRect(sidebarRoot, { left: 0, top: 0, width: 0, height: 0 });
    mockRect(sidebarPanel, { left: 0, top: 0, width: 288, height: 900 });
    sidebarRoot.appendChild(sidebarPanel);
    const terminalWindow = document.createElement("section");
    terminalWindow.className = "window";
    mockRect(terminalWindow, { left: 260, top: 48, width: 780, height: 520 });
    captureElement.append(sidebarRoot, terminalWindow);
    document.body.appendChild(captureElement);

    await renderSnapshotDialog(captureElement);
    await advanceTimers(100);

    await act(async () => {
      findButton("Options").click();
    });
    await flushReactWork();

    await act(async () => {
      findSwitch("Hide sidebar").click();
    });
    await flushReactWork();

    await advanceTimers(300);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(1);

    await advanceTimers(250);

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(2);
    expect(captureClassNames[1]).toContain("snapshot-hide-sidebar");
    expect(captureOptions[1]).toMatchObject({
      width: 1364,
      canvasWidth: 1364,
      style: {
        transform: "translateX(-236px)",
      },
    });
  });

  it("resets stale preview and saved path when reopened", async () => {
    const captureElement = document.createElement("div");
    captureElement.className = "korum-app-shell";
    document.body.appendChild(captureElement);

    const controller = await renderSnapshotDialogController(captureElement, "first-workspace");
    await advanceTimers(100);

    expect(document.querySelector("img[alt='Snapshot preview']")).not.toBeNull();
    dialogPluginMock.__setSaveResult("/tmp/korum-first.png");
    tauriCoreMock.__setInvokeResult("save_snapshot_png", undefined);

    await act(async () => {
      findButton("Save PNG").click();
    });
    await flushReactWork();

    expect(findButton("Reveal").disabled).toBe(false);

    await controller.render({ open: false });
    await controller.render({ open: true, workspaceName: "second-workspace" });

    expect(document.querySelector("img[alt='Snapshot preview']")).toBeNull();
    expect(findButton("Save PNG").disabled).toBe(true);
    expect(findButton("Reveal").disabled).toBe(true);
  });

  it("recaptures the latest options when they change during save", async () => {
    const captureElement = document.createElement("div");
    captureElement.className = "korum-app-shell";
    document.body.appendChild(captureElement);

    await renderSnapshotDialog(captureElement);
    await advanceTimers(100);

    await act(async () => {
      findButton("Options").click();
    });
    await flushReactWork();

    await act(async () => {
      findSwitch("Show minimap").click();
    });
    await flushReactWork();

    let resolvePendingCapture: (() => void) | null = null;
    htmlToImageMock.toCanvas
      .mockImplementationOnce((node: HTMLElement, options?: (typeof captureOptions)[number]) => {
        captureNodes.push(node);
        captureOptions.push(options ?? {});
        captureClassNames.push(node.className);
        return new Promise<HTMLCanvasElement>((resolve) => {
          resolvePendingCapture = () => resolve(mockCanvas("data:image/png;base64,AQID"));
        });
      })
      .mockImplementationOnce(async (node: HTMLElement, options?: (typeof captureOptions)[number]) => (
        recordCapture(node, options, "data:image/png;base64,BAUG")
      ));
    dialogPluginMock.__setSaveResult("/tmp/korum-race.png");
    tauriCoreMock.__setInvokeResult("save_snapshot_png", undefined);

    await act(async () => {
      findButton("Save PNG").click();
    });
    await flushReactWork();

    expect(htmlToImageMock.toCanvas).toHaveBeenCalledTimes(2);

    await act(async () => {
      findSwitch("Show usage card").click();
    });
    await flushReactWork();

    await act(async () => {
      resolvePendingCapture?.();
      await Promise.resolve();
    });
    await flushReactWork();

    const saveCalls = tauriCoreMock.__getInvokeCalls().filter((call) => call.command === "save_snapshot_png");
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.args).toMatchObject({
      path: "/tmp/korum-race.png",
      bytes: [4, 5, 6],
    });
    expect(captureClassNames[2]).toContain("snapshot-hide-minimap");
    expect(captureClassNames[2]).toContain("snapshot-hide-usage-card");
  });

  it("does not render title controls or capture title metadata", async () => {
    const captureElement = document.createElement("div");
    captureElement.className = "korum-app-shell";
    document.body.appendChild(captureElement);

    await renderSnapshotDialog(captureElement, "workspace-with-a-deliberately-long-human-readable-name");
    await advanceTimers(100);

    await act(async () => {
      findButton("Options").click();
    });
    await flushReactWork();

    expect(document.querySelector("#snapshot-title")).toBeNull();
    expect(document.body.textContent).not.toContain("Title");
    expect(document.body.textContent).not.toContain("Show title");
    expect(captureElement.dataset.snapshotTitle).toBeUndefined();
    expect(captureClassNames[0]).not.toContain("snapshot-show-title");
  });
});
