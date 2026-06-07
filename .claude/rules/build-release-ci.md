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
- `bundle.macOS.dmg` sets a `dmg/background.png` (660x400) with explicit app/Applications icon positions. The background is required: the forked `bundle_dmg.sh` only emits the "reposition hidden files" AppleScript clause when `--background` is passed, so without it the auto-generated `.VolumeIcon.icns` stays at the top-left and shows in the installer window when Finder reveals hidden files. Regenerate the asset with `python3 src-tauri/dmg/generate-background.py` (Pillow); keep its dimensions and icon coordinates in sync with the config.
