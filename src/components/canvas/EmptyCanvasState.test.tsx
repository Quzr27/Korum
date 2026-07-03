import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import EmptyCanvasState from "./EmptyCanvasState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  return button as HTMLButtonElement;
}

async function renderEmptyCanvasState(props?: Partial<Parameters<typeof EmptyCanvasState>[0]>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const onCreateWorkspace = props?.onCreateWorkspace ?? vi.fn();
  const onCreateDemoWorkspace = props?.onCreateDemoWorkspace ?? vi.fn();
  const onImportLayout = props?.onImportLayout ?? vi.fn();

  await act(async () => {
    root.render(
      <EmptyCanvasState
        onCreateWorkspace={onCreateWorkspace}
        onCreateDemoWorkspace={onCreateDemoWorkspace}
        onImportLayout={onImportLayout}
        {...props}
      />,
    );
  });

  return { onCreateWorkspace, onCreateDemoWorkspace, onImportLayout };
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
  vi.restoreAllMocks();
});

describe("EmptyCanvasState", () => {
  it("offers layout import before any workspace exists", async () => {
    const { onImportLayout } = await renderEmptyCanvasState();

    await act(async () => {
      findButton("Import layout").click();
    });

    expect(onImportLayout).toHaveBeenCalledTimes(1);
  });
});
