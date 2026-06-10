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
 *
 * Rect caching: getBoundingClientRect() is O(layout) and is called in a
 * capture-phase mousemove, which fires for every pixel of cursor movement for
 * every attached terminal. We cache the rect with a 100ms TTL. The cache is
 * invalidated explicitly via invalidateContainerRect() whenever the container's
 * position can change (terminal window drag commit, canvas pan/zoom commit,
 * container resize/fit). During another window's drag the cached rect of *this*
 * terminal's container is still valid because dragging a different window does
 * not move this container.
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

const RECT_TTL_MS = 100;

interface CachedRect {
  rect: DOMRect;
  at: number;
}

const rectCache = new WeakMap<HTMLElement, CachedRect>();

/**
 * Explicitly invalidate the cached rect for a container (call after drag/zoom
 * commit or resize/fit so the next mousemove re-measures the real position).
 */
export function invalidateContainerRect(container: HTMLElement): void {
  rectCache.delete(container);
}

function getCachedRect(container: HTMLElement): DOMRect {
  const now = performance.now();
  const cached = rectCache.get(container);
  if (cached && now - cached.at < RECT_TTL_MS) return cached.rect;
  const rect = container.getBoundingClientRect();
  rectCache.set(container, { rect, at: now });
  return rect;
}

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

  const rect = getCachedRect(container);
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
