/**
 * xterm.js CSS-scale mouse coordinate compensation.
 *
 * The canvas world uses `transform: scale(zoom)`. xterm calculates mouse
 * position as `(clientX - rect.left) / css.cell.width`, but
 * `getBoundingClientRect()` returns **scaled** dimensions while
 * `css.cell.width` is **unscaled** (from font metrics). At zoom != 1 this
 * maps clicks to the wrong row/col.
 *
 * Fix: adjust `clientX`/`clientY` in capture phase so xterm sees offsets
 * that match its unscaled cell metrics.
 */

/** One-time check: can we override MouseEvent.clientX via defineProperty? */
export let CAN_OVERRIDE_CLIENT_COORDS: boolean = (() => {
  try {
    const e = new MouseEvent("click", { clientX: 100 });
    Object.defineProperty(e, "clientX", { value: 999, configurable: true });
    return e.clientX === 999;
  } catch {
    return false;
  }
})();

let warnedOnce = false;

/**
 * Adjust a MouseEvent's clientX/Y to compensate for CSS `transform: scale(zoom)`
 * on a parent container. No-op when zoom === 1 or when the engine doesn't
 * support overriding MouseEvent properties.
 */
export function adjustMouseForZoom(
  e: MouseEvent,
  container: HTMLElement,
  zoom: number,
): void {
  if (zoom === 1) return;

  if (!CAN_OVERRIDE_CLIENT_COORDS) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[xterm-mouse-compat] Cannot override MouseEvent.clientX/Y — " +
          "click coordinates may be wrong at non-1x zoom.",
      );
    }
    return;
  }

  const rect = container.getBoundingClientRect();
  try {
    Object.defineProperty(e, "clientX", {
      value: rect.left + (e.clientX - rect.left) / zoom,
      configurable: true,
    });
    Object.defineProperty(e, "clientY", {
      value: rect.top + (e.clientY - rect.top) / zoom,
      configurable: true,
    });
  } catch {
    // Real dispatched events may have stricter property descriptors than synthetic ones.
    // Disable compensation for all future events rather than throwing per-event.
    CAN_OVERRIDE_CLIENT_COORDS = false;
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[xterm-mouse-compat] Cannot override MouseEvent.clientX/Y — " +
          "click coordinates may be wrong at non-1x zoom.",
      );
    }
  }
}
