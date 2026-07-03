import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function renderOpenContextMenu() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <ContextMenu>
        <ContextMenuTrigger data-testid="workspace-trigger">Workspace</ContextMenuTrigger>
        <ContextMenuContent forceMount>
          <ContextMenuItem variant="destructive">Delete Workspace</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
  });

  const trigger = document.querySelector<HTMLElement>("[data-testid='workspace-trigger']");
  if (!trigger) throw new Error("Context menu trigger not found");

  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    }));
    await Promise.resolve();
  });

  const content = document.querySelector<HTMLElement>("[data-slot='context-menu-content']");
  const item = document.querySelector<HTMLElement>("[data-slot='context-menu-item']");
  if (!content) throw new Error("Context menu content not found");
  if (!item) throw new Error("Context menu item not found");

  return { content, item };
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
});

describe("ContextMenuItem", () => {
  it("lets the destructive item variant own destructive styling", async () => {
    const { content, item } = await renderOpenContextMenu();

    expect(item.dataset.variant).toBe("destructive");
    expect(item.className).toContain("data-[variant=destructive]:text-destructive");
    expect(item.className).toContain("data-[variant=destructive]:focus:bg-destructive/10");
    expect(item.className).toContain("data-[variant=destructive]:data-[highlighted]:bg-destructive/10");
    expect(content.className).not.toContain("data-[variant=destructive]:text-accent-foreground");
    expect(content.className).not.toContain("data-[variant=destructive]:focus:bg-foreground/10");
  });

  it("does not override destructive item variants from submenu content", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        <ContextMenu>
          <ContextMenuTrigger data-testid="submenu-trigger">Workspace</ContextMenuTrigger>
          <ContextMenuContent forceMount>
            <ContextMenuSub>
              <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
              <ContextMenuSubContent forceMount>
                <ContextMenuItem variant="destructive">Delete Nested</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>,
      );
    });

    const trigger = document.querySelector<HTMLElement>("[data-testid='submenu-trigger']");
    if (!trigger) throw new Error("Context menu trigger not found");

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }));
      await Promise.resolve();
    });

    const subContent = document.querySelector<HTMLElement>("[data-slot='context-menu-sub-content']");
    if (!subContent) throw new Error("Context menu submenu content not found");

    expect(subContent.className).not.toContain("data-[variant=destructive]:text-accent-foreground");
    expect(subContent.className).not.toContain("data-[variant=destructive]:focus:bg-foreground/10");
  });
});
