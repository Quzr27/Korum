---
paths:
  - "src/components/canvas/Canvas.tsx"
  - "src/components/canvas/EmptyCanvasState.tsx"
  - "src/lib/viewport.ts"
  - "src/lib/window-snapping.ts"
  - "src/lib/use-drag-resize.ts"
  - "src/lib/live-terminals.ts"
  - "src/styles/canvas.css"
  - "src/styles/empty-state.css"
  - "src/styles/window.css"
  - "src/App.tsx"
  - "src/lib/agent-status.ts"
  - "src/lib/agent-status.test.ts"
---

# Canvas Engine

- Canvas uses CSS transform on the world: `translate(panX, panY) scale(zoom)`.
- Ctrl-scroll zooms to cursor; plain scroll panning is disabled so terminal scrollback keeps working.
- Pan and zoom are ref-driven and applied directly to DOM during interaction; avoid React state churn while moving.
- Middle-drag panning uses document listeners so pan does not get stuck when the pointer leaves the viewport.
- Dot grid and atmosphere follow pan/zoom through CSS variables and background positioning.
- `.panning` and `.zooming` suppress expensive atmosphere blur while the user is interacting.
- `isWindowInViewport()` handles world-to-screen AABB checks; all window types participate in viewport culling.
- Active window stays mounted even when off-screen, which protects in-flight edits and focused behavior.
- `useDragResize` performs transform-based drag and direct style mutation for resize, then commits once on mouseup.
- Magnetic snapping uses `snapDraggedWindow()` with a zoom-stable screen threshold and 24px arrange-grid gap.
- Alignment guides are imperative DOM nodes in `.canvas-snap-guides`; do not drive guide lines with React state during mousemove.
- Terminal-to-diff tethers live in the imperative SVG `.canvas-tethers` layer inside `.canvas-world`; do not recompute endpoints on every pan/zoom event because the parent transform moves them. Update line attributes from refs/live rects during drag or resize, rebuild the precomputed tether render index when visible windows change, and keep visual motion CSS-only with reduced-motion support.
- During active `.panning` or `.zooming`, suppress tether animation/filter cost; restore the animated theme-colored arrow when motion ends.
- War-room mode is frontend-only session UI state owned by `App.tsx`; do not persist it, alter saved viewports, or write settings while entering/exiting it.
- War-room may visually override canvas atmosphere through inherited CSS variables on the root `.war-room` class; remove the class to restore the user's exact configured atmosphere.
- War-room agent window emphasis must use existing `AgentStatus` DOM projection (`data-agent-activity` and pulse classes), CSS border/halo animation, and semantic status tokens. Do not drive pulsing with timers, requestAnimationFrame, or per-frame React state.
- During active `.panning` or `.zooming`, suppress war-room pulse animation just like atmosphere/tether effects so drag, pan, and zoom stay responsive.
- Waiting attention should be strongest only briefly, then settle into a steady glow; avoid permanent high-intensity pulsing across many windows.
- The `waiting` settle is a one-shot `forwards` CSS animation, and the agent DOM projection re-runs on every pan/zoom/window change. So in `applyAgentStatusesToDom` mutate the pulse class only when it actually changes (remove the *other* classes, add the desired one if absent) — a blanket `classList.remove(...all)` + `add(current)` re-adds the class every projection and restarts the settle, so it never settles while the user navigates.
- Arrange grid should preserve window array order to avoid unnecessary unmount/remount of terminal sessions.
- The minimap is a canvas-owned floating utility and must not be nested where canvas isolation breaks fixed placement.
- In war-room mode the minimap remains visible as the fleet radar even while sidebar, status rail, and zoom/settings chrome are hidden.
