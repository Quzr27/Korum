---
paths:
  - "package.json"
  - "bun.lock"
  - "vite.config.ts"
  - "tsconfig.json"
  - "eslint.config.js"
  - "vitest.config.ts"
  - "src-tauri/Cargo.toml"
  - "src-tauri/Cargo.lock"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/capabilities/**"
  - "src-tauri/dmg/**"
  - ".github/workflows/**"
---

# Build, Release, CI

- `bunx tauri dev` runs Tauri dev; Tauri calls `bun run dev`, which starts Vite on strict port `1420`.
- `bunx tauri build` runs the frontend `build` script first, then bundles the app from `dist`.
- Frontend checks are `bun run lint`, `bun run typecheck`, and `bun run test`; Rust checks are `cargo check` and `cargo test` inside `src-tauri`.
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `korum` entry), and `src-tauri/tauri.conf.json` currently agree on version `0.4.0`. Bump all four together for a release.
- Runtime versions are not pinned by `.node-version`, `.nvmrc`, `.tool-versions`, `rust-toolchain`, `engines`, or `packageManager`; do not invent a required version.
- Vite uses React Compiler through `babel-plugin-react-compiler`, Tailwind v4 via `@tailwindcss/vite`, and the `@/` alias to `src`.
- ESLint flat config ignores `src-tauri/`, `dist/`, and `src/components/ui/`; generated shadcn primitives are intentionally outside lint scope.
- CI runs Bun install, lint, frontend typecheck/tests, then Rust check/tests with Linux WebKit system dependencies.
- Release workflow builds macOS `aarch64-apple-darwin` and `x86_64-apple-darwin` artifacts on `v*` tags and creates a draft GitHub release.
- Tauri CSP must keep `script-src 'wasm-unsafe-eval'` for Shiki Oniguruma WASM in release builds.
- Keep `git2` with `vendored-openssl`; it avoids OpenSSL cross-build pain for macOS release artifacts.
- Tauri capabilities currently allow core default, native open dialog, clipboard manager, and `core:window:allow-start-dragging` for the main window; keep `src-tauri/gen/schemas/capabilities.json` in sync when permissions change.
- Main macOS window uses `titleBarStyle: "Overlay"` + `hiddenTitle` + a tuned `trafficLightPosition` so the canvas atmosphere renders behind the native traffic-light titlebar. Changing `trafficLightPosition` needs an app relaunch (it is read at window creation), not just Vite HMR. The transparent top drag strip must call `getCurrentWindow().startDragging()` and keep the `core:window:allow-start-dragging` capability — `data-tauri-drag-region` alone is not sufficient in this overlay setup. Keep the drag strip short (`--app-titlebar-drag-height`) and below the side panels (`z-30`) so it occludes minimal canvas and panel buttons stay clickable. Sidebar/file-drawer chrome layout (edge-to-edge panels, collapse toggle, dynamic right radius) is documented in `workspaces-sidebar.md`.
- `bundle.macOS.dmg` sets a `dmg/background.png` with explicit app/Applications icon positions (app `180,170`, Applications `480,170`, window `660x400`). The background is required: the forked `bundle_dmg.sh` only emits the "reposition hidden files" AppleScript clause when `--background` is passed, so without it the auto-generated `.VolumeIcon.icns` stays top-left. Regenerate with `python3 src-tauri/dmg/generate-background.py` (needs Pillow + numpy); keep the icon coordinates in sync with the config.
- The background **must be exactly the window size (660x400)**. A wider image makes Finder add a horizontal scrollbar (you can scroll past the design into empty space, exposing the parked hidden icons) — do not widen it to "fill" oversized windows.
- The bundler parks `.background`/`.VolumeIcon.icns` ~`window_width + 100` (~770px) to the right, just off the window. They only become visible if the user enables Finder's "show hidden files" (⌘⇧.), a dev-side setting — normal users see a clean window, so no post-processing is needed. (An earlier attempt to push them to `6000,6000` via a `.DS_Store` binary patch was dropped: any icon outside the window adds a scrollbar anyway, and it solved a problem real users don't have.)
- Building the DMG runs `bundle_dmg.sh`, which drives Finder via AppleScript. That (and `screencapture`) is TCC-blocked in Claude's shell (`-1743`), so `tauri build` DMG packaging fails in-session and the DMG must be built from a real terminal. To inspect a built DMG headlessly, re-parse its `.DS_Store` with the `ds_store` lib plus a `mac_alias.Bookmark.from_bytes` passthrough patch.
