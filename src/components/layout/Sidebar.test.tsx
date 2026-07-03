import { act } from "react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import Sidebar from "./Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Workspace } from "@/types";

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
});
