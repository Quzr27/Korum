/**
 * Check whether a canvas window is within (or near) the visible viewport.
 *
 * Transforms world-space window coordinates to screen-space using the current
 * pan/zoom, then tests overlap against the viewport rectangle expanded by
 * `buffer` pixels on each side. The buffer zone prevents flicker during slow
 * pan — terminals just outside the viewport are pre-created before they scroll
 * into view.
 */
export function isWindowInViewport(
  win: { x: number; y: number; width: number; height: number },
  pan: { x: number; y: number },
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  buffer = 200,
): boolean {
  const screenX = win.x * zoom + pan.x;
  const screenY = win.y * zoom + pan.y;
  const screenW = win.width * zoom;
  const screenH = win.height * zoom;

  return !(
    screenX + screenW < -buffer ||
    screenX > viewportWidth + buffer ||
    screenY + screenH < -buffer ||
    screenY > viewportHeight + buffer
  );
}
