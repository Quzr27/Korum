import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent as ReactMouseEvent } from "react";

const INTERACTIVE_SELECTOR = "button, input, a, [role='button']";

/**
 * Start an OS window drag from a left-button mousedown on a titlebar / drag region.
 * With `guardInteractive`, mousedowns that land on buttons/inputs/links are ignored
 * so controls inside the drag area stay clickable.
 */
export function startWindowDragFromMouseDown(
  event: ReactMouseEvent<HTMLElement>,
  options?: { guardInteractive?: boolean },
): void {
  if (event.button !== 0) return;
  if (options?.guardInteractive && (event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) {
    return;
  }
  event.preventDefault();
  void getCurrentWindow().startDragging().catch((error: unknown) => {
    console.warn("Failed to start window drag", error);
  });
}
