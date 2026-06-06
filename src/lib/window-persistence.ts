import type { WindowState } from "@/types";

export function stripSessionWindowFields(window: WindowState): WindowState {
  if (window.type === "terminal") {
    return (({ ptyId: _, ...rest }) => rest)(window);
  }
  if (window.type === "code") {
    return (({ targetLine: _, targetColumn: __, targetNonce: ___, ...rest }) => rest)(window);
  }
  return window;
}
