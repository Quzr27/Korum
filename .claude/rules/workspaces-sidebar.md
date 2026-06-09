---
paths:
  - "src/components/layout/Sidebar.tsx"
  - "src/components/layout/FileTree.tsx"
  - "src/components/layout/ZoomSpeedControl.tsx"
  - "src/App.tsx"
  - "src/types/index.ts"
  - "src/styles/app.css"
---

# Workspaces & Sidebar

- Workspaces have `id`, `name`, `color`, `icon`, and optional `rootPath`; the `default` workspace color uses the semantic `--foreground` token rather than a hardcoded white.
- Folder-first workspace creation uses the native dialog plugin; project folder basename becomes the default workspace name.
- New terminals use workspace `rootPath` as initial cwd when present.
- Sidebar owns workspace tree UI, workspace edit/delete dialogs, file drawer state, filtering, and window list navigation.
- Keep the filter input and workspace list aligned on the x-axis (`px-3` for both chrome areas); active workspace rows should not visually drift from the filter edge.
- `SidebarWindow` projections exclude geometry so drag/resize/focus does not force sidebar re-renders.
- Sidebar click on a window switches to its workspace, focuses the window, and zooms/navigates canvas as needed.
- The file drawer is per-workspace and stored in localStorage under `korum-sidebar-ui`, not Rust settings.
- File drawer open/query/show-ignored are session UI state; do not persist them in `state.json`.
- If the file drawer is open, zoom reset and sidebar focus must account for drawer width.
- Keep global status panels out of the left Explorer; it is workspace and files only.
- Active file reveal opens the drawer, expands ancestors, fetches missing dirs, and preserves the user's filter.
- The sidebar + file drawer are docked edge-to-edge (flush left/top/bottom, `fixed inset-y-0 left-0`); only the right edge is bordered and rounded with the theme radius (`rounded-r-xl`), and that radius/border "moves" to the file drawer when it is open. Non-right borders are zeroed via inline `style` because the unlayered `.glass`/`.glass-subtle` border shorthand beats Tailwind `border-*-0`.
- Collapse is a single persistent toggle (HugeIcons `PanelLeftIcon`) pinned next to the macOS traffic lights; collapsing keeps the sidebar mounted and animates it out with the same transform-only drawer motion as SettingsPanel so local UI state is preserved. The file drawer uses the same transform-only duration/easing when opening/closing. The window stays draggable by the sidebar/drawer title bands via the shared `startWindowDragFromMouseDown` (guarded so buttons/inputs stay clickable). The sidebar's first row is an empty title band reserving the traffic-light area; `trafficLightPosition.y` is tuned to that row and only changes on app relaunch.
