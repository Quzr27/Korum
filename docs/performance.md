# Performance Notes

This file captures local performance decisions that should stay true as the app evolves.

## Canvas Motion

- Pan and zoom are ref-driven and write directly to DOM transforms during active motion.
- Terminal-to-diff tethers live inside `.canvas-world`, so the world transform moves them with the windows.
- Do not call the tether sync path from every wheel or pan mousemove event. Recompute tether endpoints when windows change, when the viewport resizes, after committed pan/zoom state, and during live window drag/resize.
- `buildTetherRenderIndex()` precomputes valid terminal-to-changes pairs plus the set of window ids that can affect tethers. `Canvas` uses that set to ignore live-rect updates from untethered windows.
- While `.canvas-viewport` is `.panning` or `.zooming`, tether dash animation and glow filters are suppressed. The animated theme-colored arrow returns after motion ends.

## Terminal Smart Links

- Smart-linked terminal file paths should not call the full workspace `get_git_status` command.
- Use `get_git_file_status(path, root)` for the clicked path only, then pass the single status into `selectSmartLinkCodeViewMode()`.
- The single-file status command intentionally returns `None` for clean, untracked, outside-repo, or no-repo paths so links fall back to normal `file` mode.
- `App.openFile()` deduplicates in-flight file opens and single-file status requests. Keep that guard when changing terminal link behavior, or rapid repeated clicks can do duplicate git work and create duplicate CodeWindows.

## Verification

Useful focused checks for these paths:

```bash
bun run test -- src/lib/window-tethers.test.ts src/lib/code-window-target.test.ts
bun run typecheck
cd src-tauri && cargo test get_git_file_status --lib
```

Full pre-handoff check:

```bash
bun run lint && bun run typecheck && bun run test && cd src-tauri && cargo check
cd src-tauri && cargo test
```
